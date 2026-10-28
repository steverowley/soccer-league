// ── features/match/logic/viewer/playback.ts ─────────────────────────────────
// Turns the pre-computed replay frames into a smooth, per-render-frame
// snapshot of where every player + the ball are RIGHT NOW.
//
// WHY THIS EXISTS
//   The viewer renders at 60 fps, so it must (a) map real wall-clock time to a
//   game-clock second using the season's pacing window, and (b) interpolate
//   between the bracketing frames so bodies glide instead of teleporting.  It
//   also derives each player's velocity, which the renderer needs for gait
//   (idle/walk/run) and facing.
//
// TWO REPLAY FORMATS, ONE ENTRY POINT: sampleFrames(frames, gameSec)
//   v2 (Season 1 and the legacy tables): one frame every 2 game-seconds.
//     Players and ball are interpolated linearly, exactly as they always have
//     been; the ball's height is unknown and reported as 0.
//   v3 (docs/match-viewer.md, section 2B): frames carry `tSec` and share one
//     `ballTrack`.
//     - Players every 0.5 s, interpolated with a monotone cubic Hermite
//       spline (Steffen's tangents): curved paths through the frames that
//       never overshoot the values on either side, so a player who stops
//       does not swing past his mark.  A jump no runner could make (a
//       sent-off man parked on the touchline, the taker set on the spot)
//       breaks the spline: he holds, then appears at the new point.
//     - The ball is replayed from its keyframes with the engine's own ball
//       physics (logic/replay/ballTrack.ts), so passes, chips, shots and
//       bounces travel at their real speed and height; `ownerId` names the
//       player in possession so the renderer can draw it at his feet.
//
// PURE LOGIC: no React, no canvas.  The component owns the wall-clock; this
// module just answers "given game-second S, where is everyone?".

import type { PositionSnapshot } from '../../api/matchPositions';
import { sampleBallTrack } from '../replay/ballTrack';

/** Full regulation game time in seconds (90 min × 60).  The pacing window maps onto this. */
export const TOTAL_GAME_SECONDS = 90 * 60;

/**
 * Speed (m/s) above which a move between two v3 frames is a jump, not a run.
 * The fastest player in the engine sprints at 8.6 m/s and a keeper dives at
 * under 6 m/s, so 15 m/s is only ever a placement.
 */
export const TELEPORT_SPEED = 15;

/**
 * Map real elapsed wall-clock seconds to a game-clock second, applying the same
 * compression the commentary feed uses (`match_duration_seconds` reveals the
 * full 90 minutes), so the dots stay in lockstep with the play-by-play.
 *
 * @param realElapsedSec   Seconds since kickoff (negative/zero → 0).
 * @param durationSeconds  Season pacing window; ≤0 falls back to 1× (real == game).
 * @returns                Game-clock seconds since kickoff.
 */
export function realToGameSeconds(realElapsedSec: number, durationSeconds: number): number {
  if (realElapsedSec <= 0) return 0;
  return durationSeconds > 0
    ? (realElapsedSec / durationSeconds) * TOTAL_GAME_SECONDS
    : realElapsedSec;
}

/**
 * A frame's own game-time in seconds since kickoff: its exact `tSec` for a
 * v3 frame, else (minute−1)·60 + second.
 */
export function frameGameSeconds(f: PositionSnapshot): number {
  return f.tSec ?? (f.minute - 1) * 60 + f.second;
}

/** One player's interpolated state for the current render frame. */
export interface SampledPlayer {
  /** Position in metres (x ∈ [0,105], y ∈ [0,68]). */
  x: number;
  y: number;
  /** Velocity in metres per GAME-second (drives gait + facing; sign is camera-agnostic). */
  vx: number;
  vy: number;
  /** True for the ball carrier. */
  hasBall: boolean;
}

/** The ball's interpolated state for the current render frame. */
export interface SampledBall {
  x: number;
  y: number;
  /** Height above the grass in metres (v3 replays; always 0 for v2, which never stored it). */
  z: number;
  /** The player in possession, or null when the ball is loose. */
  ownerId: string | null;
}

