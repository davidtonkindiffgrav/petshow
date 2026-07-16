-- Security fix: the original "Authenticated upload" INSERT policy on
-- storage.objects (bucket show-assets) had no folder or ownership
-- restriction whatsoever — with_check was just `bucket_id = 'show-assets'`.
-- Any authenticated user (e.g. a brand-new signup) could INSERT a new
-- object at any path in the bucket, including under another user's/show's
-- folder (shows/{showId}/logo, profiles/{otherUid}/avatar, etc), as long
-- as no object existed there yet. Re-uploads/overwrites (UPDATE, since
-- uploadImage() uses upsert:true) were already correctly ownership-scoped
-- by show-assets owner update/delete in 2026-07-04_storage_update_policies.sql
-- — only first-time INSERT was open. Discovered 2026-07-16 while verifying
-- physical-prize-image upload security; confirmed live via
-- `select * from pg_policies where schemaname='storage' and tablename='objects'`.
--
-- This replaces it with a policy scoped per folder convention, mirroring
-- the ownership logic already used by the owner update/delete policies.
-- certs/ and awards/ already have their own dedicated, correctly-scoped
-- INSERT policies (2026-07-05_storage_certs_policies.sql,
-- 2026-07-11_storage_awards_policies.sql) and are untouched here.

DROP POLICY IF EXISTS "Authenticated upload" ON storage.objects;

CREATE POLICY "show-assets scoped insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'show-assets'
  AND (
    -- Show-owned assets: logo/banner, sponsor logos, judge roster photos
    (
      (storage.foldername(name))[1] IN ('shows', 'sponsors', 'judges')
      AND EXISTS (
        SELECT 1 FROM public.shows s
        WHERE s.id::text = (storage.foldername(name))[2]
          AND s.created_by = auth.uid()
      )
    )
    -- A judge's own profile photo (judges/profile/{uid}.ext)
    OR (name LIKE 'judges/profile/' || auth.uid()::text || '.%')
    -- A user's own avatar (profiles/{uid}/avatar.ext)
    OR (
      (storage.foldername(name))[1] = 'profiles'
      AND (storage.foldername(name))[2] = auth.uid()::text
    )
    -- Participant-submitted entry photos: any authenticated user may upload
    OR (storage.foldername(name))[1] = 'entries'
  )
);
