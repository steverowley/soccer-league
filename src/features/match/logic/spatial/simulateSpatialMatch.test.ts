// ── features/match/logic/spatial/simulateSpatialMatch.test.ts ─────────────────
// Smoke + invariant tests for the authoritative spatial engine.
//
// We assert STRUCTURAL invariants (determinism, bounds, conservation between
// score and goal events) rather than exact scorelines — the engine is
// emergent, so over-fitting to a specific result would make the suite brittle.
// These are the spatial analogue of the legacy engine's 200 seeded smoke tests
// and will grow into the cutover guardrail.

import { describe, it, expect } from 'vitest';
import {
  simulateSpatialMatch,
  type SpatialTeamInput,
  type SpatialPlayerInput,
} from './simulateSpatialMatch';
import type { SimPlayerStats, Role } from './types';
import { PITCH_LENGTH, PITCH_WIDTH } from './types';
import { adaptSpatialResult, type PlayerIndex } from './spatialEventAdapter';

// ── Fixture builders ──────────────────────────────────────────────────────────

/** A stat line offset from a 65 baseline, so two teams can differ in strength. */
function stats(base: number): SimPlayerStats {
  return {
    shooting: base, passing: base, dribbling: base, speed: base, stamina: base,
    tackling: base, positioning: base, goalkeeping: base, vision: base,
  };
}

/**
 * Build a standard 4-4-2 starting XI (1 GK, 4 DF, 4 MF, 2 FW) with a uniform
 * base rating.  Ids are prefixed so home/away players never collide.
 */
function makeXI(prefix: string, base: number): SpatialPlayerInput[] {
  const roles: Role[] = ['GK', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'FW', 'FW'];
  return roles.map((role, i) => ({
    id: `${prefix}-${i}`,
    name: `${prefix} ${i}`,
    role,
    stats: stats(base),
  }));
}

function team(prefix: string, base: number, formation = '4-4-2'): SpatialTeamInput {
  return { formation, players: makeXI(prefix, base) };
}

// Shorter matches keep the suite fast; a couple of full-length runs cover the
// long-match invariants (stamina drain, many restarts) without bloating CI.
const SHORT = { matchSeconds: 1800, frameEverySec: 1 }; // 30 min
const FULL = { matchSeconds: 90 * 60, frameEverySec: 2 };

describe('simulateSpatialMatch — determinism', () => {
  it('produces a byte-identical result for the same seed', () => {
    const a = simulateSpatialMatch(team('H', 70), team('A', 70), { ...SHORT, seed: 99 });
    const b = simulateSpatialMatch(team('H', 70), team('A', 70), { ...SHORT, seed: 99 });
    expect(a.finalScore).toEqual(b.finalScore);
    expect(a.events.length).toBe(b.events.length);
    expect(a.frames.length).toBe(b.frames.length);
    // Spot-check the full event stream matches.
    expect(a.events).toEqual(b.events);
  });

  it('different seeds generally diverge', () => {
    const results = [1, 2, 3].map((seed) =>
      simulateSpatialMatch(team('H', 70), team('A', 70), { ...SHORT, seed }),
    );
    const signatures = new Set(results.map((r) => `${r.finalScore[0]}-${r.finalScore[1]}:${r.events.length}`));
    // Not all three runs should be identical — the seed must actually matter.
    expect(signatures.size).toBeGreaterThan(1);
  });
});

describe('simulateSpatialMatch — structural invariants', () => {
  it('keeps the final score consistent with the goal events', () => {
    const r = simulateSpatialMatch(team('H', 72), team('A', 68), { ...SHORT, seed: 21 });
    const homeGoals = r.events.filter((e) => e.type === 'goal' && e.side === 'home').length;
    const awayGoals = r.events.filter((e) => e.type === 'goal' && e.side === 'away').length;
    expect(r.finalScore).toEqual([homeGoals, awayGoals]);
  });

  it('emits a kickoff event and tags every event with a 1–90 minute', () => {
    const r = simulateSpatialMatch(team('H', 70), team('A', 70), { ...SHORT, seed: 5 });
    expect(r.events[0]?.type).toBe('kickoff');
    for (const e of r.events) {
      expect(e.minute).toBeGreaterThanOrEqual(1);
      expect(e.minute).toBeLessThanOrEqual(90);
    }
  });

  it('keeps all 22 players and the ball within the pitch every frame', () => {
    const r = simulateSpatialMatch(team('H', 70), team('A', 70), { ...SHORT, seed: 8 });
    const EPS = 0.6; // allow a hair of overshoot on the tick a body hits a wall
    for (const frame of r.frames) {
      expect(frame.players).toHaveLength(22);
      for (const p of frame.players) {
        expect(p.x).toBeGreaterThanOrEqual(-EPS);
        expect(p.x).toBeLessThanOrEqual(PITCH_LENGTH + EPS);
        expect(p.y).toBeGreaterThanOrEqual(-EPS);
        expect(p.y).toBeLessThanOrEqual(PITCH_WIDTH + EPS);
      }
      expect(frame.ball.x).toBeGreaterThanOrEqual(-EPS);
      expect(frame.ball.x).toBeLessThanOrEqual(PITCH_LENGTH + EPS);
      expect(frame.ball.y).toBeGreaterThanOrEqual(-EPS);
      expect(frame.ball.y).toBeLessThanOrEqual(PITCH_WIDTH + EPS);
    }
  });

  it('samples frames at roughly the configured cadence', () => {
    // stoppage off so the frame count maps cleanly to the configured length.
    const r = simulateSpatialMatch(team('H', 70), team('A', 70), { matchSeconds: 600, frameEverySec: 1, seed: 3, stoppage: false });
    // 600s at 1 frame/sec ≈ 600 frames (+1 final).  Allow slack for the
    // boundary-crossing sampling logic.
    expect(r.frames.length).toBeGreaterThan(580);
    expect(r.frames.length).toBeLessThan(640);
  });

  it('plays deterministic stoppage time past 90:00, capped at ~6 min', () => {
    const withStop = simulateSpatialMatch(team('H', 70), team('A', 70), { ...FULL, seed: 7 });
    const noStop = simulateSpatialMatch(team('H', 70), team('A', 70), { ...FULL, seed: 7, stoppage: false });
    // Regulation is byte-identical; stoppage only appends extra ticks/events.
    expect(withStop.events.length).toBeGreaterThan(noStop.events.length);
    const maxMinute = Math.max(...withStop.events.map((e) => e.minute));
    expect(maxMinute).toBeGreaterThan(90);   // added time really plays
    expect(maxMinute).toBeLessThanOrEqual(96); // 90 + the 6-min clamp
    // Without stoppage the match ends in regulation.
    expect(Math.max(...noStop.events.map((e) => e.minute))).toBeLessThanOrEqual(90);
  });
});

