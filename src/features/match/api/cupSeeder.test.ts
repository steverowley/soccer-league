// ── cupSeeder tests ──────────────────────────────────────────────────────────
// Two concerns live here:
//
//   1. (#569) Cup fixture SCHEDULING — kickoffs are anchored to real wall-clock
//      time so the match-worker's `scheduled_at <= now()` claim can always reach
//      them (the year-2600 dates froze both cups at the Round of 16 forever).
//
//   2. (#568 follow-up) Season-GENERALISED seeding — `seedCupCompetitions` must
//      work for ANY season, not just Season 1. It used to read hardcoded S1
//      league/cup UUIDs; now it resolves the season's OWN competitions
//      dynamically (league comps by `(season_id, type='league')` sorted into the
//      canonical league order; cup comps by NAME). These tests drive it against
//      a stateful in-memory Supabase mock (modelled on seasonRollover.test.ts) —
//      no real client is touched — using FRESH random-style UUIDs so a regression
//      to the old hardcoded `20000000-…` cup IDs would fail loudly.

import { describe, it, expect } from 'vitest';

import {
  cupR1KickoffIso,
  cupNextRoundKickoffIso,
  resolveSeasonLeagueCompIds,
  resolveSeasonCupCompIds,
  seedCupCompetitions,
} from './cupSeeder';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// ── #569: scheduling ──────────────────────────────────────────────────────────

describe('cup fixture scheduling (#569)', () => {
  // A fixed clock so the assertions are deterministic and cannot flake.
  const now = Date.parse('2026-06-24T12:00:00Z');

  it('schedules the Round of 16 in the near future, not the year-2600 calendar', () => {
    const t = Date.parse(cupR1KickoffIso(now));
    expect(t).toBeGreaterThan(now); // reachable: strictly after "now"
    expect(t).toBeLessThanOrEqual(now + 7 * DAY); // inside the worker's claim horizon
    expect(new Date(cupR1KickoffIso(now)).getUTCFullYear()).toBe(2026); // real year, not 2600
  });

  it('schedules each later round within the claim horizon of its completion', () => {
    const t = Date.parse(cupNextRoundKickoffIso(now));
    expect(t).toBeGreaterThan(now);
    expect(t).toBeLessThanOrEqual(now + 7 * DAY);
    expect(new Date(cupNextRoundKickoffIso(now)).getUTCFullYear()).toBe(2026);
  });

  it('is deterministic for a fixed clock (no flake)', () => {
    expect(cupR1KickoffIso(now)).toBe(cupR1KickoffIso(now));
    expect(cupNextRoundKickoffIso(now)).toBe(cupNextRoundKickoffIso(now));
  });
});

// ── #568 follow-up: season-generalised seeding ─────────────────────────────────

const SEASON_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

/** Canonical league slug order the seeder must impose, regardless of row order. */
const LEAGUE_ID_ORDER = ['rocky-inner', 'gas-giants', 'outer-reaches', 'kuiper-belt'] as const;

/** A fresh-UUID league competition for one league (NOT the S1 `10000000-…`). */
interface CompRow {
  id: string;
  season_id: string;
  league_id: string | null;
  name: string;
  type: 'league' | 'cup';
  /** Seeded brackets live here; null until a cup is drawn. */
  bracket?: unknown;
}

/** A matches row in the FK-JOINED shape `getLeagueStandings` selects. */
interface MatchSeedRow {
  competition_id: string;
  status: string;
  home_team_id: string;
  away_team_id: string;
  home_score: number;
  away_score: number;
  home_team: { id: string; name: string };
  away_team: { id: string; name: string };
}

/**
 * Build a fresh-UUID league comp id that is obviously NOT the hardcoded S1 id —
 * embeds the league slug so failures are readable.
 */
function leagueCompId(slug: string): string {
  return `aaaa1111-0000-0000-0000-${slug.replace(/[^a-z]/g, '').padEnd(12, '0').slice(0, 12)}`;
}

