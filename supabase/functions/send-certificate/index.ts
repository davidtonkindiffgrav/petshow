import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { PDFDocument, rgb, StandardFonts, degrees } from 'npm:pdf-lib@1.17.1';
import fontkit from 'npm:@pdf-lib/fontkit@1.1.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ACCENT_R = 0.106, ACCENT_G = 0.659, ACCENT_B = 0.604; // #1ba89a
const DARK_R   = 0.078, DARK_G   = 0.227, DARK_B   = 0.216; // #143A37
const MID_R    = 0.290, MID_G    = 0.400, MID_B    = 0.388; // #4A6663
const LIGHT_R  = 0.608, LIGHT_G  = 0.706, LIGHT_B  = 0.686; // #9BB4AF

const PLACE_LABEL: Record<number, string> = { 1: '1st Place', 2: '2nd Place', 3: '3rd Place' };
const PLACE_ICON:  Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

async function fetchBytes(url: string): Promise<ArrayBuffer | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return r.arrayBuffer();
  } catch { return null; }
}

async function fetchHandwritingFont(): Promise<Uint8Array | null> {
  try {
    // Legacy UA makes Google Fonts return TTF URLs instead of WOFF2 (pdf-lib needs TTF/OTF)
    const cssRes = await fetch(
      'https://fonts.googleapis.com/css?family=Homemade+Apple',
      { headers: { 'User-Agent': 'Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1)' } },
    );
    if (!cssRes.ok) return null;
    const css = await cssRes.text();
    const m = css.match(/url\(([^)]+)\)/);
    if (!m) return null;
    const fontUrl = m[1].replace(/['"]/g, '');
    const fontRes = await fetch(fontUrl);
    if (!fontRes.ok) return null;
    return new Uint8Array(await fontRes.arrayBuffer());
  } catch { return null; }
}

function hexToRgb(hex: string) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex);
  if (!m) return { r: 1, g: 1, b: 1 };
  return { r: parseInt(m[1], 16) / 255, g: parseInt(m[2], 16) / 255, b: parseInt(m[3], 16) / 255 };
}

