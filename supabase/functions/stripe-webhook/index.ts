import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'npm:stripe@14';

// Mirrors src/lib/fees.js — duplicated here since this Deno function can't
// import a Vite-bundled frontend module. "You receive" is what the organiser
// actually gets after platform + Stripe fees, same figure shown on the
// public/organiser pages, so a money-based goal must be compared to it too.
function organiserNet(total: number, currency: string, settings: Record<string, number>): number | null {
  const pct = settings['service_fee_pct'];
  const floor = settings[`service_fee_floor_${currency}`];
  if (pct == null || floor == null) return null;
  const platformFee = Math.max(floor, total * pct / 100);

  const stripePct = settings['stripe_fee_pct'];
  const stripeFixed = settings[`stripe_fee_fixed_${currency}`];
  if (stripePct == null || stripeFixed == null) return null;
  const stripeFee = total * stripePct / 100 + stripeFixed;

  return Math.max(0, total - platformFee - stripeFee);
}

// Real net-per-entry (captured from Stripe's own balance transaction at
// confirmation, see entry_net_amount below) summed directly — falls back to
// the organiserNet() estimate only for rows confirmed before that capture
// existed (entry_net_amount null). Keeps "amount raised" matching what
// Stripe itself shows the organiser instead of drifting from real
// per-transaction fees (confirmed live: our stripe_fee_pct/fixed settings
// assumed a domestic-card rate; an actual test charge came back at the
// higher foreign-card rate, an 8 cent gap on a $5 entry).
async function sumConfirmedNet(
  supabase: ReturnType<typeof createClient>, showId: string, entryFee: number, currency: string,
): Promise<number> {
  const { data: entries } = await supabase
    .from('show_entries').select('entry_net_amount').eq('show_id', showId).eq('status', 'confirmed');
  let total = 0, missing = 0;
  for (const e of (entries || [])) {
    if (e.entry_net_amount != null) total += Number(e.entry_net_amount);
    else missing++;
  }
  if (missing > 0) {
    const { data: feeRows } = await supabase
      .from('platform_settings').select('key, value').or('key.like.service_fee_%,key.like.stripe_fee_%');
    const settings: Record<string, number> = {};
    for (const r of (feeRows || [])) settings[r.key] = parseFloat(r.value) || 0;
    total += missing * (organiserNet(entryFee || 0, currency || 'AUD', settings) ?? 0);
  }
  return total;
}

// If this show has opted into closing entries once a fundraising goal is
// met, check the running total after every confirmed payment and stamp
// entries_closed_at the moment it's crossed. Event-driven — no cron needed.
// Concurrent near-goal checkouts may both land and overshoot slightly;
// that's expected, the important thing is closing promptly once crossed.
async function checkAndCloseOnGoal(supabase: ReturnType<typeof createClient>, showId: string) {
  const { data: show } = await supabase
    .from('shows')
    .select('close_entries_on_goal, fundraising_goal, fundraising_goal_type, entries_closed_at, entry_fee, currency')
    .eq('id', showId).single();

  if (!show || !show.close_entries_on_goal || !show.fundraising_goal || show.entries_closed_at) return;

  let total: number;
  if (show.fundraising_goal_type === 'entries') {
    const { count } = await supabase
      .from('show_entries')
      .select('id', { count: 'exact', head: true }).eq('show_id', showId).eq('status', 'confirmed');
    total = count || 0;
  } else {
    total = await sumConfirmedNet(supabase, showId, show.entry_fee, show.currency);
  }

  if (total >= show.fundraising_goal) {
    await supabase.from('shows')
      .update({ entries_closed_at: new Date().toISOString(), entries_closed_reason: 'goal' })
      .eq('id', showId).is('entries_closed_at', null);
  }
}

