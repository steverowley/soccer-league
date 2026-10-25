// ── features/match/logic/spatial/possession.ts ───────────────────────────────
// The on-ball brain (design 3.4, 4.4, 4.5).  When the ball is at his feet the
// carrier SCORES every option he has from where he stands (each shot target,
// each pass to each team-mate, each carry direction, a clearance) and picks
// among the best with a small softmax temperature.  Considerations are
// response curves multiplied together; personality, confidence, momentum and
// the score-and-clock term are multipliers on the same evaluator.
//
// The utility of an action is in expected-goal units:
//   U = (how likely it works, as he judges it) x (value of where it leaves us)
//       - (how likely it fails) x (risk aversion) x (value to THEM of the ball there)
// The estimate only CHOOSES the action; whether the pass arrives, the touch
// holds or the shot beats the keeper is then decided physically in step.ts.
//
// Also home to the pure rule geometry (offside position, penalty area).

import {
  type Vec2, vec, sub, add, scale, normalize, dist, dot,
} from './vec2.ts';
import { type Rng } from './rng.ts';
import {
  type SimPlayer, type SimWorld, type TeamSide, type KickKind, type RestartKind,
  GOAL_Y_MIN, GOAL_Y_MAX, PITCH_WIDTH, PITCH_LENGTH,
  PENALTY_AREA_DEPTH, PENALTY_AREA_Y_MIN, PENALTY_AREA_Y_MAX,
  attackingGoalX, defendingGoalX, otherSide,
} from './types.ts';
import {
  positionValue, xgGeom, estimatePass, estimateShot, pressureAt, timeToReach,
  progressOf, nearestOpponentDist, shotWindup,
} from './evaluate.ts';
import { errorScale, perceive } from './execution.ts';
import { effectiveMaxSpeed, MAX_ACCEL } from './steering.ts';
import { GRAVITY, groundLaunchSpeed, airLaunchSpeed } from './ball.ts';

export { pressureAt } from './evaluate.ts';

// ── Play-style and term weights ──────────────────────────────────────────────

/** How strongly a play-style's shoot delta scales shot utility. */
const STYLE_SHOOT_K = 2.5;
/** How strongly a play-style's pass delta scales pass utility. */
const STYLE_PASS_K = 1.5;
/** How strongly a play-style's dribble delta scales carry utility. */
const STYLE_DRIBBLE_K = 1.5;

/** Global shot appetite: the one shared weight on the value of shooting. */
const SHOT_APPETITE = 0.3;

/** Anti-passivity: each consecutive carry scales carry utility by this. */
const HOLD_DECAY = 0.97;

/** Reach (m) of an opponent's foot when judging whether a carry is safe. */
const CARRY_FOOT = 0.9;

/** Carry probe length (m) for evaluating a dribble direction. */
const CARRY_PROBE = 5;

/** Value of a cross that does not find its man: a corner or a second ball. */
const CROSS_SECOND_BALL = 0.03;

/** How far (m) beyond the line a passer must see a man to rule him out as offside. */
const SEEN_OFFSIDE = 1.5;

/** Base decision temperature (expected-goal units). */
const BASE_TEMPERATURE = 0.006;

// ── Action type ─────────────────────────────────────────────────────────────

/** The carrier's chosen action for this touch. */
export type CarrierAction =
  | { kind: 'shoot'; aim: Vec2; gz: number; speed: number; utility: number; est: number; chip: boolean;
      /** Estimate components (frame, keeper beaten, lane clear), for traces. */
      parts?: { f: number; b: number; c: number } }
  | { kind: 'pass'; target: SimPlayer; aim: Vec2; speed: number; vz: number; kick: KickKind; utility: number; pC: number; lofted: boolean }
  | { kind: 'dribble'; dir: Vec2; utility: number }
  | { kind: 'clear'; aim: Vec2; speed: number; vz: number; utility: number };

/** What restart (if any) this touch is taking; restricts the option set. */
export type ActionMode = 'open' | RestartKind;

// ── Context terms ───────────────────────────────────────────────────────────

