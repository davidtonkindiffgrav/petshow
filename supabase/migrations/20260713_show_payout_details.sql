-- Per-show payout (bank/OFX transfer) details, so an admin has what they need
-- to actually pay an organiser out after a show wraps up. Deliberately
-- per-show (not per-organiser/organisation): individual organisers have no
-- organisation_id, and a one-off show may need proceeds sent somewhere other
-- than the organiser's usual account.

CREATE TABLE IF NOT EXISTS show_payout_details (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id                     uuid        NOT NULL UNIQUE REFERENCES shows(id) ON DELETE CASCADE,

  -- Beneficiary (who owns the account)
  account_holder_name         text        NOT NULL,
  beneficiary_address_line1   text        NOT NULL,
  beneficiary_city            text        NOT NULL,
  beneficiary_region          text,
  beneficiary_postcode        text        NOT NULL,
  beneficiary_country         text        NOT NULL,

  -- Bank / account
  bank_name                   text        NOT NULL,
  bank_country                text        NOT NULL,
  bank_address                text,
  account_currency            text        NOT NULL,
  account_number              text        NOT NULL,
  swift_bic                   text        NOT NULL,
  iban                        text,
  local_bank_code             text,
  local_bank_code_label       text,

  notes                       text,

  verified_at                 timestamptz,
  verified_by                 uuid        REFERENCES profiles(id),

  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

-- Editing any payout-critical field after verification invalidates the
-- verified flag — a changed bank account must be re-checked before it's
-- trusted again for a transfer.
CREATE OR REPLACE FUNCTION clear_payout_verification_on_edit()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.verified_at IS NOT NULL AND (
    NEW.account_holder_name != OLD.account_holder_name OR
    NEW.account_number      != OLD.account_number OR
    NEW.swift_bic           != OLD.swift_bic OR
    NEW.iban                IS DISTINCT FROM OLD.iban OR
    NEW.local_bank_code     IS DISTINCT FROM OLD.local_bank_code OR
    NEW.bank_name           != OLD.bank_name OR
    NEW.bank_country        != OLD.bank_country
  ) THEN
    NEW.verified_at := NULL;
    NEW.verified_by := NULL;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER show_payout_details_clear_verification
  BEFORE UPDATE ON show_payout_details
  FOR EACH ROW EXECUTE FUNCTION clear_payout_verification_on_edit();

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Sensitive financial PII — tightly scoped, unlike general show/entry data.
ALTER TABLE show_payout_details ENABLE ROW LEVEL SECURITY;

CREATE POLICY "organiser manage own show payout details" ON show_payout_details
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM shows s WHERE s.id = show_payout_details.show_id AND s.created_by = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM shows s WHERE s.id = show_payout_details.show_id AND s.created_by = auth.uid())
  );

-- Admins can read (verification writes go through the admin-api Edge
-- Function using the service-role client, same as settlements — no admin
-- UPDATE policy needed here).
CREATE POLICY "admin read show payout details" ON show_payout_details
  FOR SELECT TO authenticated USING (is_admin());
