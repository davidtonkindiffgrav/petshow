-- Internal admin dashboard, Phase 2: user/show admin bookkeeping columns,
-- a real 'cancelled' show status, and organisation notes.

-- shows.status: no CREATE TABLE exists in this repo's migrations to read the
-- live CHECK constraint's name, so find and rewrite it defensively rather
-- than assuming what it's called.
DO $$
DECLARE conname text;
BEGIN
  SELECT con.conname INTO conname
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY(con.conkey)
  WHERE rel.relname = 'shows' AND con.contype = 'c' AND att.attname = 'status';
  IF conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE shows DROP CONSTRAINT %I', conname);
  END IF;
  ALTER TABLE shows ADD CONSTRAINT shows_status_check
    CHECK (status IN ('draft', 'published', 'cancelled'));
END $$;

-- Suspension is a separate, independent flag from status/cancellation — a
-- temporary admin hide that doesn't change the show's lifecycle status.
-- Both the public show page and the entry flow must treat a suspended show
-- as unavailable regardless of status.
ALTER TABLE shows ADD COLUMN IF NOT EXISTS suspended_at timestamptz;

-- Admin bookkeeping only in this phase — nothing on the public site reads
-- this column yet (no homepage/listing "featured" concept exists today).
ALTER TABLE shows ADD COLUMN IF NOT EXISTS featured boolean NOT NULL DEFAULT false;

ALTER TABLE shows ADD COLUMN IF NOT EXISTS admin_notes text;

-- profiles: account suspension. Enforcement lives in src/lib/auth.js's
-- getAuth(), the shared choke point every role's pages call.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS suspended_at timestamptz;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS suspended_reason text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS suspended_by uuid REFERENCES profiles(id);

ALTER TABLE organisations ADD COLUMN IF NOT EXISTS notes text;
