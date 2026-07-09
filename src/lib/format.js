// Shared rendering helpers for admin pages. Extracted from admin/index.astro
// and admin/financial.astro once a third/fourth page needed the same
// currency-formatting logic (same trigger that justified charts.js).
//
// Note on the bigClass/smallClass params: Tailwind's scanner only picks up
// utility classes that appear as literal substrings somewhere in a scanned
// file — a runtime-interpolated class name (e.g. `text-[${size}px]`) would
// never get generated. So callers must pass literal class strings, not
// numbers; every distinct size variant needs to appear literally somewhere
// in source (either here as a default, or at the call site) for Tailwind to
// generate it.

export function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function bigValue(text, bigClass = 'text-[20px]') {
  return `<p class="${bigClass} font-extrabold text-[#1c1626] leading-tight">${esc(text)}</p>`;
}

export function formatBytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0, v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

// Single currency -> one big number, same as before. 2+ currencies -> a
// uniform scrollable mini-table, one row per currency all the same size,
// with the "primary" currency (highest amount, alphabetical tiebreak)
// bolded on a tinted row pinned to the top of the scroll area. Replaces the
// old "shrink the font until it fits" approach, which only worked up to
// 2-3 currencies before becoming unreadable — this scales to any count.
// Accepts either a { currency: amount } map or a [{ currency, amount }]
// array (e.g. Stripe balance entries).
export function currencyTable(input, opts = {}) {
  const {
    bigClass = 'text-[20px]',
    rowClass = 'text-[12.5px]',
    maxVisibleRows = 4,
    rowHeightPx = 30,
    showCount = true,
  } = opts;

  const entries = Array.isArray(input)
    ? input.map(b => [b.currency, b.amount])
    : Object.entries(input || {}).filter(([, v]) => v !== 0 || Object.keys(input || {}).length === 1);

  if (!entries.length) return `<p class="${bigClass} font-extrabold text-[#1c1626] leading-tight">$0.00</p>`;
  if (entries.length === 1) {
    const [cur, v] = entries[0];
    return `<p class="${bigClass} font-extrabold text-[#1c1626] leading-tight">${esc(cur)} ${Number(v).toFixed(2)}</p>`;
  }

  const sorted = [...entries].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const primaryCur = sorted[0][0];
  const maxHeight = Math.min(sorted.length, maxVisibleRows) * rowHeightPx;

  const rows = sorted.map(([cur, v], i) => {
    const isPrimary = cur === primaryCur;
    const stripe = !isPrimary && i % 2 === 1 ? 'bg-[#f7fdfc]' : '';
    return `<div class="flex items-center justify-between px-4 py-1.5 ${rowClass} ${isPrimary ? 'sticky top-0 z-[1] bg-brand-tint font-extrabold' : `font-semibold ${stripe}`}">
      <span class="${isPrimary ? 'text-[#1c1626]' : 'text-[#6f6880]'}">${esc(cur)}</span>
      <span class="${isPrimary ? 'text-brand-dark' : 'text-[#1c1626]'}">${Number(v).toFixed(2)}</span>
    </div>`;
  }).join('');

  return `<div>
    <div class="border-t border-[#daeeed] -mx-4 overflow-y-auto" style="max-height:${maxHeight}px;">${rows}</div>
    ${showCount ? `<p class="text-[10.5px] text-[#9b94a8] mt-1.5">${sorted.length} currencies</p>` : ''}
  </div>`;
}

const STATUS_PILL_COLORS = {
  confirmed: 'background:#dcf6e3;color:#16a34a;',
  pending:   'background:#fef1d6;color:#e89b1c;',
  cancelled: 'background:#fee2e2;color:#ef4444;',
  draft:            'background:#f5f3fa;color:#6f6880;',
  published:        'background:#dcf6e3;color:#16a34a;',
  pending_approval: 'background:#fef1d6;color:#e89b1c;',
  paid:             'background:#dcf6e3;color:#16a34a;',
  overdue:          'background:#fee2e2;color:#ef4444;',
  active:           'background:#dcf6e3;color:#16a34a;',
  suspended:        'background:#fee2e2;color:#ef4444;',
};

export function statusPill(status) {
  const style = STATUS_PILL_COLORS[status] || 'background:#f5f3fa;color:#6f6880;';
  return `<span style="display:inline-flex;align-items:center;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;${style}">${esc(String(status).replace('_', ' '))}</span>`;
}

// New-palette status pill (README §1: success #1d8a4e/#e5f6ec, warning
// #b9770e/#fef3d6, danger #c53d3d/#fce8e6, neutral #6b7c89/#eef1f4) for the 4
// redesigned admin sections only. statusPill() above stays untouched — it's
// still shared by the 12 out-of-scope admin pages.
const STATUS_PILL_COLORS_V2 = {
  confirmed: 'background:#e5f6ec;color:#1d8a4e;',
  published: 'background:#e5f6ec;color:#1d8a4e;',
  paid:      'background:#e5f6ec;color:#1d8a4e;',
  active:    'background:#e5f6ec;color:#1d8a4e;',
  pending:          'background:#fef3d6;color:#b9770e;',
  pending_approval: 'background:#fef3d6;color:#b9770e;',
  draft:            'background:#eef1f4;color:#6b7c89;',
  cancelled: 'background:#fce8e6;color:#c53d3d;',
  overdue:   'background:#fce8e6;color:#c53d3d;',
  suspended: 'background:#fce8e6;color:#c53d3d;',
};

