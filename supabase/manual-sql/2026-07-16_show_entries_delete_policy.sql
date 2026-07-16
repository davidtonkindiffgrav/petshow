-- show_entries has never had a DELETE policy, for any role. This means
-- src/pages/participant/enter.astro's cleanup of a pending entry after a
-- cancelled Stripe checkout (line ~73) has always silently no-opped —
-- RLS blocked the delete, no error was surfaced, and the row was just left
-- behind with status = 'pending'.
--
-- Scoped to the entrant's own pending rows only: confirmed/paid entries or
-- entries with results can't be deleted this way.

begin;

create policy "participant delete own pending entries"
on public.show_entries
for delete
to authenticated
using (user_id = auth.uid() and status = 'pending');

commit;
