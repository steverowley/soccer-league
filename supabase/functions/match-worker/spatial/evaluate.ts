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
import { groundTravelTime, airTravelTime } from './ball.ts';
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
const LANE_REACT = 0.42;

/** Advantage (s) a receiver already standing at the aim point has over an
 *  opponent arriving there: he is between that man and the ball. */
const RECEIVER_FIRST = 0.25;

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
  keeper: SimPlayer | undefined, defenders: readonly SimPlayer[],
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
  // Keeper: lateral distance from him to the line of the ball where it
  // passes his position, against the time the ball needs to get there.
  let pBeat = 1;
  if (keeper && !keeper.sentOff) {
    const seg = segmentDistance(keeper.pos, from, aim);
    const tToKeeper = T * seg.t;
    const reach = (gz > 1.5 ? 1.15 : 1.35) * (0.9 + 0.2 * (keeper.stats.goalkeeping / 100));
    const dive = 3.4 + 2.4 * (keeper.stats.goalkeeping / 100);
    const react = 0.17 + 0.2 * (1 - keeper.stats.goalkeeping / 100);
    const need = react + Math.max(0, seg.d - reach) / dive;
    pBeat = sigmoid((tToKeeper - need) * -1 / 0.09);
    if (seg.d > reach + 4) pBeat = 1;
  }
  // Blockers: bodies near the lane, between shooter and goal.
  let pClear = 1;
  for (const o of defenders) {
    if (o.sentOff || o.role === 'GK') continue;
    const seg = segmentDistance(o.pos, from, aim);
    if (seg.t <= 0.02 || seg.t >= 0.98) continue;
    // Within his reach plus a leg thrown out: a likely block.
    if (seg.d < 2.6) pClear *= sigmoid((seg.d - 1.2) / 0.3);
  }
  return { p: pFrame * pBeat * pClear, pFrame, pBeat, pClear };
}

/** Speed of a player's current motion (m/s). */
export function speedOf(p: SimPlayer): number {
  return len(p.vel);
}
