// Client-side CSV export — no backend, matches this project's no-build-step
// constraint. Converts already-fetched table data into a downloaded file.

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// columns: [{ label, value(row) }] — value() lets callers derive a column
// from nested/computed data (e.g. row.shows?.title) instead of requiring
// flat rows.
export function toCsv(rows, columns) {
  const header = columns.map((c) => csvCell(c.label)).join(',');
  const lines = rows.map((row) => columns.map((c) => csvCell(c.value(row))).join(','));
  return [header, ...lines].join('\r\n');
}

export function downloadCsv(filename, rows, columns) {
  const csv = toCsv(rows, columns);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
