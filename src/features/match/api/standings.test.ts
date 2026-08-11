// ── features/match/api/standings.test.ts ─────────────────────────────────────
// Unit tests for the Supabase-backed league table read. Mocks Supabase at the
// chainable-query boundary (same approach as entities/api/chronicle.test.ts) so
// no real client is touched.
//
// The focus here is the distinction between "this league has no table yet" and
// "the query failed". supabase-js reports query errors in the RESOLVED value
// rather than by rejecting, so `fetchLeagueStandings` flattened both to `[]` —
// and /leagues rendered a failed read as "Awaiting first kick-off" over a
// mid-season table. `fetchLeagueStandingsResult` keeps them apart; the legacy
// entry point keeps its old flattening contract for callers that don't care.

import { describe, it, expect, vi, afterEach } from 'vitest';

import type { IslSupabaseClient } from '@shared/supabase/client';

import { fetchLeagueStandings, fetchLeagueStandingsResult } from './standings';

// ── Chainable Supabase query mock ────────────────────────────────────────────
// Responses are keyed by table so one call can serve the `matches` read and the
// `teams` read with different outcomes (the two failure modes are separate
// branches in the function under test).

interface MockResult {
  data: unknown;
  error: { message: string } | null;
}

function makeDb(byTable: Record<string, MockResult>) {
  function builderFor(table: string) {
    const result = byTable[table] ?? { data: [], error: null };
    const builder = {
      select() { return builder; },
      eq()     { return builder; },
      order()  { return builder; },
      then(resolve: (v: MockResult) => unknown) { return resolve(result); },
    };
    return builder;
  }

  return { from: (table: string) => builderFor(table) } as unknown as IslSupabaseClient;
}

/** One completed league fixture as the nested PostgREST select returns it. */
function match(home: string, away: string, hs: number, as: number) {
  return {
    home_team_id: home,
    away_team_id: away,
    home_score: hs,
    away_score: as,
    played_at: '2026-08-10T15:00:00Z',
    competitions: { league_id: 'rocky-inner', type: 'league' },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchLeagueStandingsResult — success', () => {
  it('aggregates 3-1-0 points and sorts the table', async () => {
    const db = makeDb({
      matches: { data: [match('mars', 'earth', 2, 0), match('earth', 'venus', 1, 1)], error: null },
      teams: {
        data: [
          { id: 'mars', name: 'Mars Athletic' },
          { id: 'earth', name: 'Earth United FC' },
          { id: 'venus', name: 'Venus Volcanic SC' },
        ],
        error: null,
      },
    });

    const result = await fetchLeagueStandingsResult(db, 'rocky-inner');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Mars 3 pts. Earth and Venus draw level on 1 pt, so goal difference
    // splits them: Venus 1-1 (GD 0) sits above Earth 1-3 (GD -2).
    expect(result.rows.map((r) => [r.team, r.points, r.gd])).toEqual([
      ['Mars Athletic', 3, 2],
      ['Venus Volcanic SC', 1, 0],
      ['Earth United FC', 1, -2],
    ]);
  });

  it('reports ok with an empty table when the league has played nothing', async () => {
    const db = makeDb({
      matches: { data: [], error: null },
      teams: { data: [], error: null },
    });
    const result = await fetchLeagueStandingsResult(db, 'kuiper-belt');
    expect(result).toEqual({ ok: true, rows: [] });
  });

  it('lists registered teams at zero rather than omitting them', async () => {
    const db = makeDb({
      matches: { data: [], error: null },
      teams: { data: [{ id: 'pluto', name: 'Pluto FC Wanderers' }], error: null },
    });
    const result = await fetchLeagueStandingsResult(db, 'kuiper-belt');
    expect(result.ok && result.rows).toEqual([
      expect.objectContaining({ id: 'pluto', team: 'Pluto FC Wanderers', played: 0, points: 0 }),
    ]);
  });
});

describe('fetchLeagueStandingsResult — failure', () => {
  it('reports the match query failing instead of an empty table', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const db = makeDb({
      matches: { data: null, error: { message: 'statement timeout' } },
      teams: { data: [], error: null },
    });
    const result = await fetchLeagueStandingsResult(db, 'rocky-inner');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/statement timeout/);
  });

  it('reports the team query failing instead of an empty table', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const db = makeDb({
      matches: { data: [], error: null },
      teams: { data: null, error: { message: 'permission denied' } },
    });
    const result = await fetchLeagueStandingsResult(db, 'rocky-inner');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/permission denied/);
  });
});

describe('fetchLeagueStandings — legacy contract', () => {
  it('still flattens a failed query to an empty array', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const db = makeDb({
      matches: { data: null, error: { message: 'statement timeout' } },
      teams: { data: [], error: null },
    });
    await expect(fetchLeagueStandings(db, 'rocky-inner')).resolves.toEqual([]);
  });

  it('returns the rows on success', async () => {
    const db = makeDb({
      matches: { data: [match('mars', 'earth', 3, 1)], error: null },
      teams: {
        data: [
          { id: 'mars', name: 'Mars Athletic' },
          { id: 'earth', name: 'Earth United FC' },
        ],
        error: null,
      },
    });
    const rows = await fetchLeagueStandings(db, 'rocky-inner');
    expect(rows.map((r) => r.team)).toEqual(['Mars Athletic', 'Earth United FC']);
  });
});
