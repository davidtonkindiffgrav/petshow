// Shared voting-window logic for public vote shows (is_judged === false).
//
// The window is:
//   opens  — entries open  (vote_open_mode 'on_entries_open')
//            entries close (vote_open_mode 'after_entries_close', the default)
//   closes — show_date + show_time in the show's timezone (missing time = midnight,
//            i.e. the start of show day). A vote at the exact cutoff is rejected,
//            so with a 10:50 start the last accepted vote is 10:49:59.

// Convert a date value + 'HH:MM' wall time in an IANA timezone to a UTC Date.
// Without a timezone the components are interpreted in the viewer's local time.
export function zonedDateTime(dateVal, timeStr, timeZone) {
  if (!dateVal) return null;
  const [y, m, d] = String(dateVal).slice(0, 10).split('-').map(Number);
  const [hh, mm] = String(timeStr || '0:0').split(':').map(Number);
  if (!y || !m || !d) return null;
  if (!timeZone) return new Date(y, m - 1, d, hh || 0, mm || 0);

  // Find the UTC instant whose wall clock in timeZone matches the components.
  // Two iterations converge across DST boundaries.
  const target = Date.UTC(y, m - 1, d, hh || 0, mm || 0);
  let guess = target;
  for (let i = 0; i < 2; i++) {
    guess += target - wallClockUtc(guess, timeZone);
  }
  return new Date(guess);
}

function wallClockUtc(ts, timeZone) {
  const p = {};
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date(ts));
  for (const { type, value } of parts) p[type] = value;
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
}

export function getVoteWindow(show) {
  const opensAt = show.vote_open_mode === 'on_entries_open'
    ? zonedDateTime(show.entry_open_date, show.entry_open_time, show.timezone)
    : zonedDateTime(show.entry_close_date, show.entry_close_time, show.timezone);
  const closesAt = zonedDateTime(show.show_date, show.show_time, show.timezone);
  return { opensAt, closesAt };
}

// Requires show fields: is_judged, results_published_at, vote_open_mode,
// entry_open_date/_time, entry_close_date/_time, show_date, show_time, timezone.
export function isVotingOpen(show, now = new Date()) {
  if (show.is_judged !== false || show.results_published_at) return false;
  const { opensAt, closesAt } = getVoteWindow(show);
  if (opensAt && now < opensAt) return false;
  if (closesAt && now >= closesAt) return false;
  return true;
}
