export function formatInZone(isoString, timezone) {
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: timezone || undefined,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(isoString));
}

export function formatDateInZone(isoString, timezone) {
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: timezone || undefined,
    dateStyle: 'medium',
  }).format(new Date(isoString));
}
