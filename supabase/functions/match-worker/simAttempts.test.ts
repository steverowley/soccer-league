// @vitest-environment node
// ── match-worker/simAttempts.test.ts ─────────────────────────────────────────
// Poison-pill handling and throttling (docs/mvp-free-tier.md decisions 3, 4):
// attempt counting, backoff, parking, the claim filter and the per-tick
// catch-up cap.

import { describe, it, expect } from 'vitest';
import {
  applyClaimableFilter,
  backstopClaimBudget,
  fanOutSlots,
  planSimFailure,
  truncateError,
  MAX_CLAIMS_PER_TICK,
  MAX_IN_FLIGHT,
  MAX_SIM_ATTEMPTS,
  SIM_BACKOFF_MINUTES,
  SIM_ERROR_MAX_CHARS,
  type ClaimFilterable,
} from './simAttempts.ts';

const NOW = new Date('2026-10-26T12:00:00.000Z');
const plusMin = (m: number) => new Date(NOW.getTime() + m * 60_000).toISOString();

describe('planSimFailure: attempts, backoff, parking', () => {
  it('backs off 5, then 15 minutes, and parks on the 3rd failure', () => {
    expect(MAX_SIM_ATTEMPTS).toBe(3);
    expect(SIM_BACKOFF_MINUTES).toEqual([5, 15, 45]);

    const first = planSimFailure(0, new Error('boom'), NOW);
    expect(first).toMatchObject({ sim_attempts: 1, sim_next_attempt_at: plusMin(5), sim_parked_at: null, parked: false });

    const second = planSimFailure(1, new Error('boom'), NOW);
    expect(second).toMatchObject({ sim_attempts: 2, sim_next_attempt_at: plusMin(15), sim_parked_at: null, parked: false });

    const third = planSimFailure(2, new Error('boom'), NOW);
    expect(third).toMatchObject({ sim_attempts: 3, sim_next_attempt_at: plusMin(45), parked: true });
    expect(third.sim_parked_at).toBe(NOW.toISOString());
  });

  it('stays parked (and on the longest pause) beyond the cap', () => {
    const later = planSimFailure(7, 'still broken', NOW);
    expect(later).toMatchObject({ sim_attempts: 8, sim_next_attempt_at: plusMin(45), parked: true });
  });

  it('treats a missing count (row read before the migration default) as 0', () => {
    expect(planSimFailure(null, 'x', NOW).sim_attempts).toBe(1);
    expect(planSimFailure(undefined, 'x', NOW).sim_attempts).toBe(1);
    expect(planSimFailure(Number.NaN, 'x', NOW).sim_attempts).toBe(1);
  });

  it('stores a single-line, truncated error', () => {
    const plan = planSimFailure(0, new Error(`Insert events failed:\n${'x'.repeat(2000)}`), NOW);
    expect(plan.sim_last_error.length).toBe(SIM_ERROR_MAX_CHARS);
    expect(plan.sim_last_error.startsWith('Error: Insert events failed: xxx')).toBe(true);
    expect(plan.sim_last_error.endsWith('...')).toBe(true);
    expect(plan.sim_last_error).not.toContain('\n');
  });
});

describe('truncateError', () => {
  it('renders strings, errors and objects', () => {
    expect(truncateError('plain')).toBe('plain');
    expect(truncateError(new TypeError('bad'))).toBe('TypeError: bad');
    expect(truncateError({ code: 23514 })).toBe('{"code":23514}');
    expect(truncateError('abcdefghij', 8)).toBe('abcde...');
  });
});

/** Records the builder calls the claim filter makes. */
class RecordingQuery implements ClaimFilterable<RecordingQuery> {
  calls: Array<[string, ...unknown[]]> = [];
  eq(c: string, v: unknown) { this.calls.push(['eq', c, v]); return this; }
  lte(c: string, v: unknown) { this.calls.push(['lte', c, v]); return this; }
  is(c: string, v: null) { this.calls.push(['is', c, v]); return this; }
  or(f: string) { this.calls.push(['or', f]); return this; }
}

