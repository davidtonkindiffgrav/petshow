import { supabase } from './supabase.js';

const BUCKET = 'show-assets';

export async function uploadImage(path, file) {
  const ext      = file.name.split('.').pop().toLowerCase();
  const fullPath = `${path}.${ext}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(fullPath, file, { upsert: true, contentType: file.type });
  if (error) throw error;
  return supabase.storage.from(BUCKET).getPublicUrl(fullPath).data.publicUrl;
}
