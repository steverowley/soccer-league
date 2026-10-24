// ── lore.ts ──────────────────────────────────────────────────────────────────
// Read-side helpers over the canon export (lore.generated.ts).
//
// The world bible lives in a private Obsidian vault; its fan-facing slice
// (register facts plus Fragments) is exported into lore.generated.ts. Pages
// read it only through these helpers so the shape of the export can change
// without touching UI code.
//
// Canon wins over hand-written profile text: when a page shows founding
// years, honours or legends, they come from here, not from entity profiles.

import {
  LORE_CLUBS,
  LORE_LEAGUES,
  LORE_LEGENDS,
  LORE_CELESTIAL_CUPS,
  type LoreChannel,
  type LoreClub,
  type LoreFragment,
  type LoreLeague,
  type LoreLegend,
  type LoreCelestialCup,
} from './lore.generated';

export type { LoreChannel, LoreClub, LoreFragment, LoreLeague, LoreLegend, LoreCelestialCup };

const CLUBS = new Map(LORE_CLUBS.map((c) => [c.id, c]));
const LEAGUES = new Map(LORE_LEAGUES.map((l) => [l.id, l]));

/** The last season played before the ISL's first, 2600. */
export const LAST_PRE_ISL_SEASON = 2599;

export function getClubLore(id: string | undefined): LoreClub | null {
  return (id && CLUBS.get(id)) || null;
}

export function getLeagueLore(id: string | undefined): LoreLeague | null {
  return (id && LEAGUES.get(id)) || null;
}

/**
 * Display name for any club in the canon, including the lost clubs that never
 * reached the ISL (they appear in old honours lists). Falls back to the id.
 */
export function loreClubName(id: string): string {
  return CLUBS.get(id)?.name ?? id;
}

/** True when the club is one of the 32 in the ISL (so it has a page). */
export function isIslClub(id: string): boolean {
  return CLUBS.get(id)?.isl === true;
}

export function fragmentsFor(fragments: readonly LoreFragment[], channel: LoreChannel): string[] {
  return fragments.filter((f) => f.channel === channel).map((f) => f.text);
}

/** Legends of one club, oldest first. */
export function legendsForClub(clubId: string): LoreLegend[] {
  return LORE_LEGENDS.filter((l) => l.club === clubId);
}

export interface TitleCount {
  club: string;
  titles: number;
  last: number;
}

/** All-time league title counts for a league, most titles first. */
export function titleTable(leagueId: string): TitleCount[] {
  const league = LEAGUES.get(leagueId);
  if (!league) return [];
  const byClub = new Map<string, TitleCount>();
  for (const s of league.seasons) {
    const row = byClub.get(s.champion) ?? { club: s.champion, titles: 0, last: 0 };
    row.titles += 1;
    row.last = Math.max(row.last, s.year);
    byClub.set(s.champion, row);
  }
  return [...byClub.values()].sort((a, b) => b.titles - a.titles || b.last - a.last);
}

export function celestialCups(): LoreCelestialCup[] {
  return LORE_CELESTIAL_CUPS;
}
