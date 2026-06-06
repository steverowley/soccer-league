// ── voting/api/enactment.test.ts ─────────────────────────────────────────────
// Idempotency tests for season enactment (#529).
//
// The roster mutations enactSeasonFocuses applies (stat bumps, player inserts,
// finance deltas) are NOT individually idempotent — re-applying them would
// double-credit finances and double-bump stats.  The fix guards each
// (team, season, tier) on an existing `focus_enacted` row BEFORE mutating, so
// a re-run (cron retry, double admin click) is a no-op.  These tests drive
// enactSeasonFocuses twice against a stateful fake DB and assert the second
// run mutates nothing.

import { describe, it, expect } from 'vitest';
import { enactSeasonFocuses } from './enactment';
import type { IslSupabaseClient } from '@shared/supabase/client';

// ── Stateful in-memory fake Supabase client ─────────────────────────────────
// Models the chained PostgREST surface enactment touches: select / insert /
// update / upsert / eq / order / single / maybeSingle.  The `focus_enacted`
// upsert persists into the store so the second run's guard read finds it.

interface Store {
  focus_options:           Array<Record<string, unknown>>;
  focus_tally:             Array<Record<string, unknown>>;
  players:                 Array<Record<string, unknown>>;
  focus_enacted:           Array<Record<string, unknown>>;
  team_finances:           Array<Record<string, unknown>>;
  architect_interventions: Array<Record<string, unknown>>;
}

/** Records every write so a test can assert "the second run mutated nothing". */
interface WriteLog {
  ops: Array<{ table: string; mode: 'insert' | 'update' | 'upsert' }>;
}

function makeFakeDb(store: Store, log: WriteLog) {
  let idSeq = 0;

  function from(table: keyof Store) {
    const rows = store[table];
    const filters: Array<{ col: string; val: unknown }> = [];
    let mode: 'select' | 'insert' | 'update' | 'upsert' = 'select';
    let payload: Record<string, unknown> | Record<string, unknown>[] | null = null;
    let conflict: string[] = [];

    const match = (r: Record<string, unknown>) => filters.every((f) => r[f.col] === f.val);

    function commit(): { data: unknown; error: null } {
      if (mode === 'select') {
        return { data: rows.filter(match), error: null };
      }
      if (mode === 'update' && payload && !Array.isArray(payload)) {
        log.ops.push({ table, mode: 'update' });
        const hit = rows.filter(match);
        for (const r of hit) Object.assign(r, payload);
        return { data: hit, error: null };
      }
      if (mode === 'insert' && payload) {
        log.ops.push({ table, mode: 'insert' });
        const list = Array.isArray(payload) ? payload : [payload];
        const inserted = list.map((p) => {
          const row = { id: p['id'] ?? `gen-${table}-${++idSeq}`, ...p };
          rows.push(row);
          return row;
        });
        return { data: inserted, error: null };
      }
      if (mode === 'upsert' && payload) {
        log.ops.push({ table, mode: 'upsert' });
        const list = Array.isArray(payload) ? payload : [payload];
        for (const p of list) {
          const existing = conflict.length
            ? rows.find((r) => conflict.every((c) => r[c] === p[c]))
            : undefined;
          if (existing) Object.assign(existing, p);
          else rows.push({ id: p['id'] ?? `gen-${table}-${++idSeq}`, ...p });
        }
        return { data: list, error: null };
      }
      return { data: [], error: null };
    }

    const builder: Record<string, unknown> = {
      select() { return builder; },
      insert(p: Record<string, unknown> | Record<string, unknown>[]) { mode = 'insert'; payload = p; return builder; },
      update(p: Record<string, unknown>) { mode = 'update'; payload = p; return builder; },
      upsert(p: Record<string, unknown> | Record<string, unknown>[], opts?: { onConflict?: string }) {
        mode = 'upsert'; payload = p;
        conflict = opts?.onConflict ? opts.onConflict.split(',').map((s) => s.trim()) : [];
        return builder;
      },
      eq(col: string, val: unknown) { filters.push({ col, val }); return builder; },
      order() { return builder; },
      single() {
        const { data } = commit();
        const arr = data as unknown[];
        return Promise.resolve({ data: arr[0] ?? null, error: null });
      },
      maybeSingle() {
        const { data } = commit();
        const arr = data as unknown[];
        return Promise.resolve({ data: arr[0] ?? null, error: null });
      },
      then<T>(resolve: (v: { data: T; error: null }) => unknown) {
        return Promise.resolve(commit() as { data: T; error: null }).then(resolve);
      },
    };
    return builder;
  }

  return { from } as unknown as IslSupabaseClient;
}

function seededStore(): Store {
  const teamId = 'team-1';
  const seasonId = 'season-1';
  return {
    focus_options: [{ team_id: teamId, season_id: seasonId, option_key: 'stadium_upgrade' }],
    // One major winner with votes; no minor entries → no minor enactment.
    focus_tally: [{
      option_id: 'opt-1', team_id: teamId, season_id: seasonId,
      option_key: 'stadium_upgrade', label: 'Upgrade the Stadium', description: null,
      tier: 'major', vote_count: 5, total_credits: 100,
    }],
    players: [
      { id: 'p1', team_id: teamId, name: 'Striker One', position: 'FW', age: 24, overall_rating: 70,
        attacking: 70, defending: 60, mental: 65, athletic: 72, technical: 68, starter: true, jersey_number: 9 },
      { id: 'p2', team_id: teamId, name: 'Keeper Two', position: 'GK', age: 27, overall_rating: 71,
        attacking: 30, defending: 75, mental: 70, athletic: 68, technical: 60, starter: true, jersey_number: 1 },
    ],
    focus_enacted: [],
    team_finances: [],
    architect_interventions: [],
  };
}

describe('enactSeasonFocuses — idempotency (#529)', () => {
  it('applies mutations once and is a no-op on a second run', async () => {
    const store = seededStore();
    const log: WriteLog = { ops: [] };
    const db = makeFakeDb(store, log);

    // ── Run 1: enacts the major focus, applies its finance mutation ──────────
    const first = await enactSeasonFocuses(db, 'season-1');
    expect(first.enacted).toBe(1);
    expect(store.focus_enacted).toHaveLength(1);

    // Real mutations happened (a finance delta at minimum).
    const financeWritesRun1 = log.ops.filter((o) => o.table === 'team_finances').length;
    expect(financeWritesRun1).toBeGreaterThan(0);
    const balanceAfterRun1 = (store.team_finances[0]?.['balance'] as number) ?? 0;
    expect(balanceAfterRun1).toBeGreaterThan(0);

    // ── Run 2: guard short-circuits — no roster/finance mutations ────────────
    log.ops = [];
    const second = await enactSeasonFocuses(db, 'season-1');

    // Still reports the team as enacted (it IS enacted)...
    expect(second.enacted).toBe(1);
    // ...but NOTHING was mutated the second time.
    const mutatingTables = ['players', 'team_finances', 'entities', 'architect_interventions', 'focus_enacted'];
    const mutationsRun2 = log.ops.filter((o) => mutatingTables.includes(o.table));
    expect(mutationsRun2).toHaveLength(0);

    // No duplicate audit row, and the balance is unchanged (not double-credited).
    expect(store.focus_enacted).toHaveLength(1);
    expect(store.team_finances[0]?.['balance']).toBe(balanceAfterRun1);
  });
});
