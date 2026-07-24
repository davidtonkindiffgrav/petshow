-- ── entry_net_amount reconciliation scheduling ────────────────────────────────
-- Safety net for stripe-webhook's live balance-transaction fetch (which
-- already retries for ~7s to cover ordinary Stripe settlement lag): anything
-- still null after that gets picked up hourly by this job and retried again,
-- so a rare longer delay or transient API error doesn't leave entry_net_amount
-- null forever with nobody watching the function logs. Every "amount raised"
-- consumer already falls back to the organiserNet() estimate for null rows,
-- so this is purely closing the gap between estimate and Stripe's real
-- figure sooner — never something an entry's confirmation depends on.
--
-- Reuses the existing goal_reminder_service_role_key Vault secret (see
-- 20260717b_goal_reminder.sql) rather than creating a second one — it's the
-- same service_role key either way.
--
-- IMPORTANT — before running the block below, replace YOUR_PROJECT_REF with
-- this project's actual Supabase project ref.

select cron.schedule(
  'backfill-entry-net-amount',
  '0 * * * *', -- hourly, on the hour
  $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/backfill-entry-net-amount',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'goal_reminder_service_role_key'
      )
    ),
    body := '{}'::jsonb
  );
  $$
);
