// ── features/match/logic/spatial/offball.ts ──────────────────────────────────
// Off the ball (design 4.6): every player who is not at the ball has jobs to
// choose from (chase a loose ball, meet a pass, press the carrier, cover,
// mark, offer support, run in behind, hold shape) and SCORES them against each
// other at his own think cadence, so a job can lose: a full-back abandons his
// touchline for a loose ball when that is worth more.
//
// What is AUTHORED, honestly: the team shape (formation anchors that slide
// with the ball, the defensive line, the width) comes from formation.ts.  The
// research found pure local scoring makes 22 players swarm the ball, so the
// shape is given and the jobs are scored on top of it.
//
// Also here: the shared per-tick context (who can reach the ball first), which
// is pure geometry over the predicted ball path.

import { type Vec2, vec, sub, add, scale, normalize, dist, len, ZERO } from './vec2.ts';
import {
  type SimPlayer, type SimWorld, type TeamSide, type OffBallJob,
  PITCH_LENGTH, PITCH_WIDTH, attackingGoalX, defendingGoalX, otherSide,
} from './types.ts';
import { predictPath } from './ball.ts';
import { timeToReach, positionValue, nearestOpponentDist, pressureAt, progressOf } from './evaluate.ts';
import { effectiveMaxSpeed, arrive, seek, separation, markTarget } from './steering.ts';
import { dynamicAnchor } from './formation.ts';
import { softPick, lateness, goalDiff, momentumOf, offsideLineX } from './possession.ts';
import { perceive, slip } from './execution.ts';

/** Ball-path lookahead: samples, and ticks per sample. */
export const PATH_SAMPLES = 25;
export const PATH_STRIDE = 2;

/** Reach (m) for playing a ball with the feet, and the height limits. */
export const FOOT_REACH = 0.85;
export const HEAD_Z = 2.35;

/** Beyond this distance (m) from his man the ball is loose, not carried. */
export const LOOSE_DIST = 3.5;

/** One player's earliest way to the ball. */
export interface Intercept {
  /** Seconds until he can be at the ball. */
  t: number;
  /** Where. */
  pt: Vec2;
}

/** Shared per-tick facts every decision reads. */
export interface TickContext {
  now: number;
  /** The player in possession, if the ball is under someone's control. */
  carrier: SimPlayer | null;
  /** The side in possession (carrier's side, or the side whose kick is in flight). */
  attacking: TeamSide | null;
  /** Earliest intercept per player id. */
  intercept: Map<string, Intercept>;
  /** Fastest outfielder (or keeper) to the ball per side, with the time. */
  best: { home: SimPlayer | null; away: SimPlayer | null };
  bestT: { home: number; away: number };
  /** Second-fastest per side, with the time. */
  secondT: { home: number; away: number };
  /** Rank by time to the carrier among outfielders of the side NOT in possession. */
  pressRank: Map<string, number>;
  /** Marking assignment per defender id: the attacker he picks up and that man's value. */
  markOf: Map<string, { id: string; v: number }>;
}

/** Attackers worth less than this (positionValue) are left to the zone. */
const MARK_MIN_VALUE = 0.02;
/** A defender further than this (m) from an attacker does not pick him up. */
const MARK_MAX_DIST = 22;

const PATH_BUF = new Float64Array(3 * PATH_SAMPLES * PATH_STRIDE);

/**
 * Build the tick context: predict the ball path and find, for every player,
 * the earliest point on it he can reach in time.
 */
