// ── features/match/logic/replay/ballTrack.ts ─────────────────────────────────
// The ball in a v3 replay: a list of keyframes, replayed with the engine's own
// ball physics in between (docs/match-viewer.md, section 2B).
//
// WHY
//   A v2 replay kept one ball position every 2 s and the viewer slid the ball
//   in a straight line between them, but the ball changes hands in 37 to 40%
//   of those gaps, so a pass, the control and the next pass merged into one
//   slow glide.  The engine already knows the ball exactly: between two
//   discontinuities (a kick, a touch, a deflection, a stop, a restart) it moves
//   under `stepBall` alone (spatial/ball.ts: drag, rolling resistance,
//   gravity, bounces).  So the replay stores only the discontinuities, as
//   keyframes, and the viewer re-runs `stepBall` from the latest keyframe.
//
// EXACTNESS
//   A keyframe holds the ball's state quantised to BALL_QUANTUM (1 cm, 1 cm/s).
//   The recorder (recorder.ts) replays the same quantised keyframe with the
//   same `stepBall` calls this module makes, and writes a new keyframe as soon
//   as that replay and the engine's real ball differ by more than KEY_POS_EPS
//   in position or KEY_VEL_EPS in velocity, or the owner changes.  So at every
//   engine tick the replayed ball is within KEY_POS_EPS (plus half a quantum)
//   of where the engine had it; between ticks it is interpolated linearly
//   over one tenth of a second.
//
// PURE: no React, no canvas, no I/O.

import { stepBall, type BallBody } from '../spatial/ball';
import { vec } from '../spatial/vec2';

/**
 * Keyframes are stored as integers in hundredths: 1 cm and 1 cm/s.  The
 * stored integer is Math.round(value * BALL_SCALE) and the decoded value is
 * that integer / BALL_SCALE, which is exactly what {@link quantise} returns.
 */
export const BALL_SCALE = 100;

/** A replay whose ball strays this far (m) from the engine's gets a new keyframe. */
export const KEY_POS_EPS = 0.02;

/** A replay whose ball velocity strays this far (m/s) gets a new keyframe. */
export const KEY_VEL_EPS = 0.02;

/** One discontinuity in the ball's motion: its whole state after an engine tick. */
export interface BallKey {
  /** Engine tick index (time = tick * dtSec). */
  tick: number;
  /** Position (m) and height above the grass (m). */
  x: number;
  y: number;
  z: number;
  /** Velocity (m/s), horizontal and vertical. */
  vx: number;
  vy: number;
  vz: number;
  /** The player in possession from this tick, or null when loose. */
  ownerId: string | null;
}

/** A whole match's ball: keyframes plus the engine step they are replayed at. */
export interface BallTrack {
  /** The engine's physics step (s); keyframes are replayed one step at a time. */
  dtSec: number;
  /** Keyframes in tick order; the first is at tick 0. */
  keys: readonly BallKey[];
  /** The last tick of the match (the replay never runs past it). */
  endTick: number;
}

/** The ball at one instant, as the viewer draws it. */
export interface BallSample {
  x: number;
  y: number;
  /** Height above the grass (m). */
  z: number;
  /** Velocity (m/s) at the start of the current tick. */
  vx: number;
  vy: number;
  vz: number;
  /** The player in possession, or null when loose. */
  ownerId: string | null;
}

/** Round to the keyframe resolution (the stored value, exactly as decoded). */
export function quantise(n: number): number {
  // `+ 0` turns -0 into 0, which is what a JSON round trip gives back.
  return Math.round(n * BALL_SCALE) / BALL_SCALE + 0;
}

/** A fresh physics body at a keyframe's state. */
export function bodyAt(k: BallKey): BallBody {
  return { pos: vec(k.x, k.y), vel: vec(k.vx, k.vy), z: k.z, vz: k.vz };
}

/** Index of the last key at or before `tick` (0 when `tick` precedes them all). */
function keyIndexAt(keys: readonly BallKey[], tick: number): number {
  let lo = 0;
  let hi = keys.length - 1;
  let result = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (keys[mid]!.tick <= tick) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}

/**
 * Replay cache: the body reached by stepping forward from one key, so that a
 * viewer sampling forward in time (60 times a second) steps on from where it
 * was instead of from the key.  Keyed by track identity; the steps it takes
 * are the very same `stepBall` calls a fresh replay would make, so the result
 * is identical either way.
 */
const CACHE = new WeakMap<BallTrack, { keyIdx: number; steps: number; body: BallBody }>();

/** The ball body `steps` ticks after key `keyIdx` (no keyframe in between). */
function replayed(track: BallTrack, keyIdx: number, steps: number): BallBody {
  const c = CACHE.get(track);
  let body: BallBody;
  let done: number;
  if (c && c.keyIdx === keyIdx && c.steps <= steps) {
    body = { pos: c.body.pos, vel: c.body.vel, z: c.body.z, vz: c.body.vz };
    done = c.steps;
  } else {
    body = bodyAt(track.keys[keyIdx]!);
    done = 0;
  }
  for (; done < steps; done++) stepBall(body, track.dtSec);
  CACHE.set(track, { keyIdx, steps, body: { pos: body.pos, vel: body.vel, z: body.z, vz: body.vz } });
  return body;
}

/** The ball's state at a whole tick: a keyframe, or a replay from the latest one. */
export function ballAtTick(track: BallTrack, tick: number): { body: BallBody; ownerId: string | null } {
  const t = Math.max(0, Math.min(track.endTick, tick));
  const i = keyIndexAt(track.keys, t);
  const k = track.keys[i]!;
  return { body: replayed(track, i, Math.max(0, t - k.tick)), ownerId: k.ownerId };
}

/**
 * Sample the ball at a game-clock second: replay to the tick at or before it,
 * then interpolate linearly across that one tick (to the next keyframe when
 * one falls there, so a kick starts exactly where the engine struck it).
 *
 * @param track    The match's ball track.
 * @param gameSec  Game-clock seconds since kickoff.
 * @returns        Position, height, velocity and owner at that instant.
 */
export function sampleBallTrack(track: BallTrack, gameSec: number): BallSample {
  const ticks = Math.max(0, Math.min(track.endTick, gameSec / track.dtSec));
  // A hair of tolerance so 0.3 / 0.1 = 2.9999999999999996 reads as tick 3.
  const tick = Math.floor(ticks + 1e-6);
  const frac = Math.max(0, Math.min(1, ticks - tick));
  const i = keyIndexAt(track.keys, tick);
  const k = track.keys[i]!;
  const a = replayed(track, i, Math.max(0, tick - k.tick));
  if (frac < 1e-6 || tick >= track.endTick) {
    return { x: a.pos.x, y: a.pos.y, z: a.z, vx: a.vel.x, vy: a.vel.y, vz: a.vz, ownerId: k.ownerId };
  }
  // The next tick: the next keyframe when one falls there, else one more step.
  const nk = track.keys[i + 1];
  let b: BallBody;
  if (nk && nk.tick === tick + 1) {
    b = bodyAt(nk);
  } else {
    b = { pos: a.pos, vel: a.vel, z: a.z, vz: a.vz };
    stepBall(b, track.dtSec);
  }
  return {
    x: a.pos.x + (b.pos.x - a.pos.x) * frac,
    y: a.pos.y + (b.pos.y - a.pos.y) * frac,
    z: a.z + (b.z - a.z) * frac,
    vx: a.vel.x,
    vy: a.vel.y,
    vz: a.vz,
    ownerId: k.ownerId,
  };
}
