-- ── Voting Window Settings ────────────────────────────────────────────────────

-- show_time: optional show start time 'HH:MM' (paired with show_date, in the show's
--            timezone). For public vote shows, voting cuts off at this moment;
--            blank means midnight at the start of show day.
-- vote_open_mode: when public voting opens —
--            'on_entries_open'     voting runs alongside entries from the moment they open
--            'after_entries_close' voting opens only once entries close (default)
ALTER TABLE shows
  ADD COLUMN IF NOT EXISTS show_time text,
  ADD COLUMN IF NOT EXISTS vote_open_mode text NOT NULL DEFAULT 'after_entries_close'
    CHECK (vote_open_mode IN ('on_entries_open', 'after_entries_close'));
