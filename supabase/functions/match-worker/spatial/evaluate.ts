// ── features/match/logic/spatial/evaluate.ts ─────────────────────────────────
// What a player can SEE and ESTIMATE from where he stands: how valuable a spot
// is, how long anyone needs to get somewhere, whether a pass lane is open,
// whether a shot would beat the keeper.  These are the considerations of the
// utility AI (design 3.4).  They are the player's judgement, used only to
// CHOOSE; the outcome of whatever he chooses is then decided by physics.
//
// All functions are pure (no randomness, no mutation).

import { type Vec2, vec, sub, dist, dist2, dot, len } from './vec2.ts';
import {
  type SimPlayer, type TeamSide,
  PITCH_LENGTH, PITCH_WIDTH, GOAL_Y_MIN, GOAL_Y_MAX, GOAL_HEIGHT,
  attackingGoalX,
} from './types.ts';
import { effectiveMaxSpeed, MAX_ACCEL } from './steering.ts';
import { groundTravelTime, airTravelTime, stepBall, verticalLaunchSpeed, type BallBody } from './ball.ts';
import { KICK_ERROR } from './execution.ts';

/** Logistic squash. */
export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/** Standard normal CDF (Abramowitz-Stegun 7.1.26 via erf). */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t
    * Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/** Fraction of the way from a side's own goal line to the goal it attacks, in [0,1]. */
export function progressOf(pos: Vec2, side: TeamSide): number {
  const f = side === 'home' ? pos.x / PITCH_LENGTH : 1 - pos.x / PITCH_LENGTH;
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

/**
 * Geometric chance quality of a spot: the angle the goal mouth subtends and
 * the distance, through a logistic.  About 0.36 six metres out centrally,
 * 0.16 at the penalty spot, 0.05 at twenty metres.  This is the "how good a
 * place to shoot from" intuition, not a roll.
 */
export function xgGeom(pos: Vec2, side: TeamSide): number {
  const gx = attackingGoalX(side);
  const dx = Math.abs(gx - pos.x);
  const a1 = Math.atan2(GOAL_Y_MIN - pos.y, dx);
  const a2 = Math.atan2(GOAL_Y_MAX - pos.y, dx);
  const angle = Math.abs(a2 - a1);
  const d = Math.hypot(dx, pos.y - PITCH_WIDTH / 2);
  return sigmoid(-2.8 + 2.6 * angle - 0.05 * d);
}

/**
 * Value of having the ball at `pos` for `side`: roughly the chance the
 * possession ends in a goal (an expected-threat surface).  Rises gently up the
 * pitch and steeply near goal.
 */
export function positionValue(pos: Vec2, side: TeamSide): number {
  const f = progressOf(pos, side);
  return 0.002 + 0.06 * f * f * f + 0.3 * xgGeom(pos, side);
}

/**
 * Time (s) for a player to get to a point, from his current velocity, with
 * acceleration up to his fatigue-limited top speed.  A beaten player still
 * recovering adds the time he has left.
 *
 * @param p    The player.
 * @param pt   Destination.
 * @param now  Match clock (for recovery).
 */
export function timeToReach(p: SimPlayer, pt: Vec2, now: number): number {
  const dx = pt.x - p.pos.x;
  const dy = pt.y - p.pos.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  const v = effectiveMaxSpeed(p);
  const along = d > 0.01 ? (p.vel.x * dx + p.vel.y * dy) / d : 0;
  const u = along < 0 ? along * 0.5 : along; // turning round costs, but less than a full stop
  const tAcc = Math.max(0, (v - u) / MAX_ACCEL);
  const dAcc = ((u + v) / 2) * tAcc;
  let t: number;
  if (d <= dAcc) {
    // Solve u t + a t^2 / 2 = d.
    const a = MAX_ACCEL;
    t = (-u + Math.sqrt(Math.max(0, u * u + 2 * a * d))) / a;
  } else {
    t = tAcc + (d - dAcc) / v;
  }
  return t + Math.max(0, p.recoverUntil - now);
}

/**
 * Local pressure on a position in [0,1]: how hemmed-in the carrier is by
 * opponents.  An opponent right on top contributes ~1, fading to 0 at 6m.
 *
 * @param pos        Position to evaluate.
 * @param opponents  The opposing players.
 */
export function pressureAt(pos: Vec2, opponents: readonly SimPlayer[]): number {
  const RADIUS = 6;
  let pressure = 0;
  for (const o of opponents) {
    if (o.sentOff) continue;
    const d = dist(pos, o.pos);
    if (d < RADIUS) pressure += (RADIUS - d) / RADIUS;
  }
  return Math.min(1, pressure);
}

/** Distance to the nearest opponent (Infinity for none). */
export function nearestOpponentDist(pos: Vec2, opponents: readonly SimPlayer[]): number {
  let best = Infinity;
  for (const o of opponents) {
    if (o.sentOff) continue;
    const d = dist2(pos, o.pos);
    if (d < best) best = d;
  }
  return best === Infinity ? Infinity : Math.sqrt(best);
}

/** Distance from point p to the segment a-b, and the projection fraction. */
export function segmentDistance(p: Vec2, a: Vec2, b: Vec2): { d: number; t: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < 1e-9) return { d: dist(p, a), t: 0 };
  let t = dot(sub(p, a), ab) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return { d: dist(p, vec(a.x + ab.x * t, a.y + ab.y * t)), t };
}