describe('simulateSpatialMatch — emergent football', () => {
  it('produces goals across a full match population', () => {
    // Sum goals over several full matches; a working engine must score
    // SOMETHING.  Loose bounds avoid flakiness while catching a dead engine
    // (0 goals ever) or a broken one (absurd goal counts).  Explicit timeout
    // because a few full 90-minute sims (54k ticks each) exceed the 5s default.
    let totalGoals = 0;
    for (const seed of [10, 20, 30]) {
      const r = simulateSpatialMatch(team('H', 72), team('A', 68), { ...FULL, seed });
      totalGoals += r.finalScore[0] + r.finalScore[1];
    }
    expect(totalGoals).toBeGreaterThan(0);
    // Calibrated to ~5 goals/match; ceiling of 40 across 3 matches (avg <13)
    // guards against a runaway engine while tolerating a high-variance trio.
    expect(totalGoals).toBeLessThan(40);
  }, 30000);

  it('generates a varied event vocabulary, not just one type', () => {
    const r = simulateSpatialMatch(team('H', 70), team('A', 70), { ...FULL, seed: 50 });
    const kinds = new Set(r.events.map((e) => e.type));
    // A real flowing match touches several event kinds (passes, restarts, etc.).
    expect(kinds.size).toBeGreaterThanOrEqual(3);
  });
});

describe('simulateSpatialMatch — goal attribution (#522)', () => {
  // Build an id→side map and an adapter PlayerIndex straight from the fixtures.
  function sideOf(home: SpatialTeamInput, away: SpatialTeamInput): Map<string, 'home' | 'away'> {
    const m = new Map<string, 'home' | 'away'>();
    for (const p of home.players) m.set(p.id, 'home');
    for (const p of away.players) m.set(p.id, 'away');
    return m;
  }
  function indexOf(home: SpatialTeamInput, away: SpatialTeamInput): PlayerIndex {
    const m: PlayerIndex = new Map();
    for (const p of home.players) m.set(p.id, { id: p.id, name: p.name, teamName: 'Home', side: 'home' });
    for (const p of away.players) m.set(p.id, { id: p.id, name: p.name, teamName: 'Away', side: 'away' });
    return m;
  }

  it('credits every shot-goal to a player on the scoring side, and the adapter counts them', () => {
    // A lopsided fixture makes goals plentiful across a handful of full matches,
    // so the attribution assertions get real data without flaking on a 0-0.
    const home = team('H', 80);
    const away = team('A', 55);
    const sides = sideOf(home, away);

    let goalEvents = 0;
    let attributed = 0;
    let statGoals = 0;

    for (const seed of [10, 20, 30, 40]) {
      const r = simulateSpatialMatch(home, away, { ...FULL, seed });
      for (const g of r.events.filter((e) => e.type === 'goal')) {
        goalEvents++;
        if (g.playerId !== undefined) {
          attributed++;
          // The scorer must belong to the side credited with the goal — never the opponent.
          expect(sides.get(g.playerId)).toBe(g.side);
        }
      }
      // The adapter turns each attributed goal event into a +1 on that player's
      // goal tally; summing them must equal the number of attributed events.
      const adapted = adaptSpatialResult(r, indexOf(home, away));
      statGoals += Object.values(adapted.playerStats).reduce((sum, s) => sum + s.goals, 0);
    }

    // The engine scored, and the fix attributed those goals.  Before #522 every
    // goal event had no playerId, so `attributed` and `statGoals` would be 0 —
    // this is the regression guard.
    expect(goalEvents).toBeGreaterThan(0);
    expect(attributed).toBeGreaterThan(0);
    expect(statGoals).toBe(attributed);
  }, 60000);
});
