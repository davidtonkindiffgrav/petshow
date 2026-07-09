// Pure SVG chart builders — no DOM dependency, no build-step chart library.
// Return plain SVG markup strings that callers insert via innerHTML, matching
// this codebase's template-string page architecture. Extracted from the
// trend/donut chart code originally written inline in src/pages/organiser.astro.

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// points: [{ label, value }] rendered left-to-right, evenly spaced.
// opts: { mode: 'bar'|'line', width, height, formatValue(v), highlightIndex }
export function barLineSvg(points, opts = {}) {
  const {
    mode = 'bar',
    width: W = 420,
    height: H = 125,
    formatValue = (v) => String(v),
    highlightIndex = points.length - 1,
  } = opts;

  const values = points.map((p) => p.value);
  const maxVal = Math.max(...values, 1);
  const padL = 28, padR = 6, padT = 16, padB = 18;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const slotW = chartW / Math.max(points.length, 1);
  let svg = '';

  [0.33, 0.66, 1].forEach((frac) => {
    const y = padT + chartH - frac * chartH;
    const val = frac * maxVal;
    const lbl = Number.isInteger(maxVal) ? Math.round(val) : (val >= 10 ? Math.round(val) : val.toFixed(1));
    svg += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="#f0eefa" stroke-width="1"/>`;
    svg += `<text x="${padL - 4}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="7" fill="#c4bed0">${lbl}</text>`;
  });

  if (mode === 'bar') {
    const barW = slotW * 0.48;
    points.forEach((p, i) => {
      const cx = padL + i * slotW + slotW / 2;
      const barH = p.value > 0 ? Math.max(3, (p.value / maxVal) * chartH) : 0;
      const y = padT + chartH - barH;
      const isHi = i === highlightIndex;
      const color = isHi ? '#1ba89a' : '#b8e4e0';
      if (p.value > 0) {
        svg += `<rect x="${(cx - barW / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" rx="2.5" fill="${color}"/>`;
        svg += `<text x="${cx.toFixed(1)}" y="${(y - 2.5).toFixed(1)}" text-anchor="middle" font-size="7.5" font-weight="700" fill="${isHi ? '#1ba89a' : '#6f6880'}">${esc(formatValue(p.value))}</text>`;
      } else {
        svg += `<rect x="${(cx - barW / 2).toFixed(1)}" y="${(padT + chartH - 2).toFixed(1)}" width="${barW.toFixed(1)}" height="2" rx="1" fill="#efebf5"/>`;
      }
      svg += `<text x="${cx.toFixed(1)}" y="${(H - 4).toFixed(1)}" text-anchor="middle" font-size="7.5" fill="${isHi ? '#1ba89a' : '#9b94a8'}" font-weight="${isHi ? '700' : '400'}">${esc(p.label)}</text>`;
    });
  } else {
    const pts = points.map((p, i) => ({
      x: padL + i * slotW + slotW / 2,
      y: padT + chartH - (p.value / maxVal) * chartH,
      val: p.value,
    }));
    const gradId = `tg${Math.random().toString(36).slice(2, 8)}`;
    svg += `<defs><linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#1ba89a" stop-opacity="0.15"/><stop offset="100%" stop-color="#1ba89a" stop-opacity="0.01"/></linearGradient></defs>`;
    const bl = padT + chartH;
    svg += `<path d="M${pts[0].x.toFixed(1)},${bl} ${pts.map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} L${pts[pts.length - 1].x.toFixed(1)},${bl} Z" fill="url(#${gradId})"/>`;
    svg += `<polyline points="${pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}" fill="none" stroke="#1ba89a" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>`;
    pts.forEach((p, i) => {
      const isHi = i === highlightIndex;
      svg += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${isHi ? 3.5 : 2.5}" fill="${isHi ? '#1ba89a' : '#fff'}" stroke="#1ba89a" stroke-width="1.5"/>`;
      if (p.val > 0) svg += `<text x="${p.x.toFixed(1)}" y="${(p.y - 5.5).toFixed(1)}" text-anchor="middle" font-size="7.5" font-weight="700" fill="${isHi ? '#1ba89a' : '#6f6880'}">${esc(formatValue(p.val))}</text>`;
      svg += `<text x="${p.x.toFixed(1)}" y="${(H - 4).toFixed(1)}" text-anchor="middle" font-size="7.5" fill="${isHi ? '#1ba89a' : '#9b94a8'}" font-weight="${isHi ? '700' : '400'}">${esc(points[i].label)}</text>`;
    });
  }

  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;" aria-hidden="true">${svg}</svg>`;
}