export function buildContext(world: SimWorld): TickContext {
  const now = world.clockSec;
  const ball = world.ball;
  const dt = world.dtSec;
  const all = [...world.home, ...world.away];
  let carrier = ball.ownerId ? all.find((p) => p.id === ball.ownerId) ?? null : null;
  // A ball that has got away from its man is loose: anyone may go for it.
  if (carrier && (carrier.sentOff || dist(carrier.pos, ball.pos) > LOOSE_DIST)) {
    ball.ownerId = null;
    carrier = null;
  }
  const attacking: TeamSide | null = carrier ? carrier.side : ball.kick ? ball.kick.side : ball.lastTouchSide;

  const steps = PATH_SAMPLES * PATH_STRIDE;
  predictPath(ball, steps, dt, PATH_BUF);
  const intercept = new Map<string, Intercept>();
  const best = { home: null as SimPlayer | null, away: null as SimPlayer | null };
  const bestT = { home: Infinity, away: Infinity };
  const secondT = { home: Infinity, away: Infinity };
  for (const p of all) {
    if (p.sentOff) continue;
    const reachZ = p.role === 'GK' ? 2.7 : HEAD_Z;
    const v = Math.max(1, effectiveMaxSpeed(p));
    let found: Intercept | null = null;
    // Now (index -1 is the current position).
    if (ball.z <= reachZ && dist(p.pos, ball.pos) <= FOOT_REACH) {
      found = { t: 0, pt: ball.pos };
    } else {
      for (let s = 0; s < PATH_SAMPLES; s++) {
        const i = (s + 1) * PATH_STRIDE - 1;
        const z = PATH_BUF[3 * i + 2]!;
        if (z > reachZ) continue;
        const pt = vec(PATH_BUF[3 * i]!, PATH_BUF[3 * i + 1]!);
        const tBall = (i + 1) * dt;
        const tMe = timeToReach(p, pt, now) - FOOT_REACH / v;
        if (tMe <= tBall) { found = { t: tBall, pt }; break; }
      }
      if (!found) {
        const i = steps - 1;
        const pt = vec(PATH_BUF[3 * i]!, PATH_BUF[3 * i + 1]!);
        found = { t: Math.max(steps * dt, timeToReach(p, pt, now)), pt };
      }
    }
    intercept.set(p.id, found);
    const s = p.side;
    if (found.t < bestT[s]) { secondT[s] = bestT[s]; bestT[s] = found.t; best[s] = p; }
    else if (found.t < secondT[s]) secondT[s] = found.t;
  }

  // Pressing order of the side out of possession: by time to a point just
  // goal-side of where the carrier will be (a man chasing from behind cannot
  // confront him; the one in front can).
  const pressRank = new Map<string, number>();
  if (carrier) {
    const def = (carrier.side === 'home' ? world.away : world.home).filter((p) => !p.sentOff && p.role !== 'GK');
    const goal = vec(defendingGoalX(def[0]?.side ?? otherSide(carrier.side)), PITCH_WIDTH / 2);
    const ahead = add(carrier.pos, scale(carrier.vel, 0.8));
    const front = add(ahead, scale(normalize(sub(goal, ahead)), 2));
    const ranked = def.map((p) => ({ p, t: timeToReach(p, front, now) })).sort((a, b) => a.t - b.t);
    ranked.forEach((r, i) => pressRank.set(r.p.id, i));
  }
  // Marking assignments for the side defending (authored organisation): the
  // most dangerous attackers, in order, each picked up by the nearest free
  // defender who is not the first presser.  Greedy, O(attackers x defenders).
  const markOf = new Map<string, { id: string; v: number }>();
  const defSide = attacking === 'home' ? 'away' : attacking === 'away' ? 'home' : null;
  if (defSide) {
    const def = (defSide === 'home' ? world.home : world.away)
      .filter((p) => !p.sentOff && p.role !== 'GK' && pressRank.get(p.id) !== 0);
    const att = (defSide === 'home' ? world.away : world.home)
      .filter((a) => !a.sentOff && a.role !== 'GK' && a !== carrier)
      .map((a) => ({ a, v: positionValue(a.pos, a.side) }))
      .filter((x) => x.v > MARK_MIN_VALUE)
      .sort((x, y) => y.v - x.v);
    const free = new Set(def);
    for (const { a, v } of att) {
      let best: SimPlayer | null = null;
      let bestD = MARK_MAX_DIST;
      for (const d of free) {
        const dd = dist(d.pos, a.pos);
        if (dd < bestD) { bestD = dd; best = d; }
      }
      if (best) { markOf.set(best.id, { id: a.id, v }); free.delete(best); }
    }
  }
  return { now, carrier, attacking, intercept, best, bestT, secondT, pressRank, markOf };
}

