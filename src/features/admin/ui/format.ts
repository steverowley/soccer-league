// ── features/admin/ui/format.ts ──────────────────────────────────────────────
// Formatting helpers shared by the admin panels. Moved out of the old
// `primitives.tsx` when that file's style constants and components were
// replaced by the design system (src/shared/design and src/shared/ui):
// this is the one piece of it that was logic, not look.

/**
 * Format an ISO timestamp for the admin tables: en-GB, 24-hour, day first.
 * Admin is staff-only, so a real-world date is fine here (fan pages never
 * print one).
 *
 * @param iso  ISO timestamp from the database.
 * @returns    "27/10/2026, 18:00", or the input unchanged if unparseable.
 */
export function fmtDatetime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
