// ── features/match/logic/spatial/ball.ts ─────────────────────────────────────
// 2.5D ball physics (design 4.1).  The ball has a ground position (x, y), a
// height z and a velocity (vx, vy, vz).  Gravity acts on z, quadratic drag on
// the horizontal speed, rolling resistance on the ground, and a bounce with
// restitution when a falling ball meets the grass.  Height is what makes
// crosses, headers, lobs, chips and a keeper's reach work.
//
// Everything here is deterministic physics: no randomness enters.  The same
// constants drive the live simulation, the trajectory prediction players use
// to meet a ball, and the closed-form solvers a kicker uses to choose a kick
// speed, so what a player expects is what the ball does (minus his own
// execution error, applied elsewhere).

import { type Vec2, vec } from './vec2.ts';

/** Gravity (m/s^2). */
export const GRAVITY = 9.81;

/** Rolling resistance on grass (m/s^2): the constant part of ground friction. */
export const ROLL_DECEL = 1.6;

/** Quadratic drag coefficient (1/m) on the horizontal speed, air and ground. */
export const DRAG_K = 0.010;

/** Vertical restitution of a bounce (fraction of the downward speed kept). */
const RESTITUTION = 0.45;

/** Ball-on-grass friction coefficient at a bounce. */
const BOUNCE_MU = 0.5;

/** A landing slower than this (m/s) settles into a roll instead of bouncing. */
const SETTLE_VZ = 1.1;

/** The mutable physical state of a ball (a subset of SimBall). */
export interface BallBody {
  pos: Vec2;
  vel: Vec2;
  z: number;
  vz: number;
}

/** True while the ball is off the ground (in flight or bouncing). */
export function isAirborne(b: BallBody): boolean {
  return b.z > 0 || b.vz > 0;
}

/**
 * Advance a ball body by one timestep (semi-implicit Euler).  Mutates `b`.
 *
 * @param b   The ball.
 * @param dt  Timestep (s).
 */
export function stepBall(b: BallBody, dt: number): void {
  const sp = Math.sqrt(b.vel.x * b.vel.x + b.vel.y * b.vel.y);
  const airborne = isAirborne(b);
  if (sp > 0) {
    const decel = DRAG_K * sp * sp + (airborne ? 0 : ROLL_DECEL);
    const ns = Math.max(0, sp - decel * dt);
    const f = ns / sp;
    b.vel = ns === 0 ? vec(0, 0) : vec(b.vel.x * f, b.vel.y * f);
  }
  b.pos = vec(b.pos.x + b.vel.x * dt, b.pos.y + b.vel.y * dt);
  if (airborne) {
    // Exact for constant gravity (not semi-implicit Euler): at 10 Hz the
    // Euler drop of g*dt*t/2 sent every aimed ball about 0.4 m low over a
    // second of flight, so low shots bounced short of the line and lost a
    // fifth of their pace, and no kick arrived where its kicker aimed it.
    b.z += b.vz * dt - 0.5 * GRAVITY * dt * dt;
    b.vz -= GRAVITY * dt;
    if (b.z <= 0) {
      b.z = 0;
      if (-b.vz > SETTLE_VZ) {
        // Coulomb friction at the bounce: the grass takes at most mu times
        // the normal impulse from the horizontal speed, and never more than
        // the 2/7 a sliding ball loses on the way to rolling.  A skimming
        // drive keeps most of its pace; a dropping lofted ball is checked.
        const loss = Math.min(BOUNCE_MU * (1 + RESTITUTION) * -b.vz, (2 / 7) * Math.hypot(b.vel.x, b.vel.y));
        const vh = Math.hypot(b.vel.x, b.vel.y);
        const keep = vh > 1e-9 ? (vh - loss) / vh : 0;
        b.vz = -b.vz * RESTITUTION;
        b.vel = vec(b.vel.x * keep, b.vel.y * keep);
      } else {
        b.vz = 0;
      }
    }
  }
}

/**
 * Predict the ball's future path by stepping a scratch copy forward.  Writes
 * x, y, z triples into `out` (length >= 3 * steps) and returns the number of
 * steps written.  Stops early once the ball is at rest on the ground.
 *
 * @param b      Current ball state (not mutated).
 * @param steps  How many timesteps to look ahead.
 * @param dt     Timestep (s).
 * @param out    Destination buffer.
 */
export function predictPath(b: BallBody, steps: number, dt: number, out: Float64Array): number {
  const s: BallBody = { pos: b.pos, vel: b.vel, z: b.z, vz: b.vz };
  let n = 0;
  for (let i = 0; i < steps; i++) {
    stepBall(s, dt);
    out[3 * i] = s.pos.x;
    out[3 * i + 1] = s.pos.y;
    out[3 * i + 2] = s.z;
    n = i + 1;
    if (s.z === 0 && s.vz === 0 && s.vel.x === 0 && s.vel.y === 0) {
      // At rest: fill the remainder with the resting point so lookups by
      // index past the stop still read a valid position.
      for (let j = i + 1; j < steps; j++) {
        out[3 * j] = s.pos.x;
        out[3 * j + 1] = s.pos.y;
        out[3 * j + 2] = 0;
      }
      return steps;
    }
  }
  return n;
}

// ── Closed-form solvers (the kicker's physics intuition) ──────────────────────

const AK = ROLL_DECEL / DRAG_K;

/**
 * Ground-ball launch speed needed to arrive `d` metres away still moving at
 * `arrive` m/s (rolling the whole way).
 */
export function groundLaunchSpeed(d: number, arrive: number): number {
  return Math.sqrt(Math.max(0, (arrive * arrive + AK) * Math.exp(2 * DRAG_K * d) - AK));
}

/** Speed of a ground ball launched at `v0` after rolling `d` metres (0 if it stops short). */
export function groundSpeedAfter(v0: number, d: number): number {
  const v2 = (v0 * v0 + AK) * Math.exp(-2 * DRAG_K * d) - AK;
  return v2 > 0 ? Math.sqrt(v2) : 0;
}

/** Distance a ground ball launched at `v0` rolls before stopping. */
export function groundStopDistance(v0: number): number {
  return Math.log(1 + (v0 * v0) / AK) / (2 * DRAG_K);
}

/** Time for a ground ball launched at `v0` to cover `d` metres (Infinity if it stops short). */
export function groundTravelTime(v0: number, d: number): number {
  const vd = groundSpeedAfter(v0, d);
  if (vd <= 0 && d > groundStopDistance(v0) - 0.01) return Infinity;
  const r = Math.sqrt(DRAG_K / ROLL_DECEL);
  return (Math.atan(v0 * r) - Math.atan(vd * r)) / Math.sqrt(ROLL_DECEL * DRAG_K);
}

/** Horizontal launch speed for a ball in flight to cover `d` metres in `t` seconds. */
export function airLaunchSpeed(d: number, t: number): number {
  return (Math.exp(DRAG_K * d) - 1) / (DRAG_K * Math.max(0.05, t));
}

/** Time for a ball in flight launched at horizontal speed `v0` to cover `d` metres. */
export function airTravelTime(v0: number, d: number): number {
  return (Math.exp(DRAG_K * d) - 1) / (DRAG_K * Math.max(0.1, v0));
}

/**
 * Vertical launch speed so a ball starting at height `z0` is at height `zt`
 * after `t` seconds of flight.
 */
export function verticalLaunchSpeed(z0: number, zt: number, t: number): number {
  const tt = Math.max(0.05, t);
  return (zt - z0 + 0.5 * GRAVITY * tt * tt) / tt;
}
