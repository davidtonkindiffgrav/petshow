// Shared certificate render + upload + email flow.
// Used by the manual "Send Certificate" button (organiser/results) and the
// automatic send-on-publish flow (organiser/judging).
import { renderCertificate } from './cert-renderer.js';

export async function sendCertificateToEntry({ supabase, show, entry, category, sponsors = [], design = {} }) {
  if (!entry.exhibitor_email || !String(entry.exhibitor_email).trim()) {
    return { ok: false, reason: 'no_email' };
  }
  try {
    const canvas = document.createElement('canvas');
    await renderCertificate(canvas, { show, entry, category, sponsors, design });

    const jpgDataUrl = canvas.toDataURL('image/jpeg', 0.92);
    const blob = await (await fetch(jpgDataUrl)).blob();

    const jpgPath = `certs/${show.id}/${entry.id}.jpg`;
    const { error: uploadErr } = await supabase.storage
      .from('show-assets')
      .upload(jpgPath, blob, { contentType: 'image/jpeg', upsert: true });
    if (uploadErr) throw new Error('Upload failed: ' + uploadErr.message);

    const { data: { publicUrl: cert_jpg_url } } = supabase.storage
      .from('show-assets').getPublicUrl(jpgPath);

    const { data: { session } } = await supabase.auth.getSession();
    const fnRes = await fetch(
      `${import.meta.env.PUBLIC_SUPABASE_URL}/functions/v1/send-certificate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ show_id: show.id, entry_id: entry.id, cert_jpg_url }),
      },
    );
    const result = await fnRes.json();
    if (result.error) throw new Error(result.error);

    return { ok: true, cert_jpg_url, cert_pdf_url: result.cert_pdf_url };
  } catch (err) {
    return { ok: false, reason: 'error', message: err?.message || 'Unknown error' };
  }
}
