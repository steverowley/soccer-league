// ── CosmicArchitect.match.test.ts ───────────────────────────────────────────
// WHY: Integration test for the match-time Architect lifecycle.  Two
// invariants are enforced here, both of which would silently break user
// experience if violated:
//
//   1. `prepareArchitectForMatch()` hydrates the Architect from a
//      LoreStore-shaped client BEFORE returning, so the first
//      `getContext()` call in the simulator already sees real cross-match
//      lore rather than an empty ledger.
//
//   2. `getContext()` is fully synchronous — it MUST NOT issue any awaited
//      DB call, because it fires 5–10 times in <500 ms during a goal burst
//      as commentators and player-thought prompts compose in parallel.  A
//      single accidental `await` here would stall the entire feed.
//
// The test uses a hand-rolled fake supabase client (no jest mocks) so the
// hydration path is exercised end-to-end against the same code paths the
// production app runs.

import { describe, it, expect, vi } from 'vitest';
import type { IslSupabaseClient } from '@shared/supabase/client';
import type { ArchitectLoreRow } from '../types';
import { prepareArchitectForMatch } from './prepareArchitect';

// ── Fake Supabase client ────────────────────────────────────────────────────
//
// `LoreStore.hydrate()` calls `db.from('architect_lore').select('*')` and
// awaits the resolved `{ data, error }` shape.  The fake below returns a
// thenable that resolves to the same shape, plus an upsert+select chain
// for `persistAll()` so post-match writes don't reject either.

function makeFakeDb(rows: ArchitectLoreRow[]): IslSupabaseClient {
  const queryResult = Promise.resolve({ data: rows, error: null });
  const upsertResult = Promise.resolve({ data: rows, error: null });
  // Object satisfies the bits of SupabaseClient that lore.ts touches; cast
  // through `unknown` is intentional — the fake intentionally only models
  // the calls under test rather than the whole client surface.
  return {
    from: () => ({
      select: () => queryResult,
      upsert: () => ({ select: () => upsertResult }),
    }),
  } as unknown as IslSupabaseClient;
}

// ── Sample lore rows ────────────────────────────────────────────────────────

const SAMPLE_ROWS: ArchitectLoreRow[] = [
  {
    id: '1',
    scope: 'rivalry:MAR_vs_SAT',
    key: 'thread',
    payload: { thread: 'Two cosmoses, one grudge.', lastResult: 'MAR' },
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: '2',
    scope: 'player:Kael Vorn',
    key: 'arc',
    payload: { team: 'Mars Athletic', arc: 'The defiant striker' },
    updated_at: '2026-01-01T00:00:00Z',
  },
];

// Minimal team/manager shapes — only fields the constructor or
// `getContext()` reads need to be defined.  `shortName` matters because
// `_rivalryKey()` uses it to look up rivalry threads.
const HOME_TEAM = { name: 'Mars Athletic', shortName: 'MAR', color: '#ff0000' };
const AWAY_TEAM = { name: 'Saturn Rings United', shortName: 'SAT', color: '#0000ff' };
const MGR_HOME  = { name: 'M. Olympus', personality: 'analytical' };
const MGR_AWAY  = { name: 'V. Saturn',  personality: 'fiery' };

// ── Tests ───────────────────────────────────────────────────────────────────

describe('prepareArchitectForMatch', () => {
  it('hydrates lore from the DB before returning', async () => {
    const db = makeFakeDb(SAMPLE_ROWS);
    const { architect } = await prepareArchitectForMatch(db, {
      apiKey:      '',
      homeTeam:    HOME_TEAM,
      awayTeam:    AWAY_TEAM,
      homeManager: MGR_HOME,
      awayManager: MGR_AWAY,
      stadium:     null,
      weather:     'clear',
    });

    // Hydrate should have populated the rivalry + player arc.
    expect(architect.lore.rivalryThreads['MAR_vs_SAT']).toEqual({
      thread:     'Two cosmoses, one grudge.',
      lastResult: 'MAR',
    });
    expect(architect.lore.playerArcs['Kael Vorn']).toEqual({
      team: 'Mars Athletic',
      arc:  'The defiant striker',
    });
  });

  it('falls back to empty lore when the DB query fails', async () => {
    // A throwing client simulates a network failure.  The helper must log
    // (we silence it here) and proceed with the empty-lore default rather
    // than rejecting — kickoff must not be blocked.
    const errorDb = {
      from: () => ({
        select: () => Promise.reject(new Error('network down')),
      }),
    } as unknown as IslSupabaseClient;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { architect } = await prepareArchitectForMatch(errorDb, {
      apiKey:      '',
      homeTeam:    HOME_TEAM,
      awayTeam:    AWAY_TEAM,
      homeManager: MGR_HOME,
      awayManager: MGR_AWAY,
      stadium:     null,
      weather:     'clear',
    });

    expect(architect.lore.rivalryThreads).toEqual({});
    expect(architect.lore.playerArcs).toEqual({});
    warnSpy.mockRestore();
  });
});

describe('CosmicArchitect.getContext()', () => {
  it('runs synchronously — 10 tight-loop calls do not yield to the event loop', async () => {
    const db = makeFakeDb(SAMPLE_ROWS);
    const { architect } = await prepareArchitectForMatch(db, {
      apiKey:      '',
      homeTeam:    HOME_TEAM,
      awayTeam:    AWAY_TEAM,
      homeManager: MGR_HOME,
      awayManager: MGR_AWAY,
      stadium:     null,
      weather:     'clear',
    });

    // Sanity: hydrated lore is visible.
    expect(architect.lore.rivalryThreads['MAR_vs_SAT']).toBeDefined();

    // Tight loop: 10 calls in a row.  If any path inside getContext()
    // returns a Promise (e.g. someone added an `await` to fetch lore on
    // demand), Array.from(...).every(typeof === 'string') would fail
    // because we'd see a Promise.  This is the explicit synchronous gate
    // referenced in the engineering invariants in CLAUDE.md.
    const results: unknown[] = [];
    for (let i = 0; i < 10; i++) {
      results.push(architect.getContext());
    }
    expect(results).toHaveLength(10);
    for (const r of results) {
      expect(typeof r).toBe('string');
    }
    // The hydrated rivalry lore must surface in the synchronous output —
    // proves the value was already in memory and no async fetch occurred.
    expect(results[0]).toContain('Two cosmoses, one grudge.');
  });
});
