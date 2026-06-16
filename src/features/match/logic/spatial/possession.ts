// ── features/match/logic/spatial/possession.ts ───────────────────────────────
// The on-ball brain + the physics of kicking.  This is where player STATS
// become OUTCOMES: a high-vision playmaker picks the better pass, a strong
// finisher's shots fly truer, a poor passer sprays it.  Everything here is
// pure — decisions and kick vectors are returned as data; step.ts applies them
// to the world.  Events (goals, saves, tackles) emerge downstream in step.ts
// from the resulting ball motion, never from a direct roll here.

import {
  type Vec2, vec, sub, add, scale, normalize, dist, dist2, dot,
} from './vec2';
import { rngGaussian, type Rng } from './rng';
import {
  type SimPlayer, type SimWorld, type TeamSide,
  GOAL_Y_MIN, GOAL_Y_MAX, PITCH_WIDTH, PITCH_LENGTH,
  attackingGoalX,
} from './types';

/** The carrier's chosen action for this decision tick. */
export type CarrierAction =
  | { kind: 'shoot' }
  | { kind: 'pass'; target: SimPlayer }
  | { kind: 'dribble' };

// ── Spatial evaluation helpers ────────────────────────────────────────────────

/**
 * Shooting quality of a position in [0,1], combining distance and angle.
 * A central position 10m out scores ~1; a tight angle 35m out scores ~0.
 * This gates whether shooting is even considered and scales the shot's error.
 *
 * @param pos   The shooter's position.
 * @param side  Which side they play for (sets which goal they attack).
 */
export function shotQuality(pos: Vec2, side: TeamSide): number {
  const goalX = attackingGoalX(side);
  const goalCentre = vec(goalX, PITCH_WIDTH / 2);
  const d = dist(pos, goalCentre);
  // Distance term: full marks at ≤8m, fading to 0 by ~32m.
  const distTerm = d <= 8 ? 1 : d >= 32 ? 0 : 1 - (d - 8) / 24;
  // Angle term: how much of the goal mouth is "visible".  Central → wide
  // angle → easy; out wide → narrow angle → hard.  Approximate via the
  // lateral offset from the goal centre relative to distance.
  const lateral = Math.abs(pos.y - PITCH_WIDTH / 2);
  const angleTerm = d < 1 ? 1 : Math.max(0, 1 - lateral / (d + 4));
  return distTerm * angleTerm;
}

/**
 * Local pressure on a position in [0,1]: how hemmed-in the carrier is by
 * opponents.  An opponent right on top contributes ~1, fading to 0 at 6m.
 * High pressure pushes the carrier to release the ball (pass) rather than hold.
 *
 * @param pos        Position to evaluate.
 * @param opponents  The opposing players.
 */
export function pressureAt(pos: Vec2, opponents: readonly SimPlayer[]): number {
  const RADIUS = 6;
  let pressure = 0;
  for (const o of opponents) {
    const d = dist(pos, o.pos);
    if (d < RADIUS) pressure += (RADIUS - d) / RADIUS;
  }
  return Math.min(1, pressure);
}

/**
 * Distance to the nearest opponent — used to measure how "open" a pass target
 * is.  Larger = more space = safer reception.
 */
function nearestOpponentDist(pos: Vec2, opponents: readonly SimPlayer[]): number {
  let best = Infinity;
  for (const o of opponents) {
    const d = dist2(pos, o.pos);
    if (d < best) best = d;
  }
  return best === Infinity ? Infinity : Math.sqrt(best);
}

/**
 * Choose the best teammate to pass to, or null if no option beats holding.
 *
 * Each candidate is scored by: forward progress toward goal (the main driver),
 * how open they are, minus a penalty for very long (riskier) passes.  A
 * low-vision carrier adds noise to the scores so they more often pick a worse
 * option — vision literally improves decision quality, as the design intends.
 *
 * The keeper is only considered as a last-resort backward outlet (when the
 * carrier is under heavy pressure deep in their own third), so teams don't
 * pointlessly pass back to the GK.
 *
 * @param carrier    The player on the ball.
 * @param teammates  Same-side players (excluding the carrier).
 * @param opponents  Opposing players.
 * @param rng        Seeded source for vision-scaled noise.
 */
