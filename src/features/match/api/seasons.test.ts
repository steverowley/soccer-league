// ── features/match/api/seasons.test.ts ───────────────────────────────────────
// Integration-style tests for the season-lifecycle DB layer.  Pure logic
// is covered separately in `logic/seasonLifecycle.test.ts`; these tests
// pin the query plumbing — joins, optimistic updates, and the maybeSingle
// no-row branches — via an in-memory Supabase double.
//
// MOCK STRATEGY mirrors `betting/api/wagers.test.ts`: a hand-rolled
// chained query builder backed by an in-memory store.  Kept inline rather
// than extracted to a shared helper so each test file's mock surface
// stays auditable from the file it lives in.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getSeasonStatus,
  getLeagueFixtureCountsForSeason,
  transitionSeasonStatus,
  getSeasonIdForMatch,
} from './seasons';
import type { IslSupabaseClient } from '@shared/supabase/client';

// ── In-memory store shape ────────────────────────────────────────────────────

interface SeasonRow      { id: string; status: string; ended_at: string | null }
interface CompetitionRow { id: string; season_id: string; type: string }
interface MatchRow       { id: string; competition_id: string; status: string }

interface FakeStore {
  seasons:      SeasonRow[];
  competitions: CompetitionRow[];
  matches:      MatchRow[];
}

/**
 * Build a fake Supabase client backed by the provided in-memory store.
 *
 * Implements the chain methods this api file actually uses: select / eq /
 * in / update / maybeSingle / await-thenable.  Anything outside that
 * surface throws (the test that triggers the mismatch will fail loudly).
 */
function makeFakeDb(store: FakeStore): IslSupabaseClient {
  function from(table: keyof FakeStore) {
    type Filter = { col: string; val: unknown; kind: 'eq' | 'in' };
    const filters: Filter[] = [];
    let mode:    'select' | 'update' = 'select';
    let payload: Record<string, unknown> | null = null;

    function applyFilters<T extends Record<string, unknown>>(rows: T[]): T[] {
      let out = rows;
      for (const f of filters) {
        if (f.kind === 'eq') out = out.filter((r) => r[f.col] === f.val);
        else                 out = out.filter((r) => (f.val as unknown[]).includes(r[f.col]));
      }
      return out;
    }

    async function executor<T>(): Promise<{ data: T; error: null }> {
      const rows = store[table] as unknown as Record<string, unknown>[];
      if (mode === 'update' && payload) {
        const matched = applyFilters(rows);
        for (const r of matched) Object.assign(r, payload);
        return { data: matched as unknown as T, error: null };
      }
      return { data: applyFilters(rows) as unknown as T, error: null };
    }

    const builder: Record<string, unknown> = {
      // .select() after .update() in real Supabase returns the updated rows,
      // so we treat select() as a no-op once the mode is already 'update'.
      // Otherwise it sets us into pure read mode.
      select() { if (mode !== 'update') mode = 'select'; return builder; },
      update(p: Record<string, unknown>) { mode = 'update'; payload = p; return builder; },
      eq(col: string, val: unknown) { filters.push({ col, val, kind: 'eq' }); return builder; },
      in(col: string, vals: unknown[]) { filters.push({ col, val: vals, kind: 'in' }); return builder; },
      maybeSingle() {
        return executor<unknown>().then((r) => {
          const arr = r.data as unknown[];
          return { data: arr[0] ?? null, error: null };
        });
      },
      then<T>(resolve: (v: { data: T; error: null }) => unknown) {
        return executor<T>().then(resolve);
      },
    };
    return builder;
  }

  return { from } as unknown as IslSupabaseClient;
}

let store: FakeStore;

beforeEach(() => {
  store = { seasons: [], competitions: [], matches: [] };
});

// ── getSeasonStatus ──────────────────────────────────────────────────────────

describe('getSeasonStatus', () => {
  it('returns the row\'s status when found', async () => {
    store.seasons.push({ id: 's1', status: 'active', ended_at: null });
    const status = await getSeasonStatus(makeFakeDb(store), 's1');
    expect(status).toBe('active');
  });

  it('returns null when no season row matches', async () => {
    // Empty store — exercises the maybeSingle null-data branch.
    const status = await getSeasonStatus(makeFakeDb(store), 'missing');
    expect(status).toBeNull();
  });
});

// ── getLeagueFixtureCountsForSeason ──────────────────────────────────────────

