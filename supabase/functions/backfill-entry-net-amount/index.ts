import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'npm:stripe@14';

// Called hourly by a pg_cron + pg_net job (see the
// 20260724b_backfill_entry_net_amount_cron.sql migration) — not public-facing,
// so this deploys WITHOUT --no-verify-jwt. The cron job authenticates with
// the project's service_role key (via Supabase Vault, reusing the same
// goal_reminder_service_role_key secret the goal-reminder cron already uses).
//
// stripe-webhook already tries to fetch each entry's real net-per-entry (from
// Stripe's balance transaction) live at confirmation time, with a ~7s retry
// window for the usual settlement lag. This is the safety net for the rare
// case that still isn't enough — a longer-than-usual delay, a transient
// Stripe API error, etc. Every "amount raised" consumer already falls back
// to the organiserNet() estimate for any entry_net_amount that's still null,
// so a straggler here is a display-only inaccuracy, never a blocked entry —
// this job just closes that gap automatically instead of leaving it null
// forever with nobody watching the function logs.

serve(async (_req: Request) => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-04-10' });

    // Only Connect-processed entries (stripe_account_id set) ever get a real
    // net figure — anything else is either free or the dead legacy path, and
    // would just waste a Stripe call for nothing.
    const { data: rows, error: fetchErr } = await supabase
      .from('show_entries')
      .select('id, stripe_session_id, stripe_account_id')
      .eq('status', 'confirmed')
      .is('entry_net_amount', null)
      .not('stripe_account_id', 'is', null)
      .not('stripe_session_id', 'is', null);
    if (fetchErr) throw new Error('Failed to load stragglers: ' + fetchErr.message);

    // Group by session — one checkout session can cover multiple entries,
    // and the net splits evenly across them, same as stripe-webhook does.
    const bySession = new Map<string, { accountId: string; entryIds: string[] }>();
    for (const r of (rows || [])) {
      const key = r.stripe_session_id as string;
      if (!bySession.has(key)) bySession.set(key, { accountId: r.stripe_account_id, entryIds: [] });
      bySession.get(key)!.entryIds.push(r.id);
    }

    let fixed = 0, stillMissing = 0;
    for (const [sessionId, { accountId, entryIds }] of bySession) {
      try {
        const session: any = await stripe.checkout.sessions.retrieve(
          sessionId, {}, { stripeAccount: accountId },
        );
        const pi: any = await stripe.paymentIntents.retrieve(
          session.payment_intent, { expand: ['latest_charge.balance_transaction'] }, { stripeAccount: accountId },
        );
        const bt = pi.latest_charge?.balance_transaction;
        if (bt?.net == null) { stillMissing++; continue; }

        const netPerEntry = (bt.net / 100) / entryIds.length;
        const { error: updErr } = await supabase
          .from('show_entries').update({ entry_net_amount: netPerEntry }).in('id', entryIds);
        if (updErr) { console.error(`Failed to backfill session ${sessionId}:`, updErr.message); continue; }
        fixed += entryIds.length;
      } catch (err: any) {
        console.error(`Failed to backfill session ${sessionId}:`, err.message);
        stillMissing++;
      }
    }

    return new Response(JSON.stringify({ sessionsChecked: bySession.size, entriesFixed: fixed, stillMissing }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('backfill-entry-net-amount failed:', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal error' }), {
      headers: { 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