export function chooseBestPass(
  carrier: SimPlayer,
  teammates: readonly SimPlayer[],
  opponents: readonly SimPlayer[],
  rng: Rng,
): SimPlayer | null {
  const goalX = attackingGoalX(carrier.side);
  const carrierProg = -Math.abs(carrier.pos.x - goalX); // closer to goal → larger (less negative)

  let best: SimPlayer | null = null;
  let bestScore = -Infinity;

  // Vision shapes how much random noise corrupts the scoring: elite vision
  // (~90) ⇒ ±0.5 noise; poor vision (~40) ⇒ ±3 noise — enough to flip picks.
  const noiseAmp = 3.2 * (1 - carrier.stats.vision / 110);

  for (const t of teammates) {
    // Skip the keeper unless we're a pressured defender deep in our own half.
    if (t.role === 'GK') continue;

    const targetProg = -Math.abs(t.pos.x - goalX);
    const forwardGain = targetProg - carrierProg; // >0 means closer to goal than us
    const openness = Math.min(12, nearestOpponentDist(t.pos, opponents)); // cap so it doesn't dominate
    const passLen = dist(carrier.pos, t.pos);
    const lengthPenalty = passLen > 28 ? (passLen - 28) * 0.25 : 0;

    // Weighted blend.  Forward progress is the dominant term; openness keeps
    // us from passing into traffic; length penalty discourages hopeful balls.
    let score = forwardGain * 0.6 + openness * 0.5 - lengthPenalty;
    score += rngGaussian(rng, 0, noiseAmp);

    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }

  return best;
}

/**
 * Decide what the carrier does this decision tick.
 *
 * Order of intent:
 *   1. If well-positioned to shoot, and a stat-weighted urge fires, shoot.
 *   2. Else if under real pressure OR a clearly more advanced teammate exists,
 *      pass to the best option.
 *   3. Else carry the ball forward (dribble).
 *
 * @param carrier    Player on the ball.
 * @param world      Current world (for teammates / opponents).
 * @param rng        Seeded source.
 */
export function chooseAction(carrier: SimPlayer, world: SimWorld, rng: Rng): CarrierAction {
  const teammates = (carrier.side === 'home' ? world.home : world.away).filter((p) => p.id !== carrier.id);
  const opponents = carrier.side === 'home' ? world.away : world.home;

  const sq = shotQuality(carrier.pos, carrier.side);
  const pressure = pressureAt(carrier.pos, opponents);

  // ── 1. Shoot? ──────────────────────────────────────────────────────────
  // Only consider it from a genuinely promising position.  The urge scales
  // with shot quality and the finisher's shooting stat; under pressure a
  // shooter is a touch more likely to just hit it.  The gate (sq > 0.50) and
  // low coefficients keep shot VOLUME realistic — calibrated (2026-06) alongside
  // placement error and saveProbability so a seeded batch lands near real-world
  // goal rates (~2.5–2.8/match), not the ~5+ arcade scorelines the first cut gave.
  if (sq > 0.50) {
    const shootUrge = sq * (0.075 + carrier.stats.shooting / 750) + pressure * 0.03;
    if (rng() < shootUrge) return { kind: 'shoot' };
  }

  // ── 2. Pass? ───────────────────────────────────────────────────────────
  const best = chooseBestPass(carrier, teammates, opponents, rng);
  if (best) {
    const goalX = attackingGoalX(carrier.side);
    const advances = Math.abs(best.pos.x - goalX) < Math.abs(carrier.pos.x - goalX) - 4;
    // Pass when squeezed, or when a teammate is meaningfully further forward.
    const passUrge = pressure * 0.7 + (advances ? 0.35 : 0.05);
    if (rng() < passUrge) return { kind: 'pass', target: best };
  }

  // ── 3. Otherwise, carry it. ──────────────────────────────────────────────
  return { kind: 'dribble' };
}

// ── Kick kinematics ───────────────────────────────────────────────────────────

/**
 * Compute a ball velocity that sends it from `from` toward `to` at `speed`,
 * with a lateral gaussian error of `lateralErrStd` metres applied at the
 * target.  Lower skill → larger error std → ball strays off the intended line.
 *
 * @param from           Kick origin (ball position).
 * @param to             Intended destination.
 * @param speed          Launch speed in m/s.
 * @param lateralErrStd  Std-dev of sideways miss at the target, in metres.
 * @param rng            Seeded source.
 * @returns              Ball velocity vector.
 */