/** Lateness of the match in [0,1]: 0 before the hour, 1 at full time. */
export function lateness(world: SimWorld): number {
  const t = world.clockSec / Math.max(1, world.matchSeconds);
  return t < 0.6 ? 0 : t > 1 ? 1 : (t - 0.6) / 0.4;
}

/** Goal difference from `side`'s point of view. */
export function goalDiff(world: SimWorld, side: TeamSide): number {
  return side === 'home' ? world.score[0] - world.score[1] : world.score[1] - world.score[0];
}

/** Momentum of a side in [-1, 1] (0 when ablated). */
export function momentumOf(world: SimWorld, side: TeamSide): number {
  if (!world.flags.momentum) return 0;
  return side === 'home' ? world.momentum[0] : world.momentum[1];
}

/**
 * Risk aversion: the weight on the value the opponent gets if we lose the
 * ball.  Leading late raises it (keep it safe), trailing late lowers it.
 */
export function lossWeight(p: SimPlayer, world: SimWorld): number {
  let w = p.traits.caution;
  if (world.flags.scoreClockTerm) {
    const L = lateness(world);
    const gd = goalDiff(world, p.side);
    if (gd > 0) w *= 1 + 0.6 * L;
    else if (gd < 0) w *= 1 - 0.4 * L;
  }
  if (world.flags.confidence) w *= 1.05 - 0.1 * p.confidence;
  return w;
}

/** Shot appetite multiplier for a player now (style, personality, momentum, score and clock). */
export function shotAppetite(p: SimPlayer, world: SimWorld): number {
  const style = p.side === 'home' ? world.homeStyle : world.awayStyle;
  let a = SHOT_APPETITE * p.traits.shoot * (1 + style.shoot * STYLE_SHOOT_K);
  a *= 1 + 0.2 * momentumOf(world, p.side);
  if (world.flags.scoreClockTerm) {
    const L = lateness(world);
    const gd = goalDiff(world, p.side);
    if (gd < 0) a *= 1 + 0.4 * L;
    else if (gd > 0) a *= 1 - 0.2 * L;
  }
  return a;
}

/**
 * Pick among options by utility with a softmax over the top three (design
 * 3.4: decision softness).  This is a CHOICE among near-best options, not a
 * chance of success.  With softness ablated it is a plain argmax.
 *
 * @returns  Index of the chosen option (-1 for an empty list).
 */
export function softPick(rng: Rng, utilities: readonly number[], temperature: number, soft: boolean): number {
  const n = utilities.length;
  if (n === 0) return -1;
  // Top three by utility (stable: earlier index wins ties).
  let i1 = -1, i2 = -1, i3 = -1;
  for (let i = 0; i < n; i++) {
    const u = utilities[i]!;
    if (i1 < 0 || u > utilities[i1]!) { i3 = i2; i2 = i1; i1 = i; }
    else if (i2 < 0 || u > utilities[i2]!) { i3 = i2; i2 = i; }
    else if (i3 < 0 || u > utilities[i3]!) { i3 = i; }
  }
  if (!soft || n === 1) return i1;
  const best = utilities[i1]!;
  const t = Math.max(1e-6, temperature);
  const cand = [i1, i2, i3].filter((i) => i >= 0);
  const w = cand.map((i) => Math.exp((utilities[i]! - best) / t));
  const total = w.reduce((s, x) => s + x, 0);
  let r = rng() * total;
  for (let k = 0; k < cand.length; k++) {
    r -= w[k]!;
    if (r <= 0) return cand[k]!;
  }
  return i1;
}

/** Decision temperature for a player: lower with vision and confidence. */
export function temperatureOf(p: SimPlayer, world: SimWorld): number {
  let t = BASE_TEMPERATURE * (1.35 - p.stats.vision / 100);
  if (world.flags.confidence) t *= 1.1 - 0.2 * p.confidence;
  return t;
}

// ── The carrier's decision ──────────────────────────────────────────────────

/**
 * Decide what the carrier does with this touch.
 *
 * @param carrier  The player at the ball.
 * @param world    The world.
 * @param mode     'open' in open play, or the restart being taken.
 * @param indirect True for an indirect free kick (no direct shot).
 * @returns        The chosen action plus the top options (for traces).
 */
