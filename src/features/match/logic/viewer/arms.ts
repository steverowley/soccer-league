// ── features/match/logic/viewer/arms.ts ─────────────────────────────────────
// Floppy arms on spring physics (docs/match-viewer.md section 6): the charm
// the owner insists on.  Never a canned loop: each arm is a damped spring
// driven by the body, so it trails when the player sets off, flings forward
// when he stops, jolts on each footfall, gets an impulse on a kick or a
// tackle, and swings up into a V overhead in a goal celebration.
//
// THE MODEL (ported from the owner-approved sketch, preset "Floppy")
//   Angle `a` is measured from hanging straight down (0) through straight out
//   to that side (PI/2) to overhead (PI); `b` is the elbow bend relative to
//   the upper arm.  Each frame the upper arm is pulled toward its target by
//   stiffness K, slowed by damping D, pushed by the body's acceleration
//   (coupling G) and by gravity; the forearm follows the upper arm's swing.
//
// PERFORMANCE: 22+ figures at 60 fps on a phone.  The state is two small
// objects per player, mutated in place; a step allocates nothing.  The
// random jitter on impulses comes from a per-player seeded generator, so a
// capture is reproducible.
//
// TIME: stepped with REAL seconds (the match plays at 4.5x; game-time arms
// would flail at 4.5 times their speed).

import type { ArmPreset } from './actionAnim';

/** Spring constants for one arm style. */
export interface ArmPhysics {
  /** Stiffness pulling the upper arm to its target. */
  K: number;
  /** Damping. */
  D: number;
  /** How strongly the body's acceleration swings the arms. */
  G: number;
  /** Angular velocity added by a kick impulse (times the action's strength). */
  kick: number;
  /** Angular velocity added at most by a footfall. */
  step: number;
}

/** The owner's choice: arms lag, overshoot and flap on each step. */
export const FLOPPY: ArmPhysics = { K: 22, D: 3.4, G: 0.9, kick: 10, step: 2.2 };

/** The arm's resting angle from straight down (and its relaxed elbow bend). */
export const REST_ANGLE = 0.62;
export const REST_BEND = 0.35;
/** Joint limits (radians): an arm never swings through the body or past overhead. */
const A_MIN = -0.7;
const A_MAX = 3.4;
const B_LIMIT = 2.0;
/** Gravity on the upper arm (radians per second squared at horizontal). */
const GRAVITY = 2.0;
/** Physics substep (s): keeps the stiff celebration and dive springs stable on a slow frame. */
const MAX_SUBSTEP = 1 / 120;

/** One arm: side (-1 back, +1 the side he faces), angle and elbow with their velocities. */
export interface Arm {
  side: -1 | 1;
  a: number;
  av: number;
  b: number;
  bv: number;
}

/** Both arms of one player plus his jitter generator. */
export interface ArmState {
  back: Arm;
  front: Arm;
  /** Phase offset for his celebration wiggle (radians). */
  ph: number;
  /** State of his seeded jitter generator (uint32). */
  rng: number;
}

/**
 * A pose's hold on the arms: the target the springs pull to while it lasts,
 * and how stiffly.  The arms stay springs, so they still overshoot and flop.
 */
export interface ArmHold {
  a: number;
  b: number;
  K: number;
}

/** What drives the arms this frame (one scratch object is reused by the caller). */
export interface ArmDrive {
  /** How hard he is running, 0..1. */
  run: number;
  /** His stride phase (radians): the arms swing with the legs. */
  phase: number;
  /** Body acceleration along the screen's x axis (m/s^2, softened). */
  ax: number;
  /** Body acceleration upward (negative = dropping, the arms fly up). */
  ay: number;
  /** Seconds on his clock (the celebration wiggle). */
  t: number;
  /** A pose holding the arms (throw-in, catch, dive, celebration), or null. */
  hold: Readonly<ArmHold> | null;
  /** True while celebrating: the arms make a V overhead and wiggle. */
  celebrate: boolean;
}

/**
 * Where each pose holds the arms (angle, elbow, stiffness).  'rest' leaves
 * them free; 'celebrate' is the V overhead with a wiggle (ArmDrive.celebrate).
 * Frozen objects, shared by every player: a frame allocates nothing.
 */
export const ARM_HOLDS: Readonly<Record<Exclude<ArmPreset, 'rest' | 'celebrate'>, Readonly<ArmHold>>> = {
  /** A parry: both hands up. */
  up: Object.freeze({ a: 2.6, b: 0.2, K: 70 }),
  /** Balance on a shot, a header, a stumble. */
  out: Object.freeze({ a: 1.45, b: 0.2, K: 45 }),
  /** A throw-in: up and bent in so the hands meet over the head. */
  overhead: Object.freeze({ a: 2.75, b: 0.75, K: 80 }),
  /** The throw itself: flung down from overhead. */
  forward: Object.freeze({ a: 1.2, b: 0.3, K: 50 }),
  /** A slide: arms back for balance. */
  back: Object.freeze({ a: 0.95, b: -0.4, K: 40 }),
  /** A catch: the ball hugged to the chest. */
  hug: Object.freeze({ a: 0.9, b: 2.3, K: 70 }),
  /** A keeper's dive: stretched out past his head. */
  dive: Object.freeze({ a: 2.9, b: 0.1, K: 90 }),
};

