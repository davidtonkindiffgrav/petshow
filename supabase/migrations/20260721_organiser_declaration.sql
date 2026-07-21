-- ── Organiser Representation & Authority Declaration ──────────────────────────

-- organiser_declaration_accepted_at: timestamp the organiser ticked the
-- mandatory "Organiser Representation & Authority" checkbox when publishing
-- a show. Null until Publish Now is first clicked; provides an audit trail
-- for the legal authority / no-liability declaration.
ALTER TABLE shows
  ADD COLUMN IF NOT EXISTS organiser_declaration_accepted_at timestamptz;
