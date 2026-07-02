// Renders an award certificate onto a <canvas> element.
// Canvas is set to A4-landscape logical size (842×595 CSS px) at 2× pixel ratio.

const SCALE = 2;

// Page dimensions in logical px (landscape)
const PAGE_SIZES = { a4: [842, 595], letter: [792, 612] };

export const CERT_DEFAULTS = {
  border_style:  'classic',
  image_mode:    'photo',   // 'none' | 'photo' | 'ribbon'
  show_logo:     true,
  show_sponsors:  false,
  show_signature: false,
  bg_color:      '#ffffff',
  photo_size:    0.45,   // fraction 0.20–0.70
  page_size:     'a4',   // 'a4' | 'letter'
  fields:        ['animal_name', 'breed', 'exhibitor_name', 'category', 'place', 'show_date'],
};

const PLACE_LABEL = { 1: '1st Place', 2: '2nd Place', 3: '3rd Place' };
const RIBBON_URLS = { 1: '/images/1st.png', 2: '/images/2nd.png', 3: '/images/3rd.png' };
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

function drawBorder(ctx, style, W, H) {
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
  } else if (style === 'rainbow') {
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0,    '#ff2d2d');
    grad.addColorStop(0.17, '#ff9900');
    grad.addColorStop(0.33, '#ffee00');
    grad.addColorStop(0.5,  '#00dd55');
    grad.addColorStop(0.67, '#2277ff');
    grad.addColorStop(0.83, '#aa00ff');
    grad.addColorStop(1,    '#ff2d2d');
    ctx.strokeStyle = grad;
    ctx.lineWidth   = 5;
    ctx.lineJoin    = 'round';
    ctx.lineCap     = 'round';

    // Draw one connected wavy path around the full perimeter
    const addCurls = (x0, y0, x1, y1) => {
      const dx = x1 - x0, dy = y1 - y0;
      const len = Math.sqrt(dx * dx + dy * dy);
      const nx = -dy / len, ny = dx / len; // left-perpendicular
      const n = Math.max(3, Math.round(len / 34));
      for (let i = 0; i < n; i++) {
        const flip = i % 2 === 0 ? 1 : -1;
        ctx.quadraticCurveTo(
          x0 + (i + 0.5) / n * dx + flip * 9 * nx,
          y0 + (i + 0.5) / n * dy + flip * 9 * ny,
          x0 + (i + 1)   / n * dx,
          y0 + (i + 1)   / n * dy,
        );
      }
    };

    ctx.beginPath();
    ctx.moveTo(m, m);
    addCurls(m,     m,     W - m, m);
    addCurls(W - m, m,     W - m, H - m);
    addCurls(W - m, H - m, m,     H - m);
    addCurls(m,     H - m, m,     m);
    ctx.closePath();
    ctx.stroke();
  } else if (style === 'gallery') {
    ctx.lineWidth = 1;

    // Outer rectangle
    ctx.strokeRect(m, m, W - 2 * m, H - 2 * m);

    const sq  = 7;  // corner square: ±sq px from corner point
    const arm = 52; // bracket arm length along the border edge from square
    const tk  = 11; // inward tick length at the end of each arm

    for (const [cx, cy, dx, dy] of [
      [m,     m,     1,  1],
      [W - m, m,    -1,  1],
      [m,     H - m,  1, -1],
      [W - m, H - m, -1, -1],
    ]) {
      // Small square centred on the corner point (straddles the outer border)
      ctx.strokeRect(cx - sq, cy - sq, sq * 2, sq * 2);

      ctx.beginPath();
      // Horizontal bracket arm along border edge + inward tick
      ctx.moveTo(cx + sq * dx, cy);
      ctx.lineTo(cx + (sq + arm) * dx, cy);
      ctx.lineTo(cx + (sq + arm) * dx, cy + tk * dy);
      // Vertical bracket arm along border edge + inward tick
      ctx.moveTo(cx, cy + sq * dy);
      ctx.lineTo(cx, cy + (sq + arm) * dy);
      ctx.lineTo(cx + tk * dx, cy + (sq + arm) * dy);
      ctx.stroke();
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
  const [W, H] = PAGE_SIZES[d.page_size] || PAGE_SIZES.a4;

  canvas.width  = W * SCALE;
  canvas.height = H * SCALE;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(SCALE, SCALE);

  // Wait for fonts before drawing text
  await document.fonts.load(`700 18px ${FONT}`).catch(() => {});
  if (d.show_signature) {
    if (!document.getElementById('gf-homemade-apple')) {
      const lnk = document.createElement('link');
      lnk.id   = 'gf-homemade-apple';
      lnk.rel  = 'stylesheet';
      lnk.href = 'https://fonts.googleapis.com/css2?family=Homemade+Apple&display=swap';
      document.head.appendChild(lnk);
      await new Promise(r => { lnk.onload = r; lnk.onerror = r; setTimeout(r, 3000); });
    }
    await document.fonts.load('400 26px "Homemade Apple"').catch(() => {});
  }

  // ── Background ────────────────────────────────────────────────────────────
  ctx.fillStyle = d.bg_color;
  ctx.fillRect(0, 0, W, H);

  // ── Border ────────────────────────────────────────────────────────────────
  drawBorder(ctx, d.border_style, W, H);

  // ── Load images in parallel ───────────────────────────────────────────────
  const place       = entry?.result_place ?? 1;
  const logoUrl     = d.show_logo ? (show?.logo_url || show?.org_logo_url) : null;
  const photoUrl    = d.image_mode === 'photo' ? entry?.photo_url : null;
  const ribbonUrl   = RIBBON_URLS[place] ?? RIBBON_URLS[1];
  const sponsorUrls = d.show_sponsors ? sponsors.slice(0, 4).map(s => s.logo_url) : [];

  const [logoImg, photoImg, ribbonImg, ...sponsorImgs] = await Promise.all([
    loadImg(logoUrl),
    loadImg(photoUrl),
    loadImg(ribbonUrl),
    ...sponsorUrls.map(loadImg),
  ]);

  // contentImg drives the main image zone; ribbonImg always used for banner icon
  const contentImg = d.image_mode === 'ribbon' ? ribbonImg
                   : d.image_mode === 'photo'  ? photoImg
                   : null;

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
  const placeStr = PLACE_LABEL[place] ?? `#${place}`;
  const catName  = category?.name     ?? 'Best in Show';

  ctx.textAlign = 'center';
  if (d.fields.includes('place')) {
    ctx.font      = `700 26px ${FONT}`;
    ctx.fillStyle = ACCENT;
    if (ribbonImg && d.image_mode !== 'ribbon') {
      // Small ribbon icon inline with place text
      const rh     = 32;
      const rw     = Math.round(rh * ribbonImg.naturalWidth / ribbonImg.naturalHeight);
      const textW  = ctx.measureText(placeStr).width;
      const startX = Math.round((W - rw - 10 - textW) / 2);
      ctx.drawImage(ribbonImg, startX, y, rw, rh);
      ctx.textAlign = 'left';
      ctx.fillText(placeStr, startX + rw + 10, y + 22);
      ctx.textAlign = 'center';
      y += 36;
    } else {
      ctx.fillText(placeStr, W / 2, y + 24);
      y += 34;
    }
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
  const footerH = d.show_sponsors && sponsorImgs.some(Boolean) ? 56 : 36;
  const contentH = H - y - footerH - PAD;
  const contentW = W - 2 * PAD;
  const photoSize = Math.min(Math.max(d.photo_size ?? 0.45, 0.20), 0.70);

  // Layout depends on photo aspect ratio:
  //   Portrait (< 0.80)  → photo left column, text right (side-by-side)
  //   Landscape or square → photo centred at top, text centred below
  let photoW = 0, photoH = 0, photoX = PAD, photoY = y;
  let textDrawX = PAD, textStartY = y + 4, textCentered = false;

  if (contentImg) {
    const aspect = contentImg.naturalWidth / contentImg.naturalHeight;

    if (aspect < 0.80) {
      // Portrait: photo left column, text centred both axes in the remaining column.
      photoW = Math.round(90 + ((photoSize - 0.20) / 0.50) * 120);
      // Preserve natural aspect ratio and centre vertically in the column
      photoH = Math.min(Math.round(photoW / aspect), contentH);
      photoX = PAD;
      photoY = y + Math.round((contentH - photoH) / 2);

      // Pre-calculate text block height for vertical centering
      let totalTextH = 0;
      if (d.fields.includes('animal_name')) totalTextH += 34;
      if (d.fields.includes('breed') && entry?.breed) totalTextH += 24;
      if (d.fields.includes('exhibitor_name') && entry?.exhibitor_name) totalTextH += 26;

      const colLeft    = PAD + photoW + 24;
      const colCenterX = colLeft + (W - PAD - colLeft) / 2;
      const vertOffset = Math.max(0, Math.round((contentH - totalTextH) / 2));

      textDrawX    = colCenterX;
      textStartY   = y + vertOffset;
      textCentered = true;
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
  } else {
    // No photo: center text block both axes in the full content zone
    let totalTextH = 0;
    if (d.fields.includes('animal_name')) totalTextH += 34;
    if (d.fields.includes('breed') && entry?.breed) totalTextH += 24;
    if (d.fields.includes('exhibitor_name') && entry?.exhibitor_name) totalTextH += 26;
    textDrawX    = W / 2;
    textStartY   = y + Math.max(0, Math.round((contentH - totalTextH) / 2));
    textCentered = true;
  }

  // Photo
  if (contentImg && photoW > 0 && photoH > 0) {
    if (d.image_mode === 'ribbon') {
      // Draw ribbon PNG at computed size — no crop, no clipping, no border stroke
      ctx.drawImage(contentImg, photoX, photoY, photoW, photoH);
    } else {
      fitImage(ctx, contentImg, photoX, photoY, photoW, photoH, 10);
      ctx.strokeStyle = '#E6EEEC';
      ctx.lineWidth   = 1;
      rrect(ctx, photoX, photoY, photoW, photoH, 10);
      ctx.stroke();
    }
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
  ctx.textAlign = d.show_signature ? 'left' : 'right';
  ctx.fillText('fur to feathers', d.show_signature ? PAD : W - PAD, fy - 14);

  // ── Judge signature ───────────────────────────────────────────────────────
  if (d.show_signature) {
    const sigName = show?.judge_name || 'Sebastian Montgomery';
    const sigW    = 200;
    const sigCX   = W - PAD - sigW / 2;

    ctx.textAlign = 'center';

    // "Judge" label
    ctx.font      = `500 9px ${FONT}`;
    ctx.fillStyle = TEXT_LIGHT;
    ctx.fillText('Judge', sigCX, fy - 74);

    // Handwritten name — auto-size to fit block width
    let sigPx = 26;
    ctx.font = `400 ${sigPx}px "Homemade Apple"`;
    while (ctx.measureText(sigName).width > sigW - 10 && sigPx > 11) {
      sigPx--;
      ctx.font = `400 ${sigPx}px "Homemade Apple"`;
    }
    ctx.fillStyle = TEXT_DARK;
    ctx.fillText(sigName, sigCX, fy - 50);

    // Signature line
    ctx.strokeStyle = TEXT_MID + '50';
    ctx.lineWidth   = 0.5;
    ctx.beginPath();
    ctx.moveTo(sigCX - sigW / 2, fy - 38);
    ctx.lineTo(sigCX + sigW / 2, fy - 38);
    ctx.stroke();
  }
}
