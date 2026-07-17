// Renders a social-media promo image onto a <canvas> element.
// Fixed 4:5 canvas (1080×1350) — the standard Facebook/Instagram feed portrait
// size, sized for direct upload with no cropping.
//
// Layout: a banner strip across the top ~35%, a flat background color filling
// the rest. A centered headline pill sits just below the banner. Up to four
// independently placeable elements (show logo, club logo, sponsor logo row,
// QR code) sit in one of three corners — top-left, top-right, or
// bottom-right — auto-stacking if more than one shares a corner. Bottom-left
// is reserved for the show title/date text block, which sits on a
// translucent panel so it stays legible over any background color.

import QRCode from 'qrcode';
import { deriveBarColor } from './dominantColor.js';

const W = 1080;
const H = 1350;
const PAD = 64;
const GAP = 16;
const FONT = '"Plus Jakarta Sans", system-ui, sans-serif';
const DEFAULT_ACCENT = '#0E2A2A';
const BANNER_H = Math.round(H * 0.35);

const ELEMENT_DEFAULTS = { on: true, pos: 'tl', size: 1 };

export const PROMO_DEFAULTS = {
  headline: 'Entries Open',
  headlineSize: 48, // px — organiser-set exact size, not a percentage
  bg_color: null, // null = follow show.banner_color / DEFAULT_ACCENT
  showLogo: { ...ELEMENT_DEFAULTS, pos: 'tl' },
  clubLogo: { ...ELEMENT_DEFAULTS, pos: 'tr' },
  sponsors: { ...ELEMENT_DEFAULTS, pos: 'br', on: false },
  qr:       { ...ELEMENT_DEFAULTS, pos: 'br' },
};

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

// Cover-fit crop into a destination box, like CSS object-fit: cover.
function fitImage(ctx, img, dx, dy, dw, dh) {
  const aspect = img.naturalWidth / img.naturalHeight;
  const target = dw / dh;
  let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
  if (aspect > target) { sw = sh * target; sx = (img.naturalWidth - sw) / 2; }
  else                  { sh = sw / target; sy = (img.naturalHeight - sh) / 2; }
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}

function whiteCard(ctx, x, y, w, h, r = 16) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur  = 16;
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  rrect(ctx, x, y, w, h, r);
  ctx.fill();
  ctx.restore();
}

