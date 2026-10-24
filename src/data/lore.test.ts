// ── lore.test.ts ─────────────────────────────────────────────────────────────
// Holds the canon export (lore.generated.ts) to the game's own data, so a
// stale or careless export fails CI instead of showing fans a broken or
// contradictory history.

import { describe, it, expect } from 'vitest';
import { LEAGUES, TEAMS_BY_LEAGUE } from './leagueData';
import { LORE_CLUBS, LORE_LEAGUES, LORE_LEGENDS, LORE_CELESTIAL_CUPS } from './lore.generated';
import { getClubLore, titleTable, legendsForClub, fragmentsFor, LAST_PRE_ISL_SEASON } from './lore';

const gameTeams = Object.values(TEAMS_BY_LEAGUE).flat();
const loreIds = new Set(LORE_CLUBS.map((c) => c.id));

describe('canon export matches the game', () => {
  it('has a lore entry for every ISL club, in the same league, and no extras', () => {
    const isl = LORE_CLUBS.filter((c) => c.isl);
    expect(isl.map((c) => c.id).sort()).toEqual(gameTeams.map((t) => t.id).sort());
    for (const [leagueId, teams] of Object.entries(TEAMS_BY_LEAGUE)) {
      for (const t of teams) expect(getClubLore(t.id)?.league, t.id).toBe(leagueId);
    }
  });

  it('uses the same four leagues', () => {
    expect(LORE_LEAGUES.map((l) => l.id).sort()).toEqual(LEAGUES.map((l) => l.id).sort());
  });

  it('only references clubs it defines', () => {
    const refs = [
      ...LORE_LEAGUES.flatMap((l) =>
        l.seasons.flatMap((s) => [s.champion, s.runnerUp, s.cup?.winner, s.cup?.loser]),
      ),
      ...LORE_LEGENDS.map((l) => l.club),
      ...LORE_CELESTIAL_CUPS.flatMap((c) => [
        c.champion,
        ...c.matches.flatMap((m) => [m.winner, m.loser]),
      ]),
    ].filter((x): x is string => x != null);
    expect(refs.filter((r) => !loreIds.has(r))).toEqual([]);
  });

  it('ends every league history at the last season before the ISL', () => {
    for (const l of LORE_LEAGUES) {
      const years = l.seasons.map((s) => s.year);
      expect(Math.min(...years), l.id).toBe(l.founded);
      expect(Math.max(...years), l.id).toBe(LAST_PRE_ISL_SEASON);
      expect(new Set(years).size, `${l.id} has one row per season`).toBe(years.length);
    }
  });

  it('keeps honours consistent with the season rows', () => {
    for (const c of LORE_CLUBS) {
      const won = LORE_LEAGUES.flatMap((l) => l.seasons)
        .filter((s) => s.champion === c.id)
        .map((s) => s.year)
        .sort();
      expect(c.titles, c.id).toEqual(won);
    }
    const total = LORE_LEAGUES.reduce(
      (n, l) => n + titleTable(l.id).reduce((m, r) => m + r.titles, 0),
      0,
    );
    expect(total).toBe(LORE_LEAGUES.reduce((n, l) => n + l.seasons.length, 0));
  });

  it("gives every legend real years inside their club's life", () => {
    for (const l of LORE_LEGENDS) {
      const club = getClubLore(l.club)!;
      expect(l.from, l.name).toBeLessThanOrEqual(l.to);
      expect(l.from, l.name).toBeGreaterThanOrEqual(club.founded);
      if (club.defunct) expect(l.to, l.name).toBeLessThanOrEqual(club.defunct);
    }
  });
});

describe('only fan-safe text crosses over from the vault', () => {
  const allFragments = [...LORE_CLUBS, ...LORE_LEAGUES, ...LORE_LEGENDS].flatMap(
    (x) => x.fragments,
  );

  it('has fragments to show', () => {
    expect(allFragments.length).toBeGreaterThan(100);
    for (const t of gameTeams) {
      expect(fragmentsFor(getClubLore(t.id)!.fragments, 'club page').length, t.id).toBeGreaterThan(
        0,
      );
    }
    expect(gameTeams.filter((t) => legendsForClub(t.id).length > 0).length).toBe(gameTeams.length);
  });

  it('carries no vault markup, secret markers or em dashes', () => {
    const bad = allFragments.filter((f) => /\[\[|\[!|<!--|%%|secret|\u2014/i.test(f.text));
    expect(bad).toEqual([]);
  });
});
