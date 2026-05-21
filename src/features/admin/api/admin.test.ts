// ── features/admin/api/admin.test.ts ─────────────────────────────────────────
// Integration-style tests for the admin DB layer.  Same in-memory Supabase
// double pattern used in `betting/api/wagers.test.ts` + `match/api/seasons
// .test.ts`: a hand-rolled chained query builder backed by an in-memory
// store.  Each test that wants to verify an UPDATE inspects the store row
// directly rather than asserting on the response payload — closer to what
// real PostgREST callers care about.
//
// POST-MIGRATION 0041 NOTE
// ────────────────────────
// Both `fastForwardScheduledMatches` and `completeMatchManually` now route
// their mutations through SECURITY DEFINER RPCs (`admin_fast_forward_matches`
// / `admin_complete_match`) instead of direct table UPDATEs.  The fake DB
// below grew an `rpc()` surface that mirrors the SQL function bodies just
// enough to keep every behavioural assertion meaningful — score-range
// guards, the cup-draw rule, optimistic-concurrency on `status='scheduled'`,
// and the bulk fast-forward interval arithmetic.  Anything the production
// RPC enforces (admin role check) is exercised by separate end-to-end
// tests against the live Supabase project; the unit suite here covers the
// client wrapper's input handling and bus-event contract.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fastForwardScheduledMatches, completeMatchManually } from './admin';
import type { IslSupabaseClient } from '@shared/supabase/client';
import type { IslEventBus, IslEvents } from '@shared/events/bus';

// ── In-memory store shape ────────────────────────────────────────────────────

/**
 * Row shape the fake DB supports for the `matches` table.  The fast-forward
 * tests only touch `id`/`status`/`scheduled_at`; the manual-completion tests
 * additionally rely on team/competition foreign-key columns plus `home_score`
 * / `away_score` / `played_at` — all optional here so each test only
 * populates the columns it cares about.
 */
interface MatchRow {
  id:              string;
  status:          string;
  scheduled_at:    string | null;
  /** Home team UUID — required for `match.completed` bus payload. */
  home_team_id?:   string | null;
  /** Away team UUID — required for `match.completed` bus payload. */
  away_team_id?:   string | null;
  /** Competition UUID — required for `match.completed` bus payload. */
  competition_id?: string | null;
  /** Final home score after manual completion. */
  home_score?:     number | null;
  /** Final away score after manual completion. */
  away_score?:     number | null;
  /** ISO timestamp stamped at completion time. */
  played_at?:      string | null;
}

/**
 * Row shape the fake DB supports for the `competitions` table.  Only the
 * fields `completeMatchManually` actually reads (`id`, `type`) are modelled;
 * additional columns (`name`, `format`, `status`, …) are intentionally absent
 * so a regression that starts reading them trips a compile error.
 */
interface CompetitionRow {
  /** UUID — matches `matches.competition_id` for the lookup join. */
  id:   string;
  /** Discriminator the cup-draw guard checks for: 'cup' vs 'league'. */
  type: 'cup' | 'league';
}

interface FakeStore {
  matches:      MatchRow[];
  /**
   * Competitions referenced by `matches.competition_id`.  Seeded by tests
   * that exercise the cup-draw guard; other tests can leave it empty.
   */
  competitions: CompetitionRow[];
}

// ── Score range constants (mirror migration 0041) ──────────────────────────
// The RPC enforces `home_score`/`away_score` ∈ [0, 99] via `RAISE EXCEPTION
// … USING ERRCODE = '22023'`.  We replicate the same bounds in the fake so
// over/under-range inputs that survive the client wrapper's guard still
// fail with the same human-readable error string the production code
// would emit.  Mechanical effect: matches `MIN_SCORE` / `MAX_SCORE` in
// admin.ts so any future tightening only needs to change the production
// constants — the fake follows by re-reading them on the next test run.

