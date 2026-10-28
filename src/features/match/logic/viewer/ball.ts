// ── features/match/logic/viewer/ball.ts ─────────────────────────────────────
// Where the viewer draws the ball, as pure math (docs/match-viewer.md 2C).
//
// THREE JOBS
//   1. AT THE FEET.  While a player has the ball it is drawn at his feet,
//      offset a little toward where he is going, instead of at the point
//      interpolated between two replay snapshots (which drifts off a dribbler
//      because the snapshots are two seconds apart).
//   2. NO TELEPORTS.  Pinning the ball to its owner makes it jump when the
//      owner changes between snapshots.  A jump bigger than GLIDE_GAP_M is
//      turned into a short glide (GLIDE_MS of real time) that ends exactly on
//      the moving target, so it reads as the pass it was.
//   3. TRAIL.  A short trail behind the ball when it travels fast (passes and
//      shots), measured in game metres per game second so it means the same
//      thing at every replay speed.
//
// PURE LOGIC: no React, no canvas.  The component keeps the state objects
// returned here in refs between animation frames.

/** A ball position in world metres; `z` is height above the grass. */
export interface BallPoint {
  x: number;
  y: number;
  z: number;
}

/** How far ahead of the owner's feet the ball sits (metres). */
export const FEET_OFFSET_M = 0.8;
/** The ball always sits at least this far toward the camera, so the legs never hide it. */
export const FEET_FORWARD_M = 0.3;
/** Owner speed (game m/s) above which his running direction places the ball. */
const MOVING_MPS = 0.4;

/**
 * The ball's position at a player's feet.
 *
 * @param owner  The owner's drawn position and velocity (metres, game m/s).
 * @param face   His sprite facing (+1 right, -1 left), used when standing.
 * @returns      Ground-level ball point.
 */
export function ballAtFeet(owner: { x: number; y: number; vx: number; vy: number }, face: number): BallPoint {
  const speed = Math.hypot(owner.vx, owner.vy);
  const ux = speed > MOVING_MPS ? owner.vx / speed : face >= 0 ? 1 : -1;
  const uy = speed > MOVING_MPS ? owner.vy / speed : 0;
  return {
    x: owner.x + ux * FEET_OFFSET_M,
    y: owner.y + Math.max(FEET_FORWARD_M, uy * FEET_OFFSET_M),
    z: 0,
  };
}

// ── Glide over discontinuities ─────────────────────────────────────────────

/** A jump between two render frames bigger than this (metres) is glided, not drawn. */
export const GLIDE_GAP_M = 4;
/** Length of a glide in real milliseconds. */
export const GLIDE_MS = 140;

/** An in-progress glide: where it started and when. */
export interface BallGlide {
  from: BallPoint;
  startMs: number;
}

/** What `glideBall` hands back for this frame. */
export interface GlideStep {
  /** Where to draw the ball now. */
  shown: BallPoint;
  /** The glide to carry into the next frame, or null. */
  glide: BallGlide | null;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const dist = (a: BallPoint, b: BallPoint): number => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Decide where to draw the ball this frame, gliding over a jump.
 *
 * @param prevShown  Where it was drawn last frame (null on the first frame).
 * @param target     Where the data says it is now.
 * @param glide      The glide carried from the last frame, if any.
 * @param nowMs      Real clock in milliseconds.
 * @param enabled    False to snap (reduced motion, a seek, a restart).
 */
export function glideBall(
  prevShown: BallPoint | null,
  target: BallPoint,
  glide: BallGlide | null,
  nowMs: number,
  enabled: boolean,
): GlideStep {
  if (!enabled || prevShown == null) return { shown: target, glide: null };
  let g = glide;
  if (g == null) {
    if (dist(prevShown, target) <= GLIDE_GAP_M) return { shown: target, glide: null };
    g = { from: prevShown, startMs: nowMs };
  }
  const s = (nowMs - g.startMs) / GLIDE_MS;
  if (s >= 1) return { shown: target, glide: null };
  // Ease out: quick departure, gentle arrival on the receiver.
  const e = 1 - (1 - Math.max(0, s)) ** 2;
  return {
    shown: { x: lerp(g.from.x, target.x, e), y: lerp(g.from.y, target.y, e), z: lerp(g.from.z, target.z, e) },
    glide: g,
  };
}

// ── Trail ──────────────────────────────────────────────────────────────────

/** A drawn ball position stamped with game time. */
export interface TrailPoint extends BallPoint {
  /** Game seconds since kickoff. */
  t: number;
}

/** How much game time the trail covers. */
export const TRAIL_GAME_SEC = 0.45;
/** Ball speed (game m/s) at which the trail appears: faster than any dribble. */
export const TRAIL_MIN_MPS = 9;

/**
 * Append this frame's ball point and drop points older than the trail window.
 * A step back in game time (a restart) or a long gap clears the history.
 *
 * @returns The new history (the input array is not modified).
 */
export function pushTrail(history: readonly TrailPoint[], p: TrailPoint): TrailPoint[] {
  const last = history[history.length - 1];
  if (last && (p.t < last.t || p.t - last.t > 2)) return [p];
  const out = history.filter((q) => p.t - q.t <= TRAIL_GAME_SEC);
  out.push(p);
  return out;
}

/**
 * The trail to draw, oldest first: the whole window when the ball covered it
 * at TRAIL_MIN_MPS or more, otherwise nothing.
 */
export function trailToDraw(history: readonly TrailPoint[]): TrailPoint[] {
  if (history.length < 2) return [];
  const first = history[0]!;
  const last = history[history.length - 1]!;
  const dt = last.t - first.t;
  if (dt <= 0) return [];
  return dist(first, last) / dt >= TRAIL_MIN_MPS ? [...history] : [];
}