/** Everything the renderer needs for one frame. */
export interface SampledFrame {
  players: Map<string, SampledPlayer>;
  ball: SampledBall | null;
  /** False when there are no frames (legacy / pre-kickoff) → caller shows the rest state. */
  hasData: boolean;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/**
 * Index of the last frame whose game-time is ≤ `gameSec`, or −1 if `gameSec`
 * precedes the first frame.  Binary search over the time-sorted array.
 */
function lastIndexAtOrBefore(frames: PositionSnapshot[], gameSec: number): number {
  let lo = 0;
  let hi = frames.length - 1;
  let result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const f = frames[mid]!;
    if (frameGameSeconds(f) <= gameSec) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}

/**
 * Sample the match at a game-clock second, interpolating between bracketing
 * frames and deriving per-player velocity.
 *
 * Edge cases:
 *  • No frames            → `hasData: false`, empty maps (caller draws rest state).
 *  • Before the first frame → holds the first frame, zero velocity.
 *  • After the last frame   → holds the last frame, zero velocity (no rewind).
 *
 * @param frames   Pre-loaded, time-sorted snapshots from `getMatchPositions`.
 * @param gameSec  Game-clock seconds since kickoff (from `realToGameSeconds`).
 * @returns        Interpolated positions + velocities for this instant.
 */
export function sampleFrames(frames: PositionSnapshot[], gameSec: number): SampledFrame {
  if (frames.length === 0) return { players: new Map(), ball: null, hasData: false };

  // Index of the active frame.  Before the first frame's game-time we hold frame
  // 0 STATIC (no `next`, so derived velocities are zero): players stand at their
  // kickoff positions rather than drifting toward frame 1 before play has begun.
  const rawIdx = lastIndexAtOrBefore(frames, gameSec);
  const beforeStart = rawIdx < 0;
  const i = beforeStart ? 0 : rawIdx;
  const cur = frames[i]!;
  const next = !beforeStart && i + 1 < frames.length ? frames[i + 1]! : null;

  if (cur.ballTrack) return sampleV3(frames, i, next !== null, beforeStart ? frameGameSeconds(cur) : gameSec);

  // ── v2: linear, exactly as before v3 ──────────────────────────────────────
  // Interpolation fraction across the [cur, next] segment (0 when there's no next).
  const gi = frameGameSeconds(cur);
  let t = 0;
  let segDt = 0;
  if (next) {
    segDt = frameGameSeconds(next) - gi;
    if (segDt > 0) t = clamp((gameSec - gi) / segDt, 0, 1);
  }

  // Index the next frame's players by id so the lerp can pair them O(1).
  const nextById = new Map<string, { x: number; y: number; hasBall: boolean }>();
  if (next) for (const np of next.snapshots.players) nextById.set(np.id, np);

  const players = new Map<string, SampledPlayer>();
  for (const p of cur.snapshots.players) {
    const np = next ? nextById.get(p.id) : undefined;
    if (np && segDt > 0) {
      players.set(p.id, {
        x: lerp(p.x, np.x, t),
        y: lerp(p.y, np.y, t),
        vx: (np.x - p.x) / segDt,
        vy: (np.y - p.y) / segDt,
        hasBall: p.hasBall,
      });
    } else {
      players.set(p.id, { x: p.x, y: p.y, vx: 0, vy: 0, hasBall: p.hasBall });
    }
  }

  const cb = cur.snapshots.ball;
  let ball: SampledBall;
  if (next && segDt > 0) {
    const nb = next.snapshots.ball;
    ball = { x: lerp(cb.x, nb.x, t), y: lerp(cb.y, nb.y, t), z: 0, ownerId: t < 0.5 ? cb.ownerId : nb.ownerId };
  } else {
    ball = { x: cb.x, y: cb.y, z: 0, ownerId: cb.ownerId };
  }

  return { players, ball, hasData: true };
}

// ── v3 ───────────────────────────────────────────────────────────────────────

/** A player's position in a frame, looked up by id (null when not on the pitch). */
function posIn(f: PositionSnapshot | undefined, id: string): { x: number; y: number } | null {
  if (!f) return null;
  for (const p of f.snapshots.players) if (p.id === id) return p;
  return null;
}

/**
 * Steffen's monotone tangent at a knot from the secant slopes either side
 * (equal spacing).  Zero at a local extremum, and never steeper than the
 * shallower neighbour allows, so the curve cannot overshoot either knot.
 * A missing slope (an end, or a jump) takes the other one.
 */
function steffen(before: number | null, after: number | null): number {
  if (before === null && after === null) return 0;
  if (before === null) return after!;
  if (after === null) return before;
  if (before * after <= 0) return 0;
  const p = (before + after) / 2;
  const m = Math.min(Math.abs(before), Math.abs(after), 0.5 * Math.abs(p));
  return (before > 0 ? 2 : -2) * m;
}

/** A secant slope, or null when the move is a jump (see TELEPORT_SPEED). */
function slope(
  a: { x: number; y: number } | null, b: { x: number; y: number } | null, h: number,
): { x: number; y: number } | null {
  if (!a || !b || h <= 0) return null;
  const sx = (b.x - a.x) / h;
  const sy = (b.y - a.y) / h;
  return Math.hypot(sx, sy) > TELEPORT_SPEED ? null : { x: sx, y: sy };
}

/** Cubic Hermite value and derivative on one segment, t ∈ [0, 1], length h. */
function hermite(p0: number, p1: number, m0: number, m1: number, t: number, h: number): [number, number] {
  const t2 = t * t;
  const t3 = t2 * t;
  const v = (2 * t3 - 3 * t2 + 1) * p0 + (t3 - 2 * t2 + t) * h * m0 + (-2 * t3 + 3 * t2) * p1 + (t3 - t2) * h * m1;
  const d = ((6 * t2 - 6 * t) * p0) / h + (3 * t2 - 4 * t + 1) * m0 + ((-6 * t2 + 6 * t) * p1) / h + (3 * t2 - 2 * t) * m1;
  return [v, d];
}

/**
 * Sample a v3 replay: curved, overshoot-free players and the physical ball.
 *
 * @param frames   The v3 snapshots (sharing one ballTrack).
 * @param i        Index of the frame at or before `gameSec` (0 before kickoff).
 * @param hasNext  Whether a later frame exists (false past the end).
 * @param gameSec  The instant, already clamped to frame 0 before kickoff.
 */
function sampleV3(frames: PositionSnapshot[], i: number, hasNext: boolean, gameSec: number): SampledFrame {
  const cur = frames[i]!;
  const t0 = frameGameSeconds(cur);
  const next = hasNext ? frames[i + 1]! : null;
  const prev = i > 0 ? frames[i - 1] : undefined;
  const after = hasNext ? frames[i + 2] : undefined;
  const h = next ? frameGameSeconds(next) - t0 : 0;
  const t = next && h > 0 ? clamp((gameSec - t0) / h, 0, 1) : 0;
  const hPrev = prev ? t0 - frameGameSeconds(prev) : 0;
  const hAfter = next && after ? frameGameSeconds(after) - frameGameSeconds(next) : 0;

  const ball = sampleBallTrack(cur.ballTrack!, next ? gameSec : t0);
  const owner = ball.ownerId;

  const players = new Map<string, SampledPlayer>();
  for (const p of cur.snapshots.players) {
    const np = next ? posIn(next, p.id) : null;
    const s1 = slope(p, np, h);
    if (!np || !s1) {
      // Past the end, leaving the pitch, or a jump: hold until the next frame.
      players.set(p.id, { x: p.x, y: p.y, vx: 0, vy: 0, hasBall: p.id === owner });
      continue;
    }
    const s0 = slope(posIn(prev, p.id), p, hPrev);
    const s2 = slope(np, posIn(after, p.id), hAfter);
    const m0x = steffen(s0 ? s0.x : null, s1.x);
    const m0y = steffen(s0 ? s0.y : null, s1.y);
    const m1x = steffen(s1.x, s2 ? s2.x : null);
    const m1y = steffen(s1.y, s2 ? s2.y : null);
    const [x, vx] = hermite(p.x, np.x, m0x, m1x, t, h);
    const [y, vy] = hermite(p.y, np.y, m0y, m1y, t, h);
    players.set(p.id, { x, y, vx, vy, hasBall: p.id === owner });
  }

  return { players, ball: { x: ball.x, y: ball.y, z: ball.z, ownerId: owner }, hasData: true };
}
