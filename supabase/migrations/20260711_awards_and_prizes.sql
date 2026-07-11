-- Awards & Prizes redesign: per-category awards.
--
-- Replaces the flat, disconnected `show_prizes` free-text list with a proper
-- awards catalogue that categories can reference. One row per distinct
-- award/prize an organiser defines for a show; show_categories.award_id lets
-- multiple categories point at the same award (reuse), and a single award
-- row bundles both a certificate and a physical prize via its two boolean
-- flags rather than needing two separate rows.
--
-- show_prizes and shows.prize_source/has_digital_certs/has_physical_prizes
-- are NOT touched here and become legacy/unused columns going forward — no
-- data migration, old rows/values are left in place, just no longer read or
-- written by the organiser UI.

CREATE TABLE IF NOT EXISTS awards (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id               uuid        NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  name                  text        NOT NULL,
  includes_certificate  boolean     NOT NULL DEFAULT true,
  includes_physical     boolean     NOT NULL DEFAULT false,
  physical_description  text,
  image_url             text,
  sponsor_id            uuid        REFERENCES show_sponsors(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS awards_show_id_idx ON awards(show_id);

ALTER TABLE show_categories
  ADD COLUMN IF NOT EXISTS award_id uuid REFERENCES awards(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS show_categories_award_id_idx ON show_categories(award_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE awards ENABLE ROW LEVEL SECURITY;

-- Public read, gated on the parent show being published — identical pattern
-- to show_categories/show_sponsors in
-- supabase/manual-sql/2026-07-05_public_read_categories_sponsors.sql.
DROP POLICY IF EXISTS "public read awards of published shows" ON awards;
CREATE POLICY "public read awards of published shows" ON awards
  FOR SELECT TO public
  USING (
    EXISTS (SELECT 1 FROM shows s WHERE s.id = awards.show_id AND s.status = 'published')
  );

-- Owner (organiser) read/write on their own shows' awards, including while
-- the show is still a draft.
--
-- NOTE FOR DAVID: this mirrors the `shows.created_by = auth.uid()` idiom
-- used everywhere else in this codebase (settlements, storage policies,
-- certs policies — see 2026-07-05_storage_certs_policies.sql) but
-- show_categories' own owner-write policy was never versioned in this repo
-- (it was set up directly in the Supabase dashboard, exact text unknown).
-- Please compare this against the real show_categories policy in the
-- dashboard and reconcile if it differs materially, so awards behaves the
-- same as categories for the organiser.
DROP POLICY IF EXISTS "organiser manage own awards" ON awards;
CREATE POLICY "organiser manage own awards" ON awards
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM shows s WHERE s.id = awards.show_id AND s.created_by = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM shows s WHERE s.id = awards.show_id AND s.created_by = auth.uid())
  );
