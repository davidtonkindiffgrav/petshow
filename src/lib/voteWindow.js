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

// Whether entries are open, and if not, why. A show can have a fixed
// entry_close_date, an opt-in auto-close on its fundraising_goal (both
// trip whichever comes first), or neither (manual close only) — see
// entries_closed_at/_reason on shows. close_entries_on_goal is a separate
// flag from fundraising_goal/show_fundraising_publicly: a goal can be set
// and shown publicly purely for informational purposes without ever
// auto-closing entries. show_date is always the backstop: entries never
// outlive the show day.
//
// currentTotal is the caller-supplied running total (organiser-net amount
// raised, or confirmed entry count, matching fundraising_goal_type) — this
// module has no DB access, so it must be queried by the caller and passed
// in. Pass null/undefined if not checking the goal.
export function getEntriesCloseInfo(show, currentTotal, now = new Date()) {
  if (show.entries_closed_at) {
    return { isOpen: false, reason: show.entries_closed_reason || 'manual', closedAt: new Date(show.entries_closed_at) };
  }

  const showStartsAt = zonedDateTime(show.show_date, show.show_time, show.timezone);
  if (showStartsAt && now >= showStartsAt) {
    return { isOpen: false, reason: 'show_date', closedAt: showStartsAt };
  }

  const closeAt = show.entry_close_date
    ? zonedDateTime(show.entry_close_date, show.entry_close_time, show.timezone)
    : null;
  if (closeAt && now >= closeAt) {
    return { isOpen: false, reason: 'date', closedAt: closeAt };
  }

  if (show.close_entries_on_goal && show.fundraising_goal != null && currentTotal != null && currentTotal >= show.fundraising_goal) {
    return { isOpen: false, reason: 'goal', closedAt: now };
  }

  return { isOpen: true, reason: null, closedAt: null };
}

// Validates the relative order of a show's three key dates, independent of
// whether entry_close_date is even set (an indefinite show has nothing to
// check there). Returns an error message string, or null if the combination
// is fine. Equal instants are allowed (e.g. entries open the same moment
// Show Day starts) — only a reversed order is blocked.
//
// Without this, a show_date backstop still stops entries closing late (see
// getEntriesCloseInfo), but a misconfigured open-after-close never actually
// opens, and a close-after-show-day shows entrants a close date/countdown
// that will never be reached.
export function getDateOrderError({ entry_open_date, entry_open_time, entry_close_date, entry_close_time, show_date, show_time, timezone }) {
  const openAt  = zonedDateTime(entry_open_date, entry_open_time, timezone);
  const closeAt = zonedDateTime(entry_close_date, entry_close_time, timezone);
  const showAt  = zonedDateTime(show_date, show_time, timezone);

  if (openAt && closeAt && openAt >= closeAt) {
    return 'Entries Close must be after Entries Open.';
  }
  if (closeAt && showAt && closeAt > showAt) {
    return 'Entries Close must be on or before Show Day.';
  }
  if (openAt && showAt && openAt > showAt) {
    return 'Entries Open must be on or before Show Day.';
  }
  return null;
}

// Goal progress for the public show page. Returns null if no goal is set.
export function getGoalProgress(show, currentTotal) {
  if (show.fundraising_goal == null) return null;
  const current = Number(currentTotal) || 0;
  const target   = Number(show.fundraising_goal);
  return {
    type: show.fundraising_goal_type || 'amount', // 'amount' | 'entries'
    current,
    target,
    pct: target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0,
  };
}
