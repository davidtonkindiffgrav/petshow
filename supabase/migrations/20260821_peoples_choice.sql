-- ── People's Choice add-on ────────────────────────────────────────────────────
-- Judged shows can offer an optional paid "People's Choice" award per category.
-- The base judged entry is mandatory; the add-on nominates the same entry for a
-- parallel competition decided by free public vote. Judge breaks first-place ties.

-- Show-wide settings: one add-on fee (whole currency units) and one prize.
ALTER TABLE shows
  ADD COLUMN IF NOT EXISTS peoples_choice_fee      numeric,
  ADD COLUMN IF NOT EXISTS peoples_choice_award_id uuid REFERENCES awards(id) ON DELETE SET NULL;

-- Per-category opt-in by the organiser.
ALTER TABLE show_categories
  ADD COLUMN IF NOT EXISTS has_peoples_choice boolean NOT NULL DEFAULT false;

ALTER TABLE show_entries
  -- Expected gross for this row's share of its Stripe session, stamped at insert.
  -- Replaces the equal-division assumption once entries can cost different amounts.
  ADD COLUMN IF NOT EXISTS entry_gross_amount numeric,
  -- NULL = not opted in to People's Choice; value = fee snapshot at insert time.
  ADD COLUMN IF NOT EXISTS peoples_choice_fee_amount numeric,
  ADD COLUMN IF NOT EXISTS peoples_choice_result_place smallint,
  -- Separate certificate slots so a dual winner keeps both certificates.
  ADD COLUMN IF NOT EXISTS pc_cert_jpg_url text,
  ADD COLUMN IF NOT EXISTS pc_cert_pdf_url text,
  ADD COLUMN IF NOT EXISTS pc_cert_email_sent_at timestamptz;

-- ── Judge tie-break picks ─────────────────────────────────────────────────────
-- One row per (show, category): the judge's pick among entries tied for first.
CREATE TABLE IF NOT EXISTS peoples_choice_tiebreaks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id     uuid NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES show_categories(id) ON DELETE CASCADE,
  entry_id    uuid NOT NULL REFERENCES show_entries(id) ON DELETE CASCADE,
  judge_email text NOT NULL,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (show_id, category_id)
);

ALTER TABLE peoples_choice_tiebreaks ENABLE ROW LEVEL SECURITY;

-- Judge manages their own picks, but only for shows they are assigned to
-- (show_judges_self_read lets a judge see their own assignment rows).
CREATE POLICY pc_tiebreaks_judge_self ON peoples_choice_tiebreaks
  FOR ALL TO authenticated
  USING (
    lower(judge_email) = lower(auth.email())
    AND show_id IN (SELECT sj.show_id FROM show_judges sj WHERE lower(sj.email) = lower(auth.email()))
  )
  WITH CHECK (
    lower(judge_email) = lower(auth.email())
    AND show_id IN (SELECT sj.show_id FROM show_judges sj WHERE lower(sj.email) = lower(auth.email()))
  );

-- Organiser can read tie-break state for their own shows.
CREATE POLICY pc_tiebreaks_org_read ON peoples_choice_tiebreaks
  FOR SELECT TO authenticated
  USING (show_id IN (SELECT shows.id FROM shows WHERE shows.created_by = auth.uid()));

-- ── RPC: get_pc_tally ─────────────────────────────────────────────────────────
-- Confirmed People's Choice vote counts per category, with tie state.
-- Callable by the show's organiser or an assigned judge.

