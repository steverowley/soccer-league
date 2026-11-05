// ── features/match/logic/viewer/animation.ts ────────────────────────────────
// The stride of a Charming figure (docs/match-viewer.md section 6), as pure
// math.  No React, no canvas: the component advances each player's stride
// with real elapsed time and the renderer reads it.
//
// HOW A FIGURE MOVES
//   - `run` (0..1) says how hard he is running, from his MEASURED ground speed
//     in the match (game metres per game second), so the gait tells the
//     truth whatever the playback speed.
//   - The stride phase advances in REAL seconds, faster the harder he runs;
//     the legs swing on sin(phase), the arms' springs swing with them, and
//     each half cycle is a footfall (a 1 px bounce and a jolt to the arms).
//   - Standing, the phase stops and he breathes (the renderer's slow bob).

/** Ground speed (game m/s) at which a player counts as running flat out. */
export const FULL_RUN_MPS = 6;
/** Below this `run`, the stride stops (he stands and breathes). */
export const STRIDE_MIN_RUN = 0.08;
/** Stride cycles per real second at a jog, and the extra at full speed. */
const STRIDE_HZ_BASE = 1.6;
const STRIDE_HZ_RUN = 1.6;

/**
 * How hard he is running, 0..1, from his ground speed.
 *
 * @param speedMps  Ground speed in metres per game second.
 */
export function runAmount(speedMps: number): number {
  const r = speedMps / FULL_RUN_MPS;
  return r <= 0 || !Number.isFinite(r) ? 0 : r >= 1 ? 1 : r;
}

/**
 * Advance a stride phase by one frame of real time.
 *
 * @param phase  Current phase (radians).
 * @param run    How hard he is running (0..1).
 * @param dtSec  Real seconds since the last frame.
 * @returns      The new phase (unchanged while he stands).
 */
export function advanceStride(phase: number, run: number, dtSec: number): number {
  if (run <= STRIDE_MIN_RUN || !(dtSec > 0)) return phase;
  return phase + dtSec * 2 * Math.PI * (STRIDE_HZ_BASE + STRIDE_HZ_RUN * run);
}

/**
 * Footfalls come every half cycle: true when a foot landed between two phases.
 *
 * @param prev  Phase last frame.
 * @param next  Phase this frame.
 */
export function footfall(prev: number, next: number): boolean {
  return Math.floor(next / Math.PI) !== Math.floor(prev / Math.PI);
}

/** A figure's gait for this frame: what the renderer swings the legs with. */
export interface Gait {
  /** Stride phase (radians). */
  phase: number;
  /** How hard he is running, 0..1. */
  run: number;
}

/** Standing still (reduced motion, the rest state). */
export const STANDING: Gait = { phase: 0, run: 0 };