/** Opponent reaction allowance (s) a passer assumes when judging a lane:
 *  seeing the pass, deciding to go, and turning (calibrated against what the
 *  physics then does: scripts/estimate-calibration.ts). */
const LANE_REACT = 0.3;

/** Advantage (s) a receiver already standing at the aim point has over an
 *  opponent arriving there: he is between that man and the ball. */
const RECEIVER_FIRST = 0.15;

/** Reach (m) an opponent has to cut out a ground ball. */
const LANE_REACH = 0.9;

/** A passer's estimate of one pass. */
export interface PassEstimate {
  /** Estimated chance the pass reaches its man (judgement, not a roll). */
  pC: number;
  /** Ball travel time to the aim point (s). */
  tBall: number;
  /** Tightest opponent margin on the lane (s; negative = he gets there first). */
  oppMargin: number;
  /** Receiver's arrival margin (s; positive = he is there in time). */
  recvMargin: number;
}

/**
 * Estimate a pass: for points along the ball's path, compare when the ball
 * arrives with when each opponent could be there, and whether the receiver
 * can be at the aim point in time.  Execution error widens with distance.
 *
 * @param from       Ball position.
 * @param aim        Intended destination.
 * @param v0         Launch speed (horizontal).
 * @param lofted     True for a ball in flight (only the ends are contestable).
 * @param receiver   Intended receiver.
 * @param opponents  The other side.
 * @param errScale   The passer's current error scale.
 * @param now        Match clock.
 */
export function estimatePass(
  from: Vec2, aim: Vec2, v0: number, lofted: boolean,
  receiver: SimPlayer, opponents: readonly SimPlayer[], errScale: number, now: number,
): PassEstimate {
  const d = dist(from, aim);
  const fr = lofted ? LOFT_FRACTIONS : GROUND_FRACTIONS;
  const tAt = (f: number): number => (lofted ? airTravelTime(v0, f * d) : groundTravelTime(v0, f * d));
  const tBall = tAt(1);
  const tRecv = timeToReach(receiver, aim, now);
  let oppMargin = Infinity;
  for (const o of opponents) {
    if (o.sentOff) continue;
    // Cheap prefilter: an opponent far from the whole lane cannot matter.
    const sd = segmentDistance(o.pos, from, aim);
    if (sd.d > 18) continue;
    const vO = Math.max(1, effectiveMaxSpeed(o));
    for (const f of fr) {
      const pt = vec(from.x + (aim.x - from.x) * f, from.y + (aim.y - from.y) * f);
      const tb = tAt(f);
      if (!Number.isFinite(tb)) continue;
      const to = LANE_REACT + timeToReach(o, pt, now) - LANE_REACH / vO;
      const m = to - tb + (f === 1 && tRecv < tb ? RECEIVER_FIRST : 0);
      if (m < oppMargin) oppMargin = m;
    }
  }
  const recvMargin = (Number.isFinite(tBall) ? tBall : 99) + 0.5 - tRecv;
  const base = lofted ? KICK_ERROR.lofted : KICK_ERROR.pass;
  const latStd = d * base.ang * errScale;
  const pAcc = sigmoid((1.7 - latStd) / 0.45);
  const pOpp = oppMargin === Infinity ? 1 : sigmoid((oppMargin + 0.05) / 0.16);
  const pRecv = sigmoid(recvMargin / 0.2);
  return { pC: pOpp * pRecv * pAcc, tBall, oppMargin, recvMargin };
}

