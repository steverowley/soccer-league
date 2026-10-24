// ── features/match/logic/spatial/step.ts ─────────────────────────────────────
// One physics tick of the emergent match (engine v2, docs/emergent-engine.md).
//
// PER-TICK SHAPE
//   1. Restart set-up, if the ball is dead (players take position, the taker
//      plays it through the normal decision and kick model).
//   2. Perception: predict the ball's path; who can reach it first.
//   3. Decisions: off-ball jobs (at each player's think cadence), the carrier's
//      action when the ball is at his feet, a defender's choice to commit to a
//      challenge, a keeper's dive once he has read a shot.
//   4. Movement: steer and integrate every body.
//   5. Ball physics: integrate the 2.5D ball, then judge what it met first on
//      this tick's path: a post, a line, a keeper's hand, a defender's body, a
//      receiver's foot.  Events are emitted when the thing physically happens.
//
// NO OUTCOME ROLLS.  The only randomness is execution and perception error
// (execution.ts) and the softmax choice among near-best options
// (possession.softPick).  A tackle, a save, a foul, an interception and a goal
// are all decided by where bodies and the ball are, and when.

import {
  type Vec2, vec, add, sub, scale, len, dist, dot, normalize, truncate, ZERO,
} from './vec2.ts';
import {
  type SimPlayer, type SimWorld, type SimEvent, type TeamSide, type KickInfo, type KickKind,
  type RestartKind,
  PITCH_LENGTH, PITCH_WIDTH, GOAL_Y_MIN, GOAL_Y_MAX, GOAL_HEIGHT, CENTRE_SPOT,
  attackingGoalX, defendingGoalX, otherSide,
} from './types.ts';
import { effectiveMaxSpeed, MAX_ACCEL, seek } from './steering.ts';
import {
  chooseAction, isOffsidePosition, isInPenaltyArea, touchDistance, softPick,
  type CarrierAction,
} from './possession.ts';
import {
  positionValue, pressureAt, sigmoid, estimateShot, segmentDistance, progressOf, timeToReach,
} from './evaluate.ts';
import {
  errorScale, strike, firstTouch, reactionDelay, perceive, slip, KICK_ERROR,
} from './execution.ts';
import {
  stepBall, airTravelTime, verticalLaunchSpeed, ROLL_DECEL, DRAG_K, predictPath, GRAVITY,
} from './ball.ts';
import {
  buildContext, thinkJob, jobVelocity, type TickContext, FOOT_REACH, HEAD_Z, findById,
  PATH_SAMPLES, PATH_STRIDE,
} from './offball.ts';
import {
  keeperVelocity, readShot, diveVelocity, keeperReach, KEEPER_TOP, catchSpeed, inOwnBox, diveSpeed,
} from './keeper.ts';
import {
  beginRestart, restartVelocity, penaltySpot, goalKickSpot, cornerSpot,
} from './setpiece.ts';

// ── Tunable constants ─────────────────────────────────────────────────────────

/** Minimum time (s) between two touches by the same carrier. */
const TOUCH_GAP = 0.25;

/** Seconds after striking the ball before the kicker can touch it again. */
const KICKER_LOCK = 0.35;

/** Seconds a committed lunge takes to reach its point. */
const LUNGE_TIME = 0.35;

/** Leg reach (m) at the end of a lunge. */
const LEG_REACH = 0.95;

/** Contact radii (m): foot on ball, foot on the man. */
const BALL_CONTACT = 0.5;
const MAN_CONTACT = 0.8;

/** Ball speed (m/s) above which a body in the way deflects rather than controls. */
const BLOCK_SPEED = 17;

/** Foul severity thresholds for a yellow and a straight red. */
const YELLOW_SEVERITY = 1.2;
const RED_SEVERITY = 2.1;

/** Lunge appetite: base gain and base cost (expected-goal units). */
const LUNGE_GAIN_BASE = 0.01;
const LUNGE_FOUL_COST = 0.02;

/** Ball radius plus post radius (m), for woodwork. */
const FRAME_HIT = 0.17;

/** Earliest match-clock second a tactical substitution is considered (55'). */
const SUB_MIN_SEC = 55 * 60;

/** Spacing (s) between a side's changes (about 9'). */
const SUB_SPACING_SEC = 9 * 60;

/** A tiring starter is replaced once their stamina drops below this. */
const SUB_STAMINA_THRESHOLD = 0.55;

/** Confidence drift time constant (s) back toward the player's baseline. */
const CONFIDENCE_TAU = 600;

/** Momentum smoothing time constant (s). */
const MOMENTUM_TAU = 150;

// ── Small helpers ─────────────────────────────────────────────────────────────

function emit(events: SimEvent[], world: SimWorld, minute: number, e: Omit<SimEvent, 'tSec' | 'minute'>): void {
  events.push({ tSec: world.clockSec, minute, ...e });
}

function trace(world: SimWorld, kind: string, p: SimPlayer | null, data: Record<string, number | string | boolean | null>): void {
  if (!world.trace) return;
  const b = world.ball;
  world.trace({
    tSec: Math.round(world.clockSec * 10) / 10,
    kind,
    ...(p ? { playerId: p.id, side: p.side } : {}),
    ball: { x: r2(b.pos.x), y: r2(b.pos.y), z: r2(b.z) },
    data,
  });
}

function r2(x: number): number {
  return Math.round(x * 100) / 100;
}

function teamOf(world: SimWorld, side: TeamSide): SimPlayer[] {
  return side === 'home' ? world.home : world.away;
}

function keeperOf(world: SimWorld, side: TeamSide): SimPlayer | undefined {
  return teamOf(world, side).find((p) => p.role === 'GK' && !p.sentOff);
}

function isShotKind(k: KickKind): boolean {
  return k === 'shot' || k === 'penalty';
}

function isPassKind(k: KickKind): boolean {
  return k === 'pass' || k === 'through' || k === 'cross' || k === 'long' || k === 'throw';
}

/** Confidence baseline: the home crowd lifts the home side a little. */
function confidenceBase(p: SimPlayer): number {
  return p.side === 'home' ? 0.53 : 0.47;
}

function bump(world: SimWorld, p: SimPlayer | null | undefined, d: number): void {
  if (!p || !world.flags.confidence) return;
  p.confidence = Math.max(0, Math.min(1, p.confidence + d));
}

function shotImpulse(world: SimWorld, side: TeamSide, k: number): void {
  if (!world.flags.momentum) return;
  const s = side === 'home' ? 1 : -1;
  world.momentum[0] = Math.max(-1, Math.min(1, world.momentum[0] + s * k));
  world.momentum[1] = -world.momentum[0];
}

/** Everyone re-reads the game after the ball's path changes (reaction delay). */
function newBallPath(world: SimWorld, except: SimPlayer | null): void {
  const now = world.clockSec;
  for (const p of world.home) if (p !== except && !p.sentOff) p.reactUntil = now + reactionDelay(p, world);
  for (const p of world.away) if (p !== except && !p.sentOff) p.reactUntil = now + reactionDelay(p, world);
}

/** Record that `p` touched the ball now. */
function touched(world: SimWorld, p: SimPlayer): void {
  const b = world.ball;
  b.lastTouchId = p.id;
  b.lastTouchSide = p.side;
  b.lastTouchSec = world.clockSec;
}

// ── Player integration ──────────────────────────────────────────────────────

/**
 * Move one player toward a desired velocity, respecting acceleration and top
 * speed, then integrate position and drain/recover stamina.  Mutates `p`.
 */
function integratePlayer(p: SimPlayer, desired: Vec2, dt: number, accel = MAX_ACCEL, cap = effectiveMaxSpeed(p)): void {
  const deltaV = truncate(sub(desired, p.vel), accel * dt);
  p.vel = truncate(add(p.vel, deltaV), cap);
  p.pos = add(p.pos, scale(p.vel, dt));
  p.pos = vec(Math.max(0, Math.min(PITCH_LENGTH, p.pos.x)), Math.max(0, Math.min(PITCH_WIDTH, p.pos.y)));
  // Stamina drains with the square of speed fraction (sprinting costs most),
  // faster for players with less engine, and recovers gently at walking pace.
  const speedFrac = len(p.vel) / Math.max(1, p.maxSpeed);
  if (speedFrac > 0.3) {
    p.stamina -= speedFrac * speedFrac * 0.0016 * dt * 60 * (1.2 - 0.4 * (p.stats.stamina / 100));
  } else {
    p.stamina += 0.0006 * dt * 60;
  }
  p.stamina = Math.max(0.2, Math.min(1, p.stamina));
}