describe('getLeagueFixtureCountsForSeason', () => {
  it('counts matches by status across every league competition in the season', async () => {
    // Two league competitions, one cup competition (which must be ignored).
    store.competitions.push(
      { id: 'c-rocky', season_id: 's1', type: 'league' },
      { id: 'c-gas',   season_id: 's1', type: 'league' },
      { id: 'c-cup',   season_id: 's1', type: 'cup'    },
    );
    // 3 completed, 1 in_progress, 1 scheduled across the leagues; cup
    // matches must NOT be counted since they don't gate the season.
    store.matches.push(
      { id: 'm1', competition_id: 'c-rocky', status: 'completed'  },
      { id: 'm2', competition_id: 'c-rocky', status: 'completed'  },
      { id: 'm3', competition_id: 'c-gas',   status: 'completed'  },
      { id: 'm4', competition_id: 'c-gas',   status: 'in_progress' },
      { id: 'm5', competition_id: 'c-rocky', status: 'scheduled'  },
      // The cup match below should be excluded entirely.
      { id: 'm6', competition_id: 'c-cup',   status: 'scheduled'  },
    );

    const counts = await getLeagueFixtureCountsForSeason(makeFakeDb(store), 's1');
    expect(counts).toEqual({
      scheduled: 1, inProgress: 1, completed: 3, cancelled: 0,
    });
  });

  it('counts cancelled matches into the cancelled bucket', async () => {
    store.competitions.push({ id: 'c1', season_id: 's1', type: 'league' });
    store.matches.push(
      { id: 'm1', competition_id: 'c1', status: 'cancelled' },
      { id: 'm2', competition_id: 'c1', status: 'completed' },
    );
    const counts = await getLeagueFixtureCountsForSeason(makeFakeDb(store), 's1');
    expect(counts.cancelled).toBe(1);
    expect(counts.completed).toBe(1);
  });

  it('returns zero counts when the season has no league competitions', async () => {
    // Only a cup → leagues query returns empty, helper returns zeros.
    store.competitions.push({ id: 'c-cup', season_id: 's1', type: 'cup' });
    const counts = await getLeagueFixtureCountsForSeason(makeFakeDb(store), 's1');
    expect(counts).toEqual({
      scheduled: 0, inProgress: 0, completed: 0, cancelled: 0,
    });
  });

  it('returns zero counts when the season has no rows at all', async () => {
    const counts = await getLeagueFixtureCountsForSeason(makeFakeDb(store), 's-missing');
    expect(counts).toEqual({
      scheduled: 0, inProgress: 0, completed: 0, cancelled: 0,
    });
  });
});

// ── transitionSeasonStatus ───────────────────────────────────────────────────

describe('transitionSeasonStatus', () => {
  it('flips the status when the optimistic predicate matches', async () => {
    store.seasons.push({ id: 's1', status: 'active', ended_at: null });
    const won = await transitionSeasonStatus(makeFakeDb(store), 's1', 'active', 'voting');
    expect(won).toBe(true);
    expect(store.seasons[0]!.status).toBe('voting');
    // ended_at is stamped only on the active → voting transition.
    expect(store.seasons[0]!.ended_at).not.toBeNull();
  });

  it('returns false when the row has already moved past the expected status', async () => {
    // Pretend another worker already advanced the row.
    store.seasons.push({ id: 's1', status: 'voting', ended_at: '2026-04-30T00:00:00Z' });
    const won = await transitionSeasonStatus(makeFakeDb(store), 's1', 'active', 'voting');
    expect(won).toBe(false);
    // Must not overwrite the row when the predicate doesn't match.
    expect(store.seasons[0]!.status).toBe('voting');
  });

  it('does NOT write ended_at on the voting → enacted transition', async () => {
    // The worker stamps ended_at exactly once (active → voting); subsequent
    // transitions must leave it alone so the original close-of-league
    // timestamp stays the source of truth.
    store.seasons.push({ id: 's1', status: 'voting', ended_at: '2026-04-30T00:00:00Z' });
    const won = await transitionSeasonStatus(makeFakeDb(store), 's1', 'voting', 'enacted');
    expect(won).toBe(true);
    expect(store.seasons[0]!.status).toBe('enacted');
    expect(store.seasons[0]!.ended_at).toBe('2026-04-30T00:00:00Z');
  });
});

// ── getSeasonIdForMatch ──────────────────────────────────────────────────────

describe('getSeasonIdForMatch', () => {
  it('walks match → competition → season to resolve the season UUID', async () => {
    store.matches.push({ id: 'm1', competition_id: 'c1', status: 'completed' });
    store.competitions.push({ id: 'c1', season_id: 's42', type: 'league' });
    const seasonId = await getSeasonIdForMatch(makeFakeDb(store), 'm1');
    expect(seasonId).toBe('s42');
  });

  it('returns null when the match row is missing', async () => {
    const seasonId = await getSeasonIdForMatch(makeFakeDb(store), 'm-missing');
    expect(seasonId).toBeNull();
  });

  it('returns null when the competition row is missing', async () => {
    // Match exists but no competition row — exercises the second-hop miss.
    store.matches.push({ id: 'm1', competition_id: 'c-orphan', status: 'completed' });
    const seasonId = await getSeasonIdForMatch(makeFakeDb(store), 'm1');
    expect(seasonId).toBeNull();
  });
});
