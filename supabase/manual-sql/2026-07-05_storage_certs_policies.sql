-- Fix: "Authentication failed" / 400 "new row violates row-level security policy"
-- when an organiser clicks "Send Certificate".
--
-- results.astro uploads the rendered certificate JPG *from the browser* using the
-- organiser's own session, to:  certs/{showId}/{entryId}.jpg   (upsert: true)
-- before calling the send-certificate Edge Function. That client-side upload is
-- subject to storage RLS. The show-assets bucket's INSERT policy covers
-- shows/ sponsors/ judges/ profiles/ entries/ — but NOT certs/ — so the upload
-- is rejected. upsert:true also means a re-send is an UPDATE, which needs its
-- own policy.
--
-- foldername('certs/{showId}/{entryId}.jpg') = {certs, showId}
--   [1] = 'certs'   [2] = showId
-- Gate: the signed-in user must own the show (shows.created_by = auth.uid()).
-- These policies are additive (permissive = OR'd with existing ones), so they
-- do not affect any other upload path.

-- First send → INSERT
drop policy if exists "show-assets certs owner insert" on storage.objects;
create policy "show-assets certs owner insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'show-assets'
  and (storage.foldername(name))[1] = 'certs'
  and exists (
    select 1 from public.shows s
    where s.id::text = (storage.foldername(name))[2]
      and s.created_by = auth.uid()
  )
);

-- Re-send / overwrite → UPDATE
drop policy if exists "show-assets certs owner update" on storage.objects;
create policy "show-assets certs owner update"
on storage.objects for update to authenticated
using (
  bucket_id = 'show-assets'
  and (storage.foldername(name))[1] = 'certs'
  and exists (
    select 1 from public.shows s
    where s.id::text = (storage.foldername(name))[2]
      and s.created_by = auth.uid()
  )
)
with check (
  bucket_id = 'show-assets'
  and (storage.foldername(name))[1] = 'certs'
  and exists (
    select 1 from public.shows s
    where s.id::text = (storage.foldername(name))[2]
      and s.created_by = auth.uid()
  )
);

-- Verify afterwards:
--   select policyname, cmd from pg_policies
--   where schemaname = 'storage' and tablename = 'objects'
--     and policyname like 'show-assets certs%';
