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

  // ── #428 slice 2: Architect interference wiring ───────────────────────────
  //
  // These tests lock down the integration contract:
  //   1. With no interferences wired, behaviour is byte-identical to legacy.
  //   2. A guaranteed-firing curse on every player annuls every goal so the
  //      final score becomes 0–0.
  //   3. The events list reflects the resolver's mutations (goal → shot)
  //      and the cursed events carry the interferenceApplied marker.

  describe('Architect interference wiring (#428)', () => {
    /**
     * Resolver RNG that always rolls 0 → fires every applicable curse /
     * bless. The Math.random in the engine itself is a separate spy,
     * mocked independently for determinism.
     */
    const alwaysFire = () => 0;

    /**
     * Roster fragment helper: every player on both teams is cursed at
     * magnitude 10 (100% firing chance) starting at minute 0. Goals can
     * still happen — but each one passes through the resolver which
     * downgrades it to a shot. End score must therefore land at 0–0.
     */
    function curseEveryone(home: EngineTeam, away: EngineTeam) {
      const allPlayers = [...home.players, ...away.players].map(p => p.name);
      return {
        ctx: {
          curses:  allPlayers.map(playerName => ({
            playerName, magnitude: 10, startMin: 0,
          })),
          blesses: [],
        },
        random: alwaysFire,
      };
    }

    it('no interferences wired → byte-identical to legacy behaviour', () => {
      vi.spyOn(Math, 'random').mockImplementation(makeLCG(101));
      const [h1, a1] = freshTeams();
      const baseline = simulateFullMatch(h1, a1);

      vi.restoreAllMocks();
      vi.spyOn(Math, 'random').mockImplementation(makeLCG(101));
      const [h2, a2] = freshTeams();
      // Pass `null` explicitly to confirm the new parameter slot doesn't
      // drift the RNG sequence even when present-but-null.
      const withNull = simulateFullMatch(h2, a2, null, null, null, null);

      expect(withNull.finalScore).toEqual(baseline.finalScore);
      expect(withNull.events.length).toBe(baseline.events.length);
    });

    it('curse-everyone-magnitude-10 → final score is 0–0 and every goal carries the marker', () => {
      vi.spyOn(Math, 'random').mockImplementation(makeLCG(101));
      const [home, away] = freshTeams();
      const baseline = simulateFullMatch(home, away);

      // Sanity: baseline must score at least once or the test is vacuous.
      const baselineGoals = baseline.finalScore[0] + baseline.finalScore[1];
      expect(baselineGoals).toBeGreaterThan(0);

      vi.restoreAllMocks();
      vi.spyOn(Math, 'random').mockImplementation(makeLCG(101));
      const [h2, a2] = freshTeams();
      const cursed = simulateFullMatch(
        h2, a2, null, null, null, curseEveryone(h2, a2),
      );

      // All goals annulled → 0–0 result.
      expect(cursed.finalScore).toEqual([0, 0]);

      // The cursed run has zero `isGoal:true` events. Structural check
      // (rather than position-by-position against baseline) because
      // mirroring isGoal back to the raw event affects playerStats
      // updates, which in turn changes the engine's bias bag on
      // subsequent minutes — the post-curse event stream diverges
      // from baseline by design.
      const remainingGoals = cursed.events.filter(
        ev => ev.payload['isGoal'] === true,
      );
      expect(remainingGoals).toHaveLength(0);

      // At least one event carries the curse marker (proof the resolver
      // actually fired on this seed).
      const curseMarked = cursed.events.filter(
        ev => ev.payload['interferenceApplied'] === 'curse',
      );
      expect(curseMarked.length).toBeGreaterThan(0);
      // Every curse-marked event is a downgraded goal (now a shot).
      for (const ev of curseMarked) {
        expect(ev.type).toBe('shot');
        expect(ev.payload['isGoal']).toBe(false);
      }
    });

    it('playerStats reflects the post-resolution outcome — no phantom goals', () => {
      vi.spyOn(Math, 'random').mockImplementation(makeLCG(101));
      const [home, away] = freshTeams();
      const cursed = simulateFullMatch(
        home, away, null, null, null, curseEveryone(home, away),
      );

      // With every goal annulled, no player should hold a `goals` count > 0.
      const goalCounts = Object.values(cursed.playerStats).map(s => s.goals ?? 0);
      const totalGoals = goalCounts.reduce((a, b) => a + b, 0);
      expect(totalGoals).toBe(0);
    });
  });
});
