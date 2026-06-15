// ── features/match/logic/viewer/animation.ts ────────────────────────────────
// The Tiny-Terraces motion recipe, as pure math.  No React, no canvas — the
// renderer calls these to size the bob, squash/stretch and limb flail of each
// little dude, frame by frame.
//
// THE FOUR CHEAP TRICKS (the charm is in the MOTION, not the art):
//   1. Hop/bob      — the whole body rides |sin(phase)| up and down.
//   2. Squash&stretch — synced to the hop: taller+thinner at the top of the
//                       hop, shorter+wider on landing.
//   3. Limb flail   — legs scissor and arms whip on cos(phase), opposite phase.
//   4. (shadow + facing live in the renderer; they need no per-frame math.)
//
// State (idle/walk/run) is derived from MEASURED speed, not AI intent, so the
// animation always tells the truth about what the body is doing.

// ── Animation state ─────────────────────────────────────────────────────────

/** Coarse gait, derived from a player's measured ground speed. */
export type AnimState = 'idle' | 'walk' | 'run';

/** Below this game-speed (m/s) a player reads as standing → idle bob only. */
export const WALK_SPEED_MPS = 0.4;
/** At/above this game-speed (m/s) a player reads as sprinting → full run cycle. */
export const RUN_SPEED_MPS = 3.2;

/**
 * Classify gait from speed in game-metres/second (the player's real running
 * speed in the match, NOT the compressed on-screen speed — so thresholds stay
 * stable regardless of how fast the viewer replays the match).
 *
 * @param speedMps  Ground speed in metres per game-second.
 * @returns         'idle' | 'walk' | 'run'.
 */
export function animStateFromSpeed(speedMps: number): AnimState {
  if (speedMps < WALK_SPEED_MPS) return 'idle';
  if (speedMps < RUN_SPEED_MPS) return 'walk';
  return 'run';
}

// ── Per-state tuning (the "feel" knobs) ──────────────────────────────────────

/**
 * Leg-cycle rate in radians/second, advanced by REAL elapsed time (not per
 * frame) so the cadence is the same on a 30 Hz or 144 Hz display.  ~15 rad/s at
 * a run = ~2.4 hops/sec: a peppy scamper, not a 60 fps spaz.
 */
export const STEP_RATE: Record<AnimState, number> = { idle: 4.0, walk: 11.0, run: 15.0 };

/** Hop height per state (world-ish units, scaled by depth `sc`).  Small = less "moon-bounce". */
export const HOP_AMP: Record<AnimState, number> = { idle: 0.4, walk: 0.9, run: 1.4 };

/** Leg-swing amplitude (screen px, ×depth) — the legs scissor by ±this. */
export const SWING_AMP = 2.6;

/**
 * Advance a player's animation phase by one frame.
 *
 * @param phase   Current phase (radians).
 * @param state   Current gait.
 * @param dtSec   Real elapsed seconds since the last frame.
 * @returns       The new phase.
 */
export function advancePhase(phase: number, state: AnimState, dtSec: number): number {
  return phase + STEP_RATE[state] * Math.max(0, dtSec);
}

// ── Pose ─────────────────────────────────────────────────────────────────────

/** The per-frame pose the renderer consumes to draw one dude. */
export interface Pose {
  /** Vertical hop offset in screen px (feet stay grounded; body rises by this). */
  hop: number;
  /** Normalised hop height 0..1 (independent of depth scale) — drives the shadow shrink. */
  h: number;
  /** Horizontal body scale (thins at the top of the hop). */
  scaleX: number;
  /** Vertical body scale (stretches at the top of the hop). */
  scaleY: number;
  /** Leg-swing offset in screen px: legs scissor by ±this. */
  swing: number;
  /** Raw cos(phase) ∈ [−1,1] — drives limb direction (which way the arms wave / legs lead). */
  cosPhase: number;
}

/** A frozen, motionless pose for reduced-motion / paused rendering. */
export const STATIC_POSE: Pose = { hop: 0, h: 0, scaleX: 1, scaleY: 1, swing: 0, cosPhase: 0 };

/**
 * Compute the pose for a player this frame.
 *
 * @param phase  Animation phase (radians) from `advancePhase`.
 * @param state  Current gait (selects hop amplitude).
 * @param sc     Depth scale from the projection (nearer = bigger), so distant
 *               players hop/flail proportionally less.
 * @returns      Hop, squash/stretch scales, and limb swing — all in screen px.
 */
export function computePose(phase: number, state: AnimState, sc: number): Pose {
  const amp = HOP_AMP[state] * sc;
  const hop = Math.abs(Math.sin(phase)) * amp;
  const h = amp > 0 ? hop / amp : 0; // normalised hop height 0..1
  const cosPhase = Math.cos(phase);
  return {
    hop,
    h,
    // +0.28 stretch at the top, −0.05 squash baseline → subtle, not rubbery.
    scaleY: 1 + (h * 0.28 - 0.05),
    scaleX: 1 - (h * 0.16 - 0.03),
    swing: cosPhase * SWING_AMP * sc,
    cosPhase,
  };
}