export function chooseAction(
  carrier: SimPlayer, world: SimWorld, mode: ActionMode = 'open', indirect = false, canPass = true,
): { action: CarrierAction; options: number; top: string } {
  const side = carrier.side;
  const opp = otherSide(side);
  const mates = (side === 'home' ? world.home : world.away).filter((p) => p.id !== carrier.id && !p.sentOff);
  const opponents = (side === 'home' ? world.away : world.home).filter((p) => !p.sentOff);
  const style = side === 'home' ? world.homeStyle : world.awayStyle;
  const from = world.ball.pos;
  const now = world.clockSec;
  const pressure = mode === 'open' ? pressureAt(from, opponents) : 0;
  const lam = lossWeight(carrier, world);
  const progress = progressOf(from, side);
  const options: CarrierAction[] = [];

  const ePass = errorScale(carrier, carrier.stats.passing, world, { pressure, awkward: 0 });
  const passMul = carrier.traits.pass * (1 + style.pass * STYLE_PASS_K);

  // ── Shots ──────────────────────────────────────────────────────────────
  const gx = attackingGoalX(side);
  const dGoal = dist(from, vec(gx, PITCH_WIDTH / 2));
  const canShoot = (mode === 'open' || mode === 'penalty' || (mode === 'freekick' && !indirect));
  if (canShoot && dGoal < 34) {
    const keeper = opponents.find((p) => p.role === 'GK');
    const eShot = errorScale(carrier, carrier.stats.shooting, world, { pressure, awkward: 0 });
    const power = 21 + 10 * (carrier.stats.shooting / 100);
    const appetite = shotAppetite(carrier, world);
    const lead = shotWindup(carrier);
    for (const gy of SHOT_YS) {
      for (const gz of SHOT_ZS) {
        // A placed shot low into the corner is struck a little softer.
        const speed = gz < 1 ? power * 0.94 : power;
        // Penalties and free kicks are struck from a set ball (no one closing in).
        const est = estimateShot(from, side, gy, gz, speed, eShot, keeper, opponents, mode === 'open' ? lead : 0);
        const u = est.p * appetite + (1 - est.p) * 0.006 - (1 - est.p) * lam * 0.006;
        options.push({ kind: 'shoot', aim: vec(gx, gy), gz, speed, utility: u, est: est.p, chip: false, parts: { f: est.pFrame, b: est.pBeat, c: est.pClear } });
      }
    }
  }
  if (mode === 'penalty') return finish(carrier, world, options);

  // ── Passes ─────────────────────────────────────────────────────────────
  const maxRange = mode === 'throw' ? 24 : 55;
  const fwd = side === 'home' ? 1 : -1;
  const line = offsideLineX(world, side);
  for (const m of canPass ? mates : []) {
    if (mode === 'kickoff' && progressOf(m.pos, side) > 0.5) continue;
    if (m.role === 'GK' && !(progress < 0.33 && mode === 'open')) continue;
    // Players know the offside law: a passer does not pick a man he SEES
    // standing offside (he can misjudge it: perception error).
    const offsideRule = mode !== 'throw' && mode !== 'corner' && mode !== 'goalkick';
    if (offsideRule) {
      const seenX = perceive(carrier, world, m.pos, 3.2).x;
      // He can only see a CLEAR offside from where he stands; a man a
      // stride beyond the line looks level to him (and to most passers).
      const beyond = (seenX - line) * fwd > SEEN_OFFSIDE && (seenX - from.x) * fwd > 0 && progressOf(vec(seenX, m.pos.y), side) > 0.5;
      if (beyond) continue;
    }
    const lead = Math.min(1.4, Math.max(0.3, dist(from, m.pos) / 14));
    const aims: Array<{ aim: Vec2; kick: KickKind }> = [{ aim: clampPitch(add(m.pos, scale(m.vel, lead))), kick: 'pass' }];
    if (m.job === 'run' && mode === 'open') {
      // A ball into the space behind the line, for the runner on its shoulder.
      const gxRun = attackingGoalX(side);
      const depthX = line + fwd * 8;
      const x = fwd > 0 ? Math.min(gxRun - 6, depthX) : Math.max(gxRun + 6, depthX);
      aims.push({ aim: clampPitch(vec(x, m.pos.y * 0.8 + (PITCH_WIDTH / 2) * 0.2)), kick: 'through' });
    }
    for (const { aim, kick } of aims) {
      const d = dist(from, aim);
      if (d < 4 || d > maxRange) continue;
      const vOwn = positionValue(aim, side);
      const lossAt = vec(from.x + (aim.x - from.x) * 0.5, from.y + (aim.y - from.y) * 0.5);
      const vLoss = positionValue(lossAt, opp);
      if (mode === 'throw') {
        // A throw is a short lob from the hands.
        const T = 0.5 + d * 0.035;
        const v0 = airLaunchSpeed(d, T);
        const est = estimatePass(from, aim, v0, true, m, opponents, ePass * 0.8, now);
        options.push({ kind: 'pass', target: m, aim, speed: v0, vz: GRAVITY * T / 2, kick: 'throw',
          utility: est.pC * vOwn * passMul - (1 - est.pC) * lam * vLoss, pC: est.pC, lofted: true });
        continue;
      }
      if (d <= 40) {
        const arriveSpeed = 6 + d * 0.09;
        const v0 = Math.min(27, groundLaunchSpeed(d, arriveSpeed));
        const est = estimatePass(from, aim, v0, false, m, opponents, ePass, now);
        options.push({ kind: 'pass', target: m, aim, speed: v0, vz: 0, kick,
          utility: est.pC * vOwn * receiveRoom(aim, est.tBall, opponents, now) * passMul - (1 - est.pC) * lam * vLoss, pC: est.pC, lofted: false });
      }
      if (d >= 18) {
        const T = 0.8 + d * 0.032;
        const v0 = airLaunchSpeed(d, T);
        const est = estimatePass(from, aim, v0, true, m, opponents, ePass * 1.3, now);
        // A lofted ball arrives dropping out of the sky: harder to use.
        const k: KickKind = kick === 'through' ? 'through' : 'long';
        options.push({ kind: 'pass', target: m, aim, speed: v0, vz: GRAVITY * T / 2, kick: k,
          utility: est.pC * vOwn * receiveRoom(aim, est.tBall, opponents, now) * 0.85 * passMul - (1 - est.pC) * lam * vLoss, pC: est.pC, lofted: true });
      }
    }
  }

  // ── Crosses (wide in the final third, or a corner / wide free kick) ───────
  const wide = Math.abs(from.y - PITCH_WIDTH / 2) > 13;
  if (canPass && (mode === 'open' && wide && progress > 0.74) || mode === 'corner' || (mode === 'freekick' && wide && progress > 0.7)) {
    const sign = side === 'home' ? -1 : 1; // from goal line back into the pitch
    const nearY = from.y < PITCH_WIDTH / 2 ? GOAL_Y_MIN + 1 : GOAL_Y_MAX - 1;
    const farY = from.y < PITCH_WIDTH / 2 ? GOAL_Y_MAX + 1 : GOAL_Y_MIN - 1;
    const zones = [vec(gx + sign * 5.5, nearY), vec(gx + sign * 7, farY), vec(gx + sign * 11, PITCH_WIDTH / 2)];
    for (const z of zones) {
      // The best-placed attacker for the zone is the intended target.
      let best: SimPlayer | null = null;
      let bestT = Infinity;
      for (const m of mates) {
        if (m.role === 'GK') continue;
        const t = timeToReach(m, z, now);
        if (t < bestT) { bestT = t; best = m; }
      }
      if (!best) continue;
      const d = dist(from, z);
      const T = 0.9 + d * 0.025;
      const v0 = airLaunchSpeed(d, T);
      const est = estimatePass(from, z, v0, true, best, opponents, ePass * 1.4, now);
      const vOwn = 0.8 * positionValue(z, side);
      options.push({ kind: 'pass', target: best, aim: z, speed: v0, vz: GRAVITY * T / 2, kick: 'cross',
        utility: est.pC * vOwn * passMul + (1 - est.pC) * CROSS_SECOND_BALL - (1 - est.pC) * lam * 0.3 * positionValue(z, opp), pC: est.pC, lofted: true });
    }
  }

  // ── Carry ───────────────────────────────────────────────────────────────
  if (mode === 'open') {
    const dribbleMul = carrier.traits.dribble * (1 + style.dribble * STYLE_DRIBBLE_K) * Math.pow(HOLD_DECAY, carrier.holds);
    const toGoal = normalize(sub(vec(gx, PITCH_WIDTH / 2), from));
    const vCarry = 0.85 * effectiveMaxSpeed(carrier);
    for (const a of CARRY_ANGLES) {
      const c = Math.cos(a);
      const s = Math.sin(a);
      const dir = vec(toGoal.x * c - toGoal.y * s, toGoal.x * s + toGoal.y * c);
      const end = add(from, scale(dir, CARRY_PROBE));
      if (end.x < 1 || end.x > PITCH_LENGTH - 1 || end.y < 1 || end.y > PITCH_WIDTH - 1) continue;
      const mid = add(from, scale(dir, CARRY_PROBE * 0.4));
      // Turning against his own momentum costs time before he is away.
      const vNow = carrier.vel;
      const turn = (Math.hypot(vNow.x, vNow.y) - dot(vNow, dir)) / MAX_ACCEL;
      const tMe = CARRY_PROBE / vCarry + turn;
      let margin = Infinity;
      for (const o of opponents) {
        if (dist(o.pos, from) > 14) continue;
        // He only has to get a foot to it, not his body on the spot.
        const footT = CARRY_FOOT / Math.max(1, effectiveMaxSpeed(o));
        const m1 = timeToReach(o, end, now) - footT - tMe;
        const m2 = timeToReach(o, mid, now) - footT - tMe * 0.4;
        const m = m1 < m2 ? m1 : m2;
        if (m < margin) margin = m;
      }
      // He knows where the lines are: a carry that runs at the touchline or
      // the goal line is a carry that may run out of play.
      const room = lineRoom(end, dir);
      const pIn = 1 / (1 + Math.exp(-(room - LINE_MARGIN) / 0.6));
      const pKeep = (margin === Infinity ? 0.97 : 0.97 / (1 + Math.exp(-(margin - 0.1) / 0.22))) * pIn;
      const u = pKeep * positionValue(end, side) * dribbleMul - (1 - pKeep) * lam * positionValue(mid, opp);
      options.push({ kind: 'dribble', dir, utility: u });
    }
  }

  // ── Clearance (deep and pressed) ─────────────────────────────────────────
  if (mode === 'open' && progress < 0.3 && pressure > 0.35) {
    const fwd = side === 'home' ? 1 : -1;
    const y = from.y < PITCH_WIDTH / 2 ? 12 : PITCH_WIDTH - 12;
    const aim = clampPitch(vec(from.x + fwd * 40, y));
    const d = dist(from, aim);
    const T = 1.6 + d * 0.02;
    const v0 = airLaunchSpeed(d, T);
    const u = 0.35 * positionValue(aim, side) - 0.65 * lam * positionValue(aim, opp);
    options.push({ kind: 'clear', aim, speed: v0, vz: GRAVITY * T / 2, utility: u });
  }

  if (options.length === 0) {
    // Nothing legal (e.g. a throw with nobody near): play it to the nearest mate.
    let near: SimPlayer | null = null;
    for (const m of mates) if (!near || dist(m.pos, from) < dist(near.pos, from)) near = m;
    const aim = near ? near.pos : vec(PITCH_LENGTH / 2, PITCH_WIDTH / 2);
    const d = Math.max(4, dist(from, aim));
    const T = 0.6 + d * 0.03;
    if (near) {
      return { action: { kind: 'pass', target: near, aim, speed: airLaunchSpeed(d, T), vz: GRAVITY * T / 2,
        kick: mode === 'throw' ? 'throw' : 'long', utility: 0, pC: 0, lofted: true }, options: 0, top: '' };
    }
    return { action: { kind: 'clear', aim, speed: airLaunchSpeed(d, T), vz: GRAVITY * T / 2, utility: 0 }, options: 0, top: '' };
  }
  return finish(carrier, world, options);
}

