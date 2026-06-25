// ── seasonRollover.test.ts ────────────────────────────────────────────────────
// Unit tests for the idempotent `rolloverSeason` engine (#568).  We drive it
// against an in-memory, chainable Supabase mock — no real client is touched.
//
// The mock is stateful (unlike matchEvents.test.ts's queue-only mock) because
// rolloverSeason interleaves reads and writes: it READS the prior season + a
// year-existence guard + team rosters, and WRITES seasons / competitions /
// competition_teams / matches / focus_options.  The mock therefore:
//   • serves canned reads from a per-table seed (`seasons`, `teams`), and
//   • records every insert/update/upsert into per-table `inserted` buckets so
//     the assertions can count exactly what the function created.

import { describe, it, expect } from 'vitest';
import { rolloverSeason } from './seasonRollover';

// ── Fixture data ──────────────────────────────────────────────────────────────

/** The season being rolled over (year 2600 → the new season is year 2601). */
const FROM_SEASON_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const FROM_SEASON = { id: FROM_SEASON_ID, year: 2600, is_active: true };

/** The 4 ISL leagues the engine iterates, each with 8 teams (32 total). */
const LEAGUE_IDS = ['rocky-inner', 'gas-giants', 'outer-reaches', 'kuiper-belt'] as const;

/**
 * Build the 32-team roster: 8 teams per league, ids like `rocky-inner-0`.
 * Returned as the canned `teams` read both for per-league fixture generation
 * (filtered by league_id) and the all-teams focus_options pass.
 */
function buildTeams(): Array<{ id: string; league_id: string }> {
  const teams: Array<{ id: string; league_id: string }> = [];
  for (const lg of LEAGUE_IDS) {
    for (let i = 0; i < 8; i++) teams.push({ id: `${lg}-${i}`, league_id: lg });
  }
  return teams;
}

// ── Expected counts ───────────────────────────────────────────────────────────
// 8 teams → 28 unique pairs × 2 legs = 56 fixtures per league.
// 4 leagues → 224 fixtures.  9 focus templates × 32 teams = 288 focus_options.
const FIXTURES_PER_LEAGUE = 56;
const TOTAL_FIXTURES      = FIXTURES_PER_LEAGUE * 4; // 224
const TOTAL_TEAMS         = 32;
const FOCUS_TEMPLATES     = 9;
const TOTAL_FOCUS_ROWS    = FOCUS_TEMPLATES * TOTAL_TEAMS; // 288

// ── In-memory Supabase mock ───────────────────────────────────────────────────

interface MockState {
  /** Rows already present per table (drives reads). */
  seed: {
    seasons: Array<Record<string, unknown>>;
    teams:   Array<{ id: string; league_id: string }>;
  };
  /** Everything written per table this run (drives assertions). */
  inserted: Record<string, Array<Record<string, unknown>>>;
  /** Per-(table) is_active patches applied via .update(). */
  updates: Array<{ table: string; patch: Record<string, unknown>; where: Record<string, unknown> }>;
}

/**
 * Construct a chainable Supabase mock plus the shared state it mutates.  Each
 * `.from(table)` returns a fresh builder closed over the active filters; a
 * terminator (`.maybeSingle()` / awaiting the builder) resolves against the
 * seed or records the write.
 */
