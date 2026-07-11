-- ── Show "About" Section ──────────────────────────────────────────────────────

-- about: optional long-form text — the full story behind the show/cause,
--        shown in its own card on the public show page. Distinct from
--        `description`, which stays a short summary for the hero header.
ALTER TABLE shows
  ADD COLUMN IF NOT EXISTS about text;
