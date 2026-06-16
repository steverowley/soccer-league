// ── features/match/logic/spatial/formation.test.ts ───────────────────────────
// Unit tests for formation slot tables + the dynamic, ball-tracking anchor.

import { describe, it, expect } from 'vitest';
import {
  FORMATION_SLOTS, slotToAbsolute, narrowFormation, dynamicAnchor,
  type Formation,
} from './formation';
import { type SimPlayer, PITCH_LENGTH, PITCH_WIDTH } from './types';
import { vec } from './vec2';

const ALL_FORMATIONS: Formation[] = ['4-4-2', '4-5-1', '3-4-3', '5-4-1'];

describe('FORMATION_SLOTS', () => {
  it('every formation fields exactly 11 players with one keeper', () => {
    for (const f of ALL_FORMATIONS) {
      const slots = FORMATION_SLOTS[f];
      expect(slots).toHaveLength(11);
      expect(slots.filter((s) => s.role === 'GK')).toHaveLength(1);
    }
  });

  it('every slot fraction is within [0, 1]', () => {
    for (const f of ALL_FORMATIONS) {
      for (const s of FORMATION_SLOTS[f]) {
        expect(s.fx).toBeGreaterThanOrEqual(0);
        expect(s.fx).toBeLessThanOrEqual(1);
        expect(s.fy).toBeGreaterThanOrEqual(0);
        expect(s.fy).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('narrowFormation', () => {
  it('passes through supported keys', () => {
    for (const f of ALL_FORMATIONS) expect(narrowFormation(f)).toBe(f);
  });
  it('falls back to 4-4-2 for anything else', () => {
    expect(narrowFormation('weird')).toBe('4-4-2');
    expect(narrowFormation(null)).toBe('4-4-2');
    expect(narrowFormation(undefined)).toBe('4-4-2');
  });
});

describe('slotToAbsolute', () => {
  it('places the home keeper near x=0 and the away keeper near x=105', () => {
    const gk = { role: 'GK' as const, fx: 0.05, fy: 0.5 };
    const home = slotToAbsolute(gk, 'home');
    const away = slotToAbsolute(gk, 'away');
    // Home defends x=0 → small x; away defends x=105 → large x.
    expect(home.x).toBeLessThan(10);
    expect(away.x).toBeGreaterThan(PITCH_LENGTH - 10);
    // Both keepers sit centrally across the pitch.
    expect(home.y).toBeCloseTo(PITCH_WIDTH / 2);
    expect(away.y).toBeCloseTo(PITCH_WIDTH / 2);
  });

  it('mirrors a forward slot to the correct attacking half per side', () => {
    const fw = { role: 'FW' as const, fx: 0.76, fy: 0.5 };
    const home = slotToAbsolute(fw, 'home'); // attacks x=105 → large x
    const away = slotToAbsolute(fw, 'away'); // attacks x=0   → small x
    expect(home.x).toBeGreaterThan(PITCH_LENGTH / 2);
    expect(away.x).toBeLessThan(PITCH_LENGTH / 2);
  });
});

describe('dynamicAnchor', () => {
  // Build a minimal home midfielder whose home slot is at the halfway line.
  const mf: SimPlayer = {
    id: 'm', name: 'M', role: 'MF', side: 'home',
    stats: {
      shooting: 60, passing: 60, dribbling: 60, speed: 60, stamina: 60,
      tackling: 60, positioning: 60, goalkeeping: 60, vision: 60,
    },
    homePos: vec(PITCH_LENGTH / 2, PITCH_WIDTH / 2),
    maxSpeed: 8, pos: vec(0, 0), vel: vec(0, 0), stamina: 1,
    yellowCards: 0, sentOff: false,
  };

  it('pushes the home block forward when the ball is in the attacking third', () => {
    const deep = dynamicAnchor(mf, vec(20, 34));  // ball near home's own goal
    const high = dynamicAnchor(mf, vec(90, 34));   // ball near opponent goal
    // With the ball advanced, the midfielder's anchor sits further upfield.
    expect(high.x).toBeGreaterThan(deep.x);
  });

  it('keeps the anchor inside the pitch', () => {
    for (const bx of [0, 52, 105]) {
      for (const by of [0, 34, 68]) {
        const a = dynamicAnchor(mf, vec(bx, by));
        expect(a.x).toBeGreaterThanOrEqual(0);
        expect(a.x).toBeLessThanOrEqual(PITCH_LENGTH);
        expect(a.y).toBeGreaterThanOrEqual(0);
        expect(a.y).toBeLessThanOrEqual(PITCH_WIDTH);
      }
    }
  });
});
