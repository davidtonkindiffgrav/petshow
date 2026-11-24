import { supabase } from './supabase.js';

const BUCKET = 'show-assets';

export async function uploadImage(path, file) {
  const ext      = file.name.split('.').pop().toLowerCase();
  const fullPath = `${path}.${ext}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(fullPath, file, { upsert: true, contentType: file.type });
  if (error) throw error;
  // Re-uploads reuse the same path, so without a version tag browsers and the
  // CDN keep serving the old image for up to an hour. Path extractors match
  // /show-assets/([^?#]+) so they ignore it.
  return `${supabase.storage.from(BUCKET).getPublicUrl(fullPath).data.publicUrl}?v=${Date.now()}`;
}

// Physically copies a show-assets object to a new path, returning the new
// object's public URL. Used when duplicating a show so the clone's images
// are independent of the source (deleting the source later won't break it).
export async function copyImage(oldUrl, newPath) {
  if (!oldUrl) return null;
  const oldPath = oldUrl.match(/\/show-assets\/([^?#]+)/)?.[1];
  if (!oldPath) return oldUrl;
  const ext = oldPath.split('.').pop();
  const fullNewPath = `${newPath}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).copy(oldPath, fullNewPath);
  if (error) throw error;
  return supabase.storage.from(BUCKET).getPublicUrl(fullNewPath).data.publicUrl;
}