describe('applyClaimableFilter', () => {
  it('claims only scheduled, due, not backing off, not parked', () => {
    const iso = NOW.toISOString();
    const q = applyClaimableFilter(new RecordingQuery(), iso);
    expect(q.calls).toEqual([
      ['eq', 'status', 'scheduled'],
      ['lte', 'scheduled_at', iso],
      ['is', 'sim_parked_at', null],
      ['or', `sim_next_attempt_at.is.null,sim_next_attempt_at.lte."${iso}"`],
    ]);
  });

  it('is used by both the claim and the due-count in the worker', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(process.cwd(), 'supabase/functions/match-worker/index.ts'), 'utf8');
    // claimNextDueMatch + countDueMatches; a raw .eq('status','scheduled')
    // select would bypass the backoff and the parking.
    expect(src.match(/applyClaimableFilter\(/g)?.length).toBe(2);
    expect(src).toContain('sim_seed, sim_attempts');
  });
});

describe('tick throttle', () => {
  it('caps in-flight sims and claims per tick at 2', () => {
    expect(MAX_IN_FLIGHT).toBe(2);
    expect(MAX_CLAIMS_PER_TICK).toBe(2);
  });

  it('fan-out never exceeds the queue, the wave width, the in-flight cap or the tick cap', () => {
    expect(fanOutSlots({ due: 50, inFlight: 0, claimsUsed: 0, concurrency: 2 })).toBe(2);
    expect(fanOutSlots({ due: 1, inFlight: 0, claimsUsed: 0, concurrency: 2 })).toBe(1);
    expect(fanOutSlots({ due: 50, inFlight: 1, claimsUsed: 0, concurrency: 2 })).toBe(1);
    expect(fanOutSlots({ due: 50, inFlight: 2, claimsUsed: 0, concurrency: 2 })).toBe(0);
    expect(fanOutSlots({ due: 50, inFlight: 0, claimsUsed: 2, concurrency: 2 })).toBe(0);
    expect(fanOutSlots({ due: 50, inFlight: 5, claimsUsed: 0, concurrency: 2 })).toBe(0); // never negative
  });

  it('the backstop only gets what fan-out left of the tick budget', () => {
    expect(backstopClaimBudget({ inFlight: 0, claimsUsed: 0 })).toBe(2);
    expect(backstopClaimBudget({ inFlight: 0, claimsUsed: 1 })).toBe(1);
    expect(backstopClaimBudget({ inFlight: 0, claimsUsed: 2 })).toBe(0);
    expect(backstopClaimBudget({ inFlight: 2, claimsUsed: 0 })).toBe(0);
  });

  it('drains a 20-match backlog steadily: never more than 2 claims in any tick', () => {
    // Model the dispatcher: each tick fans out (two waves at most), then the
    // backstop takes what is left of the budget. Sims finish before the next
    // tick (2 minutes apart), so in-flight starts each tick at 0.
    let backlog = 20;
    const perTick: number[] = [];
    while (backlog > 0 && perTick.length < 100) {
      let claims = 0;
      let inFlight = 0;
      for (let wave = 0; wave < 2; wave++) {
        const slots = fanOutSlots({ due: backlog, inFlight, claimsUsed: claims, concurrency: 2 });
        if (slots === 0) break;
        claims += slots;
        inFlight += slots;
        backlog -= slots;
      }
      const backstop = Math.min(backlog, backstopClaimBudget({ inFlight, claimsUsed: claims }));
      claims += backstop;
      backlog -= backstop;
      perTick.push(claims);
    }
    expect(Math.max(...perTick)).toBe(2);
    expect(perTick).toHaveLength(10); // 20 matches at 2 per tick: 20 minutes at a 2-minute tick
  });
});
