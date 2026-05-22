// ── choreographer.test.ts ──────────────────────────────────────────────────
// Unit tests for the pure archetype choreographer.
//
// COVERAGE
//   • Determinism: identical inputs → identical keyframes.
//   • Bounds: every emitted x/y stays in [0..1].
//   • Archetype invariants:
//       - GOAL_CELEBRATION never displaces either keeper toward midfield.
//       - SHOT_ATTEMPT pushes the ball + shooter toward the attacking
//         goal (x near 0.90 for home, 0.10 for away).
//       - PENALTY_TAKE puts the ball exactly on the penalty spot.
//       - SET_PIECE_PREP moves the ball to a corner-area coordinate.
//       - STOPPAGE produces zero keyframes (caller's idle drift fills).
//       - RESTART recentres the ball at (0.5, 0.5).
//       - DEFENSIVE_ACTION pulls the defender backward (toward own goal).
//       - Total animation budget never exceeds ARCHETYPE_BUDGET_MS.
//   • eventSeed: deterministic + stable across calls.
//   • mulberry32: returns [0, 1).

import { describe, expect, it } from 'vitest';

import {
  ARCHETYPE_BUDGET_MS,
  choreographArchetype,
  eventSeed,
  mulberry32,
  type Keyframe,
} from './choreographer';
import { initPitchState, type PitchState } from './pitchState';

// ── Fixture helpers ────────────────────────────────────────────────────────

const HOME_IDS = Array.from({ length: 11 }, (_, i) => `home-${i}`);
const AWAY_IDS = Array.from({ length: 11 }, (_, i) => `away-${i}`);

/** Build a fresh PitchState seeded with default 4-4-2 / 4-4-2 formations. */
function makeState(): PitchState {
  return initPitchState({
    homeFormation: '4-4-2',
    awayFormation: '4-4-2',
    homePlayerIds: HOME_IDS,
    awayPlayerIds: AWAY_IDS,
  });
}

/** Convenience: assert every keyframe's positions + ball stay in [0..1]. */
function expectInBounds(frames: Keyframe[]) {
  for (const f of frames) {
    for (const pos of f.positions.values()) {
      expect(pos.x).toBeGreaterThanOrEqual(0);
      expect(pos.x).toBeLessThanOrEqual(1);
      expect(pos.y).toBeGreaterThanOrEqual(0);
      expect(pos.y).toBeLessThanOrEqual(1);
    }
    if (f.ball) {
      expect(f.ball.x).toBeGreaterThanOrEqual(0);
      expect(f.ball.x).toBeLessThanOrEqual(1);
      expect(f.ball.y).toBeGreaterThanOrEqual(0);
      expect(f.ball.y).toBeLessThanOrEqual(1);
    }
  }
}

// ── Determinism ─────────────────────────────────────────────────────────────

