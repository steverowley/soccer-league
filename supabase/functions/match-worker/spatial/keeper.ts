// ── features/match/logic/spatial/keeper.ts ───────────────────────────────────
// Goalkeeping (design 4.5).  The keeper holds a position on the line between
// the ball and the centre of his goal, advancing to narrow the angle; comes
// for a loose ball he can reach first; and, when a shot is struck, reacts
// after a short delay and dives toward where he reads the ball crossing his
// position, at a speed set by his goalkeeping.  He saves if his reach meets
// the ball before it crosses the line: that test is pure geometry in step.ts.

import { type Vec2, vec, sub, add, scale, normalize, dist } from './vec2.ts';
import {
  type SimPlayer, type SimWorld,
  PITCH_WIDTH, PENALTY_AREA_DEPTH, PENALTY_AREA_Y_MIN, PENALTY_AREA_Y_MAX, GOAL_HEIGHT,
  defendingGoalX,
} from './types.ts';
import { arrive, seek } from './steering.ts';
import { perceive } from './execution.ts';
import { type TickContext, PATH_SAMPLES, PATH_STRIDE } from './offball.ts';
import { predictPath } from './ball.ts';

/** Dive speed (m/s) for a keeper: about 4.5 for a 70-rated keeper. */
export function diveSpeed(k: SimPlayer): number {
  return KEEPER_DIVE_BASE + KEEPER_DIVE_SKILL * (k.stats.goalkeeping / 100);
}

/** Dive speed model (shared with the shooter's estimate in evaluate.ts). */
export const KEEPER_DIVE_BASE = 2.8;
export const KEEPER_DIVE_SKILL = 2.4;

/** Horizontal reach (m) of a keeper for a ball at height z. */
export function keeperReach(k: SimPlayer, z: number): number {
  const diving = k.dive !== null;
  const base = diving ? (z > 1.5 ? 1.15 : 1.35) : 0.95;
  return base * (0.9 + 0.2 * (k.stats.goalkeeping / 100));
}

/** Highest point (m) a keeper can get a hand to. */
export const KEEPER_TOP = 2.65;

/** Speed (m/s) up to which a keeper can hold a ball rather than parry it. */
export function catchSpeed(k: SimPlayer): number {
  return 13 + 14 * (k.stats.goalkeeping / 100);
}

/** True if `pos` is inside the penalty area `k` defends (where hands are legal). */
export function inOwnBox(k: SimPlayer, pos: Vec2): boolean {
  const gx = defendingGoalX(k.side);
  return Math.abs(pos.x - gx) <= PENALTY_AREA_DEPTH && pos.y >= PENALTY_AREA_Y_MIN && pos.y <= PENALTY_AREA_Y_MAX;
}

/**
 * Desired velocity for a keeper this tick (when not diving).
 */
export function keeperVelocity(k: SimPlayer, world: SimWorld, ctx: TickContext): Vec2 {
  const ball = world.ball;
  const gx = defendingGoalX(k.side);
  const goal = vec(gx, PITCH_WIDTH / 2);
  const dBall = dist(ball.pos, goal);
  // Come for a loose ball he gets to first, inside his area (or just outside
  // it when it is running through on goal).
  if (!ctx.carrier && ctx.best[k.side]?.id === k.id && ctx.now >= k.reactUntil) {
    const ic = ctx.intercept.get(k.id);
    const oppT = ctx.bestT[k.side === 'home' ? 'away' : 'home'];
    // He comes for a ball on the ground he will clearly win, and for a high
    // ball only into his six-yard area: otherwise his defenders deal with it.
    if (ic && inOwnBox(k, ic.pt)) {
      const deep = Math.abs(ic.pt.x - gx) < 7 && Math.abs(ic.pt.y - PITCH_WIDTH / 2) < 10;
      const high = world.ball.z > 1 || world.ball.vz > 2;
      if ((high && deep && ic.t < oppT + 0.2) || (!high && ic.t < oppT - 0.2)) return seek(k, ic.pt);
    }
  }
  // Hold the line between ball and goal centre, further out as the ball nears
  // the box (narrowing the angle), a sweeper's depth when play is far away.
  let depth: number;
  if (dBall > 50) depth = 9;
  else if (dBall > 25) depth = 3 + (dBall - 25) * 0.24;
  else depth = 1 + dBall * 0.08;
  // One-on-one: an opponent carrier in the box with nobody goal-side.
  if (ctx.carrier && ctx.carrier.side !== k.side && dBall < 18) depth = Math.min(dBall - 1.5, 2 + (18 - dBall) * 0.35);
  const dir = normalize(sub(ball.pos, goal));
  const spot = add(goal, scale(dir, Math.max(0.5, depth)));
  const y = Math.max(PENALTY_AREA_Y_MIN, Math.min(PENALTY_AREA_Y_MAX, spot.y));
  return arrive(k, vec(spot.x, y), 2, 1);
}

const PATH = new Float64Array(3 * PATH_SAMPLES * PATH_STRIDE);

/**
 * When a shot is coming and the keeper has reacted, commit a dive toward the
 * point where he reads the ball crossing his position.  Mutates `k.dive`.
 */
export function readShot(k: SimPlayer, world: SimWorld): void {
  const ball = world.ball;
  const gx = defendingGoalX(k.side);
  const steps = PATH_SAMPLES * PATH_STRIDE;
  predictPath(ball, steps, world.dtSec, PATH);
  // First sample at or beyond the keeper's x (toward his goal), else the line.
  const towardGoal = gx === 0 ? -1 : 1;
  let pt: Vec2 | null = null;
  let z = 0;
  for (let i = 0; i < steps; i++) {
    const x = PATH[3 * i]!;
    const y = PATH[3 * i + 1]!;
    if ((x - k.pos.x) * towardGoal >= 0 || (x - gx) * towardGoal >= 0) {
      pt = vec(k.pos.x, y);
      z = PATH[3 * i + 2]!;
      break;
    }
  }
  if (!pt) return;
  const seen = perceive(k, world, pt, 0.45);
  k.dive = { at: vec(k.pos.x, Math.max(PENALTY_AREA_Y_MIN, Math.min(PENALTY_AREA_Y_MAX, seen.y))), z: Math.min(GOAL_HEIGHT, z) };
}

/** Velocity of a diving keeper: straight at the dive point at dive speed. */
export function diveVelocity(k: SimPlayer): Vec2 {
  if (!k.dive) return vec(0, 0);
  const d = sub(k.dive.at, k.pos);
  const l = Math.hypot(d.x, d.y);
  if (l < 0.05) return vec(0, 0);
  const s = Math.min(diveSpeed(k), l / 0.1);
  return vec((d.x / l) * s, (d.y / l) * s);
}