export function statusPillV2(status) {
  const style = STATUS_PILL_COLORS_V2[status] || 'background:#eef1f4;color:#6b7c89;';
  return `<span style="display:inline-flex;align-items:center;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;${style}">${esc(String(status).replace('_', ' '))}</span>`;
}

// Capacity/quota display shared by storage.astro (DB/bucket/row-count
// limits) and email.astro (Resend daily/monthly quota) — warns at
// 75%/90%/100%, same thresholds requested for the original Storage
// Monitoring spec.
export function usageBar(used, limit, opts = {}) {
  const { formatValue = (v) => String(v) } = opts;
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const color = pct >= 90 ? '#ef4444' : pct >= 75 ? '#e89b1c' : '#1ba89a';
  const warn = pct >= 100 ? 'Over limit' : pct >= 90 ? 'Critical' : pct >= 75 ? 'Warning' : '';
  return `<div>
    <div class="flex items-center justify-between text-[11px] text-[#6f6880] mb-1">
      <span>${esc(formatValue(used))} used</span><span>${esc(formatValue(limit))} limit</span>
    </div>
    <div class="w-full h-2 rounded-full bg-[#f0eefa] overflow-hidden">
      <div style="width:${pct.toFixed(1)}%;height:100%;background:${color};border-radius:999px;"></div>
    </div>
    <p class="text-[11px] mt-1" style="color:${color};font-weight:${pct >= 75 ? 700 : 400}">${pct.toFixed(1)}% used${warn ? ' · ' + warn : ''}</p>
  </div>`;
}

// Compact hero-KPI money display: primary currency (highest amount,
// alphabetical tiebreak) large, then only the 2nd-largest currency as a
// one-line caption, with a "+N more" indicator beyond that — deliberately
// NOT the scrollable currencyTable() above, which stays reserved for the
// pages that still use it. Accepts the same dual shape currencyTable does
// (a { currency: amount } map, or a [{ currency, amount }] array e.g. a
// Stripe balance entries list).
export function heroCurrencyValue(input, opts = {}) {
  const {
    bigClass = 'text-[24px]',
    capClass = 'text-[11.5px]',
    bigColor = '#10233f',
    capColor = '#8492a3',
  } = opts;

  const entries = Array.isArray(input)
    ? input.map((b) => [b.currency, b.amount])
    : Object.entries(input || {}).filter(([, v]) => v !== 0 || Object.keys(input || {}).length === 1);

  if (!entries.length) return `<p class="${bigClass} font-extrabold" style="color:${bigColor}">$0.00</p>`;

  const sorted = [...entries].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const [primaryCur, primaryVal] = sorted[0];
  const big = `<p class="${bigClass} font-extrabold" style="color:${bigColor}">${esc(primaryCur)} ${Number(primaryVal).toFixed(2)}</p>`;
  if (sorted.length === 1) return big;

  const [secondCur, secondVal] = sorted[1];
  const more = sorted.length > 2 ? ` · +${sorted.length - 2} more` : '';
  return big + `<p class="${capClass} mt-1" style="color:${capColor}">+${esc(secondCur)} ${Number(secondVal).toFixed(2)}${esc(more)}</p>`;
}

const RANK_STYLES = [
  { bg: '#fef3d6', color: '#b9770e' }, // 1st — gold (reuses the existing warning/amber tokens)
  { bg: '#eef1f4', color: '#48586a' }, // 2nd — silver
  { bg: '#f6e2d3', color: '#b5651d' }, // 3rd — bronze (one-off, decorative only)
];
const RANK_NEUTRAL = { bg: '#eef1f4', color: '#8492a3' }; // 4th+

// Ranked list rows: numbered badge + name + value + a thin proportional bar
// scaled to the list's own max value. Pure row rendering only — card chrome
// (title, currency selector, top-5/10 toggle, caveat banner) is page-level
// interactive state and stays in the calling page's own script.
export function leaderboardRows(items, opts = {}) {
  const { formatValue = (v) => String(v) } = opts;
  if (!items.length) return `<p class="text-[13px] text-[#9b94a8] py-2">No data yet</p>`;
  const maxVal = Math.max(...items.map((i) => i.value), 1);
  return items.map((item, i) => {
    const { bg, color } = RANK_STYLES[i] || RANK_NEUTRAL;
    const pct = Math.max(2, (item.value / maxVal) * 100);
    return `<div class="py-1">
      <div class="flex items-center gap-2">
        <span style="width:20px;height:20px;border-radius:50%;background:${bg};color:${color};font-size:10.5px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${i + 1}</span>
        <span class="flex-1 text-[13px] font-semibold text-[#10233f] min-w-0 truncate">${esc(item.label)}</span>
        <span class="text-[12.5px] font-extrabold text-[#10233f] shrink-0">${esc(formatValue(item.value))}</span>
      </div>
      <div class="h-1 bg-[#f0f2f4] rounded-full mt-1 ml-[28px] overflow-hidden">
        <div style="height:100%;width:${pct.toFixed(1)}%;background:#ff6b54;border-radius:999px;"></div>
      </div>
    </div>`;
  }).join('');
}