/**
 * How much room the receiver will have when the ball gets to him (design 4.4:
 * the receiver's space), as a multiplier on the value of the ball there.  A
 * man who will have an opponent on him as the ball arrives can only lay it
 * back; a man with a second to spare can turn and play forward.  Judged from
 * the passer's view of who could close the aim point in the ball's travel.
 */
export function receiveRoom(aim: Vec2, tBall: number, opponents: readonly SimPlayer[], now: number): number {
  let spare = Infinity;
  for (const o of opponents) {
    if (o.sentOff) continue;
    if (Math.abs(o.pos.x - aim.x) > 20 || Math.abs(o.pos.y - aim.y) > 20) continue;
    const t = timeToReach(o, aim, now) - tBall;
    if (t < spare) spare = t;
  }
  if (spare === Infinity) return ROOM_MAX;
  return ROOM_MIN + (ROOM_MAX - ROOM_MIN) / (1 + Math.exp(-(spare - ROOM_T) / ROOM_S));
}

/** Room multiplier range and its response (s of spare time when the ball arrives). */
const ROOM_MIN = 0.7;
const ROOM_MAX = 1.3;
const ROOM_T = 0.7;
const ROOM_S = 0.35;

/** Choose among the scored options. */
function finish(carrier: SimPlayer, world: SimWorld, options: CarrierAction[]): { action: CarrierAction; options: number; top: string } {
  const idx = softPick(carrier.rng, options.map((o) => o.utility), temperatureOf(carrier, world), world.flags.utilitySoftness);
  // For traces only: the three best options and their utilities (x1000).
  const top = world.trace
    ? [...options].sort((a, b) => b.utility - a.utility).slice(0, 3)
      .map((o) => o.kind + ':' + String(Math.round(o.utility * 10000) / 10)).join(',')
    : '';
  return { action: options[idx]!, options: options.length, top };
}