// ── Sendings-off and substitutions ──────────────────────────────────────────

/** Send a player off: parked on the nearest touchline, out of play for good. */
function sendOff(player: SimPlayer): void {
  player.sentOff = true;
  player.vel = ZERO;
  player.lunge = null;
  player.pos = vec(player.pos.x, player.pos.y < PITCH_WIDTH / 2 ? 0 : PITCH_WIDTH);
}

/**
 * Consider a tactical substitution for one side: after the hour mark (changes
 * spaced out), the most tired outfield starter (never the keeper or the
 * carrier) is replaced by a fresh bench player who inherits his slot.
 * Deterministic (no randomness).
 */
function maybeSubstitute(world: SimWorld, side: TeamSide, minute: number, events: SimEvent[]): void {
  const subsLeft = side === 'home' ? world.homeSubsLeft : world.awaySubsLeft;
  const bench = side === 'home' ? world.homeBench : world.awayBench;
  if (subsLeft <= 0 || bench.length === 0) return;
  const made = 3 - subsLeft;
  if (world.clockSec < SUB_MIN_SEC + made * SUB_SPACING_SEC) return;
  const team = teamOf(world, side);
  let off: SimPlayer | null = null;
  for (const p of team) {
    if (p.role === 'GK' || p.sentOff || p.id === world.ball.ownerId || p.lunge) continue;
    if (!off || p.stamina < off.stamina) off = p;
  }
  if (!off || off.stamina > SUB_STAMINA_THRESHOLD) return;
  let bi = bench.findIndex((b) => b.role === off!.role);
  if (bi < 0) bi = 0;
  const fresh = bench.splice(bi, 1)[0]!;
  fresh.role = off.role;
  fresh.homePos = off.homePos;
  fresh.pos = off.pos;
  fresh.vel = ZERO;
  fresh.stamina = 1;
  fresh.job = 'shape';
  fresh.nextThinkSec = world.clockSec;
  team[team.indexOf(off)] = fresh;
  if (side === 'home') world.homeSubsLeft -= 1; else world.awaySubsLeft -= 1;
  emit(events, world, minute, { type: 'substitution', side, playerId: fresh.id, otherId: off.id });
}

// ── Kicking ─────────────────────────────────────────────────────────────────

/** Awkwardness of striking in `dir` while running with velocity `vel`, in [0,1]. */
function awkwardness(vel: Vec2, dir: Vec2): number {
  const sp = len(vel);
  if (sp < 1.5) return 0;
  const c = dot(normalize(vel), dir);
  return Math.max(0, (1 - c) / 2) * Math.min(1, sp / 6);
}

/** Set the ball off on a deliberate strike. */
function launch(world: SimWorld, p: SimPlayer, kind: KickKind, vel: Vec2, vz: number, aim: Vec2, targetId: string | null): void {
  const b = world.ball;
  b.vel = vel;
  b.vz = vz;
  if (vz > 0 && b.z <= 0) b.z = 0.01;
  b.ownerId = null;
  touched(world, p);
  const info: KickInfo = { kind, side: p.side, playerId: p.id, from: b.pos, tSec: world.clockSec, targetId, aim, resolved: false, woodwork: false };
  b.kick = info;
  p.noTouchUntil = world.clockSec + KICKER_LOCK;
  p.holds = 0;
  newBallPath(world, p);
}

/**
 * Carry out the carrier's chosen action through the kick model.
 *
 * @param restart  The restart being taken, if any (offside does not apply from
 *                 throw-ins, corners and goal kicks; the kick kind is labelled).
 */
function execute(
  world: SimWorld, p: SimPlayer, action: CarrierAction, events: SimEvent[], minute: number, restart: RestartKind | null,
): void {
  const b = world.ball;
  const from = b.pos;
  const opponents = teamOf(world, otherSide(p.side)).filter((o) => !o.sentOff);
  const pressure = restart ? 0 : pressureAt(from, opponents);
  switch (action.kind) {
    case 'shoot': {
      const d = dist(from, action.aim);
      const dir = normalize(sub(action.aim, from));
      const T = airTravelTime(action.speed, d);
      const vz = verticalLaunchSpeed(b.z, action.gz, T);
      // A penalty is a placed strike at a still ball: about half the spread.
      const e = errorScale(p, p.stats.shooting, world, { pressure, awkward: awkwardness(p.vel, dir) }) * (restart === 'penalty' ? 0.5 : 1);
      const s = strike(p, world, dir, action.speed, vz, KICK_ERROR.shot, e);
      const kind: KickKind = restart === 'penalty' ? 'penalty' : 'shot';
      launch(world, p, kind, s.vel, s.vz, action.aim, null);
      world.lastShot = { playerId: p.id, side: p.side, tSec: world.clockSec };
      shotImpulse(world, p.side, 0.15);
      const k = keeperOf(world, otherSide(p.side));
      trace(world, 'shot', p, {
        kx: k ? r2(k.pos.x) : null, ky: k ? r2(k.pos.y) : null,
        dist: r2(d), speed: r2(action.speed), aimY: r2(action.aim.y), aimZ: r2(action.gz), est: r2(action.est),
        angErr: r2(s.angErr), errScale: r2(e), pressure: r2(pressure), restart: restart ?? 'open',
      });
      if (k) {
        k.dive = null;
        if (restart === 'penalty') {
          // A keeper cannot react to a penalty in time; he commits as it is
          // struck (a decision among equally good guesses, not a roll).
          const gx = defendingGoalX(k.side);
          const ys = [GOAL_Y_MIN + 1.2, PITCH_WIDTH / 2, GOAL_Y_MAX - 1.2];
          const i = softPick(k.rng, [0, -0.0005, 0], 0.001, world.flags.utilitySoftness);
          k.dive = { at: vec(gx, ys[i]!), z: 0.6 };
          trace(world, 'keeper_guess', k, { y: r2(ys[i]!) });
        }
      }
      return;
    }
    case 'pass': {
      const d = dist(from, action.aim);
      const dir = normalize(sub(action.aim, from));
      const e = errorScale(p, p.stats.passing, world, { pressure, awkward: awkwardness(p.vel, dir) });
      const base = action.kick === 'cross' ? KICK_ERROR.cross : action.kick === 'throw' ? KICK_ERROR.throw
        : action.lofted ? KICK_ERROR.lofted : KICK_ERROR.pass;
      const s = strike(p, world, dir, action.speed, action.vz, base, e);
      const offside = restart === 'throw' || restart === 'corner' || restart === 'goalkick'
        ? null : (isOffsidePosition(action.target, from, world) ? action.target.id : null);
      launch(world, p, action.kick, s.vel, s.vz, action.aim, action.target.id);
      b.offsideFor = offside;
      if (action.kick !== 'throw') emit(events, world, minute, { type: 'pass', side: p.side, playerId: p.id, otherId: action.target.id });
      trace(world, 'pass', p, {
        kind: action.kick, target: action.target.id, dist: r2(d), pC: r2(action.pC), u: r2(action.utility * 1000),
        angErr: r2(s.angErr), errScale: r2(e), lofted: action.lofted, offside: offside !== null, restart: restart ?? 'open',
      });
      return;
    }
    case 'clear': {
      const dir = normalize(sub(action.aim, from));
      const e = errorScale(p, p.stats.passing, world, { pressure, awkward: awkwardness(p.vel, dir) });
      const s = strike(p, world, dir, action.speed, action.vz, KICK_ERROR.clear, e);
      launch(world, p, 'clear', s.vel, s.vz, action.aim, null);
      trace(world, 'clear', p, { dist: r2(dist(from, action.aim)), angErr: r2(s.angErr) });
      return;
    }
    case 'dribble': {
      // Knock the ball ahead: far enough to run onto, close enough to keep.
      const D = touchDistance(p, opponents, pressure);
      const e = errorScale(p, p.stats.dribbling, world, { pressure, awkward: awkwardness(p.vel, action.dir) });
      const ang = slip(p, world, 0.09 * e);
      const c = Math.cos(ang);
      const sn = Math.sin(ang);
      const dir = vec(action.dir.x * c - action.dir.y * sn, action.dir.x * sn + action.dir.y * c);
      const dd = Math.max(0.3, D * (1 + slip(p, world, 0.18 * e)));
      // The ball is played relative to how fast he is already going that
      // way: on the run it is pushed into his stride, on the turn it is
      // rolled softly so he can get round to it.
      const va = Math.max(0, dot(p.vel, dir));
      const aEff = ROLL_DECEL + DRAG_K * (va + 1.5) * (va + 1.5);
      const u = va + Math.sqrt(2 * aEff * dd);
      b.vel = scale(dir, u);
      b.vz = 0;
      b.z = 0;
      b.ownerId = p.id;
      touched(world, p);
      b.kick = null;
      b.offsideFor = null;
      p.holds += 1;
      return;
    }
  }
}