function makeMock() {
  const state: MockState = {
    seed: { seasons: [{ ...FROM_SEASON }], teams: buildTeams() },
    inserted: {
      seasons: [], competitions: [], competition_teams: [], matches: [], focus_options: [],
    },
    updates: [],
  };

  function builderFor(table: string) {
    const filters: Record<string, unknown> = {};
    // Pending write payload + kind, resolved when the builder is awaited.
    let writeKind: 'insert' | 'upsert' | 'update' | null = null;
    let writeRows: Array<Record<string, unknown>> = [];
    let updatePatch: Record<string, unknown> = {};

    /** Apply recorded filters to a seed table for reads. */
    function applyFilters(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
      return rows.filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
    }

    /** Resolve the queued operation into a PostgREST-shaped { data, error }. */
    function resolve(): { data: unknown; error: null } {
      // ── Writes: record into the inserted bucket / updates log ────────────
      if (writeKind === 'insert' || writeKind === 'upsert') {
        const bucket = state.inserted[table] ?? (state.inserted[table] = []);
        bucket.push(...writeRows);
        return { data: writeRows, error: null };
      }
      if (writeKind === 'update') {
        state.updates.push({ table, patch: updatePatch, where: { ...filters } });
        // Mutate the seed so a later read reflects the update (e.g. is_active).
        if (table === 'seasons') {
          for (const row of state.seed.seasons) {
            if (Object.entries(filters).every(([k, v]) => row[k] === v)) Object.assign(row, updatePatch);
          }
        }
        return { data: [{ id: filters['id'] }], error: null };
      }
      // ── Reads: serve filtered seed rows ──────────────────────────────────
      const source = table === 'seasons' ? state.seed.seasons
        : table === 'teams' ? state.seed.teams
        : [];
      return { data: applyFilters(source as Array<Record<string, unknown>>), error: null };
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
      // .maybeSingle() returns the first filtered row (or null).
      maybeSingle() {
        const { data } = resolve();
        const rows = data as Array<Record<string, unknown>>;
        return Promise.resolve({ data: rows.length > 0 ? rows[0] : null, error: null });
      },
      // Awaiting the builder directly (selects, inserts, upsert().select()).
      then(onFulfilled: (r: { data: unknown; error: null }) => unknown) {
        return Promise.resolve(resolve()).then(onFulfilled);
      },
    };
    return builder;
  }

  const db = { from: (table: string) => builderFor(table) };
  return { db, state };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('rolloverSeason', () => {
  const OPTS = {
    // Fixed clock so the test is deterministic — matchday 1 is exactly here.
    firstKickoffMs: Date.parse('2601-01-08T12:00:00.000Z'),
    cadenceMs:      14 * 24 * 60 * 60 * 1000, // 14 days
  };

  it('creates the next season with leagues, fixtures, cups, and focus options', async () => {
    const { db, state } = makeMock();

    const result = await rolloverSeason(db as never, FROM_SEASON_ID, OPTS);

    // New season created (active, is_active, year+1, derived name).
    expect(result.alreadyRolled).toBe(false);
    expect(result.newSeasonId).toBeTruthy();
    expect(result.newSeasonName).toBe('Season 2 — 2601');

    const insertedSeason = state.inserted['seasons']?.[0];
    expect(insertedSeason).toMatchObject({ status: 'active', is_active: true, year: 2601 });

    // 4 league competitions + 2 cup competitions.
    expect(result.competitionsCreated).toBe(4);
    expect(result.cupRowsCreated).toBe(2);
    const comps = state.inserted['competitions'] ?? [];
    expect(comps.filter((c) => c['type'] === 'league')).toHaveLength(4);
    expect(comps.filter((c) => c['type'] === 'cup')).toHaveLength(2);
    // Cup rows are empty shells — no bracket key set.
    for (const cup of comps.filter((c) => c['type'] === 'cup')) {
      expect(cup['bracket']).toBeUndefined();
    }

    // 224 fixtures (56 per league × 4) and 288 focus_options (9 × 32 teams).
    expect(result.fixturesCreated).toBe(TOTAL_FIXTURES);
    expect(state.inserted['matches']).toHaveLength(TOTAL_FIXTURES);
    expect(result.focusOptionRows).toBe(TOTAL_FOCUS_ROWS);

    // Prior season is_active flipped to false (before the new INSERT).
    const deactivate = state.updates.find(
      (u) => u.table === 'seasons' && u.where['id'] === FROM_SEASON_ID,
    );
    expect(deactivate?.patch).toMatchObject({ is_active: false });
  });

  it('anchors every fixture at or after firstKickoffMs (#569 real-time guard)', async () => {
    const { db, state } = makeMock();
    await rolloverSeason(db as never, FROM_SEASON_ID, OPTS);

    const fixtures = state.inserted['matches'] ?? [];
    expect(fixtures.length).toBe(TOTAL_FIXTURES);
    for (const f of fixtures) {
      const ms = Date.parse(f['scheduled_at'] as string);
      expect(ms).toBeGreaterThanOrEqual(OPTS.firstKickoffMs);
    }
  });

  it('is idempotent: a second run with year+1 present is a zero-write no-op', async () => {
    const { db, state } = makeMock();
    // Pre-seed the next season (year 2601) so the year-guard short-circuits.
    state.seed.seasons.push({ id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', year: 2601, is_active: true });

    const result = await rolloverSeason(db as never, FROM_SEASON_ID, OPTS);

    expect(result.alreadyRolled).toBe(true);
    expect(result.newSeasonId).toBe('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
    // Nothing was created and the prior season was not deactivated.
    expect(state.inserted['seasons']).toHaveLength(0);
    expect(state.inserted['competitions']).toHaveLength(0);
    expect(state.inserted['matches']).toHaveLength(0);
    expect(state.inserted['focus_options']).toHaveLength(0);
    expect(result.competitionsCreated).toBe(0);
    expect(result.fixturesCreated).toBe(0);
    expect(result.focusOptionRows).toBe(0);
    expect(state.updates).toHaveLength(0);
  });
});
