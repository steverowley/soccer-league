// ── features/match/logic/spatial/execution.ts ────────────────────────────────
// Human imprecision (design 3.2): the ONLY place randomness enters the engine.
//
// A player decides what to do (utility, elsewhere); here he does it, a little
// off.  Every error is a physical quantity (a kick angle, a speed, a lift, the
// way a first touch springs off the foot, how long he takes to react) and its
// size scales DOWN with skill and UP with pressure, fatigue, awkward body
// shape, ball speed and lost confidence.  Whether the slightly-off kick then
// loses the ball is decided by physics, never by a roll here.
//
// With the `imprecision` ablation flag off every error is exactly zero, so a
// match plays out from decisions and physics alone.

import { type Vec2, vec, sub, add, scale, len, normalize } from './vec2.ts';
import { rngGaussian } from './rng.ts';
import type { SimPlayer, SimWorld } from './types.ts';

/**
 * Home advantage (design 4.7), applied only through human imprecision and
 * perception, never through an outcome: the home side's execution error is
 * a few per cent smaller and it reacts a fraction sooner.  Measured in
 * scripts/batch-report.ts homeaway; see docs/emergent-engine.md.
 */
export const HOME_COMPOSURE = 0.85;
export const HOME_ALERTNESS = 0.85;

/** The circumstances of one action, for the error scale. */
export interface Circumstance {
  /** Local pressure in [0,1] (see evaluate.pressureAt). */
  pressure: number;
  /** Awkwardness of body shape in [0,1] (kicking across the run). */
  awkward: number;
}

/**
 * The multiplier on every execution error for this player right now.
 * About 0.55 for a fresh, unpressured, 70-rated player at neutral confidence.
 *
 * @param p      The player acting.
 * @param skill  The governing stat (0-100) for this action.
 * @param world  The world (for ablation flags).
 * @param c      Pressure and body shape.
 */
export function errorScale(p: SimPlayer, skill: number, world: SimWorld, c: Circumstance): number {
  let e = 1.25 - skill / 100;
  e *= 1 + 0.8 * c.pressure;
  e *= 1 + 0.7 * (1 - p.stamina);
  if (world.flags.confidence) e *= 1.15 - 0.3 * p.confidence;
  e *= 1 + 0.5 * c.awkward;
  // The home crowd: a home player is a little more composed on the ball.
  if (world.flags.homeAdvantage && p.side === 'home') e *= HOME_COMPOSURE;
  return Math.max(0.08, e);
}

/** One imprecision draw: a zero-mean error of the given spread, or 0 when ablated. */
export function slip(p: SimPlayer, world: SimWorld, std: number): number {
  if (!world.flags.imprecision || std <= 0) return 0;
  return rngGaussian(p.rng, 0, std);
}

/** Per-kind error bases: direction (rad), relative speed, and lift (m/s). */
export interface KickErrorBase {
  readonly ang: number;
  readonly spd: number;
  readonly lift: number;
}

/** Error bases by kick family, at an error scale of 1. */
export const KICK_ERROR: Readonly<Record<'pass' | 'lofted' | 'cross' | 'shot' | 'header' | 'clear' | 'throw', KickErrorBase>> = {
  pass:   { ang: 0.085, spd: 0.11, lift: 0.0 },
  lofted: { ang: 0.100, spd: 0.11, lift: 0.9 },
  cross:  { ang: 0.110, spd: 0.10, lift: 1.1 },
  shot:   { ang: 0.26, spd: 0.06, lift: 4.0 },
  header: { ang: 0.170, spd: 0.15, lift: 1.4 },
  clear:  { ang: 0.160, spd: 0.12, lift: 1.5 },
  throw:  { ang: 0.050, spd: 0.08, lift: 0.5 },
};

/** The outcome of a strike: the ball's new horizontal and vertical velocity. */
export interface Strike {
  vel: Vec2;
  vz: number;
  /** The realised direction error (rad), for traces. */
  angErr: number;
}

/**
 * Strike the ball: the intended horizontal direction and speed, and the
 * intended vertical launch speed, each perturbed by the kicker's error.
 *
 * @param p      Kicker.
 * @param world  World (flags).
 * @param dir    Intended horizontal direction (unit vector).
 * @param speed  Intended horizontal launch speed (m/s).
 * @param vz     Intended vertical launch speed (m/s).
 * @param base   Error bases for this kick family.
 * @param e      Error scale from errorScale().
 */
export function strike(
  p: SimPlayer, world: SimWorld, dir: Vec2, speed: number, vz: number, base: KickErrorBase, e: number,
): Strike {
  const angErr = slip(p, world, base.ang * e);
  const c = Math.cos(angErr);
  const s = Math.sin(angErr);
  const d = vec(dir.x * c - dir.y * s, dir.x * s + dir.y * c);
  const sp = Math.max(1, speed * (1 + slip(p, world, base.spd * e)));
  const lift = vz + slip(p, world, base.lift * e);
  return { vel: scale(d, sp), vz: Math.max(0, lift), angErr };
}

/**
 * First touch (design 4.4).  The receiver wants the ball to leave his foot at
 * `desired` (usually: rolling a metre ahead in his chosen direction).  If the
 * incoming speed relative to him exceeds his control capacity the excess
 * carries the ball on in its incoming direction (a heavy touch, physics), and
 * a skill-scaled error spreads where it springs.
 *
 * @param p         Receiver.
 * @param world     World (flags).
 * @param ballVel   Incoming horizontal ball velocity.
 * @param desired   The velocity he wants the ball to leave with.
 * @param pressure  Local pressure in [0,1].
 * @returns         The ball's velocity after the touch.
 */
export function firstTouch(p: SimPlayer, world: SimWorld, ballVel: Vec2, desired: Vec2, pressure: number): Vec2 {
  const rel = len(sub(ballVel, p.vel));
  const skill = 0.6 * p.stats.dribbling + 0.4 * p.stats.passing;
  const capacity = 6 + 12 * (skill / 100);
  const excess = Math.max(0, rel - capacity);
  const det = add(desired, scale(normalize(ballVel), excess * 0.5));
  const e = errorScale(p, skill, world, { pressure, awkward: 0 });
  const std = (0.3 + 0.06 * rel) * e;
  return add(det, vec(slip(p, world, std), slip(p, world, std)));
}

/**
 * Reaction delay (s) before a player responds to a new ball path: a
 * perception cost, shorter for players who read the game well.
 *
 * @param p      The player.
 * @param world  World (flags).
 */
export function reactionDelay(p: SimPlayer, world: SimWorld): number {
  const base = p.role === 'GK'
    ? 0.17 + 0.2 * (1 - p.stats.goalkeeping / 100)
    : 0.16 + 0.22 * (1 - p.stats.positioning / 100);
  // The home crowd keeps the home side a fraction more alert.
  const lift = world.flags.homeAdvantage && p.side === 'home' ? HOME_ALERTNESS : 1;
  return base * lift + Math.abs(slip(p, world, 0.05));
}

/**
 * A perceived position: the true point plus a perception error that grows
 * with distance and shrinks with reading of the game.
 *
 * @param p      The observer.
 * @param world  World (flags).
 * @param pt     The true point.
 * @param std    Error spread (m) at an error scale of 1.
 */
export function perceive(p: SimPlayer, world: SimWorld, pt: Vec2, std: number): Vec2 {
  if (!world.flags.imprecision) return pt;
  const read = p.role === 'GK' ? p.stats.goalkeeping : p.stats.positioning;
  const s = std * (1.25 - read / 100);
  return vec(pt.x + slip(p, world, s), pt.y + slip(p, world, s));
}
