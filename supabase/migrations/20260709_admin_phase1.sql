-- Internal admin dashboard, Phase 1: settlement tracking, audit trail, admin RLS.
--
-- profiles.roles already exists as text[] (participant/organiser/judge). No
-- schema change is needed to add 'admin' — it's just a new value written into
-- the array by hand for the first admin account(s):
--   update profiles set roles = array_append(roles, 'admin') where id = '<uuid>';
-- There is no self-service UI for granting admin in Phase 1.

-- ── settlements ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settlements (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id            uuid        NOT NULL REFERENCES shows(id) ON DELETE RESTRICT,
  organisation_id    uuid        REFERENCES organisations(id),
  currency           text        NOT NULL,
  gross_entry_fees   numeric     NOT NULL DEFAULT 0,
  platform_fee       numeric     NOT NULL DEFAULT 0,
  stripe_fees        numeric     NOT NULL DEFAULT 0,
  refunds            numeric     NOT NULL DEFAULT 0,
  net_amount_owed    numeric     NOT NULL DEFAULT 0,
  amount_paid        numeric     NOT NULL DEFAULT 0,
  payment_date       date,
  status             text        NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','pending_approval','paid','cancelled','overdue')),
  pdf_url            text,
  notes              text,
  entry_count        integer     NOT NULL DEFAULT 0,
  generated_by       uuid        REFERENCES profiles(id),
  paid_by            uuid        REFERENCES profiles(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  finalised_at       timestamptz,
  UNIQUE (show_id)
);

-- Once a settlement is 'paid' it is immutable at the row level for the money
-- fields — enforced by trigger, not just app logic (mirrors
-- prevent_show_delete_with_entries protecting financial records with a DB
-- trigger, not just client discipline). Regenerating a draft/pending_approval
-- settlement is fine (upsert-on-show_id in the app layer); once paid, further
-- corrections must go through settlement_adjustments instead.
CREATE OR REPLACE FUNCTION prevent_paid_settlement_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'paid' AND NEW.status = 'paid' THEN
    IF NEW.gross_entry_fees IS DISTINCT FROM OLD.gross_entry_fees
       OR NEW.platform_fee     IS DISTINCT FROM OLD.platform_fee
       OR NEW.stripe_fees      IS DISTINCT FROM OLD.stripe_fees
       OR NEW.refunds          IS DISTINCT FROM OLD.refunds
       OR NEW.net_amount_owed  IS DISTINCT FROM OLD.net_amount_owed
       OR NEW.amount_paid      IS DISTINCT FROM OLD.amount_paid THEN
      RAISE EXCEPTION 'Settlement % is paid and finalised — record an adjustment instead of editing the paid figures', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER settlement_paid_immutable
  BEFORE UPDATE ON settlements
  FOR EACH ROW EXECUTE FUNCTION prevent_paid_settlement_mutation();

-- ── settlement_adjustments ───────────────────────────────────────────────────
-- Post-finalisation corrections are additive rows here, never a mutation of
-- the settlements row itself. Pre-finalisation edits (draft/pending_approval)
-- may still update the settlements row directly — adjustments exist for the
-- immutable-after-paid guarantee, not to replace normal editing.
CREATE TABLE IF NOT EXISTS settlement_adjustments (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id  uuid        NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  amount         numeric     NOT NULL,       -- signed: positive = owed more, negative = owed less
  reason         text        NOT NULL,
  created_by     uuid        REFERENCES profiles(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ── audit_log ────────────────────────────────────────────────────────────────
-- Minimal, generic, reusable by later admin-dashboard phases (platform config
-- edits, user role changes, etc.) — not settlement-specific.
CREATE TABLE IF NOT EXISTS audit_log (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id     uuid        REFERENCES profiles(id),
  action       text        NOT NULL,        -- e.g. 'settlement.status_changed', 'settlement.generated'
  entity_type  text        NOT NULL,        -- e.g. 'settlement'
  entity_id    uuid,
  details      jsonb       NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON audit_log (entity_type, entity_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE settlements             ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlement_adjustments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log               ENABLE ROW LEVEL SECURITY;

-- Reusable predicate: is the current JWT an admin?
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND 'admin' = ANY(roles)
  );
$$;

-- Admins can read everything in these tables. All writes go through the
-- admin-api Edge Function using the service-role client, which bypasses RLS
-- entirely — so there are deliberately no INSERT/UPDATE/DELETE policies here
-- for regular authenticated users.
CREATE POLICY "admin read settlements" ON settlements
  FOR SELECT TO authenticated USING (is_admin());
CREATE POLICY "admin read settlement_adjustments" ON settlement_adjustments
  FOR SELECT TO authenticated USING (is_admin());
CREATE POLICY "admin read audit_log" ON audit_log
  FOR SELECT TO authenticated USING (is_admin());

-- Organisers can read (read-only) settlements for shows they created, so a
-- future "my settlements" organiser view is possible without new policy work.
CREATE POLICY "organiser read own settlements" ON settlements
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM shows s WHERE s.id = settlements.show_id AND s.created_by = auth.uid())
  );
