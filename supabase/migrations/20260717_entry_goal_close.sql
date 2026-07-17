-- ── Goal-based / indefinite entry close ──────────────────────────────────────
-- Lets an organiser leave entries open indefinitely and/or close them once a
-- fundraising goal is hit, instead of only a fixed entry_close_date. shows
-- already has fundraising_goal + show_fundraising_publicly (an informational
-- progress bar, no close behavior) — this extends that existing goal instead
-- of introducing a second parallel one, and adds the actual close behavior
-- as an explicit opt-in so existing shows with a goal set keep their current
-- (display-only) behavior unchanged.
--
-- entry_close_date, close_entries_on_goal, and manual close are independent —
-- a show can have a date, a goal-close, both (whichever trips first), or
-- neither (manual close only). show_date remains required and is always the
-- hard backstop: entries never outlive the actual show day regardless of
-- goal state.

ALTER TABLE shows
  ALTER COLUMN entry_close_date DROP NOT NULL,
  ALTER COLUMN entry_close_time DROP NOT NULL;

-- fundraising_goal_type: what the existing fundraising_goal number measures.
-- Defaults to 'amount' so existing rows (all currently money goals) keep
-- their meaning unchanged.
ALTER TABLE shows
  ADD COLUMN IF NOT EXISTS fundraising_goal_type text NOT NULL DEFAULT 'amount';

ALTER TABLE shows
  ADD CONSTRAINT shows_fundraising_goal_type_check
    CHECK (fundraising_goal_type IN ('amount', 'entries'));

-- close_entries_on_goal: explicit opt-in, separate from show_fundraising_publicly.
-- A goal can be set and displayed publicly purely for informational purposes
-- without ever auto-closing entries — this must default false so existing
-- shows with a goal already configured don't suddenly start auto-closing.
ALTER TABLE shows
  ADD COLUMN IF NOT EXISTS close_entries_on_goal boolean NOT NULL DEFAULT false;

-- entries_closed_at/reason: stamped once, by whichever condition trips first
-- (date reached, goal reached, organiser manual close, or show_date arriving
-- as the backstop). Lets the public page and organiser see *why* it closed
-- instead of re-deriving it from possibly-null date/goal fields.
ALTER TABLE shows
  ADD COLUMN IF NOT EXISTS entries_closed_at     timestamptz,
  ADD COLUMN IF NOT EXISTS entries_closed_reason text;

ALTER TABLE shows
  ADD CONSTRAINT shows_entries_closed_reason_check
    CHECK (entries_closed_reason IS NULL OR entries_closed_reason IN ('date', 'goal', 'manual', 'show_date')),
  ADD CONSTRAINT shows_entries_closed_paired_check
    CHECK ((entries_closed_at IS NULL) = (entries_closed_reason IS NULL));
