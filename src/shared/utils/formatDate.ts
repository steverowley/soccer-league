/**
 * Parses an ISO timestamp string and formats it with the given Intl options.
 * Returns the raw string unchanged if parsing fails (NaN guard).
 */
function fmt(iso: string, opts: Intl.DateTimeFormatOptions, method: 'toLocaleString' | 'toLocaleDateString'): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  return new Date(ms)[method](undefined, opts);
}

/** "Apr 25" — month + day, no year, no time. Used in narrative/news feeds. */
export function formatDateShort(iso: string): string {
  return fmt(iso, { month: 'short', day: 'numeric' }, 'toLocaleDateString');
}

/** "Apr 25, 10:30 AM" — month, day, time. Used in bet history rows. */
export function formatDateTime(iso: string): string {
  return fmt(iso, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }, 'toLocaleString');
}

/** "Apr 25, 2026, 10:30:00 AM" — full timestamp with seconds. Used in audit log tables. */
export function formatDateTimeFull(iso: string): string {
  return fmt(iso, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }, 'toLocaleString');
}