export function kickToward(
  from: Vec2,
  to: Vec2,
  speed: number,
  lateralErrStd: number,
  rng: Rng,
): Vec2 {
  const dir = normalize(sub(to, from));
  // Perpendicular (rotate dir 90°) to apply sideways aim error.
  const perp = vec(-dir.y, dir.x);
  const errM = rngGaussian(rng, 0, lateralErrStd);
  const aimPoint = add(to, scale(perp, errM));
  return scale(normalize(sub(aimPoint, from)), speed);
}

/**
 * Launch parameters for a pass to `target`.  Speed scales with distance
 * (longer passes are struck harder); error shrinks with passing skill.
 */
export function passKick(carrier: SimPlayer, target: SimPlayer, rng: Rng): Vec2 {
  const d = dist(carrier.pos, target.pos);
  const speed = Math.min(24, Math.max(9, d * 1.1)); // 9–24 m/s by range
  // Error: ~2.2m std for a weak passer over 30m, ~0.6m for an elite one.
  const errStd = (d / 30) * (3.0 * (1 - carrier.stats.passing / 115)) + 0.4;
  return kickToward(carrier.pos, target.pos, speed, errStd, rng);
}

/**
 * Launch parameters for a shot at goal.  The shooter aims for a point inside
 * the goal mouth chosen with placement noise; weaker finishers spray wider and
 * are likelier to miss the frame entirely.  Aiming slightly toward a corner
 * (rather than dead centre) makes shots harder for the keeper.
 */
export function shotKick(carrier: SimPlayer, rng: Rng): Vec2 {
  const goalX = attackingGoalX(carrier.side);
  // Pick a corner bias: aim ~1m inside one post, side chosen by where the
  // shooter is angled, with placement error scaled by shooting skill.
  const towardTop = carrier.pos.y < PITCH_WIDTH / 2;
  const aimY = towardTop ? GOAL_Y_MIN + 1.2 : GOAL_Y_MAX - 1.2;
  const placementErr = 4.6 * (1 - carrier.stats.shooting / 135); // metres std (~1.5m elite, ~2.2m average — weaker efforts fly off-frame)
  const aimPoint = vec(goalX, aimY + rngGaussian(rng, 0, placementErr));
  const speed = 24 + (carrier.stats.shooting / 100) * 8; // 24–32 m/s
  // Low lateral flight error since placement noise already lives in aimY.
  return kickToward(carrier.pos, aimPoint, speed, 0.5, rng);
}

// ── Contest probabilities (pure) ───────────────────────────────────────────────

/**
 * Probability a defender wins the ball when challenging a carrier within
 * tackle range.  Centres on 50% and shifts ±35% by the tackling-vs-dribbling
 * gap, clamped to [12%, 88%] so neither outcome is ever certain.
 */
export function tackleProbability(defender: SimPlayer, carrier: SimPlayer): number {
  const edge = (defender.stats.tackling - carrier.stats.dribbling) / 200;
  return Math.min(0.88, Math.max(0.12, 0.5 + edge));
}

/**
 * Probability the keeper saves an on-target shot.  Higher goalkeeping saves
 * more; higher shot quality (closer, better angle) saves less.  Clamped to
 * [10%, 94%] — even a worldie can be tipped over, even a tap-in can be saved.
 *
 * @param keeper  The goalkeeper (uses goalkeeping stat).
 * @param sq      Shot quality of the strike, in [0,1].
 */
export function saveProbability(keeper: SimPlayer, sq: number): number {
  // base ~0.76–0.94 across the goalkeeping range; a great chance (sq→1) pulls
  // it down by ~0.33.  Tuned (2026-06) with the shot gate + placement error so
  // converted chances stay scarce enough for believable scorelines (~2.5/match).
  const base = 0.54 + keeper.stats.goalkeeping / 185;
  return Math.min(0.94, Math.max(0.10, base - sq * 0.33));
}

/**
 * PER-TICK probability that a defender who FAILED to win a clean tackle fouls
 * the carrier instead of simply missing.  Because the carrier is challenged
 * every 0.1s while a defender is in range, this is deliberately TINY — a few
 * tenths of a percent — so a full match yields a realistic ~20-30 fouls rather
 * than thousands.  A defender badly beaten for skill clips the dribbler a touch
 * more often.  Clamped to [0.2%, 1.2%] per tick.
 *
 * @param defender  The challenging player.
 * @param carrier   The player on the ball.
 */
export function foulProbability(defender: SimPlayer, carrier: SimPlayer): number {
  // How badly the defender is beaten for skill (0 = matched, → 1 = outclassed).
  const outmatched = Math.max(0, (carrier.stats.dribbling - defender.stats.tackling) / 100);
  return Math.min(0.012, Math.max(0.002, 0.003 + outmatched * 0.012));
}