async function buildPdf(
  show: any,
  entry: any,
  category: any,
  sponsors: any[],
  design: any,
  judgeName: string | null = null,
): Promise<Uint8Array> {
  const doc  = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const pageDims = design.page_size === 'letter' ? [792, 612] : [841.89, 595.28];
  const page = doc.addPage(pageDims);
  const { width: W, height: H } = page.getSize();

  const helveticaBold   = await doc.embedFont(StandardFonts.HelveticaBold);
  const helvetica       = await doc.embedFont(StandardFonts.Helvetica);

  const PAD = 36;

  // ── Background ─────────────────────────────────────────────────────────────
  const bg = hexToRgb(design.bg_color || '#ffffff');
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(bg.r, bg.g, bg.b) });

  // ── Border ─────────────────────────────────────────────────────────────────
  const borderStyle = design.border_style || 'classic';
  const accentColor = rgb(ACCENT_R, ACCENT_G, ACCENT_B);
  if (borderStyle !== 'none') {
    const m = 14;
    if (borderStyle === 'classic') {
      page.drawRectangle({ x: m, y: m, width: W - m * 2, height: H - m * 2,
        borderColor: accentColor, borderWidth: 1.5 });
    } else if (borderStyle === 'elegant') {
      page.drawRectangle({ x: m,     y: m,     width: W - m * 2,     height: H - m * 2,
        borderColor: accentColor, borderWidth: 0.75 });
      page.drawRectangle({ x: m + 5, y: m + 5, width: W - (m + 5) * 2, height: H - (m + 5) * 2,
        borderColor: accentColor, borderWidth: 0.75 });
    } else if (borderStyle === 'playful') {
      page.drawRectangle({ x: m, y: m, width: W - m * 2, height: H - m * 2,
        borderColor: accentColor, borderWidth: 3, borderLineCap: 0 });
    }
  }

  // ── Logo ───────────────────────────────────────────────────────────────────
  const logoUrl = design.show_logo ? (show.logo_url || show.org_logo_url) : null;
  let logoTop = H - PAD - 36; // y-top of logo area (pdf coords: y=0 at bottom)

  if (logoUrl) {
    const logoBytes = await fetchBytes(logoUrl);
    if (logoBytes) {
      try {
        let logoImg;
        if (logoUrl.toLowerCase().includes('.png') || logoUrl.startsWith('data:image/png')) {
          logoImg = await doc.embedPng(logoBytes);
        } else {
          logoImg = await doc.embedJpg(logoBytes);
        }
        const lh = 36;
        const lw = Math.min(lh * (logoImg.width / logoImg.height), 110);
        page.drawImage(logoImg, { x: PAD, y: H - PAD - lh, width: lw, height: lh });
      } catch {}
    }
  }

  // ── Header text ────────────────────────────────────────────────────────────
  const headerTopY = H - PAD;
  const titleSize = 14;
  const showTitle = show.title || 'Pet Show';

  page.drawText(showTitle, {
    x: W / 2 - helveticaBold.widthOfTextAtSize(showTitle, titleSize) / 2,
    y: headerTopY - titleSize - 2,
    font: helveticaBold, size: titleSize, color: rgb(DARK_R, DARK_G, DARK_B),
  });

  if (show.host_org) {
    const orgSize = 10;
    page.drawText(show.host_org, {
      x: W / 2 - helvetica.widthOfTextAtSize(show.host_org, orgSize) / 2,
      y: headerTopY - titleSize - 2 - orgSize - 4,
      font: helvetica, size: orgSize, color: rgb(MID_R, MID_G, MID_B),
    });
  }

  // Show date (top right)
  if ((design.fields || []).includes('show_date') && show.show_date) {
    const dt = new Date(show.show_date).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'long', year: 'numeric'
    });
    const dtSize = 9;
    page.drawText(dt, {
      x: W - PAD - helvetica.widthOfTextAtSize(dt, dtSize),
      y: headerTopY - dtSize - 4,
      font: helvetica, size: dtSize, color: rgb(LIGHT_R, LIGHT_G, LIGHT_B),
    });
  }

  // ── Divider under header ────────────────────────────────────────────────────
  const divider1Y = H - PAD - 48;
  page.drawLine({
    start: { x: PAD, y: divider1Y }, end: { x: W - PAD, y: divider1Y },
    thickness: 0.75, color: rgb(ACCENT_R, ACCENT_G, ACCENT_B, 0.3),
  });

  // ── Place banner ───────────────────────────────────────────────────────────
  let bannerY = divider1Y - 14;
  const place    = entry.result_place ?? 1;
  const placeStr = PLACE_LABEL[place] ?? `#${place}`;
  const catName  = category?.name ?? 'Best in Show';
  const fields   = design.fields || [];

  if (fields.includes('place')) {
    const placeText = `${placeStr}`;
    const placeSize = 22;
    page.drawText(placeText, {
      x: W / 2 - helveticaBold.widthOfTextAtSize(placeText, placeSize) / 2,
      y: bannerY - placeSize,
      font: helveticaBold, size: placeSize, color: rgb(ACCENT_R, ACCENT_G, ACCENT_B),
    });
    bannerY -= placeSize + 8;
  }

  if (fields.includes('category')) {
    const catSize = 11;
    page.drawText(catName, {
      x: W / 2 - helvetica.widthOfTextAtSize(catName, catSize) / 2,
      y: bannerY - catSize,
      font: helvetica, size: catSize, color: rgb(MID_R, MID_G, MID_B),
    });
    bannerY -= catSize + 12;
  }

  bannerY -= 8;

  // ── Divider above content ─────────────────────────────────────────────────
  page.drawLine({
    start: { x: PAD, y: bannerY }, end: { x: W - PAD, y: bannerY },
    thickness: 0.75, color: rgb(ACCENT_R, ACCENT_G, ACCENT_B, 0.3),
  });

  // ── Content zone ──────────────────────────────────────────────────────────
  const footerH = (design.show_sponsors && sponsors.length) ? 56 : 36;
  const contentY = PAD + footerH;
  const contentH = bannerY - 16 - contentY;

  // Photo
  let textOffsetX = 0;
  const showPhoto = design.image_mode === 'photo' || (!design.image_mode && !!design.show_photo);
  if (showPhoto && entry.photo_url) {
    const photoBytes = await fetchBytes(entry.photo_url);
    if (photoBytes) {
      try {
        let photoImg;
        const urlLower = entry.photo_url.toLowerCase();
        if (urlLower.includes('.png') || urlLower.includes('image/png')) {
          photoImg = await doc.embedPng(photoBytes);
        } else {
          photoImg = await doc.embedJpg(photoBytes);
        }
        // Preserve natural aspect ratio (don't stretch)
        const photoSize = Math.min(Math.max(design.photo_size ?? 0.45, 0.20), 0.70);
        const imgAspect = photoImg.width / photoImg.height;
        const boxW = Math.round(Math.min(contentH * photoSize * 1.5, 200));
        const drawH = imgAspect < 0.80 ? contentH : Math.min(Math.round(boxW / imgAspect), contentH);
        const drawW = Math.round(drawH * imgAspect);
        const drawY = contentY + Math.round((contentH - drawH) / 2);
        page.drawImage(photoImg, { x: PAD, y: drawY, width: drawW, height: drawH });
        page.drawRectangle({ x: PAD, y: drawY, width: drawW, height: drawH,
          borderColor: rgb(0.9, 0.93, 0.925), borderWidth: 0.75 });
        textOffsetX = drawW + 24;
      } catch {}
    }
  }

  // Text fields
  const textX = PAD + textOffsetX;
  let ty = bannerY - 18 - 24;

  if (fields.includes('animal_name')) {
    const name = entry.animal_name || 'Animal Name';
    const nameSize = 20;
    page.drawText(name, {
      x: textX, y: ty - nameSize,
      font: helveticaBold, size: nameSize, color: rgb(DARK_R, DARK_G, DARK_B),
    });
    ty -= nameSize + 10;
  }

  if (fields.includes('breed') && entry.breed) {
    const breedSize = 11;
    page.drawText(entry.breed, {
      x: textX, y: ty - breedSize,
      font: helvetica, size: breedSize, color: rgb(MID_R, MID_G, MID_B),
    });
    ty -= breedSize + 16;
  }

  if (fields.includes('exhibitor_name') && entry.exhibitor_name) {
    const ownerSize = 10;
    page.drawText(`Owner: ${entry.exhibitor_name}`, {
      x: textX, y: ty - ownerSize,
      font: helvetica, size: ownerSize, color: rgb(LIGHT_R, LIGHT_G, LIGHT_B),
    });
  }

  // ── Footer ─────────────────────────────────────────────────────────────────
  const footerLineY = PAD + 24;  // matches canvas fy-28
  page.drawLine({
    start: { x: PAD, y: footerLineY }, end: { x: W - PAD, y: footerLineY },
    thickness: 0.5, color: rgb(ACCENT_R, ACCENT_G, ACCENT_B, 0.18),
  });

  if (design.show_sponsors) {
    let sx = PAD;
    for (const sponsor of sponsors.slice(0, 4)) {
      if (!sponsor.logo_url) continue;
      const sBytes = await fetchBytes(sponsor.logo_url);
      if (!sBytes) continue;
      try {
        let sImg;
        const sUrl = sponsor.logo_url.toLowerCase();
        if (sUrl.includes('.png') || sUrl.includes('image/png')) {
          sImg = await doc.embedPng(sBytes);
        } else {
          sImg = await doc.embedJpg(sBytes);
        }
        const sh2 = 22;
        const sw2 = Math.min(sh2 * (sImg.width / sImg.height), 80);
        page.drawImage(sImg, { x: sx, y: PAD + footerH - 8, width: sw2, height: sh2 });
        sx += sw2 + 12;
      } catch {}
    }
  }

  const brandText = 'fur to feathers';
  const brandSize = 8;
  page.drawText(brandText, {
    x: design.show_signature
      ? PAD
      : W - PAD - helvetica.widthOfTextAtSize(brandText, brandSize),
    y: PAD + 10,
    font: helvetica, size: brandSize, color: rgb(LIGHT_R, LIGHT_G, LIGHT_B),
  });

  // ── Judge signature ───────────────────────────────────────────────────────
  if (design.show_signature) {
    const hwBytes  = await fetchHandwritingFont();
    const sigFont  = hwBytes
      ? await doc.embedFont(hwBytes)
      : await doc.embedFont(StandardFonts.TimesRomanItalic);
    const sigName  = judgeName || 'Sebastian Montgomery';
    const sigW     = 200;
    const sigX     = W - PAD - sigW;
    let   sigSize  = 22;
    while (sigFont.widthOfTextAtSize(sigName, sigSize) > sigW - 10 && sigSize > 10) sigSize--;
    const sigTextW = sigFont.widthOfTextAtSize(sigName, sigSize);
    const sigLineY = PAD + 34;

    page.drawText('Judge', {
      x: sigX + (sigW - helvetica.widthOfTextAtSize('Judge', 8)) / 2,
      y: sigLineY + 18,
      font: helvetica, size: 8, color: rgb(LIGHT_R, LIGHT_G, LIGHT_B),
    });
    page.drawText(sigName, {
      x: sigX + (sigW - sigTextW) / 2,
      y: sigLineY + 4,
      font: sigFont, size: sigSize, color: rgb(DARK_R, DARK_G, DARK_B),
    });
    page.drawLine({
      start: { x: sigX, y: sigLineY }, end: { x: sigX + sigW, y: sigLineY },
      thickness: 0.5, color: rgb(MID_R, MID_G, MID_B, 0.5),
    });
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

    // 3. Fetch show (verify ownership)
    const { data: show, error: showErr } = await adminClient
      .from('shows')
      .select('id, title, host_org, show_date, created_by, cert_design_json, cert_design_locked_at, logo_url, org_logo_url, contact_email')
      .eq('id', show_id)
      .single();
    if (showErr || !show) throw new Error('Show not found');
    if (show.created_by !== user.id) throw new Error('Unauthorized');
    if (!show.cert_design_locked_at) throw new Error('Certificate design is not locked yet');

    // 4. Fetch entry
    const { data: entry, error: entryErr } = await adminClient
      .from('show_entries')
      .select('id, animal_name, breed, exhibitor_name, exhibitor_email, result_place, category_id, photo_url')
      .eq('id', entry_id)
      .eq('show_id', show_id)
      .single();
    if (entryErr || !entry) throw new Error('Entry not found');
    if (!entry.exhibitor_email) throw new Error('No email address for this exhibitor');

    // 5. Fetch category
    const { data: category } = await adminClient
      .from('show_categories')
      .select('id, name')
      .eq('id', entry.category_id)
      .single();

    // 6. Fetch judge name for signature
    const { data: judgeRow } = await adminClient
      .from('show_judges')
      .select('first_name, last_name')
      .eq('show_id', show_id)
      .limit(1)
      .maybeSingle();
    const judgeName = judgeRow
      ? `${judgeRow.first_name || ''} ${judgeRow.last_name || ''}`.trim() || null
      : null;

    // 7. Parse design + fetch sponsors
    let design: any = {};
    try { design = JSON.parse(show.cert_design_json || '{}'); } catch {}

    let sponsors: any[] = [];
    if (design.show_sponsors) {
      const { data: sp } = await adminClient
        .from('show_sponsors')
        .select('name, logo_url')
        .eq('show_id', show_id);
      sponsors = sp || [];
    }

    // 8. Generate PDF
    const pdfBytes = await buildPdf(show, entry, category, sponsors, design, judgeName);

    // 9. Upload PDF to storage
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
    if (!resendKey) throw new Error('RESEND_API_KEY secret is not set — deploy it with: supabase secrets set RESEND_API_KEY=re_...');

    const fromAddr  = Deno.env.get('RESEND_FROM') || 'Fur to Feathers <noreply@furtofeathers.com>';
    const siteUrl   = Deno.env.get('SITE_URL') || 'https://furtofeathers.com';

    const placeStr  = PLACE_LABEL[entry.result_place] ?? `#${entry.result_place}`;
    const catName   = category?.name ?? 'Best in Show';
    const icon      = PLACE_ICON[entry.result_place] ?? '🏆';
    const firstName = entry.exhibitor_name?.split(' ')[0] || 'there';

    const jpgLink = cert_jpg_url
      ? `<a href="${cert_jpg_url}" style="display:inline-block;padding:10px 20px;background:#1ba89a;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;margin-right:8px">Download JPG</a>`
      : '';
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
      .update({
        cert_email_sent_at: now,
        cert_pdf_url,
        ...(cert_jpg_url ? { cert_jpg_url } : {}),
      })
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
