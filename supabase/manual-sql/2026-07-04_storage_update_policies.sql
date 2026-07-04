-- Fix: "new row violates row-level security policy" when re-uploading images
--
-- uploadImage() uses upsert:true to fixed paths (shows/{id}/logo,
-- sponsors/{id}/sponsor-0, judges/{id}/judge-N, profiles/{uid}/avatar,
-- judges/profile/{uid}). Overwriting an existing object requires an UPDATE
-- policy on storage.objects; the bucket only had INSERT, so the first upload
-- (e.g. in the wizard) worked and every replacement fails.
-- Entry photos (entries/{showId}/{uuid}) are always fresh inserts — unaffected.
--
-- 1. (Optional) Inspect what exists today:
--    select policyname, cmd, roles from pg_policies
--    where schemaname = 'storage' and tablename = 'objects';
--
-- 2. Run the below. Owners can overwrite/delete:
--    - assets of shows they created  (shows/…, sponsors/…, judges/{showId}/…)
--    - their own profile avatar      (profiles/{uid}/…)
--    - their own judge profile photo (judges/profile/{uid}.*)

drop policy if exists "show-assets owner update" on storage.objects;
create policy "show-assets owner update"
on storage.objects for update to authenticated
using (
  bucket_id = 'show-assets'
  and (
    exists (
      select 1 from public.shows s
      where s.id::text = (storage.foldername(name))[2]
        and s.created_by = auth.uid()
    )
    or ((storage.foldername(name))[1] = 'profiles'
        and (storage.foldername(name))[2] = auth.uid()::text)
    or name like 'judges/profile/' || auth.uid()::text || '.%'
  )
)
with check (
  bucket_id = 'show-assets'
  and (
    exists (
      select 1 from public.shows s
      where s.id::text = (storage.foldername(name))[2]
        and s.created_by = auth.uid()
    )
    or ((storage.foldername(name))[1] = 'profiles'
        and (storage.foldername(name))[2] = auth.uid()::text)
    or name like 'judges/profile/' || auth.uid()::text || '.%'
  )
);

drop policy if exists "show-assets owner delete" on storage.objects;
create policy "show-assets owner delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'show-assets'
  and (
    exists (
      select 1 from public.shows s
      where s.id::text = (storage.foldername(name))[2]
        and s.created_by = auth.uid()
    )
    or ((storage.foldername(name))[1] = 'profiles'
        and (storage.foldername(name))[2] = auth.uid()::text)
    or name like 'judges/profile/' || auth.uid()::text || '.%'
  )
);
