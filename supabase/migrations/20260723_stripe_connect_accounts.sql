-- ── Stripe Connect (per-organiser/per-club connected accounts) ───────────────
--
-- Additive only. Nothing here changes behaviour for organisers who never
-- connect a Stripe account — create-checkout-session keeps using today's
-- single-platform-account Checkout Session for them, untouched.
--
-- Account scope is per-organiser or per-club, never per-show: an individual
-- organiser's account lives on their own profiles row; a club's account is
-- shared on the organisations row so every member's shows use the same one.
-- Whoever calls stripe-connect-onboarding owns exactly one of these two rows
-- (resolved the same way `organiser/settings.astro` already resolves club vs
-- individual organisers today: organisation_id set -> organisations row,
-- else -> the caller's own profiles row).
--
-- Two readiness flags, not one, because we're using Stripe's deferred/
-- progressive onboarding: an account can accept charges (country + minimal
-- info) well before it clears full identity verification for payouts.
--   stripe_charges_ready  -> gates publishing a paid show (create-checkout-
--                            session and getPublishReadiness() both check
--                            only this).
--   stripe_payouts_ready  -> never blocks anything; only drives a "finish
--                            verifying to get paid" reminder banner.
-- Both are cached copies of Stripe's own account state, kept in sync purely
-- by the stripe-connect-webhook function (V2 thin events) — nothing reads
-- these synchronously from the Stripe API.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS stripe_account_id           text,
  ADD COLUMN IF NOT EXISTS stripe_account_country       text,
  ADD COLUMN IF NOT EXISTS stripe_card_payments_status  text,
  ADD COLUMN IF NOT EXISTS stripe_charges_ready         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_payouts_ready         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_account_updated_at    timestamptz;

ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS stripe_account_id           text,
  ADD COLUMN IF NOT EXISTS stripe_account_country       text,
  ADD COLUMN IF NOT EXISTS stripe_card_payments_status  text,
  ADD COLUMN IF NOT EXISTS stripe_charges_ready         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_payouts_ready         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_account_updated_at    timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_stripe_account_id_key
  ON profiles (stripe_account_id) WHERE stripe_account_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS organisations_stripe_account_id_key
  ON organisations (stripe_account_id) WHERE stripe_account_id IS NOT NULL;

-- Denormalised onto the entry itself so admin/reporting can tell which
-- connected account processed a given entry without a second remote Stripe
-- call. Left null on every historic/legacy row — populated going forward
-- only, whenever create-checkout-session takes the Connect branch.
ALTER TABLE show_entries
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text,
  ADD COLUMN IF NOT EXISTS stripe_account_id         text;

-- No RLS policy changes: these are new columns on tables organisers can
-- already SELECT/UPDATE their own row of (RLS is row-scoped, not
-- column-scoped), and every write to the stripe_* columns above happens via
-- an Edge Function's service-role client (stripe-connect-onboarding,
-- stripe-connect-webhook), which bypasses RLS entirely — same pattern as
-- settlements/show_payout_details verification writes today.
