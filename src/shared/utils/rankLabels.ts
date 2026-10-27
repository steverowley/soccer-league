// ── shared/utils/rankLabels.ts ──────────────────────────────────────────────
// Rank labels for a league table, with ties shown as "=N".
//
// WHY: the design language (docs/design-language.md, section 7) says tied
// ranks read "=1", not several "01"s. The Idol Board ranked every tied
// player "01" and the standings padded positions to two digits, so a table
// after one matchday showed three different numbers for three clubs with
// identical records. Two rows share a rank only when everything the table
// sorts by is equal (for standings: points, goal difference, goals scored).

/**
 * Rank label for each row of an already-ordered table.
 *
 * @param rows    Rows in table order (best first).
 * @param tieKey  Everything the order is decided by, as one comparable
 *                string; equal keys mean a genuine tie.
 * @returns       One label per row, same order: "1", "2", "=3", "=3", "5".
 */
export function rankLabels<T>(rows: readonly T[], tieKey: (row: T) => string): string[] {
  const keys = rows.map(tieKey);
  const labels: string[] = [];
  let i = 0;
  while (i < rows.length) {
    let j = i + 1;
    while (j < rows.length && keys[j] === keys[i]) j++;
    const rank = String(i + 1);
    const label = j - i > 1 ? `=${rank}` : rank;
    for (let k = i; k < j; k++) labels.push(label);
    i = j;
  }
  return labels;
}

/** Minimal standings fields that decide the order of a league table. */
export interface StandingsTieFields {
  points?: number | null | undefined;
  gd?: number | null | undefined;
  gf?: number | null | undefined;
}

/**
 * The standings tie key: points, then goal difference, then goals scored
 * (the order fetchLeagueStandings sorts by).
 *
 * @param row  A standings row.
 * @returns    A string equal for two rows exactly when they are tied.
 */
export function standingsTieKey(row: StandingsTieFields): string {
  return `${row.points ?? 0}|${row.gd ?? 0}|${row.gf ?? 0}`;
}

/**
 * English ordinal for a place: 1 -> "1st", 12 -> "12th", 22 -> "22nd".
 * Roman numerals are reserved for section indexes (spec section 7), so a
 * league place reads as an ordinal.
 *
 * @param n  A 1-based place.
 * @returns  The ordinal.
 */
export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  const suffix = ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
}

/**
 * A rank label from rankLabels() as a place in prose: a tie keeps its
 * "=N" form (so two clubs never both read "2nd"), anything else becomes
 * an ordinal.
 *
 * @param label  "3" or "=3".
 * @returns      "3rd" or "=3".
 */
export function placeLabel(label: string): string {
  if (label.startsWith('=')) return label;
  const n = Number(label);
  return Number.isFinite(n) && n > 0 ? ordinal(n) : label;
}