// ── Job evaluation ─────────────────────────────────────────────────────────

/** Bonus for staying with the current job (stops flicker). */
const JOB_HYSTERESIS = 0.07;

/** Job decision temperature. */
const JOB_TEMPERATURE = 0.05;

/** How far beyond the line (m) a runner aims once he breaks. */
const RUN_BREAK = 5;

/** Press-intensity multiplier for a side (style, momentum, score and clock, work rate). */
export function pressIntensity(p: SimPlayer, world: SimWorld): number {
  const style = p.side === 'home' ? world.homeStyle : world.awayStyle;
  let k = p.traits.work * (1 + 2 * style.press + style.tackle);
  k *= 1 + 0.3 * momentumOf(world, p.side);
  if (world.flags.scoreClockTerm) {
    const L = lateness(world);
    const gd = goalDiff(world, p.side);
    if (gd > 0) k *= 1 - 0.25 * L;
    else if (gd < 0) k *= 1 + 0.25 * L;
  }
  return k;
}

/**
 * Re-evaluate a player's off-ball job.  Mutates p.job / jobTarget / jobRef /
 * jobOffset and schedules the next think.
 */
export function thinkJob(p: SimPlayer, world: SimWorld, ctx: TickContext): void {
  const now = ctx.now;
  const side = p.side;
  const opp = otherSide(side);
  const ball = world.ball;
  const mine = ctx.intercept.get(p.id);
  const tMe = mine ? mine.t : Infinity;
  const inPossession = ctx.attacking === side && ctx.carrier !== null && ctx.carrier.side === side;
  const theyHaveIt = ctx.carrier !== null && ctx.carrier.side === opp;
  const looseOrFlight = ctx.carrier === null;

  const jobs: OffBallJob[] = [];
  const utils: number[] = [];
  const refs: Array<string | null> = [];
  const push = (j: OffBallJob, u: number, ref: string | null = null): void => {
    jobs.push(j); utils.push(u + (p.job === j ? JOB_HYSTERESIS : 0)); refs.push(ref);
  };

  push('shape', 0.3);

  if (looseOrFlight) {
    const kick = ball.kick;
    const intendedForMe = kick !== null && kick.targetId === p.id && kick.side === side;
    const tOppBest = ctx.bestT[opp];
    const iAmBest = ctx.best[side]?.id === p.id;
    if (intendedForMe) push('chase', 1.2);
    else if (iAmBest) push('chase', 0.55 + 0.4 / (1 + Math.exp(-(tOppBest - tMe + 0.3) / 0.25)));
    else if (tMe - ctx.bestT[side] < 0.7 && tMe < 2.5) push('chase', 0.36);
  }

  if (theyHaveIt && ctx.carrier) {
    const c = ctx.carrier;
    const rank = ctx.pressRank.get(p.id) ?? 99;
    const danger = positionValue(c.pos, opp);
    const k = pressIntensity(p, world);
    // Pressing is keenest close to the ball; further away the block holds.
    // Within about 35 m of his own goal somebody must always engage.
    const deepBall = Math.abs(c.pos.x - defendingGoalX(p.side)) < 35;
    const near = deepBall ? 1 : 1 / (1 + Math.exp(-(11 - dist(p.pos, c.pos)) / 3));
    if (rank === 0) push('press', (0.5 + 3 * danger) * k * near, c.id);
    else if (rank === 1) push('cover', (0.32 + 1.5 * danger) * k * near, c.id);
  }

  const assigned = ctx.markOf.get(p.id);
  if (!inPossession && assigned) {
    push('mark', 0.3 + 8 * assigned.v, assigned.id);
  } else if (!inPossession) {
    // Mark the most dangerous attacker near my anchor.
    const anchor = dynamicAnchor(p, ball.pos);
    let bestA: SimPlayer | null = null;
    let bestV = 0;
    for (const a of opp === 'home' ? world.home : world.away) {
      if (a.sentOff || a.role === 'GK' || (ctx.carrier && a.id === ctx.carrier.id)) continue;
      const d = dist(a.pos, anchor);
      if (d > 14) continue;
      const v = positionValue(a.pos, opp) * (1 - d / 16);
      if (v > bestV) { bestV = v; bestA = a; }
    }
    if (bestA) push('mark', 0.26 + 6 * bestV, bestA.id);
  }

  if (inPossession && ctx.carrier) {
    const c = ctx.carrier;
    const dC = dist(p.pos, c.pos);
    if (dC < 22) push('support', 0.34 + 0.06 * (1 - dC / 22), c.id);
    const cProg = side === 'home' ? c.pos.x / PITCH_LENGTH : 1 - c.pos.x / PITCH_LENGTH;
    const cPress = pressureAt(c.pos, opp === 'home' ? world.home : world.away);
    if ((p.role === 'FW' || (p.role === 'MF' && p.traits.dribble > 1.05)) && cProg > 0.3 && cPress < 0.6) {
      let u = 0.36 * p.traits.work;
      if (world.flags.scoreClockTerm && goalDiff(world, side) < 0) u *= 1 + 0.3 * lateness(world);
      push('run', u);
    }
  }

  const i = softPick(p.rng, utils, JOB_TEMPERATURE, world.flags.utilitySoftness);
  const job = jobs[i]!;
  p.job = job;
  p.jobRef = refs[i] ?? null;
  if (job === 'support' && ctx.carrier) p.jobOffset = supportOffset(p, world, ctx.carrier);
  if (job === 'run') {
    // Hold the shoulder of the last defender (as he reads the line), ready to
    // spin in behind the moment the ball is played.
    const line = offsideLineX(world, side);
    const seen = perceive(p, world, vec(line, p.pos.y), 1.6).x;
    const dir = side === 'home' ? 1 : -1;
    const y = p.homePos.y * 0.7 + (PITCH_WIDTH / 2) * 0.3;
    // Once the man on the ball has it settled and is facing up, the runner
    // breaks: he has to go before the pass to beat his marker, and going a
    // fraction early (his read of the line and of the moment is imprecise) is
    // how he is caught offside.
    const c = ctx.carrier;
    const goNow = c !== null && c.side === side && c.id !== p.id
      && world.clockSec - world.ball.controlSec > 0.5 + slip(p, world, 0.3)
      // A run that is not found within a couple of seconds is checked back
      // onside rather than left standing offside.
      && world.clockSec - world.ball.controlSec < 2.2
      && progressOf(c.pos, side) > 0.35;
    p.jobTarget = vec(Math.max(1, Math.min(PITCH_LENGTH - 1, seen + dir * (goNow ? RUN_BREAK : -0.3))), y);
  }
  const read = p.stats.positioning / 100;
  p.nextThinkSec = now + 0.35 + 0.3 * (1 - read);
}