/**
 * Seed completed league matches that produce a clean 8-team standings table per
 * league: team `${slug}-0` finishes 1st down to `${slug}-7` 8th. We do this by
 * giving each team a distinct points total via a round-robin-free shortcut —
 * a chain of decisive results where lower-indexed teams beat all higher-indexed
 * ones. That guarantees positions 1..6 (the qualifiers) are unambiguous.
 */
function buildLeagueMatches(compId: string, slug: string): MatchSeedRow[] {
  const rows: MatchSeedRow[] = [];
  const team = (i: number) => ({ id: `${slug}-${i}`, name: `${slug} ${i}` });
  // Each i beats every j>i once → team i wins (7-i) games. Strictly decreasing
  // win counts ⇒ a strict 1..8 ordering with no tiebreak ambiguity.
  for (let i = 0; i < 8; i++) {
    for (let j = i + 1; j < 8; j++) {
      rows.push({
        competition_id: compId,
        status: 'completed',
        home_team_id: `${slug}-${i}`,
        away_team_id: `${slug}-${j}`,
        home_score: 2,
        away_score: 0,
        home_team: team(i),
        away_team: team(j),
      });
    }
  }
  return rows;
}

interface MockState {
  competitions: CompRow[];
  matches: MatchSeedRow[];
  inserted: Record<string, Array<Record<string, unknown>>>;
  updates: Array<{ table: string; patch: Record<string, unknown>; where: Record<string, unknown> }>;
}

/**
 * Stateful chainable Supabase mock. Serves:
 *   • competitions reads (FK-free `select('id, league_id' | 'id, name' | 'bracket')`),
 *   • matches reads (the FK-joined select in getLeagueStandings),
 *   • records insert/upsert into `inserted[table]` and update into `updates`,
 *   • reflects competition `bracket` updates back into the seed so re-seed is a
 *     no-op (idempotency).
 */