// The balance transaction can attach to the charge a moment after
// checkout.session.completed fires (confirmed live: a charge came back
// captured/paid/succeeded with balance_transaction: null) — retry with
// backoff rather than treating a first-attempt miss as unavailable.
async function fetchNetPerEntry(
  stripe: Stripe, connectedAccountId: string, paymentIntentId: string, entryCount: number,
): Promise<number | null> {
  const delaysMs = [1000, 2000, 4000];
  for (let attempt = 0; attempt <= delaysMs.length; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, delaysMs[attempt - 1]));
    try {
      const pi: any = await stripe.paymentIntents.retrieve(
        paymentIntentId,
        { expand: ['latest_charge.balance_transaction'] },
        { stripeAccount: connectedAccountId },
      );
      const bt = pi.latest_charge?.balance_transaction;
      if (bt?.net != null && entryCount > 0) return (bt.net / 100) / entryCount;
    } catch (err: any) {
      console.error('Failed to fetch balance transaction for net amount:', err.message);
      return null;
    }
  }
  return null;
}

serve(async (req: Request) => {
  const sig  = req.headers.get('stripe-signature');
  const body = await req.text();

  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-04-10' });

  // Two separate Stripe destinations now deliver to this one URL, each with
  // its own signing secret: the original "Your account" destination
  // (STRIPE_WEBHOOK_SECRET, for indirect/platform checkouts), and a newer
  // "Connected accounts" destination (STRIPE_CONNECT_CHECKOUT_WEBHOOK_SECRET)
  // — required because Direct-charge checkout.session.completed events are
  // only ever delivered under the Connected-accounts scope, which can't be
  // added to an existing "Your account" destination after creation. Try
  // both; whichever one signed this request will verify.
  let event: Stripe.Event | undefined;
  let lastErr: any;
  for (const secret of [Deno.env.get('STRIPE_WEBHOOK_SECRET')!, Deno.env.get('STRIPE_CONNECT_CHECKOUT_WEBHOOK_SECRET')!]) {
    try {
      event = await stripe.webhooks.constructEventAsync(body, sig!, secret);
      break;
    } catch (err: any) {
      lastErr = err;
    }
  }
  if (!event) {
    return new Response(`Webhook signature verification failed: ${lastErr?.message}`, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session    = event.data.object as Stripe.Checkout.Session;
    const amountPaid = (session.amount_total || 0) / 100;
    const entryCount = parseInt(session.metadata?.entry_count || '1', 10);
    const perEntry   = entryCount > 0 ? amountPaid / entryCount : amountPaid;
    const showId     = session.metadata?.show_id;
    // Present when Stripe delivered this via the Connected-accounts scope
    // (Direct charge) — absent for the legacy platform-only path, which is
    // dead for any new paid show since publishing one now requires
    // stripe_charges_ready (see organiser/show.astro's publish gate).
    const connectedAccountId = (event as any).account as string | undefined;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Confirm immediately — never let the entry's confirmed status wait on
    // the balance transaction fetch below, which can legitimately still be
    // pending at this instant (confirmed live: charge came back
    // captured/paid/succeeded but with balance_transaction: null — a known
    // Stripe timing gap, not an error, especially on a brand-new connected
    // account's first transactions).
    const { error } = await supabase
      .from('show_entries')
      .update({ status: 'confirmed', entry_fee_paid: perEntry })
      .eq('stripe_session_id', session.id);

    if (error) {
      console.error('Failed to confirm entries:', error.message);
    } else {
      if (connectedAccountId && session.payment_intent) {
        const netPerEntry = await fetchNetPerEntry(stripe, connectedAccountId, session.payment_intent as string, entryCount);
        if (netPerEntry != null) {
          const { error: netErr } = await supabase
            .from('show_entries').update({ entry_net_amount: netPerEntry }).eq('stripe_session_id', session.id);
          if (netErr) console.error('Failed to store net amount:', netErr.message);
        } else {
          console.error(`Balance transaction net amount never became available for session ${session.id}`);
        }
      }
      if (showId) await checkAndCloseOnGoal(supabase, showId);
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