/** Pick the most open support angle around the carrier. */
function supportOffset(p: SimPlayer, world: SimWorld, c: SimPlayer): Vec2 {
  const opps = (p.side === 'home' ? world.away : world.home);
  const gx = attackingGoalX(p.side);
  const toGoal = normalize(sub(vec(gx, PITCH_WIDTH / 2), c.pos));
  const anchor = dynamicAnchor(p, world.ball.pos);
  let best = vec(0, 10);
  let bestS = -Infinity;
  for (const a of SUPPORT_ANGLES) {
    const r = a === 0 ? 14 : 11;
    const cs = Math.cos(a);
    const sn = Math.sin(a);
    const off = scale(vec(toGoal.x * cs - toGoal.y * sn, toGoal.x * sn + toGoal.y * cs), r);
    const spot = add(c.pos, off);
    if (spot.x < 2 || spot.x > PITCH_LENGTH - 2 || spot.y < 2 || spot.y > PITCH_WIDTH - 2) continue;
    const open = Math.min(10, nearestOpponentDist(spot, opps));
    const s = open + 0.3 * (off.x * (gx > c.pos.x ? 1 : -1)) - 0.25 * dist(spot, anchor);
    if (s > bestS) { bestS = s; best = off; }
  }
  return best;
}

const SUPPORT_ANGLES = [0, 0.7, -0.7, 1.4, -1.4, 2.3, -2.3] as const;

