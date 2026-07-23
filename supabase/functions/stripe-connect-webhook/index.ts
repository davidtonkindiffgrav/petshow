import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'npm:stripe@18';
// Same SDK-version note as stripe-connect-onboarding/index.ts — bump the pin
// to whatever's current if v2.core.* calls come back undefined.

// Separate function/webhook destination from stripe-webhook/index.ts on
// purpose: this is Stripe's V2 Accounts API, delivered as "thin events" (the
// payload only carries an id/type — the full object is a second fetch) to a
// distinct "Connected accounts" webhook destination with its own signing
// secret, whereas stripe-webhook/index.ts handles V1 snapshot events for
// checkout.session.completed on the platform's own endpoint. Bolting these
// together would mean one file juggling two unrelated parsing paradigms for
// no benefit — the existing checkout webhook needs zero changes for Connect.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const sig = req.headers.get('stripe-signature');
  const body = await req.text();

  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-04-10' });

  let thinEvent: any;
  try {
    thinEvent = (stripe as any).parseThinEvent(body, sig!, Deno.env.get('STRIPE_CONNECT_WEBHOOK_SECRET')!);
  } catch (err: any) {
    return new Response(`Webhook signature verification failed: ${err.message}`, { status: 400 });
  }

  const HANDLED_TYPES = new Set([
    'v2.core.account[requirements].updated',
    'v2.core.account[configuration.merchant].capability_status_updated',
    'v2.core.account[configuration.recipient].capability_status_updated',
  ]);

  if (HANDLED_TYPES.has(thinEvent.type)) {
    try {
      const event = await (stripe as any).v2.core.events.retrieve(thinEvent.id);

      // TODO(verify against current Stripe docs): the exact field carrying
      // the connected account's id on a retrieved V2 event. Using
      // related_object.id as the best-available guess from Stripe's V2
      // events model (thin events carry a related_object pointer) — confirm
      // during Phase 7 end-to-end testing and adjust if this comes back
      // undefined (check event.data / event.context as fallbacks).
      const accountId: string | undefined = event.related_object?.id || event.data?.id;
      if (!accountId) throw new Error('Could not determine account id from event payload');

      const account = await (stripe as any).v2.core.accounts.retrieve(accountId, {
        include: ['configuration.merchant', 'configuration.recipient', 'requirements'],
      });

      const cardPaymentsStatus: string | null = account.configuration?.merchant?.capabilities?.card_payments?.status ?? null;
      const chargesReady = cardPaymentsStatus === 'active';

      // TODO(verify against current Stripe docs): the exact field for the
      // recipient/payout capability's status — we requested
      // configuration.recipient.capabilities.bank_accounts.local at account
      // creation (see stripe-connect-onboarding/index.ts), so reading the
      // mirrored path here; confirm during Phase 7 testing.
      const payoutsStatus: string | null = account.configuration?.recipient?.capabilities?.bank_accounts?.local?.status ?? null;
      const payoutsReady = payoutsStatus === 'active';

      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      );

      const updates = {
        stripe_card_payments_status: cardPaymentsStatus,
        stripe_charges_ready: chargesReady,
        stripe_payouts_ready: payoutsReady,
        stripe_account_updated_at: new Date().toISOString(),
      };

      // Account id is unique across both tables (enforced by the Phase 1
      // migration's partial unique indexes) — try profiles first, then
      // organisations.
      const { data: updatedProfiles } = await supabase.from('profiles')
        .update(updates).eq('stripe_account_id', accountId).select('id');
      if (!updatedProfiles?.length) {
        await supabase.from('organisations').update(updates).eq('stripe_account_id', accountId);
      }

      await supabase.from('audit_log').insert({
        action: 'connect_account.status_changed',
        entity_type: 'stripe_account',
        entity_id: accountId,
        details: updates,
      });
    } catch (err: any) {
      console.error('Failed to process Connect account event:', err.message);
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
