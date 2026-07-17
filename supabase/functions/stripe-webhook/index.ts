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

  const { count } = await supabase
    .from('show_entries')
    .select('id', { count: 'exact', head: true }).eq('show_id', showId).eq('status', 'confirmed');
  const confirmedCount = count || 0;

  let total: number;
  if (show.fundraising_goal_type === 'entries') {
    total = confirmedCount;
  } else {
    const { data: feeRows } = await supabase
      .from('platform_settings').select('key, value').or('key.like.service_fee_%,key.like.stripe_fee_%');
    const settings: Record<string, number> = {};
    for (const r of (feeRows || [])) settings[r.key] = parseFloat(r.value) || 0;
    const netPerEntry = organiserNet(show.entry_fee || 0, show.currency || 'AUD', settings) ?? 0;
    total = confirmedCount * netPerEntry;
  }

  if (total >= show.fundraising_goal) {
    await supabase.from('shows')
      .update({ entries_closed_at: new Date().toISOString(), entries_closed_reason: 'goal' })
      .eq('id', showId).is('entries_closed_at', null);
  }
}

serve(async (req: Request) => {
  const sig  = req.headers.get('stripe-signature');
  const body = await req.text();

  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-04-10' });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig!, Deno.env.get('STRIPE_WEBHOOK_SECRET')!);
  } catch (err: any) {
    return new Response(`Webhook signature verification failed: ${err.message}`, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session    = event.data.object as Stripe.Checkout.Session;
    const amountPaid = (session.amount_total || 0) / 100;
    const entryCount = parseInt(session.metadata?.entry_count || '1', 10);
    const perEntry   = entryCount > 0 ? amountPaid / entryCount : amountPaid;
    const showId     = session.metadata?.show_id;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { error } = await supabase
      .from('show_entries')
      .update({ status: 'confirmed', entry_fee_paid: perEntry })
      .eq('stripe_session_id', session.id);

    if (error) console.error('Failed to confirm entries:', error.message);
    else if (showId) await checkAndCloseOnGoal(supabase, showId);
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
