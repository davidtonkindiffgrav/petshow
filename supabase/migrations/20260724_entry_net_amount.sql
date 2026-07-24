-- Real per-entry net proceeds, captured from Stripe's own balance transaction
-- at confirmation time (stripe-webhook, checkout.session.completed) — not
-- estimated. entry_fee_paid (unchanged) stays the gross all-in amount the
-- entrant paid; this is what actually lands in the organiser's connected
-- Stripe account after Stripe's real per-transaction fee + our application
-- fee, both pulled from the PaymentIntent's balance_transaction.
--
-- Only populated for Direct-charge (Connect) entries — null for anything
-- confirmed before this column existed, or via the legacy non-Connect
-- checkout path (dead for any new paid show, since publishing one now
-- requires stripe_charges_ready). Every "amount raised" consumer sums this
-- directly and only falls back to the organiserNet() estimate for rows
-- where it's null, so the figure organisers see matches what Stripe itself
-- reports instead of drifting from real per-transaction fees (confirmed
-- live: our stripe_fee_pct/fixed settings assumed a domestic-card rate,
-- but a test charge came back at the higher foreign-card rate — an 8 cent
-- gap on a $5 entry).

ALTER TABLE show_entries
  ADD COLUMN IF NOT EXISTS entry_net_amount numeric;
