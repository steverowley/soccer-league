// ── features/match/logic/spatial/vec2.test.ts ────────────────────────────────
// Unit tests for the 2D vector primitives.  These underpin every steering and
// physics calculation, so edge cases (zero-length normalize, magnitude clamp)
// matter — a NaN here would silently poison an entire match.

import { describe, it, expect } from 'vitest';
import {
  vec, add, sub, scale, len, len2, dist, dist2, normalize, truncate, dot, lerp, clampToBox, ZERO,
} from './vec2';

describe('vec2 arithmetic', () => {
  it('adds, subtracts, and scales componentwise', () => {
    expect(add(vec(1, 2), vec(3, 4))).toEqual({ x: 4, y: 6 });
    expect(sub(vec(5, 5), vec(2, 1))).toEqual({ x: 3, y: 4 });
    expect(scale(vec(2, -3), 2)).toEqual({ x: 4, y: -6 });
  });

  it('computes length and squared length', () => {
    expect(len(vec(3, 4))).toBe(5);
    expect(len2(vec(3, 4))).toBe(25);
  });

  it('computes distance between points', () => {
    expect(dist(vec(0, 0), vec(3, 4))).toBe(5);
    expect(dist2(vec(0, 0), vec(3, 4))).toBe(25);
  });

  it('dot product follows the standard definition', () => {
    expect(dot(vec(1, 0), vec(0, 1))).toBe(0);
    expect(dot(vec(2, 3), vec(4, 5))).toBe(23);
  });
});

describe('vec2 normalize', () => {
  it('returns a unit vector for non-zero input', () => {
    const n = normalize(vec(0, 5));
    expect(n.x).toBeCloseTo(0);
    expect(n.y).toBeCloseTo(1);
    expect(len(n)).toBeCloseTo(1);
  });

  it('returns ZERO (not NaN) for a zero-length input', () => {
    expect(normalize(ZERO)).toEqual({ x: 0, y: 0 });
  });
});

describe('vec2 truncate', () => {
  it('leaves a short vector unchanged', () => {
    expect(truncate(vec(1, 0), 5)).toEqual({ x: 1, y: 0 });
  });

  it('caps a long vector to maxLen, preserving direction', () => {
    const t = truncate(vec(10, 0), 4);
    expect(t.x).toBeCloseTo(4);
    expect(t.y).toBeCloseTo(0);
    expect(len(t)).toBeCloseTo(4);
  });

  it('returns ZERO for a non-positive cap', () => {
    expect(truncate(vec(3, 4), 0)).toEqual({ x: 0, y: 0 });
  });
});

describe('vec2 lerp + clampToBox', () => {
  it('lerps between endpoints', () => {
    expect(lerp(vec(0, 0), vec(10, 20), 0.5)).toEqual({ x: 5, y: 10 });
    expect(lerp(vec(0, 0), vec(10, 20), 0)).toEqual({ x: 0, y: 0 });
    expect(lerp(vec(0, 0), vec(10, 20), 1)).toEqual({ x: 10, y: 20 });
  });

  it('clamps a point into the box', () => {
    expect(clampToBox(vec(-5, 50), 0, 0, 105, 68)).toEqual({ x: 0, y: 50 });
    expect(clampToBox(vec(200, -3), 0, 0, 105, 68)).toEqual({ x: 105, y: 0 });
    expect(clampToBox(vec(50, 30), 0, 0, 105, 68)).toEqual({ x: 50, y: 30 });
  });
});