const GROUND_FRACTIONS = [0.2, 0.4, 0.6, 0.8, 1.0] as const;
const LOFT_FRACTIONS = [0.06, 0.95, 1.0] as const;

/** A shooter's estimate of one shot at one target. */
export interface ShotEstimate {
  /** Estimated chance it goes in (judgement, not a roll). */
  p: number;
  pFrame: number;
  pBeat: number;
  pClear: number;
}

/**
 * Estimate a shot at target (gy, gz) on the goal line struck at `speed`:
 * the chance the strike stays inside the frame given the shooter's error,
 * the chance it beats the keeper's reach in the time available, and the
 * chance no defender's body is in the lane.
 *
 * @param from       Ball position.
 * @param side       Shooter's side.
 * @param gy         Target y on the goal line.
 * @param gz         Target height at the line.
 * @param speed      Strike speed.
 * @param errScale   Shooter's error scale.
 * @param keeper     The defending keeper (or undefined).
 * @param defenders  Defending outfielders.
 */
export function estimateShot(
  from: Vec2, side: TeamSide, gy: number, gz: number, speed: number, errScale: number,
  keeper: SimPlayer | undefined, defenders: readonly SimPlayer[], lead = 0,
): ShotEstimate {
  const gx = attackingGoalX(side);
  const aim = vec(gx, gy);
  const d = dist(from, aim);
  const T = airTravelTime(speed, d);
  // Frame: lateral and vertical spread of the strike at the line.
  const sy = Math.max(0.05, d * KICK_ERROR.shot.ang * errScale);
  const sz = Math.max(0.05, KICK_ERROR.shot.lift * errScale * T + 0.1);
  const pY = normCdf((GOAL_Y_MAX - 0.12 - gy) / sy) - normCdf((GOAL_Y_MIN + 0.12 - gy) / sy);
  const pZ = normCdf((GOAL_HEIGHT - 0.12 - gz) / sz);
  const pFrame = Math.max(0, pY) * pZ;
  // Keeper, judged where the ball will REALLY go: the strike's lateral error
  // is integrated over (5-point Gauss-Hermite), because an aim at the corner
  // that stays on target has usually drifted toward the keeper.  Treating
  // "on target" and "beats the keeper" as independent made every corner aim
  // look like a goal (estimates of 0.3 scored 9%).
  let pGoalLat = 0;
  let pOnLat = 0;
  // The spread is often a sizeable fraction of the goal mouth (3 m at 20 m
  // for an average striker), so the integral runs over the mouth itself on
  // a fine grid rather than over a few quadrature nodes about the aim.
  for (let y = GOAL_Y_MIN + 0.12 + MOUTH_STEP / 2; y < GOAL_Y_MAX - 0.12; y += MOUTH_STEP) {
    const z = (y - gy) / sy;
    if (z * z > 9) continue;
    const w = Math.exp(-0.5 * z * z) * MOUTH_STEP / (sy * 2.5066283);
    pOnLat += w;
    pGoalLat += w * beatKeeper(from, vec(gx, y), gz, speed, keeper);
  }
  const pBeat = pOnLat > 0 ? pGoalLat / pOnLat : 0;
  // Blockers: bodies near the lane, between shooter and goal.
  let pClear = 1;
  for (const o of defenders) {
    if (o.sentOff || o.role === 'GK') continue;
    // Where he will be when the ball is struck: a man closing the shooter
    // down keeps coming through the back-lift.
    const at = lead > 0 ? vec(o.pos.x + o.vel.x * lead, o.pos.y + o.vel.y * lead) : o.pos;
    const seg = segmentDistance(at, from, aim);
    // A man level with the ball (pressing the shooter) counts: a leg out
    // beside the ball blocks it as it leaves the foot.  Only bodies behind
    // the ball or beyond the line are out of it.
    if (seg.t >= 0.98) continue;
    if (seg.t <= 0) continue; // behind the ball: it is going away from him (step.ts resolveBall)
    // A hard shot is stopped only by a body in the lane, or by a man close
    // enough to see the back-lift, who moves into the lane from his reaction
    // until the ball passes him and throws a leg (step.ts laneVelocity).
    if (dist(o.pos, from) <= BLOCKER_RANGE && lead > 0) {
      const so = segmentDistance(o.pos, from, aim);
      if (so.t <= 0) continue;
      const tBall = lead + airTravelTime(speed, so.t * d);
      const s = laneCover(o, tBall - BLOCK_REACT, sub(aimPointOn(from, aim, so.t), o.pos));
      const gap = so.d - BLOCK_REACH_THROWN - s;
      if (gap < 0.6) pClear *= sigmoid(gap / 0.12);
    } else if (seg.d < BLOCK_REACH_BODY + 0.6) {
      pClear *= sigmoid((seg.d - BLOCK_REACH_BODY) / 0.12);
    }
  }
  return { p: Math.max(0, pZ * pGoalLat) * pClear, pFrame, pBeat, pClear };
}

