-- Fix: logged-out visitors see no classes/categories (and no sponsors) on
-- public show pages.
--
-- Diagnosis (verified against prod via the anon key on 2026-07-05):
--   - shows (published) ....... readable by anon   ✅
--   - show_entries ............ readable by anon   ✅
--   - show_categories ......... blocked for anon   ❌  <- bug
--   - show_sponsors ........... blocked for anon   ❌  <- bug (breaks sponsors modal too)
--
-- Authenticated users already have a working (broad) SELECT policy on these
-- tables, which is why logged-in testers can see categories on shows they did
-- not create. The public show page (src/pages/show.astro) queries with the anon
-- key, so anonymous visitors get [].
--
-- RLS policies are permissive/OR'd, so adding an anon read policy is additive:
-- it does NOT touch the existing owner/authenticated policies, so previewing an
-- unpublished draft (owner, authenticated) keeps working. Public read is gated
-- on the parent show being published — matching what the show page renders.
--
-- Run this in the Supabase SQL editor (or `supabase db push` if you migrate it).

-- NOTE: grant to `public` (anon + authenticated), NOT just anon. A logged-in
-- user viewing someone else's published show is the `authenticated` role, whose
-- existing policy is owner-gated — so an anon-only policy leaves logged-in
-- visitors seeing nothing. `public` covers both.

-- ── show_categories ───────────────────────────────────────────────────────────
drop policy if exists "public read categories of published shows" on public.show_categories;
create policy "public read categories of published shows"
on public.show_categories for select
to public
using (
  exists (
    select 1 from public.shows s
    where s.id = show_categories.show_id
      and s.status = 'published'
  )
);

-- ── show_sponsors ─────────────────────────────────────────────────────────────
drop policy if exists "public read sponsors of published shows" on public.show_sponsors;
create policy "public read sponsors of published shows"
on public.show_sponsors for select
to public
using (
  exists (
    select 1 from public.shows s
    where s.id = show_sponsors.show_id
      and s.status = 'published'
  )
);
