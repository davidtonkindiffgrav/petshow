-- Pre-emptive fix, mirrors 2026-07-05_storage_certs_policies.sql: award
-- image uploads to awards/{showId}/{awardId} will 400 with "new row violates
-- row-level security policy" on the FIRST upload, because the original
-- show-assets bucket INSERT policy only whitelists specific top-level folder
-- prefixes (shows/ sponsors/ judges/ profiles/ entries/, plus certs/ added
-- 2026-07-05) and does not include awards/.
--
-- Re-uploads (uploadImage uses upsert:true -> UPDATE) and deletes are
-- already covered: the show-assets owner update/delete policies in
-- 2026-07-04_storage_update_policies.sql have NO folder-prefix restriction,
-- only a positional check that segment [2] is a show id owned by the caller
-- — that already matches awards/{showId}/{awardId} for free. Only INSERT
-- needs a new policy.

DROP POLICY IF EXISTS "show-assets awards owner insert" ON storage.objects;
CREATE POLICY "show-assets awards owner insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'show-assets'
  AND (storage.foldername(name))[1] = 'awards'
  AND EXISTS (
    SELECT 1 FROM public.shows s
    WHERE s.id::text = (storage.foldername(name))[2]
      AND s.created_by = auth.uid()
  )
);