/**
 * Lateral acceleration (m/s^2) of a diving keeper.  A dive is a push-off from
 * a set stance, not an instant sprint: a keeper needs about 0.4 s to move his
 * body a metre sideways.  Shared by the physics (step.ts) and the shooter's
 * estimate, so what a striker expects is what the keeper can actually do.
 */
export const DIVE_ACCEL = 9;

/** Time (s) for a keeper to move `s` metres sideways from a set stance. */
export function diveTime(s: number, vmax: number): number {
  if (s <= 0) return 0;
  const sAcc = (vmax * vmax) / (2 * DIVE_ACCEL);
  return s <= sAcc ? Math.sqrt((2 * s) / DIVE_ACCEL) : vmax / DIVE_ACCEL + (s - sAcc) / vmax;
}

/** Grid step (m) across the goal mouth for the shot integral. */
const MOUTH_STEP = 0.45;

/** Lag (s) before a blocker who has read the back-lift is moving at the lane
 *  (step.ts sets him going on the tick the shooter shapes: half a tick). */
export const BLOCK_REACT = 0.05;

/** Point at fraction t along a-b. */
function aimPointOn(a: Vec2, b: Vec2, t: number): Vec2 {
  const tt = t < 0 ? 0 : t > 1 ? 1 : t;
  return vec(a.x + (b.x - a.x) * tt, a.y + (b.y - a.y) * tt);
}

/**
 * Distance (m) a man can cover toward the lane in `t` seconds, starting
 * from his current velocity, with the same acceleration and top speed the
 * physics gives him (steering.ts).  `toLane` points from him to the lane.
 */
export function laneCover(p: SimPlayer, t: number, toLane: Vec2): number {
  if (t <= 0) return 0;
  const l = len(toLane);
  const u0 = l > 1e-6 ? Math.max(0, dot(p.vel, toLane) / l) : 0;
  const v = effectiveMaxSpeed(p);
  const tAcc = Math.max(0, (v - u0) / MAX_ACCEL);
  if (t <= tAcc) return u0 * t + 0.5 * MAX_ACCEL * t * t;
  return u0 * tAcc + 0.5 * MAX_ACCEL * tAcc * tAcc + v * (t - tAcc);
}

