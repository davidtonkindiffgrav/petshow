-- Internal admin dashboard, Phase 3: Storage Monitoring needs the database's
-- on-disk size, which is unreachable via the JS client's .from() query
-- builder (no raw-SQL passthrough) — same reasoning as is_admin() in Phase 1,
-- a thin SQL function is the only way to expose it.
--
-- Row counts (shows/show_entries/profiles/organisations/settlements) and
-- storage bucket bytes are deliberately NOT given new SQL functions here —
-- both are already obtainable via {count:'exact',head:true} queries and the
-- Storage API respectively, so adding SQL for them would just be redundant
-- surface area.
CREATE OR REPLACE FUNCTION admin_db_size()
RETURNS bigint LANGUAGE sql SECURITY DEFINER AS $$
  SELECT pg_database_size(current_database())
$$;

-- Only ever called by admin-api's service-role client, never client-side —
-- lock it down the same way regardless, so a future accidental client-side
-- .rpc() call from a non-admin session can't read it.
REVOKE EXECUTE ON FUNCTION admin_db_size() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_db_size() TO service_role;