CREATE OR REPLACE FUNCTION get_pc_tally(p_show_id uuid)
RETURNS TABLE (
  category_id       uuid,
  entry_id          uuid,
  confirmed_count   bigint,
  tied_for_first    boolean,
  tiebreak_entry_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_created_by uuid;
  v_is_judge   boolean;
BEGIN
  SELECT created_by INTO v_created_by FROM shows WHERE id = p_show_id;
  SELECT EXISTS (
    SELECT 1 FROM show_judges sj
    WHERE sj.show_id = p_show_id AND lower(sj.email) = lower(auth.email())
  ) INTO v_is_judge;
  IF v_created_by IS NULL OR (v_created_by != auth.uid() AND NOT v_is_judge) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
  WITH pc_counts AS (
    SELECT
      pvp.category_id AS cat_id,
      pvp.entry_id    AS ent_id,
      COUNT(*)::bigint AS confirmed
    FROM public_vote_picks pvp
    JOIN public_votes pv ON pvp.vote_id = pv.id
    JOIN show_entries se ON se.id = pvp.entry_id
    JOIN show_categories sc ON sc.id = pvp.category_id
    WHERE pv.show_id = p_show_id
      AND pv.confirmed_at IS NOT NULL
      AND se.status = 'confirmed'
      AND se.peoples_choice_fee_amount IS NOT NULL
      AND sc.has_peoples_choice = true
    GROUP BY pvp.category_id, pvp.entry_id
  ),
  ranked AS (
    SELECT
      cat_id, ent_id, confirmed,
      RANK() OVER (PARTITION BY cat_id ORDER BY confirmed DESC) AS place
    FROM pc_counts
  ),
  leaders AS (
    SELECT cat_id, COUNT(*) AS leader_count
    FROM ranked WHERE place = 1
    GROUP BY cat_id
  )
  SELECT
    r.cat_id,
    r.ent_id,
    r.confirmed,
    (r.place = 1 AND l.leader_count > 1) AS tied_for_first,
    tb.entry_id AS tiebreak_entry_id
  FROM ranked r
  JOIN leaders l ON l.cat_id = r.cat_id
  LEFT JOIN peoples_choice_tiebreaks tb
    ON tb.show_id = p_show_id AND tb.category_id = r.cat_id;
END;
$$;

-- ── RPC: publish_peoples_choice ───────────────────────────────────────────────
-- Writes peoples_choice_result_place = 1 for the winner of each People's Choice
-- category. Fails atomically with 'pc_tie_unresolved' if any category is tied
-- for first without a valid judge tie-break pick. Does NOT stamp
-- results_published_at; the existing judged publish flow owns that.

CREATE OR REPLACE FUNCTION publish_peoples_choice(p_show_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_created_by uuid;
  v_cat        record;
  v_winner     uuid;
  v_winners    jsonb := '[]'::jsonb;
  v_no_votes   jsonb := '[]'::jsonb;
BEGIN
  SELECT created_by INTO v_created_by FROM shows WHERE id = p_show_id;
  IF v_created_by IS NULL OR v_created_by != auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Reset any previous run so republish is idempotent.
  UPDATE show_entries SET peoples_choice_result_place = NULL
  WHERE show_id = p_show_id AND peoples_choice_result_place IS NOT NULL;

  FOR v_cat IN
    SELECT sc.id AS category_id, sc.name
    FROM show_categories sc
    WHERE sc.show_id = p_show_id AND sc.has_peoples_choice = true
  LOOP
    WITH pc_counts AS (
      SELECT pvp.entry_id, COUNT(*) AS votes
      FROM public_vote_picks pvp
      JOIN public_votes pv ON pvp.vote_id = pv.id
      JOIN show_entries se ON se.id = pvp.entry_id
      WHERE pv.show_id = p_show_id
        AND pv.confirmed_at IS NOT NULL
        AND pvp.category_id = v_cat.category_id
        AND se.status = 'confirmed'
        AND se.peoples_choice_fee_amount IS NOT NULL
      GROUP BY pvp.entry_id
    ),
    leaders AS (
      SELECT entry_id FROM pc_counts
      WHERE votes = (SELECT MAX(votes) FROM pc_counts)
    )
    SELECT CASE
      WHEN (SELECT COUNT(*) FROM leaders) = 0 THEN NULL
      WHEN (SELECT COUNT(*) FROM leaders) = 1 THEN (SELECT entry_id FROM leaders)
      ELSE (
        SELECT tb.entry_id FROM peoples_choice_tiebreaks tb
        WHERE tb.show_id = p_show_id
          AND tb.category_id = v_cat.category_id
          AND tb.entry_id IN (SELECT entry_id FROM leaders)
      )
    END INTO v_winner;

    IF v_winner IS NULL THEN
      -- No votes at all is fine; a tie without a valid pick blocks the publish.
      IF EXISTS (
        WITH pc_counts AS (
          SELECT pvp.entry_id, COUNT(*) AS votes
          FROM public_vote_picks pvp
          JOIN public_votes pv ON pvp.vote_id = pv.id
          JOIN show_entries se ON se.id = pvp.entry_id
          WHERE pv.show_id = p_show_id
            AND pv.confirmed_at IS NOT NULL
            AND pvp.category_id = v_cat.category_id
            AND se.status = 'confirmed'
            AND se.peoples_choice_fee_amount IS NOT NULL
          GROUP BY pvp.entry_id
        )
        SELECT 1 FROM pc_counts
        WHERE votes = (SELECT MAX(votes) FROM pc_counts)
        HAVING COUNT(*) > 1
      ) THEN
        RAISE EXCEPTION 'pc_tie_unresolved';
      END IF;
      v_no_votes := v_no_votes || to_jsonb(v_cat.name);
    ELSE
      UPDATE show_entries SET peoples_choice_result_place = 1 WHERE id = v_winner;
      v_winners := v_winners || jsonb_build_object(
        'category_id', v_cat.category_id,
        'category',    v_cat.name,
        'entry_id',    v_winner
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'winners', v_winners, 'no_votes', v_no_votes);
END;
$$;
