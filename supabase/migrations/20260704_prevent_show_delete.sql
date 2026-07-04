-- Prevent hard-deletion of any show that has received confirmed (paid) entries.
-- Financial records must be preserved; the correct action is to archive instead.

CREATE OR REPLACE FUNCTION prevent_show_delete_with_entries()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  entry_count integer;
BEGIN
  SELECT COUNT(*) INTO entry_count
  FROM show_entries
  WHERE show_id = OLD.id AND status = 'confirmed';

  IF entry_count > 0 THEN
    RAISE EXCEPTION
      'Cannot delete show "%": % confirmed entr% exist. Archive the show instead to preserve financial records.',
      OLD.title,
      entry_count,
      CASE WHEN entry_count = 1 THEN 'y' ELSE 'ies' END;
  END IF;

  RETURN OLD;
END;
$$;

CREATE TRIGGER no_delete_show_with_entries
  BEFORE DELETE ON shows
  FOR EACH ROW EXECUTE FUNCTION prevent_show_delete_with_entries();