/** Shot target lines across the goal (inside the posts) and heights. */
const SHOT_YS = [GOAL_Y_MIN + 0.45, GOAL_Y_MIN + 1.7, GOAL_Y_MAX - 1.7, GOAL_Y_MAX - 0.45] as const;
const SHOT_ZS = [0.25, 1.75] as const;

/** Carry directions relative to the line to goal (radians). */
const CARRY_ANGLES = [0, 0.5, -0.5, 1.05, -1.05, 1.7, -1.7, Math.PI] as const;

/**
 * Distance (m) from a point to the line it is heading for along dir (the
 * touchline or goal line the ball would cross first), capped at 30.
 */
export function lineRoom(pt: Vec2, dir: Vec2): number {
  let t = 30;
  if (dir.x > 1e-6) t = Math.min(t, (PITCH_LENGTH - pt.x) / dir.x);
  else if (dir.x < -1e-6) t = Math.min(t, -pt.x / dir.x);
  if (dir.y > 1e-6) t = Math.min(t, (PITCH_WIDTH - pt.y) / dir.y);
  else if (dir.y < -1e-6) t = Math.min(t, -pt.y / dir.y);
  return Math.max(0, t);
}

/** Room (m) a carrier wants between his probe point and the line he runs at. */
const LINE_MARGIN = 2.5;

