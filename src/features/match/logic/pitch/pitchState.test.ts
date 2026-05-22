// ── pitchState.test.ts ─────────────────────────────────────────────────────
// Verifies idle-drift convergence + initialisation invariants.

import { describe, it, expect } from 'vitest';

import { getFormationSlots } from './formations';
import {
  IDLE_DRIFT_EPSILON,
  IDLE_DRIFT_RATE,
  idleDriftStep,
  initPitchState,
  type PitchState,
} from './pitchState';

/**
 * 11 stable ids matching the formation slot order (GK ... ST).
 */
const HOME_IDS = Array.from({ length: 11 }, (_, i) => `home-${i}`);
const AWAY_IDS = Array.from({ length: 11 }, (_, i) => `away-${i}`);

// ── initPitchState ──────────────────────────────────────────────────────────

describe('initPitchState', () => {
  it('places 22 players (11 home + 11 away) at their formation slots', () => {
    const s = initPitchState({
      homeFormation: '4-4-2',
      awayFormation: '3-4-3',
      homePlayerIds: HOME_IDS,
      awayPlayerIds: AWAY_IDS,
    });
    expect(s.players).toHaveLength(22);
    expect(s.players.filter(p => p.side === 'home')).toHaveLength(11);
    expect(s.players.filter(p => p.side === 'away')).toHaveLength(11);

    const homeSlots = getFormationSlots('4-4-2', 'home');
    const awaySlots = getFormationSlots('3-4-3', 'away');
    for (const p of s.players) {
      const target = p.side === 'home' ? homeSlots[p.slotIndex] : awaySlots[p.slotIndex];
      expect(p.x).toBeCloseTo(target!.x);
      expect(p.y).toBeCloseTo(target!.y);
    }
  });

  it('initialises ball at the centre spot', () => {
    const s = initPitchState({
      homeFormation: '4-4-2',
      awayFormation: '4-4-2',
      homePlayerIds: HOME_IDS,
      awayPlayerIds: AWAY_IDS,
    });
    expect(s.ball).toEqual({ x: 0.5, y: 0.5 });
  });

  it('throws when a player-id list is the wrong length', () => {
    expect(() =>
      initPitchState({
        homeFormation: '4-4-2',
        awayFormation: '4-4-2',
        homePlayerIds: ['just-one'],
        awayPlayerIds: AWAY_IDS,
      }),
    ).toThrow(/exactly 11/);
  });
});

// ── idleDriftStep ───────────────────────────────────────────────────────────

describe('idleDriftStep', () => {
  /**
   * Helper — displace one player to (0.9, 0.9) so the drift has work
   * to do; everything else starts at slot.
   */
  function makeStateWithOneDisplacement(): PitchState {
    const base = initPitchState({
      homeFormation: '4-4-2',
      awayFormation: '4-4-2',
      homePlayerIds: HOME_IDS,
      awayPlayerIds: AWAY_IDS,
    });
    const players = base.players.map((p, i) =>
      i === 0 ? { ...p, x: 0.9, y: 0.9 } : p,
    );
    return { ...base, players };
  }

  it('moves each tick by IDLE_DRIFT_RATE × remaining gap', () => {
    const s0 = makeStateWithOneDisplacement();
    const gkSlot = getFormationSlots('4-4-2', 'home')[0]!;
    const s1 = idleDriftStep(s0);
    const before = s0.players[0]!;
    const after  = s1.players[0]!;
    const expectedX = before.x + (gkSlot.x - before.x) * IDLE_DRIFT_RATE;
    const expectedY = before.y + (gkSlot.y - before.y) * IDLE_DRIFT_RATE;
    expect(after.x).toBeCloseTo(expectedX, 8);
    expect(after.y).toBeCloseTo(expectedY, 8);
  });

  it('converges to within IDLE_DRIFT_EPSILON of the slot after N ticks', () => {
    const gkSlot = getFormationSlots('4-4-2', 'home')[0]!;
    let s = makeStateWithOneDisplacement();
    // 60 ticks should be plenty given drift rate 0.15 (each tick
    // closes 15% of the gap — after 25 the gap is ~2% of original,
    // after 60 it's < 1e-4).
    for (let i = 0; i < 60; i++) s = idleDriftStep(s);
    const gk = s.players[0]!;
    expect(Math.abs(gk.x - gkSlot.x)).toBeLessThan(IDLE_DRIFT_EPSILON);
    expect(Math.abs(gk.y - gkSlot.y)).toBeLessThan(IDLE_DRIFT_EPSILON);
  });

  it('snaps EXACTLY to the slot once within epsilon (no float-noise jitter)', () => {
    const gkSlot = getFormationSlots('4-4-2', 'home')[0]!;
    let s = makeStateWithOneDisplacement();
    for (let i = 0; i < 200; i++) s = idleDriftStep(s);
    expect(s.players[0]!.x).toBe(gkSlot.x);
    expect(s.players[0]!.y).toBe(gkSlot.y);
  });

  it('is a no-op at the converged state (idempotent under repeated calls)', () => {
    const base = initPitchState({
      homeFormation: '4-4-2',
      awayFormation: '4-4-2',
      homePlayerIds: HOME_IDS,
      awayPlayerIds: AWAY_IDS,
    });
    const once = idleDriftStep(base);
    const twice = idleDriftStep(once);
    expect(twice).toEqual(once);
  });

  it('drifts the ball back to the centre spot when displaced', () => {
    const base = initPitchState({
      homeFormation: '4-4-2',
      awayFormation: '4-4-2',
      homePlayerIds: HOME_IDS,
      awayPlayerIds: AWAY_IDS,
    });
    let s = { ...base, ball: { x: 0.1, y: 0.1 } };
    for (let i = 0; i < 60; i++) s = idleDriftStep(s);
    expect(Math.abs(s.ball.x - 0.5)).toBeLessThan(IDLE_DRIFT_EPSILON);
    expect(Math.abs(s.ball.y - 0.5)).toBeLessThan(IDLE_DRIFT_EPSILON);
  });

  it('does not mutate the input state', () => {
    const s0 = makeStateWithOneDisplacement();
    const beforeSnapshot = JSON.stringify(s0);
    idleDriftStep(s0);
    expect(JSON.stringify(s0)).toBe(beforeSnapshot);
  });
});
