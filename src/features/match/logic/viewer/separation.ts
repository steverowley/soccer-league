// ── features/match/logic/viewer/separation.ts ───────────────────────────────
// Render-time de-overlap for the viewer's little dudes.
//
// WHY (and why HERE, not in the engine)
//   Real matches genuinely bunch players around the ball, so their stored
//   positions overlap — fine for the simulation, but the sprites then sit on top
//   of each other and the pitch is hard to read.  Per the viewer's core rule
//   ("the draw step never changes the simulation"), we fix this purely at render
//   time: nudge clustered sprites apart for drawing while leaving the match data
//   untouched (tactically the players are still where the engine put them).

import { PITCH_LENGTH, PITCH_WIDTH } from '../spatial/types';

/** A mutable metre-space point the separation pass adjusts in place. */
export interface SepPoint {
  x: number;
  y: number;
}

/**
 * Minimum centre-to-centre gap (metres) between two drawn dudes.  ~2.6m is a hair
 * wider than a broadcast-camera sprite's on-pitch footprint, so a tight cluster
 * stops overlapping without visibly distorting the tactical shape (a player moves
 * at most ~1.3m for legibility).
 */
export const SEPARATION_MIN_DIST = 2.6;

/** Relaxation passes per frame.  4 resolves a dense ball-scramble; trivial at n=22. */
export const SEPARATION_ITERATIONS = 4;

/**
 * Push apart, in place, any points closer than `minDist`, over a few relaxation
 * passes.  Each overlapping pair is separated SYMMETRICALLY (both move half the
 * overlap) so the result is stable frame-to-frame as inputs drift smoothly;
 * exact/near overlaps get a small deterministic nudge (derived from the indices)
 * to break symmetry without flicker.  Points are clamped back onto the pitch.
 *
 * O(n²) — with n = 22 dudes that's ~480 pairs × `iterations`, negligible.
 *
 * @param pts        Points to de-overlap (mutated in place).
 * @param minDist    Minimum allowed centre distance in metres.
 * @param iterations Number of relaxation passes.
 */
export function separatePositions(
  pts: SepPoint[],
  minDist = SEPARATION_MIN_DIST,
  iterations = SEPARATION_ITERATIONS,
): void {
  const min2 = minDist * minDist;
  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i]!;
        const b = pts[j]!;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min2) continue;
        let d = Math.sqrt(d2);
        if (d < 1e-4) {
          // Exact overlap: nudge along a deterministic angle from the pair's
          // indices so two stacked dudes split apart the same way every frame.
          const ang = (i * 7 + j * 13) * 0.3;
          dx = Math.cos(ang);
          dy = Math.sin(ang);
          d = 1;
        }
        const push = (minDist - d) / 2;
        const ux = dx / d;
        const uy = dy / d;
        a.x -= ux * push;
        a.y -= uy * push;
        b.x += ux * push;
        b.y += uy * push;
      }
    }
    // Keep everyone on the pitch after each pass.
    for (const p of pts) {
      if (p.x < 0) p.x = 0;
      else if (p.x > PITCH_LENGTH) p.x = PITCH_LENGTH;
      if (p.y < 0) p.y = 0;
      else if (p.y > PITCH_WIDTH) p.y = PITCH_WIDTH;
    }
  }
}
