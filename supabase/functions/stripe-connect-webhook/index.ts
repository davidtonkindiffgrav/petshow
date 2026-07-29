import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
// Same SDK-version fix as stripe-connect-onboarding/index.ts — @18 didn't
// expose v2.core.* at all. Bumped to @22.
import Stripe from 'npm:stripe@22';

import { computeConnectStatus } from '../_shared/connect.ts';

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

  // Pinned to .preview, same reason as stripe-connect-onboarding/index.ts:
  // this function reads back configuration.recipient (preview-only) via
  // accounts.retrieve's `include` below.
  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2026-06-24.preview' });

  // stripe-node renamed this in v19 (we're on v22): parseThinEvent doesn't
  // exist any more — confirmed live: "stripe.parseThinEvent is not a
  // function". parseEventNotification returns a richer object with a
  // related_object field (snake_case — verified against the actual v22
  // package source; despite the changelog prose saying "relatedObject",
  // the parsed object itself is untouched JSON) instead of requiring a
  // separate events.retrieve round-trip to find the account id.
  //
  // Must use the *Async* variant + an explicit SubtleCryptoProvider: Deno
  // has no Node crypto module, so the sync path's default crypto provider
  // can't compute the HMAC synchronously — confirmed live: "SubtleCrypto
  // Provider cannot be used in a synchronous context".
  const cryptoProvider = (Stripe as any).createSubtleCryptoProvider();
  let eventNotification: any;
  try {
    eventNotification = await (stripe as any).parseEventNotificationAsync(
      body, sig!, Deno.env.get('STRIPE_CONNECT_WEBHOOK_SECRET')!, undefined, cryptoProvider,
    );
  } catch (err: any) {
    return new Response(`Webhook signature verification failed: ${err.message}`, { status: 400 });
  }

  const HANDLED_TYPES = new Set([
    'v2.core.account[requirements].updated',
    'v2.core.account[configuration.merchant].capability_status_updated',
    'v2.core.account[configuration.recipient].capability_status_updated',
  ]);

  // Temporary diagnostic: 29 Jul 2026 live-cutover testing showed Stripe
  // delivering these exact event types and getting 200 back, but nothing
  // ever reached audit_log and nothing appeared in this function's console
  // logs either — which only happens if HANDLED_TYPES.has(eventNotification
  // .type) is false, skipping both the success and error log paths entirely.
  // Logging unconditionally here to see the real type/keys on the next
  // delivery instead of guessing again. Remove once root-caused.
  console.log('Connect webhook received', {
    type: eventNotification?.type,
    keys: eventNotification ? Object.keys(eventNotification) : null,
    relatedObjectId: eventNotification?.related_object?.id ?? eventNotification?.relatedObject?.id,
  });

  if (HANDLED_TYPES.has(eventNotification.type)) {
    try {
      const accountId: string | undefined = eventNotification.related_object?.id;
      if (!accountId) throw new Error('Could not determine account id from event payload');

      const account = await (stripe as any).v2.core.accounts.retrieve(accountId, {
        include: ['configuration.merchant', 'configuration.recipient', 'requirements'],
      });

      // TODO(verify against current Stripe docs / during live testing): we
      // dropped configuration.recipient entirely from account creation (see
      // stripe-connect-onboarding/index.ts — it's for indirect-charge money
      // movement, not our Direct-charge model), so account.configuration
      // .recipient is always undefined now and the old bank_accounts.local
      // path here never matched. Requesting the `merchant` configuration is
      // documented to auto-provision a stripe_balance.payouts capability
      // alongside card_payments (since the merchant account needs its own
      // balance paid out), so trying that path — but this field wasn't
      // confirmed against a live account response. If this stays null,
      // inspect a real account.configuration.merchant.capabilities object
      // and adjust the path; stripe_payouts_ready never blocks anything
      // (only drives the settings page's "finish verification" banner), so
      // it's safe to leave under-reporting while this gets nailed down.
      const updates = computeConnectStatus(account);
      const { stripe_card_payments_status: cardPaymentsStatus, stripe_charges_ready: chargesReady, stripe_payouts_ready: payoutsReady } = updates;

      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      );

      // Account id is unique across both tables (enforced by the Phase 1
      // migration's partial unique indexes) — try profiles first, then
      // organisations. supabase-js doesn't throw on a failed update, it
      // returns { data, error } — surface both explicitly instead of
      // silently dropping errors like the previous version of this code did
      // (confirmed live: DB rows stayed unchanged with zero errors anywhere
      // because nothing ever inspected .error).
      const { data: updatedProfiles, error: profilesErr } = await supabase.from('profiles')
        .update(updates).eq('stripe_account_id', accountId).select('id');
      if (profilesErr) console.error('profiles update failed:', profilesErr.message);
      let updatedOrgs: any[] | null = null;
      if (!updatedProfiles?.length) {
        const { data, error: orgsErr } = await supabase.from('organisations')
          .update(updates).eq('stripe_account_id', accountId).select('id');
        if (orgsErr) console.error('organisations update failed:', orgsErr.message);
        updatedOrgs = data;
      }
      console.log('Connect webhook processed', {
        type: eventNotification.type, accountId, cardPaymentsStatus, chargesReady, payoutsReady,
        matchedProfile: updatedProfiles?.[0]?.id ?? null, matchedOrg: updatedOrgs?.[0]?.id ?? null,
      });

      // entity_id is uuid (audit_log was designed around entities like
      // 'settlement' that have uuid ids) — a Stripe account id like
      // "acct_..." doesn't fit, confirmed live: "invalid input syntax for
      // type uuid". Leave it null and carry the account id in details
      // instead, same as entity_type-only rows elsewhere.
      const { error: auditErr } = await supabase.from('audit_log').insert({
        action: 'connect_account.status_changed',
        entity_type: 'stripe_account',
        entity_id: null,
        details: { ...updates, stripe_account_id: accountId },
      });
      if (auditErr) console.error('audit_log insert failed:', auditErr.message);
    } catch (err: any) {
      console.error('Failed to process Connect account event:', err.message);
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
