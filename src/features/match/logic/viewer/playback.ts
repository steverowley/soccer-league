// ── features/match/logic/viewer/playback.ts ─────────────────────────────────
// Turns the pre-computed `match_positions` frames into a smooth, per-render-
// frame snapshot of where every player + the ball are RIGHT NOW.
//
// WHY THIS EXISTS
//   The spatial engine emits one frame every 2 game-seconds (~2 700 per match).
//   The viewer renders at 60 fps, so it must (a) map real wall-clock time to a
//   game-clock second using the season's pacing window, and (b) interpolate
//   between the two bracketing frames so bodies glide instead of teleporting
//   every 2 seconds.  It also derives each player's velocity from the frame
//   delta — the renderer needs that for gait (idle/walk/run) and facing.
//
// PURE LOGIC — no React, no canvas.  The component owns the wall-clock; this
// module just answers "given game-second S, where is everyone?".

import type { PositionSnapshot } from '../../api/matchPositions';

/** Full regulation game time in seconds (90 min × 60).  The pacing window maps onto this. */
export const TOTAL_GAME_SECONDS = 90 * 60;

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

/** A frame's own game-time in seconds since kickoff: (minute−1)·60 + second. */
export function frameGameSeconds(f: PositionSnapshot): number {
  return (f.minute - 1) * 60 + f.second;
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
 * precedes the first frame.  Binary search over the (minute, second)-sorted array.
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
 * frames and deriving per-player velocity from the frame delta.
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
  // 0 STATIC (no `next`, so derived velocities are zero) — players stand at their
  // kickoff positions rather than drifting toward frame 1 before play has begun.
  const rawIdx = lastIndexAtOrBefore(frames, gameSec);
  const beforeStart = rawIdx < 0;
  const i = beforeStart ? 0 : rawIdx;
  const cur = frames[i]!;
  const next = !beforeStart && i + 1 < frames.length ? frames[i + 1]! : null;

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
    ball = { x: lerp(cb.x, nb.x, t), y: lerp(cb.y, nb.y, t), ownerId: t < 0.5 ? cb.ownerId : nb.ownerId };
  } else {
    ball = { x: cb.x, y: cb.y, ownerId: cb.ownerId };
  }

  return { players, ball, hasData: true };
}
