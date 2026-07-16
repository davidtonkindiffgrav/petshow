-- Fix: "participant read own entries" on public.show_entries had qual = true
-- for role {public} — the entire table (every status, every column, every
-- show) was readable by anyone with the anon key, not just the entry's own
-- participant. This accidentally also carried public show-page reads and
-- judging, which relied on the same over-broad policy having no real scope.
--
-- Replaces it with three policies, each scoped to what actually needs access:
--   1. the entrant, for their own entries (any status)
--   2. the public, for confirmed entries on published shows only
--      (matches the column/row set src/pages/show.astro already renders)
--   3. judges, for entries on shows they're assigned to
--      (mirrors "Judges can read their assigned shows" on public.shows)

begin;

drop policy if exists "participant read own entries" on public.show_entries;

create policy "participant read own entries"
on public.show_entries
for select
to authenticated
using (user_id = auth.uid());

create policy "public read confirmed entries"
on public.show_entries
for select
to public
using (
  status = 'confirmed'
  and exists (
    select 1 from public.shows
    where shows.id = show_entries.show_id
      and shows.status = 'published'
  )
);

create policy "judges read entries for assigned shows"
on public.show_entries
for select
to authenticated
using (show_id in (select judge_show_ids_for_current_user()));

commit;
