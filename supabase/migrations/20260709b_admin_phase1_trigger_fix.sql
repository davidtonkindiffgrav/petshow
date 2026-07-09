-- Tighten settlement_paid_immutable: the original trigger only blocked money
-- field edits while status stayed 'paid', but didn't block a status change
-- AWAY FROM 'paid' (e.g. paid -> cancelled). The app layer's VALID_TRANSITIONS
-- already disallows that, but the whole point of enforcing this in the DB is
-- to not depend solely on the Edge Function having no bugs — so the trigger
-- needs to block leaving 'paid' entirely, not just mutating figures within it.
CREATE OR REPLACE FUNCTION prevent_paid_settlement_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'paid' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Settlement % is paid and finalised — its status cannot be changed', OLD.id;
    END IF;
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