function makeMock(seed: { competitions: CompRow[]; matches: MatchSeedRow[] }) {
  const state: MockState = {
    competitions: seed.competitions,
    matches: seed.matches,
    inserted: { competitions: [], competition_teams: [], matches: [] },
    updates: [],
  };

  function builderFor(table: string) {
    const filters: Record<string, unknown> = {};
    let writeKind: 'insert' | 'upsert' | 'update' | null = null;
    let writeRows: Array<Record<string, unknown>> = [];
    let updatePatch: Record<string, unknown> = {};

    function applyFilters<T extends Record<string, unknown>>(rows: T[]): T[] {
      return rows.filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
    }

    function readRows(): Array<Record<string, unknown>> {
      if (table === 'competitions') return applyFilters(state.competitions as never);
      if (table === 'matches') return applyFilters(state.matches as never);
      return [];
    }

    function resolve(): { data: unknown; error: null } {
      if (writeKind === 'insert' || writeKind === 'upsert') {
        const bucket = state.inserted[table] ?? (state.inserted[table] = []);
        bucket.push(...writeRows);
        // Inserted cup matches need an id so the bracket records match_db_id.
        return { data: writeRows.map((r, i) => ({ ...r, id: r['id'] ?? `inserted-${i}` })), error: null };
      }
      if (writeKind === 'update') {
        state.updates.push({ table, patch: updatePatch, where: { ...filters } });
        if (table === 'competitions') {
          for (const row of state.competitions) {
            if (Object.entries(filters).every(([k, v]) => (row as unknown as Record<string, unknown>)[k] === v)) {
              Object.assign(row, updatePatch);
            }
          }
        }
        return { data: [{ id: filters['id'] }], error: null };
      }
      return { data: readRows(), error: null };
    }

    const builder = {
      select() { return builder; },
      eq(col: string, val: unknown) { filters[col] = val; return builder; },
      insert(rows: Record<string, unknown> | Array<Record<string, unknown>>) {
        writeKind = 'insert';
        writeRows = Array.isArray(rows) ? rows : [rows];
        return builder;
      },
      upsert(rows: Record<string, unknown> | Array<Record<string, unknown>>) {
        writeKind = 'upsert';
        writeRows = Array.isArray(rows) ? rows : [rows];
        return builder;
      },
      update(patch: Record<string, unknown>) {
        writeKind = 'update';
        updatePatch = patch;
        return builder;
      },
      single() {
        const { data } = resolve();
        // Writes (insert().select().single()) resolve to the first written row;
        // reads (readBracket) to the first matching row.
        const rows = data as Array<Record<string, unknown>>;
        return Promise.resolve({ data: rows[0] ?? null, error: rows[0] ? null : { code: 'PGRST116', message: 'no row' } });
      },
      maybeSingle() {
        const { data } = resolve();
        const rows = data as Array<Record<string, unknown>>;
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
      then(onFulfilled: (r: { data: unknown; error: null }) => unknown) {
        return Promise.resolve(resolve()).then(onFulfilled);
      },
    };
    return builder;
  }

  return { db: { from: (table: string) => builderFor(table) }, state };
}

/** A season seed with 4 league comps (out of canonical order) + 2 named cups. */
function buildSeason(opts: {
  /** Cup names — defaults to the S2-style "— Season 2" suffix. */
  celestialName?: string;
  shieldName?: string;
  /** Omit a cup entirely (to test the skip path). */
  omitShield?: boolean;
}) {
  const competitions: CompRow[] = [];
  const matches: MatchSeedRow[] = [];

  // Seed the four league comps in a DELIBERATELY SCRAMBLED order so the test
  // proves resolveSeasonLeagueCompIds re-sorts into canonical order.
  const scrambled = ['kuiper-belt', 'rocky-inner', 'outer-reaches', 'gas-giants'];
  for (const slug of scrambled) {
    const id = leagueCompId(slug);
    competitions.push({
      id, season_id: SEASON_ID, league_id: slug, name: `${slug} League — Season 2`, type: 'league',
    });
    matches.push(...buildLeagueMatches(id, slug));
  }

  // Two cup shells (fresh UUIDs, NULL bracket) named per the rollover convention.
  competitions.push({
    id: 'cup-celestial-fresh', season_id: SEASON_ID, league_id: null,
    name: opts.celestialName ?? 'Celestial Cup — Season 2', type: 'cup', bracket: null,
  });
  if (!opts.omitShield) {
    competitions.push({
      id: 'cup-shield-fresh', season_id: SEASON_ID, league_id: null,
      name: opts.shieldName ?? 'Solar Shield — Season 2', type: 'cup', bracket: null,
    });
  }

  return { competitions, matches };
}

describe('seedCupCompetitions — season-generalised (#568 follow-up)', () => {
  it('resolveSeasonLeagueCompIds returns the 4 comps in canonical league order', async () => {
    const { db } = makeMock(buildSeason({}));
    const ids = await resolveSeasonLeagueCompIds(db as never, SEASON_ID);
    expect(ids).toEqual(LEAGUE_ID_ORDER.map((slug) => leagueCompId(slug)));
  });

  it('drops competitions whose league_id is not canonical', async () => {
    const seed = buildSeason({});
    seed.competitions.push({
      id: 'stray-league', season_id: SEASON_ID, league_id: 'phantom-zone',
      name: 'Phantom League — Season 2', type: 'league',
    });
    const { db } = makeMock(seed);
    const ids = await resolveSeasonLeagueCompIds(db as never, SEASON_ID);
    expect(ids).not.toContain('stray-league');
    expect(ids).toHaveLength(4);
  });

  it('resolveSeasonCupCompIds maps both cups to the right ids by name', async () => {
    const { db } = makeMock(buildSeason({}));
    const { celestialId, shieldId } = await resolveSeasonCupCompIds(db as never, SEASON_ID);
    expect(celestialId).toBe('cup-celestial-fresh');
    expect(shieldId).toBe('cup-shield-fresh');
  });

  it('resolveSeasonCupCompIds yields a null id when a cup is missing', async () => {
    const { db } = makeMock(buildSeason({ omitShield: true }));
    const { celestialId, shieldId } = await resolveSeasonCupCompIds(db as never, SEASON_ID);
    expect(celestialId).toBe('cup-celestial-fresh');
    expect(shieldId).toBeNull();
  });

  it('seeds BOTH cups using the season OWN comp ids (never the S1 20000000-… UUIDs)', async () => {
    const { db, state } = makeMock(buildSeason({}));
    const result = await seedCupCompetitions(db as never, SEASON_ID);

    expect(result.celestial.status).toMatch(/^(seeded|already_seeded)$/);
    expect(result.solarShield.status).toMatch(/^(seeded|already_seeded)$/);

    // Seeded against the season's OWN fresh cup ids — NOT the hardcoded S1 ids.
    expect(result.celestial.competitionId).toBe('cup-celestial-fresh');
    expect(result.solarShield.competitionId).toBe('cup-shield-fresh');
    expect(result.celestial.competitionId).not.toMatch(/^20000000-/);
    expect(result.solarShield.competitionId).not.toMatch(/^20000000-/);

    // 12 qualifiers per cup (3 positions × 4 leagues), and round-1 matches were
    // inserted against the fresh cup ids.
    expect(result.celestial.qualifiers).toBe(12);
    expect(result.solarShield.qualifiers).toBe(12);
    const insertedCupMatches = state.inserted['matches'] ?? [];
    const cupIds = new Set(insertedCupMatches.map((m) => m['competition_id']));
    expect(cupIds).toEqual(new Set(['cup-celestial-fresh', 'cup-shield-fresh']));

    // Brackets were written back to the season's cup competition rows.
    const bracketWrites = state.updates.filter(
      (u) => u.table === 'competitions' && 'bracket' in u.patch,
    );
    const bracketedIds = new Set(bracketWrites.map((u) => u.where['id']));
    expect(bracketedIds).toEqual(new Set(['cup-celestial-fresh', 'cup-shield-fresh']));
  });

  it('skips a cup whose name matches nothing without throwing', async () => {
    // Celestial present, but the second cup is misnamed so it resolves to null.
    const { db, state } = makeMock(buildSeason({ shieldName: 'Mystery Trophy — Season 2' }));
    const result = await seedCupCompetitions(db as never, SEASON_ID);

    expect(result.celestial.competitionId).toBe('cup-celestial-fresh');
    expect(result.celestial.status).toBe('seeded');
    // Unresolved tier degrades to a no_qualifiers shell, no crash.
    expect(result.solarShield.status).toBe('no_qualifiers');
    expect(result.solarShield.competitionId).toBe('');

    // Only the celestial cup had matches inserted.
    const cupIds = new Set((state.inserted['matches'] ?? []).map((m) => m['competition_id']));
    expect(cupIds).toEqual(new Set(['cup-celestial-fresh']));
  });

  it('backward-compat: S1-style plain cup names ("Celestial Cup"/"Solar Shield") still resolve', async () => {
    const { db } = makeMock(buildSeason({
      celestialName: 'Celestial Cup',
      shieldName: 'Solar Shield',
    }));
    const { celestialId, shieldId } = await resolveSeasonCupCompIds(db as never, SEASON_ID);
    expect(celestialId).toBe('cup-celestial-fresh');
    expect(shieldId).toBe('cup-shield-fresh');

    const result = await seedCupCompetitions(db as never, SEASON_ID);
    expect(result.celestial.competitionId).toBe('cup-celestial-fresh');
    expect(result.solarShield.competitionId).toBe('cup-shield-fresh');
  });
});
