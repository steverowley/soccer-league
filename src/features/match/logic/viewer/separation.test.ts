// ── separation.test.ts ──────────────────────────────────────────────────────
// Verifies the render-time de-overlap: clustered points end up apart, already-
// spread points are left alone, exact overlaps split deterministically, and
// everything stays on the pitch.

import { describe, it, expect } from 'vitest';

import {
  separatePositions,
  SEPARATION_MIN_DIST,
  type SepPoint,
} from './separation';

/** Smallest pairwise distance in a set of points. */
function minPairDist(pts: SepPoint[]): number {
  let m = Infinity;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      m = Math.min(m, Math.hypot(pts[i]!.x - pts[j]!.x, pts[i]!.y - pts[j]!.y));
    }
  }
  return m;
}

describe('separatePositions', () => {
  it('pushes a tight cluster apart toward the minimum distance', () => {
    const pts: SepPoint[] = [
      { x: 50, y: 34 },
      { x: 50.3, y: 34.1 },
      { x: 49.8, y: 33.9 },
      { x: 50.1, y: 34.2 },
    ];
    expect(minPairDist(pts)).toBeLessThan(1);
    separatePositions(pts);
    // After a few passes the closest pair is much further apart (near minDist).
    expect(minPairDist(pts)).toBeGreaterThan(SEPARATION_MIN_DIST * 0.6);
  });

  it('leaves already-separated points effectively unchanged', () => {
    const pts: SepPoint[] = [
      { x: 10, y: 10 },
      { x: 40, y: 50 },
      { x: 90, y: 20 },
    ];
    const before = pts.map((p) => ({ ...p }));
    separatePositions(pts);
    pts.forEach((p, i) => {
      expect(p.x).toBeCloseTo(before[i]!.x, 6);
      expect(p.y).toBeCloseTo(before[i]!.y, 6);
    });
  });

  it('splits two exactly-overlapping points deterministically', () => {
    const a: SepPoint[] = [{ x: 52, y: 34 }, { x: 52, y: 34 }];
    const b: SepPoint[] = [{ x: 52, y: 34 }, { x: 52, y: 34 }];
    separatePositions(a);
    separatePositions(b);
    expect(minPairDist(a)).toBeGreaterThan(0);
    expect(a).toEqual(b); // same input ⇒ same split, no flicker
  });

  it('keeps all points on the pitch', () => {
    const pts: SepPoint[] = [
      { x: 0, y: 0 },
      { x: 0.2, y: 0.2 },
      { x: 105, y: 68 },
      { x: 104.8, y: 67.8 },
    ];
    separatePositions(pts);
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(105);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(68);
    }
  });
});