describe('choreographArchetype — determinism', () => {
  it('produces identical keyframes for identical (state, archetype, payload, rng) inputs', () => {
    const state = makeState();
    const a = choreographArchetype(state, 'ATTACK_BUILDUP', { team: 'home' }, mulberry32(42));
    const b = choreographArchetype(state, 'ATTACK_BUILDUP', { team: 'home' }, mulberry32(42));
    // Maps don't deep-equal natively under .toEqual; convert to arrays.
    const norm = (frames: Keyframe[]) => frames.map(f => ({
      atMs:      f.atMs,
      positions: [...f.positions.entries()].sort(),
      ball:      f.ball,
    }));
    expect(norm(a)).toEqual(norm(b));
  });

  it('differs when the RNG seed differs (jitter is wired)', () => {
    const state = makeState();
    const a = choreographArchetype(state, 'ATTACK_BUILDUP', { team: 'home' }, mulberry32(1));
    const b = choreographArchetype(state, 'ATTACK_BUILDUP', { team: 'home' }, mulberry32(99));
    // At least one position should differ — jitter is amplitude 0.015 so
    // with seed 1 vs 99 we expect at least one x or y to disagree.
    const flatA = a.flatMap(f => [...f.positions.values()].map(p => p.x + p.y));
    const flatB = b.flatMap(f => [...f.positions.values()].map(p => p.x + p.y));
    expect(flatA).not.toEqual(flatB);
  });

  it('is pure — does not mutate the input state', () => {
    const state = makeState();
    const snapshot = JSON.stringify(state);
    choreographArchetype(state, 'SHOT_ATTEMPT', { team: 'home' }, mulberry32(7));
    choreographArchetype(state, 'GOAL_CELEBRATION', { team: 'away' }, mulberry32(7));
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});

// ── Bounds clamping ─────────────────────────────────────────────────────────

describe('choreographArchetype — bounds', () => {
  const ALL_ARCHETYPES = [
    'ATTACK_BUILDUP',
    'SHOT_ATTEMPT',
    'SET_PIECE_PREP',
    'PENALTY_TAKE',
    'DEFENSIVE_ACTION',
    'GOAL_CELEBRATION',
    'STOPPAGE',
    'RESTART',
  ] as const;

  it.each(ALL_ARCHETYPES)('keeps positions in [0..1] for %s (home)', (archetype) => {
    const frames = choreographArchetype(
      makeState(),
      archetype,
      { team: 'home' },
      mulberry32(1234),
    );
    expectInBounds(frames);
  });

  it.each(ALL_ARCHETYPES)('keeps positions in [0..1] for %s (away)', (archetype) => {
    const frames = choreographArchetype(
      makeState(),
      archetype,
      { team: 'away' },
      mulberry32(5678),
    );
    expectInBounds(frames);
  });

  it.each(ALL_ARCHETYPES)('every keyframe atMs fits in the budget for %s', (archetype) => {
    const frames = choreographArchetype(
      makeState(),
      archetype,
      { team: 'home' },
      mulberry32(0),
    );
    for (const f of frames) {
      expect(f.atMs).toBeGreaterThanOrEqual(0);
      expect(f.atMs).toBeLessThanOrEqual(ARCHETYPE_BUDGET_MS);
    }
  });
});

// ── Archetype-specific invariants ───────────────────────────────────────────

describe('choreographArchetype — SHOT_ATTEMPT', () => {
  it('drives the ball toward the attacking goal for home', () => {
    const [frame] = choreographArchetype(makeState(), 'SHOT_ATTEMPT', { team: 'home' }, mulberry32(1));
    expect(frame?.ball?.x).toBeGreaterThan(0.8);
  });

  it('drives the ball toward the attacking goal for away', () => {
    const [frame] = choreographArchetype(makeState(), 'SHOT_ATTEMPT', { team: 'away' }, mulberry32(1));
    expect(frame?.ball?.x).toBeLessThan(0.2);
  });
});

describe('choreographArchetype — PENALTY_TAKE', () => {
  it('puts the ball on the penalty spot (x≈0.88 home, 0.12 away; y=0.5)', () => {
    const [home] = choreographArchetype(makeState(), 'PENALTY_TAKE', { team: 'home' }, mulberry32(0));
    expect(home?.ball?.x).toBeCloseTo(0.88, 2);
    expect(home?.ball?.y).toBeCloseTo(0.5, 2);
    const [away] = choreographArchetype(makeState(), 'PENALTY_TAKE', { team: 'away' }, mulberry32(0));
    expect(away?.ball?.x).toBeCloseTo(0.12, 2);
    expect(away?.ball?.y).toBeCloseTo(0.5, 2);
  });
});

describe('choreographArchetype — SET_PIECE_PREP', () => {
  it('moves the ball to a corner-area coordinate', () => {
    const [frame] = choreographArchetype(makeState(), 'SET_PIECE_PREP', { team: 'home' }, mulberry32(0));
    expect(frame?.ball?.x).toBeGreaterThan(0.8);
    expect(frame?.ball?.y).toBeGreaterThan(0.8);
  });

  it('mirrors x for away', () => {
    const [frame] = choreographArchetype(makeState(), 'SET_PIECE_PREP', { team: 'away' }, mulberry32(0));
    expect(frame?.ball?.x).toBeLessThan(0.2);
  });
});

describe('choreographArchetype — GOAL_CELEBRATION', () => {
  /**
   * Keeper-stays-in-box invariant: neither side's goalkeeper should
   * appear in the positions map (they should remain at their slot).
   * The slot index for the goalkeeper is 0 in our formation tables.
   */
  it('never displaces either keeper', () => {
    const state = makeState();
    const homeKeeperId = state.players.find(p => p.side === 'home' && p.slotIndex === 0)!.id;
    const awayKeeperId = state.players.find(p => p.side === 'away' && p.slotIndex === 0)!.id;
    const frames = choreographArchetype(state, 'GOAL_CELEBRATION', { team: 'home' }, mulberry32(1));
    for (const f of frames) {
      expect(f.positions.has(homeKeeperId)).toBe(false);
      expect(f.positions.has(awayKeeperId)).toBe(false);
    }
  });

  it('returns the ball to centre on the second keyframe (restart prep)', () => {
    const frames = choreographArchetype(makeState(), 'GOAL_CELEBRATION', { team: 'home' }, mulberry32(1));
    expect(frames.length).toBeGreaterThanOrEqual(2);
    const last = frames[frames.length - 1]!;
    expect(last.ball?.x).toBeCloseTo(0.5, 2);
    expect(last.ball?.y).toBeCloseTo(0.5, 2);
  });
});

describe('choreographArchetype — STOPPAGE', () => {
  it('produces no keyframes — caller continues idle drift', () => {
    expect(choreographArchetype(makeState(), 'STOPPAGE', {}, mulberry32(0))).toEqual([]);
  });
});

describe('choreographArchetype — RESTART', () => {
  it('returns the ball to the centre spot', () => {
    const [frame] = choreographArchetype(makeState(), 'RESTART', { team: 'home' }, mulberry32(0));
    expect(frame?.ball?.x).toBe(0.5);
    expect(frame?.ball?.y).toBe(0.5);
  });
});

describe('choreographArchetype — DEFENSIVE_ACTION', () => {
  it('pulls the defender BACKWARD (toward their own goal) for home', () => {
    const state = makeState();
    const defenderBefore = state.players
      .filter(p => p.side === 'home')
      .sort((a, b) => a.x - b.x)[0]!; // deepest home defender (lowest x).
    const [frame] = choreographArchetype(state, 'DEFENSIVE_ACTION', { team: 'home' }, mulberry32(0));
    const updated = frame?.positions.get(defenderBefore.id);
    if (updated) {
      expect(updated.x).toBeLessThanOrEqual(defenderBefore.x + 0.02);
    }
  });
});

// ── eventSeed + mulberry32 ──────────────────────────────────────────────────

describe('eventSeed', () => {
  it('is deterministic for the same input string', () => {
    expect(eventSeed('abc-123')).toBe(eventSeed('abc-123'));
  });

  it('produces a 32-bit unsigned integer', () => {
    const seed = eventSeed('00000000-0000-0000-0000-000000000001');
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThanOrEqual(0xffffffff);
  });

  it('differs across distinct strings', () => {
    expect(eventSeed('a')).not.toBe(eventSeed('b'));
  });
});

describe('mulberry32', () => {
  it('returns values strictly in [0, 1)', () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('is seedable — same seed yields same sequence', () => {
    const a = mulberry32(1);
    const b = mulberry32(1);
    for (let i = 0; i < 10; i++) expect(a()).toBe(b());
  });
});
