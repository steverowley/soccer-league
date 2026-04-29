// ── simulateFullMatch.test.ts ─────────────────────────────────────────────────
// Unit tests for the pure match orchestrator.  We run it against the real
// gameEngine (no mocking) so we exercise the full simulation surface, but we
// seed Math.random() with a deterministic LCG so each run is reproducible.

import { describe, it, expect, vi, afterEach } from 'vitest';
import TEAMS from '../../../teams';
import { simulateFullMatch } from './simulateFullMatch';
import type { EngineTeam } from '../../../gameEngine.types';

// ── Seeded RNG (same as gameEngine.smoke.test.ts) ─────────────────────────────

function makeLCG(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

// ── Test helpers ──────────────────────────────────────────────────────────────

function freshTeams(): [EngineTeam, EngineTeam] {
  return [
    structuredClone(TEAMS['mars']!),
    structuredClone(TEAMS['saturn']!),
  ];
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('simulateFullMatch', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs 100 random matches without throwing', () => {
    for (let seed = 1; seed <= 100; seed++) {
      vi.spyOn(Math, 'random').mockImplementation(makeLCG(seed));
      const [home, away] = freshTeams();

      let result: ReturnType<typeof simulateFullMatch>;
      try {
        result = simulateFullMatch(home, away);
      } catch (err) {
        throw new Error(`seed=${seed} threw: ${(err as Error).message}`);
      }

      // Score invariants
      expect(Number.isFinite(result.finalScore[0]), `seed ${seed} home NaN`).toBe(true);
      expect(Number.isFinite(result.finalScore[1]), `seed ${seed} away NaN`).toBe(true);
      expect(result.finalScore[0], `seed ${seed} home<0`).toBeGreaterThanOrEqual(0);
      expect(result.finalScore[1], `seed ${seed} away<0`).toBeGreaterThanOrEqual(0);
      expect(result.finalScore[0], `seed ${seed} home>12`).toBeLessThanOrEqual(12);
      expect(result.finalScore[1], `seed ${seed} away>12`).toBeLessThanOrEqual(12);

      // Event count: 20 is a deliberately conservative floor — across 100 seeded
      // matches the actual minimum observed is 28, so this only catches a total
      // engine-silence regression, not normal low-scoring variance.
      expect(result.events.length, `seed ${seed} too few events`).toBeGreaterThanOrEqual(20);

      // Every event has valid minute/subminute/type
      for (const ev of result.events) {
        expect(ev.minute).toBeGreaterThanOrEqual(1);
        expect(ev.minute).toBeLessThanOrEqual(90);
        expect(ev.subminute).toBeGreaterThanOrEqual(0);
        expect(ev.subminute).toBeLessThan(1);
        expect(typeof ev.type).toBe('string');
        expect(ev.type.length).toBeGreaterThan(0);
        expect(typeof ev.payload).toBe('object');
      }

      // MVP is a non-empty string (may be '—' for scoreless draws)
      expect(typeof result.mvp).toBe('string');
      expect(result.mvp.length).toBeGreaterThan(0);

      vi.restoreAllMocks();
    }
  });

  it('is deterministic — same seed produces identical results', () => {
    vi.spyOn(Math, 'random').mockImplementation(makeLCG(42));
    const [h1, a1] = freshTeams();
    const first = simulateFullMatch(h1, a1);

    vi.restoreAllMocks();
    vi.spyOn(Math, 'random').mockImplementation(makeLCG(42));
    const [h2, a2] = freshTeams();
    const second = simulateFullMatch(h2, a2);

    expect(second.finalScore).toEqual(first.finalScore);
    expect(second.events.length).toBe(first.events.length);
    expect(second.mvp).toBe(first.mvp);
  });

  it('returns ordered events (minute asc, subminute asc within minute)', () => {
    vi.spyOn(Math, 'random').mockImplementation(makeLCG(7));
    const [home, away] = freshTeams();
    const { events } = simulateFullMatch(home, away);

    for (let i = 1; i < events.length; i++) {
      const prev = events[i - 1]!;
      const curr = events[i]!;
      const prevKey = prev.minute + prev.subminute;
      const currKey = curr.minute + curr.subminute;
      expect(currKey, `event ${i} out of order`).toBeGreaterThanOrEqual(prevKey);
    }
  });

  it('goal events in the event list match the final score', () => {
    vi.spyOn(Math, 'random').mockImplementation(makeLCG(13));
    const [home, away] = freshTeams();
    const { events, finalScore } = simulateFullMatch(home, away);

    // Count goals from the payload isGoal flag
    let homeGoals = 0;
    let awayGoals = 0;
    for (const ev of events) {
      if (ev.payload['isGoal']) {
        const team = ev.payload['team'] as string | undefined;
        if (team === home.shortName) homeGoals++;
        else awayGoals++;
      }
    }

    expect(homeGoals).toBe(finalScore[0]);
    expect(awayGoals).toBe(finalScore[1]);
  });

  it('subminute values within a single minute are unique', () => {
    vi.spyOn(Math, 'random').mockImplementation(makeLCG(99));
    const [home, away] = freshTeams();
    const { events } = simulateFullMatch(home, away);

    // Group by minute, check no duplicate subminutes
    const byMinute = new Map<number, number[]>();
    for (const ev of events) {
      const subs = byMinute.get(ev.minute) ?? [];
      subs.push(ev.subminute);
      byMinute.set(ev.minute, subs);
    }
    for (const [min, subs] of byMinute) {
      const unique = new Set(subs);
      expect(unique.size, `minute ${min} has duplicate subminutes`).toBe(subs.length);
    }
  });

  it('playerStats accumulates goals to match finalScore totals', () => {
    vi.spyOn(Math, 'random').mockImplementation(makeLCG(55));
    const [home, away] = freshTeams();
    const { playerStats, finalScore } = simulateFullMatch(home, away);

    const totalGoals = Object.values(playerStats).reduce(
      (sum, s) => sum + (s.goals ?? 0), 0,
    );
    expect(totalGoals).toBe(finalScore[0] + finalScore[1]);
  });
});