// ── Movement ───────────────────────────────────────────────────────────────

/** Distance (m) a presser holds goal-side of the ball while jockeying. */
export const JOCKEY_DIST = 3.0;

/** Jockey distance (m) inside the last thirty metres before his own goal. */
export const JOCKEY_DIST_DEEP = 1.8;

/**
 * Desired velocity for an outfielder doing his job this tick.
 */
export function jobVelocity(p: SimPlayer, world: SimWorld, ctx: TickContext): Vec2 {
  const ball = world.ball;
  const mates = p.side === 'home' ? world.home : world.away;
  const sep = separation(p, mates, 3.5);
  const work = Math.sqrt(p.traits.work);
  switch (p.job) {
    case 'chase': {
      if (ctx.now >= p.reactUntil) {
        const ic = ctx.intercept.get(p.id);
        if (ic) p.jobTarget = ic.pt;
      }
      // Run hard at the meeting point, braking into it so the ball can be
      // controlled rather than overrun.
      return arrive(p, p.jobTarget, 2.2, 1);
    }
    case 'press': {
      const c = ctx.carrier;
      if (!c) return arrive(p, shapePoint(p, world), 5, 0.6 * work);
      const goal = vec(defendingGoalX(p.side), PITCH_WIDTH / 2);
      // Tighter the nearer his own goal: in the last third he stands up close.
      const deep = dist(c.pos, goal) < 30;
      const jockey = add(c.pos, scale(normalize(sub(goal, c.pos)), deep ? JOCKEY_DIST_DEEP : JOCKEY_DIST));
      const d = dist(p.pos, jockey);
      return d > 4 ? seek(p, jockey) : arrive(p, jockey, 2.5, 0.95);
    }
    case 'cover': {
      const c = ctx.carrier;
      if (!c) return arrive(p, shapePoint(p, world), 5, 0.6 * work);
      const goal = vec(defendingGoalX(p.side), PITCH_WIDTH / 2);
      // The cover man sits on the line from ball to goal: the shooting lane.
      const pt = add(c.pos, scale(normalize(sub(goal, c.pos)), dist(c.pos, goal) < 30 ? 4.5 : 7));
      return add(arrive(p, pt, 4, (dist(p.pos, pt) > 5 ? 1 : 0.85) * work), scale(sep, 0.5));
    }
    case 'mark': {
      const a = findById(world, p.jobRef);
      if (!a) return arrive(p, shapePoint(p, world), 5, 0.6 * work);
      const mt = markTarget(p, a, 1.2);
      return add(arrive(p, mt, 3, (dist(p.pos, mt) > 5 ? 1 : 0.9) * work), scale(sep, 0.5));
    }
    case 'support': {
      const c = ctx.carrier;
      if (!c) return arrive(p, shapePoint(p, world), 5, 0.6 * work);
      const pt = clampIn(add(c.pos, p.jobOffset));
      return add(arrive(p, pt, 4, 0.8 * work), sep);
    }
    case 'run': {
      const d = dist(p.pos, p.jobTarget);
      if (d < 1) return arrive(p, p.jobTarget, 3, 0.7);
      return seek(p, p.jobTarget);
    }
    default: {
      const pt = shapePoint(p, world);
      const d = dist(p.pos, pt);
      // Caught upfield with the ball between him and his own goal, he
      // sprints back; otherwise he shuffles across at a working pace.
      const ownGoalX = defendingGoalX(p.side);
      const beaten = ctx.attacking !== null && ctx.attacking !== p.side
        && Math.abs(world.ball.pos.x - ownGoalX) < Math.abs(p.pos.x - ownGoalX);
      return add(arrive(p, pt, 6, (beaten ? 1 : d > 12 ? 0.85 : 0.6) * work), sep);
    }
  }
}