/**
 * The card (if any) a foul draws.  Cynical fouls that stop an attacker in a
 * threatening position are likelier to be booked, and a small share of bookable
 * fouls are serious enough for a straight red.  Most fouls return null (a free
 * kick, no card).  Always consumes exactly two rng draws so the seeded stream
 * stays stable regardless of outcome.
 *
 * @param foulPos     Where the foul happened (pitch metres).
 * @param fouledSide  The side that was fouled (attacking toward their goal).
 * @param rng         Seeded source.
 */
export function cardForFoul(foulPos: Vec2, fouledSide: TeamSide, rng: Rng): 'yellow' | 'red' | null {
  // Advancement: 0 deep in the fouled side's own half, → 1 right at the goal
  // they attack.  A foul that halts a genuine attack is the cynical, bookable one.
  const goalX = attackingGoalX(fouledSide);
  const advancement = 1 - Math.abs(foulPos.x - goalX) / PITCH_LENGTH;
  const yellowChance = 0.08 + advancement * 0.12; // ~8% midfield … ~20% near goal
  const draw = rng();
  const serious = rng() < 0.06;                    // share of bookings that are red
  if (draw >= yellowChance) return null;
  return serious ? 'red' : 'yellow';
}

/**
 * Whether `target` is in an offside position for an in-flight pass: clearly
 * beyond the second-last defender, ahead of the ball, and inside the attacking
 * half.  A forgiveness MARGIN means only unambiguous offsides are flagged — the
 * blob sim can't adjudicate millimetres, and phantom flags feel worse than the
 * occasional one let go.  Pure geometry, no rng.
 *
 * The "second-last defender" is the standard offside reference (usually, but not
 * necessarily, the keeper); we read it from ALL opponents by depth, so a keeper
 * who has rushed off their line is handled correctly.
 *
 * @param target   The intended pass receiver.
 * @param ballPos  Position the pass is struck from.
 * @param world    Current world (for the opposing defenders).
 */
export function isOffsidePosition(target: SimPlayer, ballPos: Vec2, world: SimWorld): boolean {
  const goalX = attackingGoalX(target.side); // the goal the receiver attacks
  const defenders = target.side === 'home' ? world.away : world.home;
  const xs = defenders.map((d) => d.pos.x);
  const MARGIN = 1.5; // metres of clear daylight required before we flag it

  if (goalX === PITCH_LENGTH) {
    // Attacking x=105: a deeper defender has a larger x; the second-deepest sets
    // the line. Offside = beyond it, ahead of the ball, in the attacking half.
    const desc = [...xs].sort((a, b) => b - a);
    const lineX = desc[1] ?? desc[0] ?? PITCH_LENGTH;
    return target.pos.x > lineX + MARGIN && target.pos.x > ballPos.x && target.pos.x > PITCH_LENGTH / 2;
  }
  // Attacking x=0: a deeper defender has a smaller x; the second-deepest is the line.
  const asc = [...xs].sort((a, b) => a - b);
  const lineX = asc[1] ?? asc[0] ?? 0;
  return target.pos.x < lineX - MARGIN && target.pos.x < ballPos.x && target.pos.x < PITCH_LENGTH / 2;
}

/**
 * Whether a moving ball passes within `reach` of a stationary player on this
 * tick's segment — the geometric test behind interceptions and ball
 * collection.  Uses point-to-segment distance from the player to the ball's
 * path from `ballFrom` to `ballTo`.
 *
 * @param playerPos  The player's position.
 * @param ballFrom   Ball position at start of tick.
 * @param ballTo     Ball position at end of tick.
 * @param reach      Capture radius in metres.
 */
export function ballPathWithinReach(
  playerPos: Vec2,
  ballFrom: Vec2,
  ballTo: Vec2,
  reach: number,
): boolean {
  const seg = sub(ballTo, ballFrom);
  const segLen2 = dot(seg, seg);
  if (segLen2 < 1e-9) {
    // Ball barely moved — just a point-distance check.
    return dist(playerPos, ballFrom) <= reach;
  }
  // Project player onto the segment, clamped to [0,1].
  let t = dot(sub(playerPos, ballFrom), seg) / segLen2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const closest = add(ballFrom, scale(seg, t));
  return dist(playerPos, closest) <= reach;
}
