// ── hitTest.test.ts ─────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';

import { pickNearestId, type HitTarget } from './hitTest';

const targets: HitTarget[] = [
  { id: 'a', sx: 10, sy: 10 },
  { id: 'b', sx: 50, sy: 50 },
  { id: 'c', sx: 51, sy: 52 },
];

describe('pickNearestId', () => {
  it('returns the nearest target within range', () => {
    expect(pickNearestId(targets, 12, 11, 12)).toBe('a');
  });

  it('picks the closest when several are in range', () => {
    // (50,51) is closer to b(50,50) than c(51,52)
    expect(pickNearestId(targets, 50, 51, 12)).toBe('b');
  });

  it('returns null when the click missed everything', () => {
    expect(pickNearestId(targets, 200, 200, 12)).toBeNull();
  });

  it('returns null for an empty target list', () => {
    expect(pickNearestId([], 10, 10, 12)).toBeNull();
  });

  it('respects the max distance exactly', () => {
    expect(pickNearestId([{ id: 'x', sx: 0, sy: 0 }], 10, 0, 10)).toBe('x'); // exactly on the edge
    expect(pickNearestId([{ id: 'x', sx: 0, sy: 0 }], 11, 0, 10)).toBeNull();
  });
});