/**
 * The authored shape point: the formation anchor shifted with the ball, with
 * the score-and-clock line shift (leading late sits deeper).
 */
export function shapePoint(p: SimPlayer, world: SimWorld): Vec2 {
  let a = dynamicAnchor(p, world.ball.pos);
  // Out of possession the block compacts (authored): midfield and attack drop
  // toward their own back line and everyone squeezes toward the ball's side,
  // so the space between and behind the lines closes.
  const ball = world.ball;
  const inPossession = ball.ownerId !== null
    ? (p.side === 'home' ? world.home : world.away).some((q) => q.id === ball.ownerId)
    : ball.lastTouchSide === p.side;
  if (inPossession && p.role !== 'GK') {
    // In possession nobody takes up a station beyond the offside line: a man
    // standing offside is no use to the passer.
    const fwd = p.side === 'home' ? 1 : -1;
    const line = offsideLineX(world, p.side);
    if ((a.x - (line - fwd)) * fwd > 0) a = vec(line - fwd, a.y);
  }
  if (!inPossession && p.role !== 'GK') {
    const back = p.side === 'home' ? -1 : 1;
    const drop = p.role === 'MF' ? 7 : p.role === 'FW' ? 9 : 2;
    // The squeeze toward the ball's side is strongest for the back line and
    // in their own half, where the space between centre-back and full-back
    // is what gets attacked.
    const ownHalf = (ball.pos.x - PITCH_LENGTH / 2) * back > 0;
    const squeeze = (p.role === 'DF' ? 0.32 : 0.24) * (ownHalf ? 1.25 : 0.8);
    a = clampIn(vec(a.x + back * drop, a.y + (ball.pos.y - a.y) * squeeze));
    // Keep the lines close: midfield within 11 m of the back line, the
    // forwards within 24 m, so there is no free pocket between them.
    if (p.role === 'MF' || p.role === 'FW') {
      const df = (p.side === 'home' ? world.home : world.away).find((q) => q.role === 'DF' && !q.sentOff);
      if (df) {
        const dfX = dynamicAnchor(df, ball.pos).x + back * 2;
        const gap = p.role === 'MF' ? 11 : 24;
        const fwd = -back;
        if ((a.x - dfX) * fwd > gap) a = vec(dfX + fwd * gap, a.y);
      }
    }
  }
  if (!world.flags.scoreClockTerm) return a;
  const L = lateness(world);
  const gd = goalDiff(world, p.side);
  if (L === 0 || gd === 0) return a;
  const dir = p.side === 'home' ? 1 : -1;
  const shift = (gd > 0 ? -5 : 5) * L * dir;
  return clampIn(vec(a.x + shift, a.y));
}

/** Clamp a point inside the pitch with a 1.5 m inset. */
export function clampIn(pt: Vec2): Vec2 {
  return vec(Math.max(1.5, Math.min(PITCH_LENGTH - 1.5, pt.x)), Math.max(1.5, Math.min(PITCH_WIDTH - 1.5, pt.y)));
}

/** Look a player up by id on either side. */
export function findById(world: SimWorld, id: string | null): SimPlayer | null {
  if (!id) return null;
  for (const p of world.home) if (p.id === id) return p;
  for (const p of world.away) if (p.id === id) return p;
  return null;
}

/** Velocity magnitude helper (avoid importing len everywhere). */
export function speed(v: Vec2): number {
  return len(v);
}

export { ZERO };
