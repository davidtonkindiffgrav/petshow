-- ── Goal-reminder scheduling ──────────────────────────────────────────────────
-- A one-shot heads-up email to the organiser when a show is close_entries_on_goal,
-- Show Day is approaching, and the goal hasn't been reached yet. Checked daily
-- by a pg_cron job that calls the send-goal-reminder Edge Function.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Set once the reminder has been sent, so it's a single email per show, not a
-- repeat every day the cron runs.
alter table shows
  add column if not exists goal_reminder_sent_at timestamptz;

-- How many days before Show Day the reminder fires. Lives in platform_settings
-- (not hardcoded) so it's editable from Admin > Settings without a redeploy —
-- it automatically appears in that page's generic "Other Settings" card.
insert into platform_settings (key, value)
values ('goal_reminder_days_before', '3')
on conflict (key) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- IMPORTANT — before running the block below:
--
-- 1. Replace YOUR_PROJECT_REF in the url below with this project's actual
--    Supabase project ref (from the dashboard URL / Project Settings > API).
--
-- 2. Create the Vault secret this job reads its auth header from. Run this
--    SEPARATELY in the SQL editor — never put the real key in a migration file:
--
--      select vault.create_secret(
--        '<paste your service_role key here>',
--        'goal_reminder_service_role_key'
--      );
--
--    The cron job below only ever references that secret by name.
-- ─────────────────────────────────────────────────────────────────────────────

select cron.schedule(
  'goal-reminder-check',
  '0 9 * * *', -- 09:00 UTC daily
  $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/send-goal-reminder',
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
