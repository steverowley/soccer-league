// ── features/match/logic/fixtureLabels.ts ──────────────────────────────────
// Short, consistent labels for fixture rows and cards.  Competition names
// carry the season ("Rocky Inner League: Season 1 (2600)"), which every row on
// a page repeats and which does not fit a phone; rounds are stored as text
// ("Matchday 1"), and prefixing them again produced "Matchday Matchday 1".

/**
 * The competition's name without its season suffix.
 * "Rocky Inner League: Season 1 (2600)" -> "Rocky Inner League".
 */
export function competitionLabel(name: string | null | undefined, fallback = 'League'): string {
  const base = (name ?? '').split(':')[0]?.trim() ?? '';
  return base !== '' ? base : fallback;
}

/**
 * The round as a reader sees it: "Matchday 1" stays as stored; a bare number
 * becomes "Matchday N"; empty stays empty.
 */
export function roundLabel(round: string | number | null | undefined): string {
  if (round === null || round === undefined) return '';
  const text = String(round).trim();
  if (text === '') return '';
  return /^\d+$/.test(text) ? `Matchday ${text}` : text;
}