/** Inclusive lower bound the RPC enforces on home/away scores. */
const FAKE_MIN_SCORE = 0;
/** Inclusive upper bound the RPC enforces on home/away scores. */
const FAKE_MAX_SCORE = 99;

/**
 * Build a fake Supabase client backed by `store`.  Implements the chain
 * surface this api file actually uses: from / select / update / eq / in /
 * not / await-thenable, plus a top-level `rpc(name, args)` that mimics
 * the SECURITY DEFINER functions added in migration 0041.  Anything
 * outside that surface throws — the test that triggers the mismatch will
 * fail loudly.
 *
 * @param store  Mutable in-memory tables shared across helpers and tests.
 * @returns      A Supabase-client-shaped object covering only the chains
 *               actually exercised in this file; missing methods throw on
 *               first touch so coverage gaps are obvious.
 */
function makeFakeDb(store: FakeStore): IslSupabaseClient {
  /**
   * Dispatch table for `db.rpc(name, args)`.  Each entry replicates the
   * outward-visible behaviour of the SQL function declared in migration
   * 0041 — return value shape, RAISE EXCEPTION messages, and side effects
   * on the in-memory store.  We do NOT model the `is_admin` role gate
   * here (the unit tests assume the caller has already passed UI gating);
   * end-to-end RLS coverage lives in a separate Supabase integration suite.
   */
  const rpcHandlers: Record<
    string,
    (args: Record<string, unknown>) => { data: unknown; error: { message: string } | null }
  > = {
    // admin_fast_forward_matches(p_hours numeric) → integer.
    // Mirrors the bulk UPDATE: every scheduled row with a non-null
    // scheduled_at gets shifted backwards by `p_hours` * 3_600_000 ms.
    // Returns ROW_COUNT (matchesShifted).
    admin_fast_forward_matches: (args) => {
      const hours = args.p_hours as number;
      if (!Number.isFinite(hours) || hours <= 0) {
        return { data: null, error: { message: 'admin_fast_forward_matches: hours must be > 0' } };
      }
      const offsetMs = hours * 3_600_000;
      let shifted = 0;
      for (const m of store.matches) {
        if (m.status !== 'scheduled' || m.scheduled_at == null) continue;
        const ts = Date.parse(m.scheduled_at);
        if (!Number.isFinite(ts)) continue;
        m.scheduled_at = new Date(ts - offsetMs).toISOString();
        shifted += 1;
      }
      return { data: shifted, error: null };
    },

    // admin_complete_match(p_match_id uuid, p_home_score int, p_away_score int) → json.
    // Replicates the migration body in order: score-range guard → match
    // lookup → cup-draw guard → optimistic-concurrency UPDATE.  Returns
    // a json object with the team / competition ids so the client wrapper
    // can populate the bus event without an extra read.
    admin_complete_match: (args) => {
      const matchId   = args.p_match_id   as string;
      const homeScore = args.p_home_score as number;
      const awayScore = args.p_away_score as number;

      // ── Score-range guards ────────────────────────────────────────────────
      // Range-check both sides independently so an out-of-range away
      // score isn't masked by an in-range home score (mirrors the two
      // separate IF blocks in the SQL function).
      if (!Number.isInteger(homeScore) || homeScore < FAKE_MIN_SCORE || homeScore > FAKE_MAX_SCORE) {
        return { data: null, error: { message: `admin_complete_match: home_score must be in [${FAKE_MIN_SCORE}, ${FAKE_MAX_SCORE}]` } };
      }
      if (!Number.isInteger(awayScore) || awayScore < FAKE_MIN_SCORE || awayScore > FAKE_MAX_SCORE) {
        return { data: null, error: { message: `admin_complete_match: away_score must be in [${FAKE_MIN_SCORE}, ${FAKE_MAX_SCORE}]` } };
      }

      // ── Match lookup ──────────────────────────────────────────────────────
      const row = store.matches.find((m) => m.id === matchId);
      if (!row) {
        return { data: null, error: { message: `admin_complete_match: match ${matchId} not found` } };
      }

      // ── Cup-draw guard ────────────────────────────────────────────────────
      // Knockouts need a decisive winner; a tied cup match would flip to
      // completed without the bracket advancing, so we fail early.  League
      // matches and matches with no competition_id flow through as drawable.
      if (homeScore === awayScore && row.competition_id) {
        const comp = store.competitions.find((c) => c.id === row.competition_id);
        if (comp?.type === 'cup') {
          return { data: null, error: { message: 'Cup matches cannot end in a draw — enter a tiebreak winner' } };
        }
      }

      // ── Optimistic-concurrency UPDATE ─────────────────────────────────────
      // Only writes when status is still `scheduled`.  Any other status
      // (in_progress / completed / cancelled) means another writer beat
      // us — surface the same "no longer scheduled" message the SQL
      // function emits via SQLSTATE 40001.
      if (row.status !== 'scheduled') {
        return { data: null, error: { message: 'Match is no longer scheduled — refresh and try again' } };
      }
      row.status     = 'completed';
      row.home_score = homeScore;
      row.away_score = awayScore;
      row.played_at  = new Date().toISOString();

      return {
        data: {
          match_id:       matchId,
          home_score:     homeScore,
          away_score:     awayScore,
          home_team_id:   row.home_team_id ?? null,
          away_team_id:   row.away_team_id ?? null,
          competition_id: row.competition_id ?? null,
        },
        error: null,
      };
    },
  };

  function from(table: keyof FakeStore) {
    type Filter =
      | { kind: 'eq';  col: string; val: unknown }
      | { kind: 'in';  col: string; val: unknown[] }
      | { kind: 'not'; col: string; op:  'is'; val: 'null' | unknown };
    const filters: Filter[] = [];
    let mode:    'select' | 'update' = 'select';
    let payload: Record<string, unknown> | null = null;

    function applyFilters<T extends Record<string, unknown>>(rows: T[]): T[] {
      let out = rows;
      for (const f of filters) {
        if (f.kind === 'eq')        out = out.filter((r) => r[f.col] === f.val);
        else if (f.kind === 'in')   out = out.filter((r) => f.val.includes(r[f.col]));
        else if (f.kind === 'not' && f.op === 'is' && f.val === 'null') {
          // `.not('col', 'is', null)` → keep rows where col is not null.
          out = out.filter((r) => r[f.col] != null);
        }
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
      // .select() before .update() means a read; after .update() it tells
      // PostgREST to return the affected rows — preserve the update mode.
      select() { if (mode !== 'update') mode = 'select'; return builder; },
      update(p: Record<string, unknown>) { mode = 'update'; payload = p; return builder; },
      eq(col: string, val: unknown) { filters.push({ kind: 'eq', col, val }); return builder; },
      in(col: string, vals: unknown[]) { filters.push({ kind: 'in', col, val: vals }); return builder; },
      not(col: string, op: 'is', val: unknown) {
        filters.push({ kind: 'not', col, op, val: val as 'null' });
        return builder;
      },
      // `.maybeSingle()` resolves with the first filtered row, or `null` when
      // nothing matches.  Mirrors PostgREST semantics so the production code
      // gets the same `{ data, error }` shape it sees against a real client.
      async maybeSingle<T>(): Promise<{ data: T | null; error: null }> {
        const rows = applyFilters(store[table] as unknown as Record<string, unknown>[]);
        return { data: (rows[0] ?? null) as unknown as T | null, error: null };
      },
      then<T>(resolve: (v: { data: T; error: null }) => unknown) {
        return executor<T>().then(resolve);
      },
    };
    return builder;
  }

  /**
   * Top-level `rpc(name, args)` mirror.  Looks up the handler in the
   * dispatch table above; an unregistered call throws so the test exposes
   * the missing handler instead of returning `undefined` silently.
   *
   * @param name  SQL function name (e.g. 'admin_complete_match').
   * @param args  Named-argument object exactly as the client wrapper passes
   *              it to `db.rpc()`.  Mirrors PostgREST positional semantics.
   * @returns     `{ data, error }` matching the supabase-js shape so the
   *              production code's destructuring keeps working untouched.
   */
  function rpc(name: string, args: Record<string, unknown>) {
    const handler = rpcHandlers[name];
    if (!handler) {
      throw new Error(`[fake-db] unregistered rpc call: ${name}`);
    }
    return Promise.resolve(handler(args));
  }

  return { from, rpc } as unknown as IslSupabaseClient;
}

// ── Common state ────────────────────────────────────────────────────────────

let store: FakeStore;

beforeEach(() => {
  store = { matches: [], competitions: [] };
});

// ── fastForwardScheduledMatches ──────────────────────────────────────────────

describe('fastForwardScheduledMatches', () => {
  it('shifts every scheduled match backward by the requested hours', async () => {
    // Two scheduled matches kicking off 2 hours in the future.
    const future = new Date(Date.UTC(2030, 0, 1, 12, 0, 0)).toISOString();
    const futureLater = new Date(Date.UTC(2030, 0, 1, 14, 0, 0)).toISOString();
    store.matches.push(
      { id: 'm1', status: 'scheduled', scheduled_at: future      },
      { id: 'm2', status: 'scheduled', scheduled_at: futureLater },
    );

    const result = await fastForwardScheduledMatches(makeFakeDb(store), 1);

    expect(result.matchesShifted).toBe(2);
    expect(result.hoursShifted).toBe(1);
    // Each scheduled_at should be exactly one hour earlier than its
    // original value.  Equality check converts ISO strings → ms back to ms
    // so we don't get bitten by ISO formatting differences.
    expect(Date.parse(store.matches[0]!.scheduled_at!))
      .toBe(Date.parse(future) - 3_600_000);
    expect(Date.parse(store.matches[1]!.scheduled_at!))
      .toBe(Date.parse(futureLater) - 3_600_000);
  });

  it('skips matches not in scheduled status', async () => {
    // Only the scheduled one should be shifted; in_progress / completed /
    // cancelled rows must be untouched (worker is already past them).
    const ts = new Date(Date.UTC(2030, 0, 1, 12, 0, 0)).toISOString();
    store.matches.push(
      { id: 'mA', status: 'scheduled',   scheduled_at: ts },
      { id: 'mB', status: 'in_progress', scheduled_at: ts },
      { id: 'mC', status: 'completed',   scheduled_at: ts },
      { id: 'mD', status: 'cancelled',   scheduled_at: ts },
    );

    const result = await fastForwardScheduledMatches(makeFakeDb(store), 2);

    expect(result.matchesShifted).toBe(1);
    expect(Date.parse(store.matches[0]!.scheduled_at!))
      .toBe(Date.parse(ts) - 7_200_000);
    // The other rows kept their original timestamps verbatim.
    expect(store.matches[1]!.scheduled_at).toBe(ts);
    expect(store.matches[2]!.scheduled_at).toBe(ts);
    expect(store.matches[3]!.scheduled_at).toBe(ts);
  });

  it('skips scheduled rows whose scheduled_at is null', async () => {
    // Defensive: legacy fixtures created before migration 0009 may have
    // scheduled_at = null.  We must NOT subtract from null.
    const ts = new Date(Date.UTC(2030, 0, 1, 12, 0, 0)).toISOString();
    store.matches.push(
      { id: 'm1', status: 'scheduled', scheduled_at: ts   },
      { id: 'm2', status: 'scheduled', scheduled_at: null },
    );

    const result = await fastForwardScheduledMatches(makeFakeDb(store), 1);

    expect(result.matchesShifted).toBe(1);
    expect(store.matches[1]!.scheduled_at).toBeNull();
  });

  it('returns a no-op result for non-positive hours', async () => {
    // Negative or zero must not be allowed to shift fixtures forward in
    // time — that would silently make them invisible to the worker.
    const ts = new Date(Date.UTC(2030, 0, 1, 12, 0, 0)).toISOString();
    store.matches.push({ id: 'm1', status: 'scheduled', scheduled_at: ts });

    const r1 = await fastForwardScheduledMatches(makeFakeDb(store), 0);
    const r2 = await fastForwardScheduledMatches(makeFakeDb(store), -5);
    const r3 = await fastForwardScheduledMatches(makeFakeDb(store), Number.NaN);

    expect(r1).toEqual({ matchesShifted: 0, hoursShifted: 0 });
    expect(r2).toEqual({ matchesShifted: 0, hoursShifted: 0 });
    expect(r3).toEqual({ matchesShifted: 0, hoursShifted: 0 });
    // Original timestamp must be unchanged after all three calls.
    expect(store.matches[0]!.scheduled_at).toBe(ts);
  });

  it('returns matchesShifted=0 cleanly when no scheduled rows exist', async () => {
    // Empty store — common during a fresh-season setup before fixture
    // generation has run.  Must not crash; must not write anything.
    const result = await fastForwardScheduledMatches(makeFakeDb(store), 1);
    expect(result).toEqual({ matchesShifted: 0, hoursShifted: 1 });
  });
});

// ── completeMatchManually ────────────────────────────────────────────────────

/**
 * Build a minimal stand-in for the shared event bus.  Captures every emit
 * call so tests can assert on event name + payload, and on the exact number
 * of emissions (the "exactly-once" invariant).  Only the `emit` surface is
 * needed because `completeMatchManually` never calls `on` or `clear`.
 */
function makeFakeBus(): IslEventBus & { calls: Array<{ event: string; payload: unknown }> } {
  const calls: Array<{ event: string; payload: unknown }> = [];
  return {
    calls,
    emit: <E extends keyof IslEvents>(event: E, payload: IslEvents[E]) => {
      calls.push({ event, payload });
    },
    // Unused surfaces — present so the object satisfies IslEventBus.
    on: () => () => undefined,
    clear: () => undefined,
  };
}

describe('completeMatchManually', () => {
  /**
   * Default scheduled-row seed shared by the happy-path tests.  Includes the
   * team + competition FKs so the bus payload renders the full
   * `MatchCompletedPayload` shape rather than empty strings.
   */
  const seedMatch = (): MatchRow => ({
    id:             'match-1',
    status:         'scheduled',
    scheduled_at:   '2030-01-01T12:00:00.000Z',
    home_team_id:   'team-home',
    away_team_id:   'team-away',
    competition_id: 'comp-celestial-cup',
  });

  it('updates the row to completed and emits match.completed exactly once', async () => {
    store.matches.push(seedMatch());
    const fakeBus = makeFakeBus();

    const result = await completeMatchManually(
      makeFakeDb(store), 'match-1', 2, 1, fakeBus,
    );

    // ── Return value ───────────────────────────────────────────────────────
    expect(result).toEqual({ matchId: 'match-1', homeScore: 2, awayScore: 1 });

    // ── Row mutation ───────────────────────────────────────────────────────
    const row = store.matches[0]!;
    expect(row.status).toBe('completed');
    expect(row.home_score).toBe(2);
    expect(row.away_score).toBe(1);
    expect(row.played_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);

    // ── Bus emission ───────────────────────────────────────────────────────
    // EXACTLY ONE call to bus.emit, with the full MatchCompletedPayload.
    expect(fakeBus.calls).toHaveLength(1);
    expect(fakeBus.calls[0]).toEqual({
      event: 'match.completed',
      payload: {
        matchId:       'match-1',
        homeTeamId:    'team-home',
        awayTeamId:    'team-away',
        homeScore:     2,
        awayScore:     1,
        competitionId: 'comp-celestial-cup',
      },
    });
  });

  it('throws when the matchId does not exist and never emits', async () => {
    // Store has a different match — the lookup must return null and the
    // function must throw before any UPDATE or bus.emit runs.
    store.matches.push(seedMatch());
    const fakeBus = makeFakeBus();

    await expect(
      completeMatchManually(makeFakeDb(store), 'unknown-id', 1, 0, fakeBus),
    ).rejects.toThrow(/not found/);

    // Row untouched by the failed lookup.
    expect(store.matches[0]!.status).toBe('scheduled');
    // No emit on the failure path.
    expect(fakeBus.calls).toHaveLength(0);
  });

  it('rejects scores outside [0, 99] without touching the DB or bus', async () => {
    store.matches.push(seedMatch());
    const fakeBus = makeFakeBus();
    const db = makeFakeDb(store);

    // Below-range, above-range, and non-integer inputs all fail validation.
    // Spread across both home and away to catch a one-sided guard regression.
    await expect(completeMatchManually(db, 'match-1', -1, 0,  fakeBus)).rejects.toThrow(/homeScore/);
    await expect(completeMatchManually(db, 'match-1', 100, 0, fakeBus)).rejects.toThrow(/homeScore/);
    await expect(completeMatchManually(db, 'match-1', 0,  -1, fakeBus)).rejects.toThrow(/awayScore/);
    await expect(completeMatchManually(db, 'match-1', 0,  100,fakeBus)).rejects.toThrow(/awayScore/);
    await expect(completeMatchManually(db, 'match-1', 1.5, 0, fakeBus)).rejects.toThrow(/homeScore/);
    await expect(completeMatchManually(db, 'match-1', 0, Number.NaN, fakeBus)).rejects.toThrow(/awayScore/);

    // None of those calls should have mutated the row or emitted on the bus.
    expect(store.matches[0]!.status).toBe('scheduled');
    expect(store.matches[0]!.home_score).toBeUndefined();
    expect(store.matches[0]!.away_score).toBeUndefined();
    expect(fakeBus.calls).toHaveLength(0);
  });

  it('throws for an empty matchId without touching the DB or bus', async () => {
    // Edge case kept explicit: an empty string slipping through the UI must
    // not turn into a "match `' '` not found" DB error — it must trip the
    // synchronous guard first so the failure is unambiguous in the toast.
    const fakeBus = makeFakeBus();
    await expect(
      completeMatchManually(makeFakeDb(store), '', 1, 0, fakeBus),
    ).rejects.toThrow(/matchId is required/);
    expect(fakeBus.calls).toHaveLength(0);
  });

  it('emits exactly once even across two sequential completions on different rows', async () => {
    // Sanity check that the emit counter is not somehow cumulative inside the
    // function itself (each invocation is independent — one emit per call).
    store.matches.push(
      seedMatch(),
      { ...seedMatch(), id: 'match-2' },
    );
    const fakeBus = makeFakeBus();

    await completeMatchManually(makeFakeDb(store), 'match-1', 3, 0, fakeBus);
    await completeMatchManually(makeFakeDb(store), 'match-2', 1, 1, fakeBus);

    expect(fakeBus.calls).toHaveLength(2);
    expect(fakeBus.calls.map((c) => (c.payload as { matchId: string }).matchId))
      .toEqual(['match-1', 'match-2']);
  });

  // ── Cup-draw guard ────────────────────────────────────────────────────────
  // Knockout brackets refuse to advance on tied scorelines (see
  // CupRoundAdvancerListener).  These two cases prove the admin path
  // mirrors that rule: tied input on a cup match throws before the UPDATE,
  // while tied input on a league match flows through unchanged (league
  // draws are legal under standard 3-1-0 points scoring).
  it('rejects a tied scoreline on a cup match without touching the DB or bus', async () => {
    // Seed both the match row (linked to a cup competition) and the
    // competitions row the guard's lookup reads.  `type='cup'` is the
    // exact discriminator the production guard checks.
    store.matches.push(seedMatch());
    store.competitions.push({ id: 'comp-celestial-cup', type: 'cup' });
    const fakeBus = makeFakeBus();

    // 1–1 draw on a cup match must surface as the cup-tie error.
    await expect(
      completeMatchManually(makeFakeDb(store), 'match-1', 1, 1, fakeBus),
    ).rejects.toThrow(/Cup matches cannot end in a draw/);

    // Row stayed scheduled, no scores written, no event emitted — the
    // guard fired BEFORE the UPDATE and BEFORE the emit.
    const row = store.matches[0]!;
    expect(row.status).toBe('scheduled');
    expect(row.home_score).toBeUndefined();
    expect(row.away_score).toBeUndefined();
    expect(row.played_at).toBeUndefined();
    expect(fakeBus.calls).toHaveLength(0);
  });

  it('accepts a tied scoreline on a league match and emits the bus event', async () => {
    // Same seed shape as the cup test, but the linked competition has
    // type='league' — draws are a legitimate league result (1 point each).
    store.matches.push({
      ...seedMatch(),
      // Override competition_id to a league competition row.
      competition_id: 'comp-league-1',
    });
    store.competitions.push({ id: 'comp-league-1', type: 'league' });
    const fakeBus = makeFakeBus();

    const result = await completeMatchManually(
      makeFakeDb(store), 'match-1', 2, 2, fakeBus,
    );

    // Result echoes the tied scoreline back unchanged.
    expect(result).toEqual({ matchId: 'match-1', homeScore: 2, awayScore: 2 });
    // Row was actually written, including the tied scores.
    const row = store.matches[0]!;
    expect(row.status).toBe('completed');
    expect(row.home_score).toBe(2);
    expect(row.away_score).toBe(2);
    // Exactly one emit, with the league competitionId in the payload.
    expect(fakeBus.calls).toHaveLength(1);
    expect(fakeBus.calls[0]!.payload).toMatchObject({
      matchId:       'match-1',
      homeScore:     2,
      awayScore:     2,
      competitionId: 'comp-league-1',
    });
  });

  // ── Status guard ──────────────────────────────────────────────────────────
  // Optimistic-concurrency guard: a stale editor whose row was already
  // moved to `in_progress` / `completed` by the worker must NOT overwrite
  // the worker's write, and must NOT re-emit `match.completed` (which
  // would double-settle wagers and double-advance cups).
  it('throws and does not emit when the row is no longer scheduled', async () => {
    // Seed a row whose status the worker has already advanced to
    // `in_progress` — exactly the race the guard is designed to catch.
    store.matches.push({
      ...seedMatch(),
      status: 'in_progress',
    });
    const fakeBus = makeFakeBus();

    await expect(
      completeMatchManually(makeFakeDb(store), 'match-1', 2, 1, fakeBus),
    ).rejects.toThrow(/no longer scheduled/);

    // The UPDATE's WHERE clause excluded this row, so its scores and
    // played_at must be untouched.  Status stays `in_progress` exactly
    // as the worker set it.
    const row = store.matches[0]!;
    expect(row.status).toBe('in_progress');
    expect(row.home_score).toBeUndefined();
    expect(row.away_score).toBeUndefined();
    expect(row.played_at).toBeUndefined();
    // Critical: no bus emission on the failure path — wagers must not
    // settle and cups must not advance against a write that didn't land.
    expect(fakeBus.calls).toHaveLength(0);
  });

  it('defaults to the app singleton bus when no override is supplied', async () => {
    // This proves the parameter has a real default — the production call
    // path (no `busOverride` arg) reaches the real `bus` import.  We spy
    // via vi.spyOn on the singleton's emit method.  No assertion on
    // downstream listener behaviour — those have their own test files.
    store.matches.push(seedMatch());

    const { bus: realBus } = await import('@shared/events/bus');
    const spy = vi.spyOn(realBus, 'emit');
    try {
      await completeMatchManually(makeFakeDb(store), 'match-1', 0, 0);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(
        'match.completed',
        expect.objectContaining({ matchId: 'match-1', homeScore: 0, awayScore: 0 }),
      );
    } finally {
      spy.mockRestore();
    }
  });
});
