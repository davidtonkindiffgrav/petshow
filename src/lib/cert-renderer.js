// Renders an award certificate onto a <canvas> element.
// Canvas is set to A4-landscape logical size (842×595 CSS px) at 2× pixel ratio.

const W = 842;
const H = 595;
const SCALE = 2;

export const CERT_DEFAULTS = {
  border_style:  'classic',
  show_photo:    true,
  show_logo:     true,
  show_sponsors: false,
  bg_color:      '#ffffff',
  photo_size:    0.45,   // fraction 0.20–0.70; controls column width (portrait) or photo width (centered)
  fields:        ['animal_name', 'breed', 'exhibitor_name', 'category', 'place', 'show_date'],
};

const PLACE_LABEL = { 1: '1st Place', 2: '2nd Place', 3: '3rd Place' };
const PLACE_ICON  = { 1: '🥇', 2: '🥈', 3: '🥉' };
const ACCENT      = '#1ba89a';
const TEXT_DARK   = '#143A37';
const TEXT_MID    = '#4A6663';
const TEXT_LIGHT  = '#9BB4AF';
const FONT        = '"Plus Jakarta Sans", system-ui, sans-serif';

function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

async function loadImg(url) {
  if (!url) return null;
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function drawBorder(ctx, style) {
  const m = 14;
  ctx.strokeStyle = ACCENT;
  if (style === 'none') return;
  if (style === 'classic') {
    ctx.lineWidth = 1.5;
    ctx.strokeRect(m, m, W - m * 2, H - m * 2);
  } else if (style === 'elegant') {
    ctx.lineWidth = 0.75;
    ctx.strokeRect(m, m, W - m * 2, H - m * 2);
    ctx.strokeRect(m + 5, m + 5, W - (m + 5) * 2, H - (m + 5) * 2);
  } else if (style === 'playful') {
    ctx.lineWidth = 3;
    rrect(ctx, m, m, W - m * 2, H - m * 2, 18);
    ctx.stroke();
    ctx.fillStyle = ACCENT;
    const dm = m + 4;
    for (const [x, y] of [[dm, dm], [W - dm, dm], [dm, H - dm], [W - dm, H - dm]]) {
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
    }
  }
}

function fitImage(ctx, img, dx, dy, dw, dh, radius = 0) {
  const aspect = img.naturalWidth / img.naturalHeight;
  const target = dw / dh;
  let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
  if (aspect > target) { sw = sh * target; sx = (img.naturalWidth - sw) / 2; }
  else                  { sh = sw / target; sy = (img.naturalHeight - sh) / 2; }
  ctx.save();
  if (radius > 0) { rrect(ctx, dx, dy, dw, dh, radius); ctx.clip(); }
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
  ctx.restore();
}

export async function renderCertificate(canvas, { show, entry, category, sponsors = [], design = {} }) {
  const d = { ...CERT_DEFAULTS, ...design };

  canvas.width  = W * SCALE;
  canvas.height = H * SCALE;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(SCALE, SCALE);

  // Wait for fonts before drawing text
  await document.fonts.load(`700 18px ${FONT}`).catch(() => {});

  // ── Background ────────────────────────────────────────────────────────────
  ctx.fillStyle = d.bg_color;
  ctx.fillRect(0, 0, W, H);

  // ── Border ────────────────────────────────────────────────────────────────
  drawBorder(ctx, d.border_style);

  // ── Load images in parallel ───────────────────────────────────────────────
  const logoUrl    = d.show_logo ? (show?.logo_url || show?.org_logo_url) : null;
  const photoUrl   = d.show_photo ? entry?.photo_url : null;
  const sponsorUrls = d.show_sponsors ? sponsors.slice(0, 4).map(s => s.logo_url) : [];

  const [logoImg, photoImg, ...sponsorImgs] = await Promise.all([
    loadImg(logoUrl),
    loadImg(photoUrl),
    ...sponsorUrls.map(loadImg),
  ]);

  const PAD = 36;
  let y = PAD;

  // ── Header row ────────────────────────────────────────────────────────────
  const headerH = 44;

  if (logoImg) {
    const lh = 36;
    const lw = Math.min(lh * (logoImg.naturalWidth / logoImg.naturalHeight), 110);
    ctx.drawImage(logoImg, PAD, y, lw, lh);
  }

  ctx.textAlign    = 'center';
  ctx.fillStyle    = TEXT_DARK;
  ctx.font         = `700 17px ${FONT}`;
  ctx.fillText(show?.title || 'Pet Show', W / 2, y + 14);

  if (show?.host_org) {
    ctx.font      = `500 11px ${FONT}`;
    ctx.fillStyle = TEXT_MID;
    ctx.fillText(show.host_org, W / 2, y + 30);
  }

  if (d.fields.includes('show_date') && show?.show_date) {
    const dt = new Date(show.show_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    ctx.font      = `500 10px ${FONT}`;
    ctx.fillStyle = TEXT_LIGHT;
    ctx.textAlign = 'right';
    ctx.fillText(dt, W - PAD, y + 12);
  }

  y += headerH;

  // Divider
  ctx.strokeStyle = ACCENT + '50';
  ctx.lineWidth   = 0.75;
  ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(W - PAD, y); ctx.stroke();
  y += 14;

  // ── Place banner ──────────────────────────────────────────────────────────
  const place    = entry?.result_place ?? 1;
  const placeStr = PLACE_LABEL[place] ?? `#${place}`;
  const icon     = PLACE_ICON[place]  ?? '🏆';
  const catName  = category?.name     ?? 'Best in Show';

  ctx.textAlign = 'center';
  if (d.fields.includes('place')) {
    ctx.font      = `700 26px ${FONT}`;
    ctx.fillStyle = ACCENT;
    ctx.fillText(`${icon}  ${placeStr}`, W / 2, y + 24);
    y += 34;
  }
  if (d.fields.includes('category')) {
    ctx.font      = `500 13px ${FONT}`;
    ctx.fillStyle = TEXT_MID;
    ctx.fillText(catName, W / 2, y + 14);
    y += 22;
  }

  y += 10;

  // Divider
  ctx.strokeStyle = ACCENT + '50';
  ctx.lineWidth   = 0.75;
  ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(W - PAD, y); ctx.stroke();
  y += 16;

  // ── Content zone ──────────────────────────────────────────────────────────
  const footerH  = d.show_sponsors && sponsorImgs.some(Boolean) ? 56 : 36;
  const contentH = H - y - footerH - PAD;
  const contentW = W - 2 * PAD;
  const photoSize = Math.min(Math.max(d.photo_size ?? 0.45, 0.20), 0.70);

  // Layout depends on photo aspect ratio:
  //   Portrait (< 0.80)  → photo left column, text right (side-by-side)
  //   Landscape or square → photo centred at top, text centred below
  let photoW = 0, photoH = 0, photoX = PAD, photoY = y;
  let textDrawX = PAD, textStartY = y + 4, textCentered = false;

  if (photoImg) {
    const aspect = photoImg.naturalWidth / photoImg.naturalHeight;

    if (aspect < 0.80) {
      // Portrait: side-by-side. photo_size scales column 90–210 px.
      photoW = Math.round(90 + ((photoSize - 0.20) / 0.50) * 120);
      photoH = contentH;
      photoX = PAD;
      photoY = y;
      textDrawX  = PAD + photoW + 24;
      textStartY = y + 4;
      textCentered = false;
    } else {
      // Landscape / square: centred photo, text centred below.
      let pW = Math.round(contentW * photoSize);
      let pH = Math.round(pW / aspect);
      // Cap height at 58% of contentH so text always has breathing room.
      if (pH > contentH * 0.58) { pH = Math.round(contentH * 0.58); pW = Math.round(pH * aspect); }
      photoW = pW; photoH = pH;
      photoX = PAD + Math.round((contentW - pW) / 2);
      photoY = y;
      textDrawX  = W / 2;
      textStartY = y + pH + 14;
      textCentered = true;
    }
  }

  // Photo
  if (photoImg && photoW > 0 && photoH > 0) {
    fitImage(ctx, photoImg, photoX, photoY, photoW, photoH, 10);
    ctx.strokeStyle = '#E6EEEC';
    ctx.lineWidth   = 1;
    rrect(ctx, photoX, photoY, photoW, photoH, 10);
    ctx.stroke();
  }

  // Text fields
  let ty = textStartY;
  ctx.textAlign = textCentered ? 'center' : 'left';

  if (d.fields.includes('animal_name')) {
    const name = entry?.animal_name || 'Animal Name';
    ctx.font      = `800 24px ${FONT}`;
    ctx.fillStyle = TEXT_DARK;
    ctx.fillText(name, textDrawX, ty + 22);
    ty += 34;
  }
  if (d.fields.includes('breed') && entry?.breed) {
    ctx.font      = `500 13px ${FONT}`;
    ctx.fillStyle = TEXT_MID;
    ctx.fillText(entry.breed, textDrawX, ty + 14);
    ty += 24;
  }
  if (d.fields.includes('exhibitor_name') && entry?.exhibitor_name) {
    ty += 6;
    ctx.font      = `500 12px ${FONT}`;
    ctx.fillStyle = TEXT_LIGHT;
    ctx.fillText(`Owner: ${entry.exhibitor_name}`, textDrawX, ty + 12);
    ty += 20;
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  const fy = H - PAD + 4;

  if (d.show_sponsors) {
    let sx = PAD;
    for (const sImg of sponsorImgs) {
      if (!sImg) continue;
      const sh = 22;
      const sw = Math.min(sh * (sImg.naturalWidth / sImg.naturalHeight), 80);
      ctx.drawImage(sImg, sx, fy - sh, sw, sh);
      sx += sw + 12;
    }
  }

  // Thin footer line
  ctx.strokeStyle = ACCENT + '30';
  ctx.lineWidth   = 0.5;
  ctx.beginPath(); ctx.moveTo(PAD, fy - 28); ctx.lineTo(W - PAD, fy - 28); ctx.stroke();

  ctx.font      = `400 9px ${FONT}`;
  ctx.fillStyle = TEXT_LIGHT;
  ctx.textAlign = 'right';
  ctx.fillText('fur to feathers', W - PAD, fy - 14);
}
