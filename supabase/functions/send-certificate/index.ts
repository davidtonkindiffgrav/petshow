import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { PDFDocument } from 'npm:pdf-lib@1.17.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PLACE_LABEL: Record<number, string> = { 1: '1st Place', 2: '2nd Place', 3: '3rd Place' };
const PLACE_ICON:  Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

async function fetchBytes(url: string): Promise<ArrayBuffer | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return r.arrayBuffer();
  } catch { return null; }
}

// Build PDF by embedding the already-rendered canvas JPG.
// This guarantees the PDF matches the designer preview exactly —
// correct orientation, photo, fonts (incl. Homemade Apple) all come
// from the browser-rendered canvas that produced the JPG.
async function buildPdf(certJpgUrl: string, design: any): Promise<Uint8Array> {
  const doc  = await PDFDocument.create();
  const dims: [number, number] = design.page_size === 'letter' ? [792, 612] : [841.89, 595.28];
  const page = doc.addPage(dims);
  const { width: W, height: H } = page.getSize();

  const jpgBytes = await fetchBytes(certJpgUrl);
  if (jpgBytes) {
    const img = await doc.embedJpg(jpgBytes);
    page.drawImage(img, { x: 0, y: 0, width: W, height: H });
  }

  return doc.save();
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 1. Verify JWT
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Missing Authorization header');
    const token = authHeader.replace('Bearer ', '');

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: { user }, error: authErr } = await adminClient.auth.getUser(token);
    if (authErr || !user) throw new Error('Unauthorized');

    // 2. Parse body
    const { show_id, entry_id, cert_jpg_url } = await req.json();
    if (!show_id || !entry_id) throw new Error('Missing required fields');
    if (!cert_jpg_url) throw new Error('cert_jpg_url is required');

    // 3. Fetch show (verify ownership)
    const { data: show, error: showErr } = await adminClient
      .from('shows')
      .select('id, title, show_date, created_by, cert_design_json, cert_design_locked_at, contact_email')
      .eq('id', show_id)
      .single();
    if (showErr || !show) throw new Error('Show not found');
    if (show.created_by !== user.id) throw new Error('Unauthorized');
    if (!show.cert_design_locked_at) throw new Error('Certificate design is not locked yet');

    // 4. Fetch entry
    const { data: entry, error: entryErr } = await adminClient
      .from('show_entries')
      .select('id, animal_name, exhibitor_name, exhibitor_email, result_place, category_id')
      .eq('id', entry_id)
      .eq('show_id', show_id)
      .single();
    if (entryErr || !entry) throw new Error('Entry not found');
    if (!entry.exhibitor_email) throw new Error('No email address for this exhibitor');

    // 5. Fetch category name (for email copy)
    const { data: category } = await adminClient
      .from('show_categories')
      .select('name')
      .eq('id', entry.category_id)
      .single();

    // 6. Parse design (only need page_size for PDF dimensions)
    let design: any = {};
    try { design = JSON.parse(show.cert_design_json || '{}'); } catch {}

    // 7. Generate PDF by wrapping the uploaded JPG
    const pdfBytes = await buildPdf(cert_jpg_url, design);

    // 8. Upload PDF to storage
    const pdfPath = `certs/${show_id}/${entry_id}.pdf`;
    const { error: uploadErr } = await adminClient.storage
      .from('show-assets')
      .upload(pdfPath, pdfBytes, { contentType: 'application/pdf', upsert: true });
    if (uploadErr) throw new Error('Failed to upload PDF: ' + uploadErr.message);

    const { data: { publicUrl: cert_pdf_url } } = adminClient.storage
      .from('show-assets')
      .getPublicUrl(pdfPath);

    // 9. Send email via Resend
    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (!resendKey) throw new Error('RESEND_API_KEY secret is not set');

    const fromAddr  = Deno.env.get('RESEND_FROM') || 'Fur to Feathers <noreply@furtofeathers.com>';
    const siteUrl   = Deno.env.get('SITE_URL') || 'https://furtofeathers.com';

    const placeStr  = PLACE_LABEL[entry.result_place] ?? `#${entry.result_place}`;
    const catName   = category?.name ?? 'Best in Show';
    const icon      = PLACE_ICON[entry.result_place] ?? '🏆';
    const firstName = entry.exhibitor_name?.split(' ')[0] || 'there';

    const jpgLink = `<a href="${cert_jpg_url}" style="display:inline-block;padding:10px 20px;background:#1ba89a;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;margin-right:8px">Download JPG</a>`;
    const pdfLink = `<a href="${cert_pdf_url}" style="display:inline-block;padding:10px 20px;background:#143A37;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Download PDF</a>`;

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
      body: JSON.stringify({
        from: fromAddr,
        to:   [entry.exhibitor_email],
        subject: `${icon} Your award certificate — ${show.title}`,
        html: `
          <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;color:#1c1626">
            <p style="font-size:16px">Hi ${firstName},</p>
            <p>Congratulations! <strong>${entry.animal_name}</strong> was awarded
               <strong>${placeStr}</strong> in the <strong>${catName}</strong> category
               at <strong>${show.title}</strong>. ${icon}</p>
            <p>Get your award certificate here:</p>
            <p style="margin:24px 0">${jpgLink}${pdfLink}</p>
            <p style="font-size:12px;color:#9BB4AF">
              Congratulations from the team at <a href="${siteUrl}" style="color:#1ba89a">Fur to Feathers</a>.
            </p>
          </div>
        `,
      }),
    });
    if (!emailRes.ok) {
      const detail = await emailRes.text();
      throw new Error(`Resend API error ${emailRes.status}: ${detail}`);
    }

    // 10. Write cert URLs + sent timestamp back to entry
    const now = new Date().toISOString();
    await adminClient
      .from('show_entries')
      .update({ cert_email_sent_at: now, cert_pdf_url, cert_jpg_url })
      .eq('id', entry_id);

    return new Response(
      JSON.stringify({ success: true, cert_pdf_url, cert_jpg_url }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
