// ── features/match/logic/viewer/projection.ts ───────────────────────────────
// World → screen projection for the canvas match viewer.
//
// THE ONE ARCHITECTURAL RULE (from the viewer spec)
//   The simulation lives entirely in world coordinates (metres).  The camera
//   ONLY changes the draw step — never the sim.  Swap the projection function
//   and you get a different camera from one codebase.  Two are provided:
//
//     • broadcast — a gentle 3/4 tilt that fits the whole 105×68 m pitch on
//       screen at once.  The faithful drop-in for the match panel.
//     • follow    — the same broadcast projection, then zoomed + translated so
//       the ball stays centred.  A "crop" camera for a closer, characterful read.
//
// COORDINATE FRAME (shared with the spatial engine, see logic/spatial/types.ts)
//   x ∈ [0, 105]  pitch length.   y ∈ [0, 68]  pitch width.   z = height (m).
//
// All tuning is expressed as FRACTIONS of the viewport so the projection is
// resolution-independent — the component renders into a fixed low-res backing
// store today, but nothing here assumes a particular pixel size.

import { PITCH_LENGTH, PITCH_WIDTH } from '../spatial/types';

// ── Shapes ────────────────────────────────────────────────────────────────────

/** Canvas backing-store size the projection maps into. */
export interface Viewport {
  width:  number;
  height: number;
}

/** A projected point.  `sc` is the depth scale (nearer = larger) used to size sprites. */
export interface Projected {
  x:  number;
  y:  number;
  /** Depth scale: ~0.9 at the far touchline → ~1.1 near the camera (× zoom for follow). */
  sc: number;
}

/** A plain screen-space point (no depth). */
export interface ScreenPoint {
  x: number;
  y: number;
}

// ── Broadcast tuning ──────────────────────────────────────────────────────────
// Four numbers do all the tilt work: TOP/BOT (vertical foreshortening) and
// FAR/NEAR half-widths (the pitch fans slightly wider toward the camera).
// Calibrated against the reference demo (320×208) then re-expressed as fractions.

const TOP_FRAC       = 0.26;   // ground line of the far touchline
const BOT_FRAC       = 0.913;  // ground line of the near touchline
const FAR_HALF_FRAC  = 0.453;  // half pitch-width on screen at the far line
const NEAR_HALF_FRAC = 0.478;  // …and at the near line (fans wider)
const SCALE_FAR      = 0.90;   // sprite scale at the far line
const SCALE_NEAR     = 1.10;   // …and at the near line
const Z_SCALE_FRAC   = 0.011;  // screen px per metre of height, as a fraction of viewport height

/** Zoom factor applied by the follow camera. */
export const FOLLOW_ZOOM = 2.15;

/** Fraction of viewport height the follow camera lifts the ball above centre (more pitch ahead). */
const FOLLOW_Y_OFFSET_FRAC = 0.03;

const lerp  = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

// ── Broadcast camera ────────────────────────────────────────────────────────────

/**
 * Project a world point under the 3/4 broadcast camera.
 *
 * @param wx  World x in metres (0 = home goal line, 105 = away).
 * @param wy  World y in metres (0 = far touchline, 68 = near touchline).
 * @param wz  Height above the ground in metres (0 for players; ball arc / goals use it).
 * @param vp  Viewport size.
 * @returns   Screen point + depth scale.
 */
export function projectBroadcast(wx: number, wy: number, wz: number, vp: Viewport): Projected {
  const t  = wy / PITCH_WIDTH;
  const gy = lerp(vp.height * TOP_FRAC,      vp.height * BOT_FRAC,      t);
  const hw = lerp(vp.width  * FAR_HALF_FRAC, vp.width  * NEAR_HALF_FRAC, t);
  const sc = lerp(SCALE_FAR, SCALE_NEAR, t);
  const zPx = (wz || 0) * Z_SCALE_FRAC * vp.height * sc;
  return {
    x:  vp.width * 0.5 + (wx / PITCH_LENGTH - 0.5) * 2 * hw,
    y:  gy - zPx,
    sc,
  };
}

// ── Follow camera ────────────────────────────────────────────────────────────────

/**
 * The screen point the follow camera wants to centre on — the ball's broadcast
 * projection.  The component smooths toward this each frame and clamps it.
 */
export function followAnchor(ballWx: number, ballWy: number, vp: Viewport): ScreenPoint {
  const p = projectBroadcast(ballWx, ballWy, 0, vp);
  return { x: p.x, y: p.y };
}

/**
 * Clamp the follow centre so the zoomed window never drifts far past the pitch
 * edges into empty void.  Ranges are expressed relative to the viewport.
 */
export function clampFollowCenter(c: ScreenPoint, vp: Viewport): ScreenPoint {
  const marginX = vp.width * 0.37;
  const top = vp.height * TOP_FRAC;
  const bot = vp.height * BOT_FRAC;
  const pad = vp.height * FOLLOW_Y_OFFSET_FRAC;
  return {
    x: clamp(c.x, vp.width * 0.5 - marginX, vp.width * 0.5 + marginX),
    y: clamp(c.y, top + pad, bot - pad),
  };
}

/**
 * Exponentially smooth the follow centre toward a target.  Frame-rate
 * independent: `k` is the smoothing rate per second (~6 ≈ the demo's 0.09/frame
 * at 60 fps).  Returns a fresh point; callers persist it across frames.
 */
export function smoothFollowCenter(
  prev: ScreenPoint,
  target: ScreenPoint,
  dtSec: number,
  k = 6,
): ScreenPoint {
  const a = 1 - Math.exp(-k * Math.max(0, dtSec));
  return {
    x: prev.x + (target.x - prev.x) * a,
    y: prev.y + (target.y - prev.y) * a,
  };
}

/**
 * Project a world point under the follow camera: take the broadcast projection,
 * then zoom around the (clamped, smoothed) centre so the ball sits near the
 * middle of the frame.
 *
 * @param center  The current follow centre (in broadcast screen space).
 */
export function projectFollow(
  wx: number,
  wy: number,
  wz: number,
  vp: Viewport,
  center: ScreenPoint,
): Projected {
  const p = projectBroadcast(wx, wy, wz, vp);
  return {
    x: vp.width  * 0.5 + (p.x - center.x) * FOLLOW_ZOOM,
    y: vp.height * 0.5 + vp.height * FOLLOW_Y_OFFSET_FRAC + (p.y - center.y) * FOLLOW_ZOOM,
    sc: p.sc * FOLLOW_ZOOM,
  };
}
