-- ── Public Voting Tables ──────────────────────────────────────────────────────

-- One verified vote per voter per show (email ownership confirmed via magic link)
CREATE TABLE IF NOT EXISTS public_votes (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id             uuid        NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  voter_email         text        NOT NULL,
  vote_token          text        NOT NULL UNIQUE,
  token_expires_at    timestamptz NOT NULL,
  confirmed_at        timestamptz,
  ip_address          text,
  user_agent          text,
  browser_fingerprint text,
  created_at          timestamptz DEFAULT now(),
  UNIQUE (show_id, voter_email)
);

-- One category pick per vote (voter picks one entry per category, confirmed in batch)
CREATE TABLE IF NOT EXISTS public_vote_picks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vote_id     uuid NOT NULL REFERENCES public_votes(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES show_categories(id) ON DELETE CASCADE,
  entry_id    uuid NOT NULL REFERENCES show_entries(id) ON DELETE CASCADE,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (vote_id, category_id)
);

-- No public read or write access — only service-role (Edge Functions) and SECURITY DEFINER RPCs
ALTER TABLE public_votes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public_vote_picks ENABLE ROW LEVEL SECURITY;

-- ── RPC: get_vote_counts ──────────────────────────────────────────────────────
-- Returns per-entry vote counts for a show (organiser-only, verified by auth.uid)

CREATE OR REPLACE FUNCTION get_vote_counts(p_show_id uuid)
RETURNS TABLE (
  category_id     uuid,
  entry_id        uuid,
  confirmed_count bigint,
  pending_count   bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_created_by uuid;
BEGIN
  SELECT created_by INTO v_created_by FROM shows WHERE id = p_show_id;
  IF v_created_by IS NULL OR v_created_by != auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
  SELECT
    pvp.category_id,
    pvp.entry_id,
    COUNT(*) FILTER (WHERE pv.confirmed_at IS NOT NULL)::bigint AS confirmed_count,
    COUNT(*) FILTER (WHERE pv.confirmed_at IS NULL)::bigint     AS pending_count
  FROM public_vote_picks pvp
  JOIN public_votes pv ON pvp.vote_id = pv.id
  WHERE pv.show_id = p_show_id
  GROUP BY pvp.category_id, pvp.entry_id;
END;
$$;

-- ── RPC: publish_vote_results ─────────────────────────────────────────────────
-- Tallies confirmed votes, assigns result_place 1/2/3, stamps results_published_at

CREATE OR REPLACE FUNCTION publish_vote_results(p_show_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_created_by uuid;
BEGIN
  SELECT created_by INTO v_created_by FROM shows WHERE id = p_show_id;
  IF v_created_by IS NULL OR v_created_by != auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Rank entries by confirmed vote count within each category, assign top-3 places
  WITH vote_counts AS (
    SELECT
      pvp.entry_id,
      pvp.category_id,
      COUNT(*) AS vote_count
    FROM public_vote_picks pvp
    JOIN public_votes pv ON pvp.vote_id = pv.id
    WHERE pv.show_id = p_show_id
      AND pv.confirmed_at IS NOT NULL
    GROUP BY pvp.entry_id, pvp.category_id
  ),
  ranked AS (
    SELECT
      entry_id,
      RANK() OVER (PARTITION BY category_id ORDER BY vote_count DESC) AS place
    FROM vote_counts
  )
  UPDATE show_entries se
  SET result_place = r.place
  FROM ranked r
  WHERE se.id = r.entry_id AND r.place <= 3;

  -- Stamp results_published_at on the show
  UPDATE shows SET results_published_at = now() WHERE id = p_show_id;

  RETURN jsonb_build_object('success', true);
END;
$$;