/**
 * Point a drive at a pose's arm preset (mutates the drive; allocates nothing).
 *
 * @param d       The caller's scratch drive.
 * @param preset  The pose's arms (undefined or 'rest': free).
 */
export function holdArms(d: ArmDrive, preset: ArmPreset | undefined): void {
  d.celebrate = preset === 'celebrate';
  d.hold = preset == null || preset === 'rest' || preset === 'celebrate' ? null : ARM_HOLDS[preset];
}

/** A fresh drive object (callers keep one and mutate it). */
export function newDrive(): ArmDrive {
  return { run: 0, phase: 0, ax: 0, ay: 0, t: 0, hold: null, celebrate: false };
}

/** Next float in [0, 1) from the state's generator (mulberry32, in place). */
function nextRandom(st: ArmState): number {
  st.rng = (st.rng + 0x6d2b79f5) | 0;
  let t = Math.imul(st.rng ^ (st.rng >>> 15), 1 | st.rng);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * Arms at rest for a player.
 *
 * @param seed  Any number (his appearance seed); offsets his wiggle and jitter.
 */
export function newArms(seed: number): ArmState {
  return {
    back: { side: -1, a: REST_ANGLE, av: 0, b: REST_BEND, bv: 0 },
    front: { side: 1, a: REST_ANGLE, av: 0, b: REST_BEND, bv: 0 },
    ph: seed * 17,
    rng: (Math.floor(seed * 4294967296) ^ 0x5bd1e995) | 0,
  };
}

/** Clamp v into [lo, hi]. */
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** One substep for one arm. */
function stepArm(r: Arm, ph: number, h: number, d: ArmDrive, P: ArmPhysics): void {
  // The stride swings the arms opposite the legs; standing, they hang.
  let tgt = REST_ANGLE + d.run * (0.35 + 0.35 * Math.sin(d.phase + (r.side > 0 ? 0 : Math.PI)));
  let tgtB = REST_BEND;
  let K = P.K;
  if (d.celebrate) {
    tgt = 2.3 + 0.35 * Math.sin(d.t * 13 + ph + (r.side > 0 ? 0 : 2.1));
    K = P.K * 1.6 + 20;
  } else if (d.hold) {
    tgt = d.hold.a;
    tgtB = d.hold.b;
    K = d.hold.K;
  }
  const acc =
    -K * (r.a - tgt) -
    P.D * r.av -
    d.ax * r.side * P.G * Math.cos(r.a) + // setting off sideways: the arms trail
    d.ay * P.G * 0.6 * Math.sin(r.a) - // dropping: the arms fly up
    GRAVITY * Math.sin(r.a);
  r.av += acc * h;
  r.a += r.av * h;
  if (r.a < A_MIN || r.a > A_MAX) {
    r.a = clamp(r.a, A_MIN, A_MAX);
    r.av *= -0.4;
  }
  const kb = d.hold ? Math.max(P.K * 1.4, K) : P.K * 1.4;
  const bacc = -kb * (r.b - tgtB) - P.D * 1.2 * r.bv - acc * 0.55;
  r.bv += bacc * h;
  r.b = clamp(r.b + r.bv * h, -B_LIMIT, B_LIMIT);
}

/**
 * Advance both arms by `dt` real seconds (substepped).  Allocates nothing.
 *
 * @param st     His arm state (mutated).
 * @param dt     Real seconds since the last frame (0 freezes them).
 * @param drive  What his body is doing this frame.
 * @param P      Spring constants (default: Floppy).
 */
export function stepArms(st: ArmState, dt: number, drive: ArmDrive, P: ArmPhysics = FLOPPY): void {
  if (!(dt > 0)) return;
  const n = Math.max(1, Math.ceil(dt / MAX_SUBSTEP));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    stepArm(st.back, st.ph, h, drive, P);
    stepArm(st.front, st.ph, h, drive, P);
  }
}

/**
 * An impulse from an action (a kick, a tackle, a fall): both arms fling up,
 * by slightly different amounts.
 *
 * @param mult  Strength of the action (a pass 0.5, a shot 1, a foul 1.5).
 */
export function kickArms(st: ArmState, mult: number, P: ArmPhysics = FLOPPY): void {
  st.back.av += P.kick * mult * (0.7 + 0.6 * nextRandom(st));
  st.front.av += P.kick * mult * (0.7 + 0.6 * nextRandom(st));
}

/** A footfall: a small random jolt to each arm (mostly upward). */
export function stepJolt(st: ArmState, P: ArmPhysics = FLOPPY): void {
  st.back.av += (nextRandom(st) * 2 - 0.4) * P.step;
  st.front.av += (nextRandom(st) * 2 - 0.4) * P.step;
}