// ── Shielding ───────────────────────────────────────────────────────────────

/**
 * True when the carrier's body stands between an opponent and the ball: the
 * straight line from the opponent to the ball passes within a body width of
 * the carrier, who is the nearer of the two to the ball.  Bodies block
 * access; this is geometry, not a chance.
 */
function shielded(world: SimWorld, opp: SimPlayer, ballPt: Vec2): boolean {
  const owner = world.ball.ownerId ? findById(world, world.ball.ownerId) : null;
  if (!owner || owner.side === opp.side || owner.sentOff) return false;
  const dOwner = dist(owner.pos, ballPt);
  if (dOwner > 1.2 || dOwner >= dist(opp.pos, ballPt)) return false;
  return segmentDistance(owner.pos, opp.pos, ballPt).d < BODY_WIDTH;
}

/** A ball taken within this distance (m) of its carrier counts as a tackle. */
const STEAL_DUEL_DIST = 1.5;

/** Base back-lift time of a shot (s): about 0.3 s for a 70-rated striker. */
const SHOT_WINDUP = 0.34;

/** Half a body width (m): how far either side of a player's centre he blocks. */
const BODY_WIDTH = 0.45;

/**
 * A lunge aimed at `carrier` that he has had time to see (committed at least
 * his reaction delay ago) and that has not yet landed.
 */
function incomingLunge(world: SimWorld, carrier: SimPlayer): SimPlayer | null {
  const now = world.clockSec;
  for (const d of teamOf(world, otherSide(carrier.side))) {
    const L = d.lunge;
    if (!L || L.targetId !== carrier.id || now >= L.resolveSec) continue;
    const committed = L.resolveSec - LUNGE_TIME;
    if (now - committed >= reactionDelay(carrier, world) * 0.8) return d;
  }
  return null;
}

/**
 * The carrier's answer to a challenge he has seen: a short touch away from
 * where the foot is going, toward goal where he can.  A decision and a touch
 * with ordinary execution error; whether it gets the ball out of reach is
 * then physics.
 */
function evade(world: SimWorld, p: SimPlayer, d: SimPlayer): void {
  const b = world.ball;
  const L = d.lunge!;
  const away = normalize(sub(b.pos, L.at));
  const toGoal = normalize(sub(vec(attackingGoalX(p.side), PITCH_WIDTH / 2), p.pos));
  let dir = normalize(add(scale(away, 1.4), toGoal));
  if (len(dir) < 1e-6) dir = toGoal;
  const opponents = teamOf(world, otherSide(p.side)).filter((o) => !o.sentOff);
  const pressure = pressureAt(p.pos, opponents);
  const e = errorScale(p, p.stats.dribbling, world, { pressure, awkward: awkwardness(p.vel, dir) });
  const ang = slip(p, world, 0.12 * e);
  const c = Math.cos(ang);
  const sn = Math.sin(ang);
  const dd = vec(dir.x * c - dir.y * sn, dir.x * sn + dir.y * c);
  const va = Math.max(0, dot(p.vel, dd));
  b.vel = scale(dd, va + 2.2 + slip(p, world, 0.4 * e));
  b.vz = 0;
  touched(world, p);
  b.ownerId = p.id;
  b.kick = null;
  p.holds += 1;
  trace(world, 'evade', p, { from: d.id });
}