// segments: [{ label, value, color }]. opts: { size=120, strokeWidth=14, centerTop, centerBottom }
export function donutSvg(segments, opts = {}) {
  const { size = 120, strokeWidth: sw = 14, centerTop = '', centerBottom = '', radius } = opts;
  const cx = size / 2, cy = size / 2, r = radius ?? (size / 2 - sw / 2 - 6);
  const circ = 2 * Math.PI * r;
  const total = segments.reduce((s, seg) => s + (seg.value || 0), 0);

  let arcs = '';
  if (total <= 0 || !segments.length) {
    arcs = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#efebf5" stroke-width="${sw}" transform="rotate(-90 ${cx} ${cy})"/>`;
  } else {
    let offset = 0;
    segments.forEach((seg) => {
      const value = seg.value || 0;
      const segLen = (value / total) * circ;
      const adjustedLen = Math.max(0, segLen - (segments.length > 1 ? 2 : 0));
      arcs += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${seg.color}" stroke-width="${sw}"
        stroke-dasharray="${adjustedLen} ${circ - adjustedLen}"
        stroke-dashoffset="${circ - offset}"
        transform="rotate(-90 ${cx} ${cy})"
        pointer-events="stroke"
        data-label="${esc(seg.label)}: ${value}"
        style="cursor:pointer;"/>`;
      offset += segLen;
    });
  }

  const centerText = centerTop || centerBottom
    ? `<text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="22" font-weight="800" fill="#1c1626">${esc(centerTop)}</text>
       <text x="${cx}" y="${cy + 13}" text-anchor="middle" font-size="10" fill="#9b94a8">${esc(centerBottom)}</text>`
    : '';

  return `<svg viewBox="0 0 ${size} ${size}" style="width:100%;height:auto;" aria-hidden="true">${arcs}${centerText}</svg>`;
}

// points: [{ ..., value }] — a compact trend shape (filled area + line, no
// gridlines/axis labels/per-point text) distinct from barLineSvg's denser
// chart. opts: { width=240, height=48, color, strokeWidth=2 }
export function sparklineSvg(points, opts = {}) {
  const { width: W = 240, height: H = 48, color = '#ff6b54', strokeWidth = 2, padY = 4 } = opts;
  const values = points.map((p) => p.value);
  const maxVal = Math.max(...values, 0);
  const minVal = Math.min(...values, 0);
  const range = maxVal - minVal || 1;
  const usableH = H - padY * 2;
  const n = Math.max(points.length - 1, 1);
  const coords = points.map((p, i) => ({
    x: (i / n) * W,
    y: padY + usableH - ((p.value - minVal) / range) * usableH,
  }));
  const line = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const area = `0,${H} ${line} ${W},${H}`;
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:${H}px;" aria-hidden="true">
    <polygon points="${area}" fill="${color}" opacity="0.12"></polygon>
    <polyline points="${line}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"></polyline>
  </svg>`;
}

// Sparkline point-count targets per Trends range toggle, shared by every
// page with a range-scoped Trends panel (Analytics, Dashboard Home) — keeps
// 90d/YTD visually clean without requesting new day-level granularity.
export const RANGE_TARGET_POINTS = { '7d': 7, '30d': 30, '90d': 26, ytd: 12 };

// Averages a one-point-per-day series down to ~targetCount buckets, so a
// sparkline stays visually clean on longer ranges (90d/YTD) without
// requesting new day-level granularity from the backend. Returns the input
// unchanged if it's already short enough.
export function downsampleSeries(points, targetCount, fields) {
  if (points.length <= targetCount) return points;
  const bucketSize = points.length / targetCount;
  const out = [];
  for (let i = 0; i < targetCount; i++) {
    const start = Math.floor(i * bucketSize);
    const end = Math.max(Math.floor((i + 1) * bucketSize), start + 1);
    const slice = points.slice(start, end);
    const bucket = { ...slice[slice.length - 1] };
    for (const f of fields) bucket[f] = slice.reduce((s, p) => s + (Number(p[f]) || 0), 0) / slice.length;
    out.push(bucket);
  }
  return out;
}