/** Clamp a point onto the pitch with a 1 m inset. */
function clampPitch(p: Vec2): Vec2 {
  return vec(Math.max(1, Math.min(PITCH_LENGTH - 1, p.x)), Math.max(1, Math.min(PITCH_WIDTH - 1, p.y)));
}

/**
 * How far ahead to knock the ball on a carry (m): short touches in traffic
 * and for the best dribblers, long ones into open grass.
 */
export function touchDistance(carrier: SimPlayer, opponents: readonly SimPlayer[], pressure: number): number {
  const space = Math.min(1, nearestOpponentDist(carrier.pos, opponents) / 15);
  const skill = carrier.stats.dribbling / 100;
  return 0.5 + 1.9 * space * Math.pow(1 - pressure, 1.5) * (1.15 - 0.4 * skill);
}

// ── Pure geometry kept from the first engine ───────────────────────────────

/**
 * Shooting quality of a position in [0,1], combining distance and angle.
 * A geometric summary only (the shooter's real judgement is estimateShot).
 *
 * @param pos   The shooter's position.
 * @param side  Which side they play for (sets which goal they attack).
 */
export function shotQuality(pos: Vec2, side: TeamSide): number {
  return Math.min(1, xgGeom(pos, side) / 0.4);
}

/**
 * Whether `pos` lies inside the penalty area that `attackingSide` is attacking.
 *
 * @param pos           Where the foul happened (pitch metres).
 * @param attackingSide The fouled side (attacking toward their opponent's goal).
 */