/** Shot-block geometry shared with step.ts: half-width (m) a standing body
 *  covers, the same with a leg thrown into the lane, and how close (m) to the
 *  shooter a man must be to see the back-lift and throw it. */
export const BLOCK_REACH_BODY = 0.45;
export const BLOCK_REACH_THROWN = 0.85;
export const BLOCKER_RANGE = 7;

/** Physics timestep the shooter's mental run uses (simulateSpatialMatch dtSec). */
const SIM_DT = 0.1;

/**
 * Judgement that the keeper cannot get a hand to a strike at (aim, gz): the
 * shooter runs the strike forward in his head with the same ball model
 * (ball.ts stepBall, so bounces and drag are what really happen) and the
 * same keeper (keeper.ts: he reacts after his reaction time, on a tick, then
 * dives from his current lateral speed with DIVE_ACCEL up to his dive speed,
 * with his diving reach).  The closest the ball comes to his hands, relative
 * to his reach, is squashed into a judgement.  Pure: no randomness.
 */
export function beatKeeper(from: Vec2, aim: Vec2, gz: number, speed: number, keeper: SimPlayer | undefined): number {
  if (!keeper || keeper.sentOff) return 1;
  const g = keeper.stats.goalkeeping / 100;
  const react = 0.17 + 0.2 * (1 - g) + 0.023;
  const tReact = Math.ceil(react / SIM_DT - 1e-9) * SIM_DT;
  const vmax = 3.4 + 2.4 * g;
  const d = dist(from, aim);
  const T = airTravelTime(speed, d);
  const ux = (aim.x - from.x) / Math.max(1e-6, d);
  const uy = (aim.y - from.y) / Math.max(1e-6, d);
  const ball: BallBody = { pos: from, vel: vec(ux * speed, uy * speed), z: 0, vz: verticalLaunchSpeed(0, gz, T) };
  // Where he reads the ball crossing his line (x), as readShot does.
  const kx = keeper.pos.x;
  const crossT = Math.abs(ux) > 1e-6 ? (kx - from.x) / ux : 0;
  const crossY = from.y + uy * Math.max(0, crossT);
  let ky = keeper.pos.y;
  let vy = keeper.vel.y;
  const dirY = Math.sign(crossY - ky);
  let best = Infinity;
  for (let t = SIM_DT; t <= 2.5; t += SIM_DT) {
    // Keeper first (the physics moves players before the ball).
    if (t > tReact + 1e-9) {
      const rem = (crossY - ky) * dirY;
      const want = rem > 0.05 ? dirY * Math.min(vmax, rem / SIM_DT) : 0;
      const dv = Math.max(-DIVE_ACCEL * SIM_DT, Math.min(DIVE_ACCEL * SIM_DT, want - vy));
      vy = Math.max(-vmax, Math.min(vmax, vy + dv));
    }
    ky += vy * SIM_DT;
    const prev = ball.pos;
    stepBall(ball, SIM_DT);
    const seg = segmentDistance(vec(kx, ky), prev, ball.pos);
    const reach = (t > tReact + 1e-9 ? (ball.z > 1.5 ? 1.15 : 1.35) : 1.1) * (0.9 + 0.2 * g);
    if (ball.z <= 2.65) best = Math.min(best, seg.d - reach);
    if ((ball.pos.x - aim.x) * Math.sign(ux || 1) >= 0) break;
  }
  return sigmoid(best / 0.15);
}

/** Base back-lift time of a shot (s): about 0.3 s for a 70-rated striker. */
export const SHOT_WINDUP = 0.34;

/** A player's back-lift time (s): quicker for good strikers. */
export function shotWindup(p: SimPlayer): number {
  return SHOT_WINDUP * (1.3 - 0.6 * p.stats.shooting / 100);
}

/** Speed of a player's current motion (m/s). */
export function speedOf(p: SimPlayer): number {
  return len(p.vel);
}
