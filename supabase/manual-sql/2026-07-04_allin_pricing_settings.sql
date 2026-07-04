-- All-in pricing settings for platform_settings
-- (this table is managed manually in the Supabase dashboard, not via migrations)
--
-- The new create-checkout-session Edge Function was deployed 4 July 2026.
-- Run this whole script once in the Supabase dashboard SQL editor.
-- Checkout will 400 with "Entry fees are not configured" until Part A runs.

-- ── PART A ─────────────────────────────────────────────────────────────────

-- Ensure key is unique so ON CONFLICT works (no-op if already PK/unique)
create unique index if not exists platform_settings_key_uniq on platform_settings (key);

-- Platform-fee floors (AUD anchor 1.00, others relative)
insert into platform_settings (key, value) values
  ('service_fee_floor_AUD', '1.00'),
  ('service_fee_floor_NZD', '1.10'),
  ('service_fee_floor_GBP', '0.50'),
  ('service_fee_floor_USD', '0.70'),
  ('service_fee_floor_EUR', '0.60'),
  ('service_fee_floor_CAD', '0.90'),
  ('service_fee_floor_SGD', '0.90'),
  ('service_fee_floor_ZAR', '12.00')
on conflict (key) do update set value = excluded.value;

-- Minimum all-in entry fee per currency (replaces the hardcoded MIN_ENTRY_FEE map)
insert into platform_settings (key, value) values
  ('min_entry_fee_AUD', '3'),
  ('min_entry_fee_NZD', '3'),
  ('min_entry_fee_GBP', '2'),
  ('min_entry_fee_USD', '2'),
  ('min_entry_fee_EUR', '2'),
  ('min_entry_fee_CAD', '2'),
  ('min_entry_fee_SGD', '3'),
  ('min_entry_fee_ZAR', '25')
on conflict (key) do update set value = excluded.value;

-- Stripe processing-fee ESTIMATE for the organiser "you receive" figure
-- (domestic-card rate; pct is global, fixed portion is per-currency)
insert into platform_settings (key, value) values
  ('stripe_fee_pct', '1.75'),
  ('stripe_fee_fixed_AUD', '0.30'),
  ('stripe_fee_fixed_NZD', '0.30'),
  ('stripe_fee_fixed_GBP', '0.20'),
  ('stripe_fee_fixed_USD', '0.30'),
  ('stripe_fee_fixed_EUR', '0.25'),
  ('stripe_fee_fixed_CAD', '0.30'),
  ('stripe_fee_fixed_SGD', '0.50'),
  ('stripe_fee_fixed_ZAR', '2.00')
on conflict (key) do update set value = excluded.value;

-- service_fee_pct (8) is intentionally left unchanged.

-- ── PART B ─────────────────────────────────────────────────────────────────

-- Delete the stale flat per-entry fee rows the old Edge Function used.
-- Matches exactly service_fee_ + 3 uppercase letters (service_fee_AUD etc.);
-- does NOT match service_fee_pct or service_fee_floor_*.
delete from platform_settings where key ~ '^service_fee_[A-Z]{3}$';
