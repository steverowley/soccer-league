// ── features/match/logic/spatial/steering.ts ─────────────────────────────────
// Reynolds-style steering behaviours.  Each function returns a DESIRED VELOCITY
// (m/s) — the velocity the player would adopt if this behaviour alone governed
// them.  step.ts blends the relevant behaviours per player, then accelerates
// the player's actual velocity toward the blend (bounded by an acceleration
// cap) and integrates position.  Keeping "desire" and "physics" separate makes
// each behaviour trivial to reason about and unit-test.
//
// All behaviours are pure: world state in, vector out, nothing mutated.

import {
  type Vec2, vec, sub, add, scale, len, normalize, dist, ZERO,
} from './vec2';
import { type SimPlayer, defendingGoalX } from './types';

/**
 * A player's current top speed, after stamina drain.
 * At full stamina they hit maxSpeed; fully drained they manage 60% of it.
 * 0.6 floor keeps even an exhausted player jogging rather than freezing.
 *
 * @param p  The player.
 * @returns  Effective max speed in m/s.
 */
export function effectiveMaxSpeed(p: SimPlayer): number {
  return p.maxSpeed * (0.6 + 0.4 * p.stamina);
}

/**
 * Seek: head straight at `target` at full effective speed.
 * The simplest behaviour — used when getting somewhere fast matters more than
 * arriving gently (e.g. sprinting onto a through ball).
 *
 * @returns Desired velocity toward target; ZERO if already on it.
 */
export function seek(p: SimPlayer, target: Vec2): Vec2 {
  const toTarget = sub(target, p.pos);
  if (len(toTarget) < 1e-6) return ZERO;
  return scale(normalize(toTarget), effectiveMaxSpeed(p));
}

/**
 * Arrive: seek, but ramp speed down inside `slowRadius` so the player settles
 * onto the target instead of overshooting and oscillating.  Used for holding a
 * formation anchor or a marking position — places you want to STOP at.
 *
 * @param p           The player.
 * @param target      Where to arrive.
 * @param slowRadius  Distance within which to start decelerating (metres).
 * @returns           Desired velocity, scaled down near the target.
 */
export function arrive(p: SimPlayer, target: Vec2, slowRadius: number): Vec2 {
  const toTarget = sub(target, p.pos);
  const d = len(toTarget);
  if (d < 0.2) return ZERO; // close enough — stand still rather than jitter
  const maxV = effectiveMaxSpeed(p);
  // Linear ramp: full speed beyond slowRadius, proportionally less inside it.
  const desiredSpeed = d >= slowRadius ? maxV : maxV * (d / slowRadius);
  return scale(normalize(toTarget), desiredSpeed);
}

/**
 * Pursue a moving ball by aiming where it WILL be, not where it is — the
 * classic "lead your target" so chasers don't trail forever behind a rolling
 * ball.  Lead time scales with distance but is capped so we never aim at a
 * wildly extrapolated point.
 *
 * @param p         The chaser.
 * @param ballPos   Current ball position.
 * @param ballVel   Current ball velocity (m/s).
 * @returns         Desired velocity toward the ball's predicted position.
 */
export function pursueBall(p: SimPlayer, ballPos: Vec2, ballVel: Vec2): Vec2 {
  const d = dist(p.pos, ballPos);
  const myV = Math.max(1, effectiveMaxSpeed(p));
  // Predict the time to close the gap, capped at 1.2s so a fast ball doesn't
  // send the chaser sprinting toward an unrealistic interception point.
  const lead = Math.min(1.2, d / myV);
  const predicted = add(ballPos, scale(ballVel, lead));
  return seek(p, predicted);
}

/**
 * Separation: a short-range repulsion from nearby teammates so players don't
 * collapse onto the same point.  Each crowder within `radius` contributes a
 * push away, stronger the closer they are.  The result is capped at a fraction
 * of max speed so separation nudges shape without overpowering the primary
 * behaviour (chasing / marking).
 *
 * @param p        The player.
 * @param others   Teammates to stay clear of.
 * @param radius   Personal-space radius in metres.
 * @returns        A desired-velocity contribution pushing away from crowders.
 */
export function separation(p: SimPlayer, others: readonly SimPlayer[], radius: number): Vec2 {
  let push = ZERO;
  for (const o of others) {
    if (o.id === p.id) continue;
    const away = sub(p.pos, o.pos);
    const d = len(away);
    if (d > 1e-6 && d < radius) {
      // Weight ∝ how deep into personal space they are (1 at touching, 0 at edge).
      push = add(push, scale(normalize(away), (radius - d) / radius));
    }
  }
  if (len(push) < 1e-6) return ZERO;
  // Cap separation at 55% of max speed — assertive but never dominant.
  return scale(normalize(push), effectiveMaxSpeed(p) * 0.55);
}

/**
 * The goal-side point a defender should occupy to mark an attacker: a couple of
 * metres from the attacker on the line toward the defender's OWN goal, so the
 * defender stays between attacker and goal (correct defensive side).
 *
 * @param defender  The marking player (its side determines which goal to cover).
 * @param attacker  The opponent being marked.
 * @param goalSideGap  Metres goal-side of the attacker to sit (default 2.5).
 * @returns         The position to arrive at to mark.
 */
export function markTarget(defender: SimPlayer, attacker: SimPlayer, goalSideGap = 2.5): Vec2 {
  const ownGoalX = defendingGoalX(defender.side);
  const ownGoal = vec(ownGoalX, attacker.pos.y);
  const toGoal = normalize(sub(ownGoal, attacker.pos));
  // If attacker sits exactly on the goal x, toGoal may be ~vertical; that's
  // fine — we still offset toward goal in whatever direction it points.
  return add(attacker.pos, scale(toGoal, goalSideGap));
}