// Auto-shrinks a single line to fit maxW down to minPx; if it still doesn't
// fit at minPx, greedily word-wraps at minPx instead (capped at 3 lines).
function fitTitleLines(ctx, text, maxW, maxPx, minPx) {
  let px = maxPx;
  ctx.font = `800 ${px}px ${FONT}`;
  while (ctx.measureText(text).width > maxW && px > minPx) {
    px--;
    ctx.font = `800 ${px}px ${FONT}`;
  }
  if (ctx.measureText(text).width <= maxW) return { lines: [text], px };

  px = minPx;
  ctx.font = `800 ${px}px ${FONT}`;
  const words = text.split(/\s+/);
  const lines = [];
  let cur = '';
  for (const word of words) {
    const test = cur ? `${cur} ${word}` : word;
    if (ctx.measureText(test).width > maxW && cur) {
      lines.push(cur);
      cur = word;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return { lines: lines.slice(0, 3), px };
}

// Greedy word-wrap at a fixed font size (no auto-shrink) — used for the
// headline, where the organiser picks the exact size and expects the text
// to wrap around it rather than be shrunk to fit. Explicit line breaks in
// the input are preserved as forced line breaks; each resulting line is
// then wrapped independently.
function wrapAtSize(ctx, text, maxW, px, maxLines = 10) {
  ctx.font = `800 ${px}px ${FONT}`;
  const lines = [];
  for (const paragraph of text.split(/\n+/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    let cur = '';
    for (const word of words) {
      const test = cur ? `${cur} ${word}` : word;
      if (ctx.measureText(test).width > maxW && cur) {
        lines.push(cur);
        cur = word;
      } else {
        cur = test;
      }
    }
    if (cur) lines.push(cur);
  }
  return lines.slice(0, maxLines);
}

// Groups placeable elements by their chosen corner and lays each group out
// as a stack (top corners grow downward from PAD, bottom-right grows upward
// from H-PAD), so two elements sharing a corner offset instead of overlap.
function resolveStacks(items) {
  const groups = { tl: [], tr: [], br: [] };
  for (const it of items) groups[it.pos].push(it);

  const positions = {};
  for (const side of ['tl', 'tr']) {
    let y = PAD;
    for (const it of groups[side]) {
      const x = side === 'tl' ? PAD : W - PAD - it.boxW;
      positions[it.key] = { x, y };
      y += it.boxH + GAP;
    }
  }
  let y = H - PAD;
  for (const it of groups.br) {
    y -= it.boxH;
    positions[it.key] = { x: W - PAD - it.boxW, y };
    y -= GAP;
  }

  const brWidth = groups.br.reduce((m, it) => Math.max(m, it.boxW), 0);
  return { positions, brWidth };
}

export async function renderPromoImage(canvas, { show, sponsors = [], headline, headlineSize = 48, bgColor, elements, publicUrl }) {
  canvas.width  = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  await document.fonts.load(`800 40px ${FONT}`).catch(() => {});

  const el = {
    showLogo: { ...PROMO_DEFAULTS.showLogo, ...elements?.showLogo },
    clubLogo: { ...PROMO_DEFAULTS.clubLogo, ...elements?.clubLogo },
    sponsors: { ...PROMO_DEFAULTS.sponsors, ...elements?.sponsors },
    qr:       { ...PROMO_DEFAULTS.qr,       ...elements?.qr },
  };

  const resolvedBg = bgColor || show?.banner_color || DEFAULT_ACCENT;
  const bright = deriveBarColor(resolvedBg);

  const [bannerImg, showLogoImg, clubLogoImg, qrCanvas, ...sponsorImgs] = await Promise.all([
    loadImg(show?.banner_url),
    el.showLogo.on ? loadImg(show?.logo_url) : Promise.resolve(null),
    el.clubLogo.on ? loadImg(show?.org_logo_url) : Promise.resolve(null),
    el.qr.on && publicUrl
      ? QRCode.toCanvas(document.createElement('canvas'), publicUrl, { width: 300, margin: 1, color: { dark: '#1c1626', light: '#ffffff' } })
      : Promise.resolve(null),
    ...(el.sponsors.on ? sponsors.slice(0, 4).map(s => loadImg(s.logo_url)) : []),
  ]);

  // ── Background + banner strip ────────────────────────────────────────────
  ctx.fillStyle = resolvedBg;
  ctx.fillRect(0, 0, W, H);
  if (bannerImg) fitImage(ctx, bannerImg, 0, 0, W, BANNER_H);

  // ── Build placeable-element boxes (only those toggled on & loaded) ───────
  const items = [];

  if (el.showLogo.on && showLogoImg) {
    const logoH = 88 * el.showLogo.size;
    const logoW = Math.min(logoH * (showLogoImg.naturalWidth / showLogoImg.naturalHeight), 260 * el.showLogo.size);
    items.push({ key: 'showLogo', pos: el.showLogo.pos, boxW: logoW + 40, boxH: logoH + 40, draw(x, y, w, h) {
      whiteCard(ctx, x, y, w, h);
      ctx.drawImage(showLogoImg, x + 20, y + (h - logoH) / 2, logoW, logoH);
    } });
  }

  if (el.clubLogo.on && clubLogoImg) {
    const logoH = 88 * el.clubLogo.size;
    const logoW = Math.min(logoH * (clubLogoImg.naturalWidth / clubLogoImg.naturalHeight), 260 * el.clubLogo.size);
    items.push({ key: 'clubLogo', pos: el.clubLogo.pos, boxW: logoW + 40, boxH: logoH + 40, draw(x, y, w, h) {
      whiteCard(ctx, x, y, w, h);
      ctx.drawImage(clubLogoImg, x + 20, y + (h - logoH) / 2, logoW, logoH);
    } });
  }

  const loadedSponsorImgs = sponsorImgs.filter(Boolean);
  if (el.sponsors.on && loadedSponsorImgs.length) {
    const sh = 56 * el.sponsors.size;
    const widths = loadedSponsorImgs.map(img => Math.min(sh * (img.naturalWidth / img.naturalHeight), 140 * el.sponsors.size));
    const rowW = widths.reduce((a, b) => a + b, 0) + 14 * (widths.length - 1);
    items.push({ key: 'sponsors', pos: el.sponsors.pos, boxW: rowW + 40, boxH: sh + 40, draw(x, y, w, h) {
      whiteCard(ctx, x, y, w, h);
      let sx = x + 20;
      loadedSponsorImgs.forEach((img, i) => {
        ctx.drawImage(img, sx, y + (h - sh) / 2, widths[i], sh);
        sx += widths[i] + 14;
      });
    } });
  }

  if (el.qr.on && qrCanvas) {
    const boxSize = 208 * el.qr.size;
    const qrSize  = 156 * el.qr.size;
    items.push({ key: 'qr', pos: el.qr.pos, boxW: boxSize, boxH: boxSize, draw(x, y, w, h) {
      whiteCard(ctx, x, y, w, h);
      ctx.drawImage(qrCanvas, x + (w - qrSize) / 2, y + 14 * el.qr.size, qrSize, qrSize);
      ctx.textAlign = 'center';
      ctx.font      = `700 ${16 * el.qr.size}px ${FONT}`;
      ctx.fillStyle = '#1c1626';
      ctx.fillText('Scan to Enter', x + w / 2, y + h - 16 * el.qr.size);
    } });
  }

  const { positions, brWidth } = resolveStacks(items);
  for (const it of items) {
    const p = positions[it.key];
    it.draw(p.x, p.y, it.boxW, it.boxH);
  }

  // ── Headline (centered, directly under the banner) ──────────────────────
  // Font size is an exact px value the organiser sets directly (not a
  // percentage) — text wraps to fit rather than auto-shrinking, so a big
  // size with a long headline can grow to fill most of the image.
  const headlineText = (headline ?? PROMO_DEFAULTS.headline).trim().toUpperCase();
  if (headlineText) {
    const hMaxW = W - PAD * 2 - 80;
    const hLines = wrapAtSize(ctx, headlineText, hMaxW, headlineSize);
    const hLineH = headlineSize * 1.2;
    const padX = 32, padY = Math.max(16, headlineSize * 0.28);

    const panelW = Math.min(
      Math.max(...hLines.map(l => { ctx.font = `800 ${headlineSize}px ${FONT}`; return ctx.measureText(l).width; })) + padX * 2,
      hMaxW + padX * 2,
    );
    const panelH = hLines.length * hLineH + padY * 2;
    const panelX = (W - panelW) / 2;
    const panelY = BANNER_H + 28;

    ctx.fillStyle = bright;
    rrect(ctx, panelX, panelY, panelW, panelH, 20);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font      = `800 ${headlineSize}px ${FONT}`;
    ctx.textAlign = 'center';
    hLines.forEach((line, i) => ctx.fillText(line, W / 2, panelY + padY + headlineSize * 0.82 + i * hLineH));
  }

  // ── Bottom-left text block (title + date) ────────────────────────────────
  const maxTextW = W - PAD * 2 - (brWidth > 0 ? brWidth + 40 : 0);

  let dateStr = '';
  if (show?.show_date) {
    dateStr = new Date(show.show_date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  const title = show?.title || 'Pet Show';
  const { lines, px } = fitTitleLines(ctx, title, maxTextW, 68, 40);
  const lineH = px * 1.18;

  // Panel bounds (measured before drawing so it can sit behind everything)
  const dateH = dateStr ? 56 : 0;
  const blockH = lines.length * lineH + dateH;
  const panelPadX = 28, panelPadTop = 24, panelPadBottom = 24;
  const panelW = Math.max(...lines.map(l => { ctx.font = `800 ${px}px ${FONT}`; return ctx.measureText(l).width; })) + panelPadX * 2;
  const panelH = blockH + panelPadTop + panelPadBottom;
  const panelY = H - PAD - panelH;
  ctx.fillStyle = 'rgba(10,10,15,0.55)';
  rrect(ctx, PAD - panelPadX, panelY, Math.min(panelW, maxTextW + panelPadX * 2), panelH, 18);
  ctx.fill();

  let ty = panelY + panelPadTop;

  // Title
  ctx.fillStyle = '#ffffff';
  ctx.font      = `800 ${px}px ${FONT}`;
  ctx.textAlign = 'left';
  lines.forEach((line, i) => ctx.fillText(line, PAD, ty + px * 0.85 + i * lineH));
  ty += lines.length * lineH;

  // Date
  if (dateStr) {
    ctx.font      = `600 30px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(dateStr, PAD, ty + 24);
  }
}