export function isInPenaltyArea(pos: Vec2, attackingSide: TeamSide): boolean {
  const goalX = attackingGoalX(attackingSide);
  return Math.abs(pos.x - goalX) <= PENALTY_AREA_DEPTH
    && pos.y >= PENALTY_AREA_Y_MIN
    && pos.y <= PENALTY_AREA_Y_MAX;
}

/**
 * Whether `target` is in an offside position at the instant of a pass:
 * beyond the second-last opponent, ahead of the ball, and inside the
 * attacking half.  A small forgiveness margin means only clear offsides are
 * flagged (the referee is not a millimetre-perfect camera).  Pure geometry.
 *
 * @param target   The intended pass receiver.
 * @param ballPos  Position the pass is struck from.
 * @param world    Current world (for the opposing defenders).
 */
export function isOffsidePosition(target: SimPlayer, ballPos: Vec2, world: SimWorld): boolean {
  const goalX = attackingGoalX(target.side);
  const defenders = (target.side === 'home' ? world.away : world.home).filter((d) => !d.sentOff);
  const xs = defenders.map((d) => d.pos.x);
  const MARGIN = 0.5;
  if (goalX === PITCH_LENGTH) {
    const desc = [...xs].sort((a, b) => b - a);
    const lineX = desc[1] ?? desc[0] ?? PITCH_LENGTH;
    return target.pos.x > lineX + MARGIN && target.pos.x > ballPos.x && target.pos.x > PITCH_LENGTH / 2;
  }
  const asc = [...xs].sort((a, b) => a - b);
  const lineX = asc[1] ?? asc[0] ?? 0;
  return target.pos.x < lineX - MARGIN && target.pos.x < ballPos.x && target.pos.x < PITCH_LENGTH / 2;
}

/**
 * The x of a side's offside line as seen by attackers of `attackingSide`:
 * the second-last defender (or the halfway line, whichever is nearer goal).
 */
export function offsideLineX(world: SimWorld, attackingSide: TeamSide): number {
  const defenders = (attackingSide === 'home' ? world.away : world.home).filter((d) => !d.sentOff);
  const xs = defenders.map((d) => d.pos.x);
  if (attackingSide === 'home') {
    const desc = xs.sort((a, b) => b - a);
    return Math.max(PITCH_LENGTH / 2, desc[1] ?? PITCH_LENGTH / 2);
  }
  const asc = xs.sort((a, b) => a - b);
  return Math.min(PITCH_LENGTH / 2, asc[1] ?? PITCH_LENGTH / 2);
}

/**
 * Whether a moving ball passes within `reach` of a stationary player on this
 * tick's segment.  Point-to-segment distance from the player to the path.
 */
export function ballPathWithinReach(playerPos: Vec2, ballFrom: Vec2, ballTo: Vec2, reach: number): boolean {
  const seg = sub(ballTo, ballFrom);
  const segLen2 = dot(seg, seg);
  if (segLen2 < 1e-9) return dist(playerPos, ballFrom) <= reach;
  let t = dot(sub(playerPos, ballFrom), seg) / segLen2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const closest = add(ballFrom, scale(seg, t));
  return dist(playerPos, closest) <= reach;
}

/** The point on a side's own goal line opposite the ball (for keepers and covers). */
export function ownGoalCentre(side: TeamSide): Vec2 {
  return vec(defendingGoalX(side), PITCH_WIDTH / 2);
}