/** The outfielder of a side nearest a loose ball, if within racing distance. */
function nearestRacer(world: SimWorld, side: TeamSide): SimPlayer | null {
  let best: SimPlayer | null = null;
  let bestD = 2.5;
  for (const p of teamOf(world, side)) {
    if (p.sentOff || p.role === 'GK') continue;
    const d = dist(p.pos, world.ball.pos);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

// ── Challenges (design 4.3) ─────────────────────────────────────────────────

/** True if no outfield team-mate of `d` stands between the carrier and goal. */
function isLastMan(world: SimWorld, d: SimPlayer, carrier: SimPlayer): boolean {
  const goal = vec(defendingGoalX(d.side), PITCH_WIDTH / 2);
  const dc = dist(carrier.pos, goal);
  for (const m of teamOf(world, d.side)) {
    if (m === d || m.sentOff || m.role === 'GK') continue;
    if (dist(m.pos, goal) < dc && Math.abs(m.pos.y - carrier.pos.y) < 14) return false;
  }
  return true;
}

/**
 * A defender near the carrier decides whether to commit to a challenge.  He
 * judges (with perception error) where the ball will be when his foot gets
 * there and how exposed it is from the carrier's body; the value of winning
 * it against the cost of fouling or being beaten.  A positive utility commits.
 */
function considerLunge(world: SimWorld, d: SimPlayer, carrier: SimPlayer): void {
  const now = world.clockSec;
  const b = world.ball;
  if (d.lunge || d.sentOff || now < d.recoverUntil || now < d.reactUntil || now < d.noTouchUntil) return;
  if (b.z > 0.6) return;
  const dB = dist(d.pos, b.pos);
  if (dB > 2.8) return;
  const pred = add(b.pos, scale(b.vel, LUNGE_TIME));
  const seen = perceive(d, world, pred, 0.5);
  const reach = 1.3 + 0.6 * (d.stats.tackling / 100) + LEG_REACH * 0.5;
  const dReach = dist(d.pos, seen);
  if (dReach > reach + 0.6) return;
  // A race for the ball: his foot needs LUNGE_TIME to arrive; the carrier
  // needs to get to his own touch (and cannot play it again within the touch
  // gap).  If the carrier gets there first the lunge meets the man.
  const tDef = LUNGE_TIME + Math.max(0, dReach - reach) / 7;
  const vC = Math.max(1, effectiveMaxSpeed(carrier));
  const tCar = Math.max(
    timeToReach(carrier, seen, now) - FOOT_REACH / vC,
    b.lastTouchSec + TOUCH_GAP - now,
  );
  // He judges the race by eye: a timing misread, larger for poorer tacklers
  // and when tired or rattled, is what makes a challenge late.
  const eT = errorScale(d, d.stats.tackling, world, { pressure: 0, awkward: 0 });
  const misread = slip(d, world, 0.2 * eT);
  const exposed = dist(seen, carrier.pos);
  const blocked = shielded(world, d, seen);
  // He expects a carrier who will see the foot coming to knock the ball on:
  // the better the dribbler and the slower the lunge, the likelier.
  const reactC = 0.16 + 0.22 * (1 - carrier.stats.positioning / 100);
  const pEvade = 0.7 * sigmoid((LUNGE_TIME - 0.8 * reactC) / 0.05) * (0.4 + 0.6 * carrier.stats.dribbling / 100)
    * (dist(carrier.pos, b.pos) <= FOOT_REACH ? 1 : 0.3);
  const pBall = sigmoid((tCar - tDef + misread) / 0.1) * sigmoid((reach - dReach) / 0.25) * (blocked ? 0.1 : 1) * (1 - pEvade);
  const inBox = isInPenaltyArea(carrier.pos, carrier.side);
  const lastMan = isLastMan(world, d, carrier);
  const style = d.side === 'home' ? world.homeStyle : world.awayStyle;
  const challengeMul = d.traits.challenge * (1 + 2 * style.tackle);
  const danger = positionValue(carrier.pos, carrier.side);
  const gain = (danger + LUNGE_GAIN_BASE) * challengeMul;
  // Missing means the carrier is past him: the cost grows with the danger.
  const booked = d.yellowCards > 0;
  const cost = LUNGE_FOUL_COST + (inBox ? 0.9 : 0) + (booked ? 0.1 : 0) + (lastMan ? 0.15 : 0.03) + 1.5 * danger;
  const u = pBall * gain - (1 - pBall) * cost;
  // The professional foul: stop a dangerous break by taking the man, at the
  // price of a free kick and probably a booking.  Only outside his own box.
  const manAt = add(carrier.pos, scale(carrier.vel, LUNGE_TIME));
  const toGoalC = sub(vec(defendingGoalX(d.side), PITCH_WIDTH / 2), carrier.pos);
  const behind = dot(toGoalC, sub(d.pos, carrier.pos)) < 0;
  const breaking = behind && owned(world, carrier) && progressOf(carrier.pos, carrier.side) > 0.5
    && dist(d.pos, manAt) <= reach && goalSideCount(world, d, carrier) <= 2;
  const uFoul = breaking && !inBox
    ? (danger * 1.6 - (0.02 + TACTICAL_CARD_COST + (booked ? 0.25 : 0))) * challengeMul
    : -1;
  if (u <= 0 && uFoul <= 0) return;
  const closing = len(d.vel) + 1.5;
  const tactical = uFoul > u;
  d.lunge = { at: tactical ? manAt : seen, resolveSec: now + LUNGE_TIME, closing, targetId: carrier.id };
  trace(world, 'lunge', d, {
    carrier: carrier.id, exposed: r2(exposed), dReach: r2(dReach), tCar: r2(tCar), tDef: r2(tDef), misread: r2(misread),
    holds: carrier.holds, pBall: r2(pBall), u: r2(u * 1000), uFoul: r2(uFoul * 1000), tactical, lastMan, inBox,
  });
}

/** Expected-goal cost a defender puts on the booking a tactical foul brings. */
const TACTICAL_CARD_COST = 0.03;

/** True if `p` is in possession (the ball is his and near him). */
function owned(world: SimWorld, p: SimPlayer): boolean {
  return world.ball.ownerId === p.id && dist(p.pos, world.ball.pos) < 2;
}

/** How many of `d`'s outfield team-mates stand between the carrier and goal. */
function goalSideCount(world: SimWorld, d: SimPlayer, carrier: SimPlayer): number {
  const goal = vec(defendingGoalX(d.side), PITCH_WIDTH / 2);
  const dc = dist(carrier.pos, goal);
  let n = 0;
  for (const m of teamOf(world, d.side)) {
    if (m === d || m.sentOff || m.role === 'GK') continue;
    if (dist(m.pos, goal) < dc && Math.abs(m.pos.y - carrier.pos.y) < 15) n++;
  }
  return n;
}

/** Resolve a lunge whose foot has arrived: ball, man, or nothing. */
function resolveLunge(world: SimWorld, d: SimPlayer, events: SimEvent[], minute: number): void {
  const L = d.lunge!;
  d.lunge = null;
  const now = world.clockSec;
  const b = world.ball;
  const to = sub(L.at, d.pos);
  const tl = len(to);
  const foot = tl <= LEG_REACH ? L.at : add(d.pos, scale(normalize(to), LEG_REACH));
  const carrier = findById(world, L.targetId);
  // The leg sweeps the last LEG_REACH metres to the foot: whatever it meets
  // first along that sweep, ball or man, decides the challenge.
  const legFrom = tl > 1e-6 ? sub(foot, scale(normalize(to), Math.min(LEG_REACH, tl))) : foot;
  const sb = segmentDistance(b.pos, legFrom, foot);
  const sm = carrier ? segmentDistance(carrier.pos, legFrom, foot) : { d: Infinity, t: 1 };
  const ballD = sb.d;
  const manD = sm.d;
  const ballFree = world.phase === 'open_play' && b.z < 0.6;
  const ballHit = ballFree && ballD <= BALL_CONTACT && !shielded(world, d, b.pos);
  const manHit = manD <= MAN_CONTACT;
  if (ballHit && (!manHit || sb.t <= sm.t + 0.15)) {
    // Foot meets ball first: clean.  A soft ball sticks to a good tackler;
    // otherwise it is knocked loose.
    const rel = len(sub(b.vel, d.vel));
    const skill = d.stats.tackling / 100;
    const owner = b.ownerId;
    if (rel < 3 + 4 * skill) {
      b.vel = scale(d.vel, 0.5);
      b.ownerId = d.id;
      b.controlSec = now;
    } else {
      const away = normalize(sub(b.pos, carrier ? carrier.pos : d.pos));
      b.vel = add(scale(away, 4 + 3 * (1 - skill)), vec(slip(d, world, 1.2), slip(d, world, 1.2)));
      b.ownerId = null;
    }
    b.vz = 0;
    b.kick = { kind: 'poke', side: d.side, playerId: d.id, from: b.pos, tSec: now, targetId: null, aim: b.pos, resolved: true, woodwork: false };
    b.offsideFor = null;
    touched(world, d);
    newBallPath(world, d);
    if (carrier && owner === carrier.id) {
      emit(events, world, minute, { type: 'tackle', side: d.side, playerId: d.id, otherId: carrier.id });
      bump(world, d, 0.03);
      bump(world, carrier, -0.03);
      carrier.noTouchUntil = now + 0.35;
    }
    trace(world, 'challenge', d, { outcome: 'ball', ballD: r2(ballD), manD: r2(manD) });
    return;
  }
  if (carrier && !carrier.sentOff && manHit && world.phase === 'open_play') {
    // Foot meets the man: a foul.  Severity from closing speed, angle and
    // whether the ball was even playable; the card follows from severity and
    // from denying an obvious chance.  No randomness.
    const facing = len(carrier.vel) > 0.5 ? normalize(carrier.vel)
      : normalize(sub(vec(attackingGoalX(carrier.side), PITCH_WIDTH / 2), carrier.pos));
    const approach = normalize(to);
    const fromBehind = dot(approach, facing) > 0.5;
    const severity = L.closing / 9 + (fromBehind ? 0.4 : 0) + (ballD > 1.5 ? 0.25 : 0);
    const goal = vec(attackingGoalX(carrier.side), PITCH_WIDTH / 2);
    const inBox = isInPenaltyArea(carrier.pos, carrier.side);
    const dogso = dist(carrier.pos, goal) < 30 && dist(b.pos, carrier.pos) < 2 && isLastMan(world, d, carrier)
      && dot(facing, normalize(sub(goal, carrier.pos))) > 0.3;
    let card: 'yellow' | 'red' | undefined;
    if (severity >= RED_SEVERITY || (dogso && !inBox)) card = 'red';
    else if (severity >= YELLOW_SEVERITY || dogso) card = 'yellow';
    if (card === 'yellow') {
      d.yellowCards += 1;
      if (d.yellowCards >= 2) card = 'red';
    }
    emit(events, world, minute, { type: 'foul', side: d.side, playerId: d.id, otherId: carrier.id, ...(card ? { card } : {}) });
    trace(world, 'challenge', d, {
      outcome: 'foul', ballD: r2(ballD), manD: r2(manD), severity: r2(severity), fromBehind, dogso, card: card ?? null, inBox,
    });
    bump(world, d, -0.01);
    if (card === 'red') sendOff(d);
    if (inBox) {
      emit(events, world, minute, { type: 'penalty', side: carrier.side, playerId: carrier.id });
      beginRestart(world, 'penalty', carrier.side, penaltySpot(carrier.side));
    } else {
      beginRestart(world, 'freekick', carrier.side, clampSpot(carrier.pos), card ? 12 : 0);
    }
    return;
  }
  // Foot meets nothing: beaten, and it costs real time to recover.
  d.recoverUntil = now + 0.9 - 0.4 * (d.stats.tackling / 100);
  d.noTouchUntil = now + 0.5;
  bump(world, d, -0.02);
  trace(world, 'challenge', d, { outcome: 'miss', ballD: r2(ballD), manD: r2(manD) });
}

function clampSpot(p: Vec2): Vec2 {
  return vec(Math.max(0.5, Math.min(PITCH_LENGTH - 0.5, p.x)), Math.max(0.5, Math.min(PITCH_WIDTH - 0.5, p.y)));
}

// ── Shots ───────────────────────────────────────────────────────────────────

/** Emit the single outcome event for an unresolved shot. */
function resolveShot(
  world: SimWorld, events: SimEvent[], minute: number, outcome: 'shot' | 'save', saver?: SimPlayer,
): void {
  const k = world.ball.kick;
  if (!k || !isShotKind(k.kind) || k.resolved) return;
  k.resolved = true;
  const shooter = findById(world, k.playerId);
  if (outcome === 'save' && saver) {
    emit(events, world, minute, { type: 'save', side: saver.side, playerId: saver.id, otherId: k.playerId });
    bump(world, saver, 0.04);
    bump(world, shooter, -0.02);
  } else if (k.woodwork) {
    emit(events, world, minute, { type: 'woodwork', side: k.side, playerId: k.playerId });
  } else {
    emit(events, world, minute, { type: 'shot', side: k.side, playerId: k.playerId });
    bump(world, shooter, -0.03);
  }
  trace(world, 'shot_end', shooter, { outcome: outcome === 'save' ? 'save' : k.woodwork ? 'woodwork' : 'shot' });
}

const ON_TARGET_PATH = new Float64Array(3 * 60);

/** Would the ball, untouched, cross the goal line inside the frame? */
function headingOnTarget(world: SimWorld, defendingSide: TeamSide): boolean {
  const gx = defendingGoalX(defendingSide);
  const b = world.ball;
  const n = predictPath(b, 60, world.dtSec, ON_TARGET_PATH);
  let px = b.pos.x;
  let py = b.pos.y;
  let pz = b.z;
  for (let i = 0; i < n; i++) {
    const x = ON_TARGET_PATH[3 * i]!;
    const y = ON_TARGET_PATH[3 * i + 1]!;
    const z = ON_TARGET_PATH[3 * i + 2]!;
    if ((gx === 0 && x <= 0) || (gx === PITCH_LENGTH && x >= PITCH_LENGTH)) {
      const t = Math.abs(x - px) < 1e-9 ? 1 : (gx - px) / (x - px);
      const yc = py + (y - py) * t;
      const zc = pz + (z - pz) * t;
      return yc > GOAL_Y_MIN && yc < GOAL_Y_MAX && zc < GOAL_HEIGHT;
    }
    px = x; py = y; pz = z;
  }
  return false;
}

// ── Touches (the ball meets a body) ─────────────────────────────────────────

/** Can `p` touch a ball at height z this tick, and with what reach? */
function reachFor(p: SimPlayer, z: number, at: Vec2, blocking: boolean): number {
  if (p.role === 'GK' && inOwnBox(p, at) && z <= KEEPER_TOP) return keeperReach(p, z);
  // A defender who has thrown himself into a shooting lane covers more.
  if (z <= 0.9) return FOOT_REACH + (blocking ? BLOCK_LUNGE : 0);
  if (z <= HEAD_Z) return 0.6 + (blocking ? BLOCK_LUNGE * 0.6 : 0);
  return -1;
}

/** Extra reach (m) of a leg or body thrown into a shooting lane. */
const BLOCK_LUNGE = 0.55;

/**
 * The ball has met `p` at `at` (height z).  Decide what physically happens:
 * a keeper's catch or parry, a block, a header, or a controlled first touch;
 * then label it (save, interception, tackle, completed pass).
 */
function touchBall(world: SimWorld, p: SimPlayer, at: Vec2, z: number, closeD: number, events: SimEvent[], minute: number): void {
  const b = world.ball;
  const now = world.clockSec;
  const kick = b.kick;
  const prevOwner = b.ownerId ? findById(world, b.ownerId) : null;
  b.pos = at;
  b.z = z;

  // Offside: the flagged receiver is the next to play the ball.
  if (b.offsideFor === p.id) {
    emit(events, world, minute, { type: 'offside', side: p.side, playerId: p.id });
    passEnd(world, 'offside');
    beginRestart(world, 'freekick', otherSide(p.side), clampSpot(p.pos), -3, true);
    return;
  }
  b.offsideFor = null;

  const shotLive = kick !== null && isShotKind(kick.kind) && !kick.resolved;
  const speed = len(b.vel);
  const opponents = teamOf(world, otherSide(p.side)).filter((o) => !o.sentOff);

  // ── Keeper with his hands ──────────────────────────────────────────────
  const backPass = kick !== null && kick.side === p.side && isPassKind(kick.kind) && kick.kind !== 'throw';
  if (p.role === 'GK' && inOwnBox(p, at) && z <= KEEPER_TOP && !backPass) {
    const onTarget = shotLive && kick!.side !== p.side ? headingOnTarget(world, p.side) : false;
    const rel = Math.hypot(speed, b.vz);
    const body = 0.75 + 0.35 * (p.stats.goalkeeping / 100);
    if (rel <= catchSpeed(p) && closeD <= body) {
      if (shotLive && kick!.side !== p.side) resolveShot(world, events, minute, onTarget ? 'save' : 'shot', p);
      passEnd(world, kick && kick.side !== p.side ? 'lost' : 'complete');
      touched(world, p);
      trace(world, 'keeper', p, { action: 'catch', speed: r2(rel), closeD: r2(closeD), onTarget });
      p.dive = null;
      const hold = world.flags.scoreClockTerm && leadingLate(world, p.side) ? 5 : 0;
      beginRestart(world, 'keeper', p.side, clampSpot(p.pos), hold, false, p.id);
      b.ownerId = p.id;
      return;
    }
    // Parry: the ball comes back off his hands, pushed wide of the goal.
    const gx = defendingGoalX(p.side);
    const out = gx === 0 ? 1 : -1;
    const side = b.pos.y >= p.pos.y ? 1 : -1;
    const e = errorScale(p, p.stats.goalkeeping, world, { pressure: 0, awkward: 0.5 });
    b.vel = vec(
      Math.abs(b.vel.x) * 0.22 * out + slip(p, world, 2.5 * e),
      b.vel.y * 0.3 + side * speed * 0.45 + slip(p, world, 2.5 * e),
    );
    b.vz = 1.5 + Math.abs(b.vz) * 0.3;
    b.ownerId = null;
    if (shotLive && kick!.side !== p.side) resolveShot(world, events, minute, onTarget ? 'save' : 'shot', p);
    passEnd(world, 'lost');
    b.kick = { kind: 'parry', side: p.side, playerId: p.id, from: at, tSec: now, targetId: null, aim: at, resolved: true, woodwork: false };
    touched(world, p);
    p.noTouchUntil = now + 0.4;
    newBallPath(world, p);
    trace(world, 'keeper', p, { action: 'parry', speed: r2(rel), closeD: r2(closeD), onTarget });
    return;
  }

  // ── A fast ball into a body: a block / deflection ───────────────────────
  const intended = kick !== null && kick.targetId === p.id;
  if (speed > BLOCK_SPEED && !intended) {
    const n0 = sub(at, p.pos);
    const n = len(n0) > 1e-6 ? normalize(n0) : scale(normalize(b.vel), -1);
    const vn = dot(b.vel, n);
    const refl = vn < 0 ? sub(b.vel, scale(n, 1.3 * vn)) : b.vel;
    b.vel = add(scale(refl, 0.45), vec(slip(p, world, 1.5), slip(p, world, 1.5)));
    b.vz = Math.abs(b.vz) * 0.3 + 0.8;
    b.ownerId = null;
    if (shotLive) resolveShot(world, events, minute, 'shot');
    passEnd(world, kick && kick.side === p.side ? 'complete' : 'lost');
    b.kick = { kind: 'deflection', side: p.side, playerId: p.id, from: at, tSec: now, targetId: null, aim: at, resolved: true, woodwork: false };
    touched(world, p);
    newBallPath(world, p);
    trace(world, 'block', p, { speed: r2(speed) });
    return;
  }

  if (shotLive) resolveShot(world, events, minute, 'shot');

  // ── Header ────────────────────────────────────────────────────────────
  if (z > 0.9) {
    header(world, p, events, minute);
    passEnd(world, kick && kick.side === p.side ? 'complete' : 'lost');
    return;
  }

  // ── Controlled first touch ──────────────────────────────────────────────
  const gx = attackingGoalX(p.side);
  const toGoal = normalize(sub(vec(gx, PITCH_WIDTH / 2), p.pos));
  let away = ZERO;
  let nearD = Infinity;
  for (const o of opponents) {
    const dd = dist(o.pos, p.pos);
    if (dd < nearD) { nearD = dd; away = normalize(sub(p.pos, o.pos)); }
  }
  const tdir = normalize(add(toGoal, scale(away, nearD < 6 ? 1.2 : 0.3)));
  const pressure = pressureAt(p.pos, opponents);
  // He takes the ball on in the direction he is already moving; asked to go
  // against his run (or squeezed), he kills it at his feet instead.
  const along = Math.max(0, dot(p.vel, tdir));
  const desired = scale(tdir, (along * 0.8 + 0.3) * (1 - 0.6 * pressure));
  const incoming = b.vel;
  b.vel = firstTouch(p, world, incoming, desired, pressure);
  b.vz = 0;
  b.z = 0;
  b.ownerId = p.id;
  b.controlSec = now;
  touched(world, p);
  p.holds = 0;

  // Labels: what did this touch take, and from whom?
  // Taken off a man who still had it at his feet: a tackle.  A heavy touch
  // that ran away from him and was collected is a loose ball, not a duel.
  if (prevOwner && prevOwner.side !== p.side && dist(prevOwner.pos, at) < STEAL_DUEL_DIST) {
    emit(events, world, minute, { type: 'tackle', side: p.side, playerId: p.id, otherId: prevOwner.id });
    bump(world, p, 0.03);
    bump(world, prevOwner, -0.03);
    trace(world, 'steal', p, { from: prevOwner.id, gap: r2(dist(prevOwner.pos, at)) });
  } else if (kick && isPassKind(kick.kind) && !kick.resolved) {
    if (kick.side !== p.side) {
      // Cut out on its way (read and stepped into), not a loose ball collected.
      const cutOut = speed >= 7 && dist(at, kick.aim) > 5;
      if (cutOut) emit(events, world, minute, { type: 'interception', side: p.side, playerId: p.id });
      passEnd(world, cutOut ? 'intercepted' : 'lost');
      bump(world, findById(world, kick.playerId), -0.02);
      bump(world, p, 0.02);
    } else {
      passEnd(world, 'complete');
      bump(world, findById(world, kick.playerId), 0.01);
    }
  }
  b.kick = null;
  trace(world, 'control', p, { incoming: r2(len(incoming)), out: r2(len(b.vel)), pressure: r2(pressure) });
  newBallPath(world, p);
}

/** Close out a pass in flight with its outcome (instrumentation only). */
function passEnd(world: SimWorld, outcome: string): void {
  const k = world.ball.kick;
  if (!k || !isPassKind(k.kind) || k.resolved) return;
  k.resolved = true;
  if (world.trace) trace(world, 'pass_end', findById(world, k.playerId), { kind: k.kind, outcome });
}

function leadingLate(world: SimWorld, side: TeamSide): boolean {
  const gd = side === 'home' ? world.score[0] - world.score[1] : world.score[1] - world.score[0];
  return gd > 0 && world.clockSec > world.matchSeconds * 0.75;
}

/** A header: at goal in the attacking box, away in defence, on to a mate otherwise. */
function header(world: SimWorld, p: SimPlayer, events: SimEvent[], minute: number): void {
  const b = world.ball;
  const side = p.side;
  const gx = attackingGoalX(side);
  const goal = vec(gx, PITCH_WIDTH / 2);
  const dGoal = dist(b.pos, goal);
  const opponents = teamOf(world, otherSide(side)).filter((o) => !o.sentOff);
  const pressure = pressureAt(b.pos, opponents);
  const e = errorScale(p, (p.stats.shooting + p.stats.positioning) / 2, world, { pressure, awkward: 0.3 });
  if (dGoal < 15 && progressOf(b.pos, side) > 0.8) {
    // Header at goal: pick the target the keeper is furthest from.
    const keeper = keeperOf(world, otherSide(side));
    const speed = 11 + 7 * (p.stats.shooting / 100);
    let best = 0;
    let bestP = -1;
    const ys = [GOAL_Y_MIN + 0.6, PITCH_WIDTH / 2, GOAL_Y_MAX - 0.6];
    const ps = ys.map((gy) => estimateShot(b.pos, side, gy, 0.4, speed, e * 2, keeper, opponents).p);
    for (let i = 0; i < ys.length; i++) if (ps[i]! > bestP) { bestP = ps[i]!; best = i; }
    const aim = vec(gx, ys[best]!);
    const d = dist(b.pos, aim);
    const T = airTravelTime(speed, d);
    const vz = verticalLaunchSpeed(b.z, 0.4, T);
    const s = strike(p, world, normalize(sub(aim, b.pos)), speed, Math.max(0, vz), KICK_ERROR.header, e);
    launch(world, p, 'shot', s.vel, s.vz, aim, null);
    b.vz = s.vz + Math.min(0, vz);
    world.lastShot = { playerId: p.id, side, tSec: world.clockSec };
    shotImpulse(world, side, 0.12);
    trace(world, 'shot', p, { dist: r2(d), speed: r2(speed), aimY: r2(aim.y), aimZ: 0.4, est: r2(bestP), header: true, errScale: r2(e) });
    return;
  }
  // Defensive or midfield header: away from danger, toward a mate if one is near.
  let mate: SimPlayer | null = null;
  let bestS = -Infinity;
  for (const m of teamOf(world, side)) {
    if (m === p || m.sentOff || m.role === 'GK') continue;
    const d = dist(m.pos, b.pos);
    if (d < 5 || d > 20) continue;
    const s = progressOf(m.pos, side) * 10 - d * 0.2;
    if (s > bestS) { bestS = s; mate = m; }
  }
  const ownHalf = progressOf(b.pos, side) < 0.45;
  const aim = mate && !ownHalf ? mate.pos : add(b.pos, scale(normalize(sub(b.pos, vec(defendingGoalX(side), PITCH_WIDTH / 2))), 20));
  const d = Math.max(3, dist(b.pos, aim));
  const T = 0.6 + d * 0.03;
  const speed = Math.min(16, (Math.exp(DRAG_K * d) - 1) / (DRAG_K * T));
  const s = strike(p, world, normalize(sub(aim, b.pos)), speed, GRAVITY * T / 2, KICK_ERROR.header, e);
  // A header redirects a moving ball; it cannot cancel its momentum, so part
  // of the incoming pace carries on (which is how crosses get headed behind).
  const incoming = b.vel;
  launch(world, p, mate && !ownHalf ? 'header' : 'clear', add(scale(s.vel, 0.7), scale(incoming, 0.3)), s.vz, aim, mate && !ownHalf ? mate.id : null);
  trace(world, 'header', p, { dist: r2(d), toMate: mate !== null && !ownHalf });
}

// ── Ball resolution: lines, frame and bodies along this tick's path ─────────

/**
 * After the ball moved from (from, fromZ) to its new position, find what it
 * met first: a body (touch), the frame (woodwork), or a line (goal / out).
 */
function resolveBall(world: SimWorld, from: Vec2, fromZ: number, events: SimEvent[], minute: number): void {
  const b = world.ball;
  const to = b.pos;
  const toZ = b.z;
  const now = world.clockSec;

  // First body on the path.
  let tBody = Infinity;
  let who: SimPlayer | null = null;
  let whoAt = to;
  let whoZ = toZ;
  let whoD = 0;
  const owner = b.ownerId ? findById(world, b.ownerId) : null;
  const ownerNear = owner ? dist(owner.pos, to) < 4 : false;
  const shotFlying = b.kick !== null && isShotKind(b.kick.kind) && !b.kick.resolved;
  for (const p of [...world.home, ...world.away]) {
    if (p.sentOff || p.lunge || now < p.noTouchUntil) continue;
    if (owner && p === owner) continue; // the carrier plays it by decision
    if (owner && ownerNear && p.side === owner.side) continue; // nobody takes it off his own man
    const sd = segmentDistance(p.pos, from, to);
    const zAt = fromZ + (toZ - fromZ) * sd.t;
    const atPt = vec(from.x + (to.x - from.x) * sd.t, from.y + (to.y - from.y) * sd.t);
    const reach = reachFor(p, zAt, atPt, shotFlying && now < p.blockUntil);
    if (reach < 0 || sd.d > reach) continue;
    // A player who has not yet reacted to the ball can still be hit by it,
    // but only a fast ball counts (he cannot go for one he has not seen).
    if (now < p.reactUntil && len(b.vel) <= BLOCK_SPEED && p.role !== 'GK') continue;
    if (shielded(world, p, atPt)) continue;
    // A ball still at its owner's feet, nearer his foot than this man's, is
    // his: taking it needs a committed challenge (a lunge), not a brush.
    if (owner && p.side !== owner.side && len(b.vel) < BLOCK_SPEED) {
      const dOwn = dist(owner.pos, atPt);
      if (dOwn <= FOOT_REACH && dOwn < dist(p.pos, atPt)) continue;
    }
    if (sd.t < tBody || (sd.t === tBody && who && sd.d < whoD)) {
      tBody = sd.t; who = p; whoAt = atPt; whoZ = zAt; whoD = sd.d;
    }
  }

  // Goal-line crossing on this segment.
  let tLine = Infinity;
  let lineX = 0;
  if (to.x <= 0 || to.x >= PITCH_LENGTH) {
    lineX = to.x <= 0 ? 0 : PITCH_LENGTH;
    const dx = to.x - from.x;
    tLine = Math.abs(dx) < 1e-9 ? 0 : Math.max(0, Math.min(1, (lineX - from.x) / dx));
  }
  let tTouch = Infinity;
  if (to.y <= 0 || to.y >= PITCH_WIDTH) {
    const ly = to.y <= 0 ? 0 : PITCH_WIDTH;
    const dy = to.y - from.y;
    tTouch = Math.abs(dy) < 1e-9 ? 0 : Math.max(0, Math.min(1, (ly - from.y) / dy));
  }

  if (who && tBody <= tLine && tBody <= tTouch) {
    touchBall(world, who, whoAt, whoZ, whoD, events, minute);
    return;
  }

  if (tLine <= tTouch && tLine !== Infinity) {
    const yAt = from.y + (to.y - from.y) * tLine;
    const zAt = fromZ + (toZ - fromZ) * tLine;
    const defending: TeamSide = lineX === 0 ? 'home' : 'away';
    const attacking = otherSide(defending);
    const kick = b.kick;
    // The frame: posts and crossbar.
    const nearPost = Math.min(Math.abs(yAt - GOAL_Y_MIN), Math.abs(yAt - GOAL_Y_MAX));
    const inMouth = yAt > GOAL_Y_MIN && yAt < GOAL_Y_MAX;
    const hitPost = nearPost < FRAME_HIT && zAt < GOAL_HEIGHT + FRAME_HIT;
    const hitBar = inMouth && Math.abs(zAt - GOAL_HEIGHT) < FRAME_HIT;
    if (hitPost || hitBar) {
      const into = lineX === 0 ? 1 : -1;
      b.pos = vec(lineX + into * 0.15, yAt);
      b.z = Math.max(0, zAt);
      if (hitPost) {
        const post = Math.abs(yAt - GOAL_Y_MIN) < Math.abs(yAt - GOAL_Y_MAX) ? GOAL_Y_MIN : GOAL_Y_MAX;
        b.vel = vec(-b.vel.x * 0.55, b.vel.y * 0.6 + Math.sign(yAt - post || 1) * Math.abs(b.vel.x) * 0.25);
      } else {
        b.vel = vec(-b.vel.x * 0.5, b.vel.y * 0.8);
        b.vz = -Math.abs(b.vz) * 0.5 - 1;
      }
      if (kick && isShotKind(kick.kind) && !kick.resolved) kick.woodwork = true;
      trace(world, 'frame', null, { post: hitPost, bar: hitBar, y: r2(yAt), z: r2(zAt) });
      newBallPath(world, null);
      return;
    }
    if (inMouth && zAt < GOAL_HEIGHT - 0.11 && yAt > GOAL_Y_MIN + 0.11 && yAt < GOAL_Y_MAX - 0.11) {
      scoreGoal(world, attacking, events, minute, yAt, zAt);
      return;
    }
    // Out over the goal line.
    if (kick && isShotKind(kick.kind)) resolveShot(world, events, minute, 'shot');
    passEnd(world, 'out');
    if (b.lastTouchSide === defending) {
      emit(events, world, minute, { type: 'out_corner', side: attacking });
      shotImpulse(world, attacking, 0.05);
      beginRestart(world, 'corner', attacking, cornerSpot(attacking, yAt));
    } else {
      emit(events, world, minute, { type: 'out_goalkick', side: defending });
      beginRestart(world, 'goalkick', defending, goalKickSpot(defending));
    }
    return;
  }

  if (tTouch !== Infinity) {
    const xAt = from.x + (to.x - from.x) * tTouch;
    const yLine = to.y <= 0 ? 0 : PITCH_WIDTH;
    const kick = b.kick;
    if (kick && isShotKind(kick.kind)) resolveShot(world, events, minute, 'shot');
    passEnd(world, 'out');
    const throwTo: TeamSide = b.lastTouchSide === 'home' ? 'away' : 'home';
    emit(events, world, minute, { type: 'out_throw', side: throwTo });
    beginRestart(world, 'throw', throwTo, vec(Math.max(1, Math.min(PITCH_LENGTH - 1, xAt)), yLine));
  }
}

/** A goal: the ball crossed the line between the posts and under the bar. */
function scoreGoal(world: SimWorld, attacking: TeamSide, events: SimEvent[], minute: number, y: number, z: number): void {
  const b = world.ball;
  const kick = b.kick;
  if (attacking === 'home') world.score[0] += 1; else world.score[1] += 1;
  // Credit: the last attacker to touch it; or the shooter if a keeper or
  // defender only diverted his shot; otherwise nobody (an own goal).
  let scorer: string | undefined;
  if (b.lastTouchSide === attacking && b.lastTouchId) scorer = b.lastTouchId;
  else if (world.lastShot && world.lastShot.side === attacking && world.clockSec - world.lastShot.tSec < 3) scorer = world.lastShot.playerId;
  if (kick && isShotKind(kick.kind)) kick.resolved = true;
  emit(events, world, minute, { type: 'goal', side: attacking, ...(scorer ? { playerId: scorer } : {}) });
  trace(world, 'goal', findById(world, scorer ?? null), { y: r2(y), z: r2(z), ownGoal: scorer === undefined });
  const sc = findById(world, scorer ?? null);
  bump(world, sc, 0.08);
  for (const p of teamOf(world, attacking)) bump(world, p, 0.01);
  for (const p of teamOf(world, otherSide(attacking))) bump(world, p, -0.01);
  shotImpulse(world, attacking, 0.2);
  beginRestart(world, 'kickoff', otherSide(attacking), CENTRE_SPOT);
}

// ── Dead ball ───────────────────────────────────────────────────────────────

function deadBallTick(world: SimWorld, dt: number, minute: number, events: SimEvent[]): void {
  const r = world.restart!;
  const now = world.clockSec;
  for (const p of [...world.home, ...world.away]) {
    if (p.sentOff) continue;
    integratePlayer(p, restartVelocity(p, world), dt);
  }
  let taker = findById(world, r.takerId);
  if (!taker || taker.sentOff) {
    const team = teamOf(world, r.side).filter((p) => !p.sentOff && p.role !== 'GK');
    taker = team[0] ?? null;
    if (!taker) return;
    r.takerId = taker.id;
  }
  if (r.kind === 'keeper') world.ball.pos = taker.pos;
  if (now < r.readyAt) return;
  const atSpot = dist(taker.pos, r.spot) < 0.8;
  if (!atSpot && now < r.readyAt + 25) return;
  // Take it.
  taker.pos = r.spot;
  taker.vel = ZERO;
  world.ball.pos = r.spot;
  world.phase = 'open_play';
  world.restart = null;
  world.ball.ownerId = taker.id;
  for (const p of [...world.home, ...world.away]) {
    p.job = 'shape';
    p.nextThinkSec = now;
    p.reactUntil = now;
  }
  const { action } = chooseAction(taker, world, r.kind, r.indirect);
  trace(world, 'restart', taker, { kind: r.kind, action: action.kind });
  execute(world, taker, action, events, minute, r.kind);
  // The taker may not play it again until someone else has.
  taker.noTouchUntil = now + 0.8;
}

// ── The tick ───────────────────────────────────────────────────────────────

/**
 * Advance the world by one timestep and return any events that emerged.
 *
 * @param world  The mutable match world.
 * @param dt     Timestep in seconds.
 * @returns      Events emitted this tick (often empty).
 */
export function step(world: SimWorld, dt: number): SimEvent[] {
  const events: SimEvent[] = [];
  world.clockSec += dt;
  // clockSec accumulates by repeated `+= dt`, so after thousands of ticks it
  // carries floating-point drift (5400.000000000x at 90:00).  Rounding to
  // milliseconds before Math.ceil keeps an event that lands exactly on a
  // minute boundary in its own minute.
  const clockMs = Math.round(world.clockSec * 1000) / 1000;
  const minute = Math.max(1, Math.ceil(clockMs / 60));
  const now = world.clockSec;

  if (world.phase === 'dead_ball' && world.restart) {
    deadBallTick(world, dt, minute, events);
    driftTick(world, dt);
    return events;
  }

  maybeSubstitute(world, 'home', minute, events);
  maybeSubstitute(world, 'away', minute, events);

  const ctx = buildContext(world);
  const carrier = ctx.carrier;
  const all = [...world.home, ...world.away];

  // ── Off-ball decisions ──────────────────────────────────────────────────
  for (const p of all) {
    if (p.sentOff || p.role === 'GK' || p === carrier || p.lunge) continue;
    if (now >= p.nextThinkSec) thinkJob(p, world, ctx);
  }

  // ── Keepers read shots ──────────────────────────────────────────────────
  const kick = world.ball.kick;
  if (kick && isShotKind(kick.kind) && !kick.resolved) {
    const k = keeperOf(world, otherSide(kick.side));
    if (k && !k.dive && now >= k.reactUntil) readShot(k, world);
  }

  // ── The carrier plays the ball when it is at his feet ────────────────────
  // First, a carrier who has seen a challenge coming (after his reaction
  // time) knocks the ball away from the incoming foot if he can reach it.
  if (carrier && !carrier.sentOff && now >= carrier.noTouchUntil
    && dist(carrier.pos, world.ball.pos) <= FOOT_REACH && world.ball.z < 0.7
    && now - world.ball.lastTouchSec >= 0.1) {
    const threat = incomingLunge(world, carrier);
    if (threat) evade(world, carrier, threat);
  }
  // A wound-up strike goes off when its back-lift is done, if the ball is
  // still there to hit; if the ball has gone (tackled, blocked, run away) the
  // chance is gone with it.
  for (const p of all) {
    if (!p.windup) continue;
    if (p !== carrier || world.phase !== 'open_play') { p.windup = null; continue; }
    if (now < p.windup.at) continue;
    const act = p.windup.action as CarrierAction;
    p.windup = null;
    if (dist(p.pos, world.ball.pos) <= FOOT_REACH + 0.2 && world.ball.z < 0.7) {
      execute(world, p, act, events, minute, null);
    } else if (world.trace) {
      trace(world, 'windup_lost', p, { ballD: r2(dist(p.pos, world.ball.pos)) });
    }
  }
  if (carrier && !carrier.sentOff && !carrier.windup && now >= carrier.noTouchUntil
    && dist(carrier.pos, world.ball.pos) <= FOOT_REACH && world.ball.z < 0.7
    && now - world.ball.lastTouchSec >= TOUCH_GAP) {
    // A receiver needs a moment to settle the ball and look up before he can
    // pick a pass (quicker for players who see the game early).
    // Under pressure he releases it at once (and less accurately).
    const press = pressureAt(carrier.pos, teamOf(world, otherSide(carrier.side)));
    const settled = now - world.ball.controlSec >= (0.9 + 1.0 * (1 - carrier.stats.vision / 100)) * (1 - press);
    const { action, options, top } = chooseAction(carrier, world, 'open', false, settled);
    if (world.trace) {
      trace(world, 'decide', carrier, { action: action.kind, options, u: r2(action.utility * 1000), top });
    }
    if (action.kind === 'shoot') {
      // Back-lift: quicker for good strikers, a touch longer when stretched.
      const wind = SHOT_WINDUP * (1.3 - 0.6 * carrier.stats.shooting / 100);
      carrier.windup = { action, at: now + wind };
      // Defenders close enough who see the back-lift (after their reaction
      // time) throw a leg or body into the lane.
      for (const o of teamOf(world, otherSide(carrier.side))) {
        if (o.sentOff || o.role === 'GK') continue;
        if (dist(o.pos, carrier.pos) > 7) continue;
        if (reactionDelay(o, world) < wind + 0.25) o.blockUntil = now + wind + 0.6;
      }
    } else {
      execute(world, carrier, action, events, minute, null);
    }
  }

  // ── Challenges ───────────────────────────────────────────────────────────
  const owner = world.ball.ownerId ? findById(world, world.ball.ownerId) : null;
  if (owner) {
    for (const d of teamOf(world, otherSide(owner.side))) {
      if (d.sentOff) continue;
      if (d.role === 'GK' && !inOwnBox(d, d.pos)) continue;
      if (d.role !== 'GK' && d.job !== 'press' && d.job !== 'cover' && d.job !== 'chase') continue;
      considerLunge(world, d, owner);
    }
  } else if (world.ball.z < 0.6) {
    // A loose ball two men are racing for: either may commit to get there
    // first, and if the other arrives first the challenge meets the man.
    const hr = nearestRacer(world, 'home');
    const ar = nearestRacer(world, 'away');
    if (hr && ar) {
      if (hr.job === 'chase') considerLunge(world, hr, ar);
      if (ar.job === 'chase' && !hr.lunge) considerLunge(world, ar, hr);
    }
  }
  for (const p of all) {
    if (p.lunge && now >= p.lunge.resolveSec && world.phase === 'open_play') resolveLunge(world, p, events, minute);
  }
  if (world.phase !== 'open_play') { driftTick(world, dt); return events; }

  // ── Movement ─────────────────────────────────────────────────────────────
  const ctx2 = carrier === (world.ball.ownerId ? findById(world, world.ball.ownerId) : null) ? ctx : buildContext(world);
  const carrierNow = ctx2.carrier;
  for (const p of all) {
    if (p.sentOff) continue;
    if (p.role === 'GK' && p.dive) {
      integratePlayer(p, diveVelocity(p), dt, 25, diveSpeed(p));
      continue;
    }
    if (p.lunge) {
      const v = sub(p.lunge.at, p.pos);
      const rem = Math.max(0.05, p.lunge.resolveSec - now);
      integratePlayer(p, truncate(scale(v, 1 / rem), 7), dt, 20, 7);
      continue;
    }
    if (p === carrierNow) { integratePlayer(p, carrierVelocity(p, world), dt); continue; }
    if (p.role === 'GK') { integratePlayer(p, keeperVelocity(p, world, ctx2), dt); continue; }
    const slowed = now < p.recoverUntil ? 0.35 : 1;
    integratePlayer(p, scale(jobVelocity(p, world, ctx2), slowed), dt);
  }

  // ── Ball physics and what it meets ──────────────────────────────────────
  const from = world.ball.pos;
  const fromZ = world.ball.z;
  stepBall(world.ball, dt);
  resolveBall(world, from, fromZ, events, minute);

  // A shot that has died without meeting anyone is over.
  const k2 = world.ball.kick;
  if (world.phase === 'open_play' && k2 && isShotKind(k2.kind) && !k2.resolved
    && len(world.ball.vel) < 3 && world.ball.z === 0) {
    resolveShot(world, events, minute, 'shot');
  }
  // Keepers stop diving once the ball is past or dealt with.
  const k3 = world.ball.kick;
  if (!k3 || !isShotKind(k3.kind) || k3.resolved) {
    for (const p of all) if (p.dive) p.dive = null;
  }

  driftTick(world, dt);
  return events;
}

/** The carrier runs onto his own touch. */
function carrierVelocity(p: SimPlayer, world: SimWorld): Vec2 {
  const b = world.ball;
  let target = add(b.pos, scale(b.vel, 0.25));
  // With an opponent close, he puts his body between that man and the ball.
  let near: SimPlayer | null = null;
  let nearD = 3;
  for (const o of teamOf(world, otherSide(p.side))) {
    if (o.sentOff) continue;
    const dd = dist(o.pos, b.pos);
    if (dd < nearD) { nearD = dd; near = o; }
  }
  if (near && dist(p.pos, b.pos) < 1.6) target = add(target, scale(normalize(sub(near.pos, b.pos)), 0.4));
  const d = dist(p.pos, target);
  const want = Math.min(effectiveMaxSpeed(p), Math.max(1.5, len(b.vel) + 0.8 + d * 0.9));
  const v = seek(p, target);
  const l = len(v);
  return l > 1e-6 ? scale(v, want / l) : ZERO;
}

/** Slow drifts: confidence toward baseline, momentum toward territory. */
function driftTick(world: SimWorld, dt: number): void {
  if (world.flags.confidence) {
    const a = dt / CONFIDENCE_TAU;
    for (const p of world.home) p.confidence += (confidenceBase(p) - p.confidence) * a;
    for (const p of world.away) p.confidence += (confidenceBase(p) - p.confidence) * a;
  }
  if (world.flags.momentum && world.phase === 'open_play') {
    const territory = (world.ball.pos.x / PITCH_LENGTH) * 2 - 1;
    const m = world.momentum[0] + (territory * 0.5 - world.momentum[0]) * (dt / MOMENTUM_TAU);
    world.momentum[0] = Math.max(-1, Math.min(1, m));
    world.momentum[1] = -world.momentum[0];
  }
}

export { PATH_SAMPLES, PATH_STRIDE };
export type { TickContext };
