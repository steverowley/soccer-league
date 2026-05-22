// ── formations.test.ts ─────────────────────────────────────────────────────
// Verifies the formation slot tables and the mirroring + fallback rules.

import { describe, it, expect } from 'vitest';

import {
  FORMATIONS,
  type FormationKey,
  getFormationSlots,
  isFormationKey,
} from './formations';

describe('isFormationKey', () => {
  it('accepts every documented formation', () => {
    for (const k of FORMATIONS) expect(isFormationKey(k)).toBe(true);
  });
  it('rejects unknown values', () => {
    expect(isFormationKey('4-2-4')).toBe(false);
    expect(isFormationKey('')).toBe(false);
    expect(isFormationKey('432')).toBe(false);
  });
});

describe('getFormationSlots — shape invariants', () => {
  it.each(FORMATIONS)('returns 11 slots for %s', (key) => {
    expect(getFormationSlots(key, 'home')).toHaveLength(11);
    expect(getFormationSlots(key, 'away')).toHaveLength(11);
  });

  it.each(FORMATIONS)('every slot of %s sits in [0..1] on both axes', (key) => {
    for (const p of getFormationSlots(key, 'home')) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1);
    }
  });

  it('places the goalkeeper at slot 0 with the smallest x', () => {
    // GK should be the deepest player on the home side.
    for (const k of FORMATIONS) {
      const slots = getFormationSlots(k, 'home');
      const gk = slots[0]!;
      for (let i = 1; i < slots.length; i++) {
        expect(gk.x).toBeLessThanOrEqual(slots[i]!.x);
      }
    }
  });
});

describe('getFormationSlots — fallback', () => {
  it('falls back to 4-4-2 for unknown keys', () => {
    const unknown = getFormationSlots('1-1-1-7', 'home');
    const fourfourtwo = getFormationSlots('4-4-2', 'home');
    expect(unknown).toEqual(fourfourtwo);
  });
  it('falls back to 4-4-2 for empty key', () => {
    const empty = getFormationSlots('', 'home');
    const fourfourtwo = getFormationSlots('4-4-2', 'home');
    expect(empty).toEqual(fourfourtwo);
  });
});

describe('getFormationSlots — away mirroring', () => {
  it.each(FORMATIONS)('mirrors x→(1-x) for %s when side is away', (key) => {
    const home = getFormationSlots(key, 'home');
    const away = getFormationSlots(key, 'away');
    for (let i = 0; i < 11; i++) {
      expect(away[i]!.x).toBeCloseTo(1 - home[i]!.x, 10);
      // y is preserved — only the long axis flips.
      expect(away[i]!.y).toBeCloseTo(home[i]!.y, 10);
    }
  });

  it('away GK sits at x close to 1 (deep on the opposite side)', () => {
    const away442 = getFormationSlots('4-4-2', 'away');
    expect(away442[0]!.x).toBeGreaterThan(0.9);
  });
});

describe('getFormationSlots — immutability', () => {
  it('mutating the returned array does not affect a second call', () => {
    const a = getFormationSlots('4-4-2', 'home');
    a[0]!.x = 999;
    a[0]!.y = 999;
    const b = getFormationSlots('4-4-2', 'home');
    expect(b[0]!.x).not.toBe(999);
    expect(b[0]!.y).not.toBe(999);
  });
});

describe('FORMATIONS list', () => {
  it('exposes exactly the four supported formations', () => {
    // Pin the list so a future addition shows up here and the rest of
    // the suite can it.each across the canonical set.
    expect([...FORMATIONS]).toEqual<FormationKey[]>(['4-4-2', '3-4-3', '4-5-1', '5-4-1']);
  });
});
