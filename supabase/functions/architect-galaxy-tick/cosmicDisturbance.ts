// ── cosmicDisturbance.ts ───────────────────────────────────────────────────
// Turns an Architect intervention into a public "cosmic disturbance" story.
//
// WHY THIS IS ITS OWN MODULE: the galaxy tick used to publish the audit
// row's `reason` verbatim, prefixed with the real-world date, on the
// assumption that it was "already written to be in-world safe".  It was
// not: in-match rows carry machine text ("In-match Architect interference
// at minute 78: curse_player."), so the News page led with code names and
// a 2026 date in a league set in 2600.  It also re-announced the newest
// intervention on every tick, so one intervention appeared six times.
//
// The rules, kept pure so they are tested without a database:
//   1. Only in-match interventions become disturbances.  Mid-week trait
//      shifts already publish their own story when they happen.
//   2. The text is the Architect's own proclamation (written in-world by
//      the match worker), framed by the fixture.  Never `reason`, never a
//      date, never an interference type.
//   3. An intervention is announced once.  The narrative row records the
//      intervention id in `composed_from` (its provenance column), and the
//      tick skips ids that are already there.

/** The intervention columns the galaxy tick selects for disturbances. */
export interface DisturbanceSource {
  id: string;
  /** For in-match rows, the match id. */
  target_id: string | null;
  created_at: string;
  new_value: { proclamation?: unknown } | null;
  meta: { kind?: unknown } | null;
}

/** Club names for the framing line; either may be missing. */
export interface DisturbanceFixture {
  home?: string | null;
  away?: string | null;
}

/** The Architect's proclamation, trimmed, or null when there is none. */
export function proclamationOf(row: DisturbanceSource): string | null {
  const p = row.new_value?.proclamation;
  if (typeof p !== 'string') return null;
  const text = p.trim();
  return text.length > 0 ? text : null;
}

/**
 * The newest in-match intervention that has a proclamation and has not been
 * announced yet, or null.  `rows` may arrive in any order.
 */
export function pickUnannounced(
  rows: readonly DisturbanceSource[],
  announced: ReadonlySet<string>,
): DisturbanceSource | null {
  const candidates = rows
    .filter((r) => r.meta?.kind === 'in_match_interference')
    .filter((r) => proclamationOf(r) !== null)
    .filter((r) => !announced.has(r.id))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return candidates[0] ?? null;
}

/**
 * The public story: the proclamation framed by the fixture when both club
 * names are known, otherwise by "a match".
 */
export function cosmicDisturbanceText(
  proclamation: string,
  fixture: DisturbanceFixture | null,
): string {
  const home = fixture?.home?.trim();
  const away = fixture?.away?.trim();
  const where = home && away ? `${home} v ${away}` : 'a match';
  return `The Architect spoke during ${where}: "${proclamation}"`;
}
