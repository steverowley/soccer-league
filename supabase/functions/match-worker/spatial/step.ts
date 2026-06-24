// ── features/match/logic/spatial/step.ts ─────────────────────────────────────
// One physics tick of the spatial match: assign each player a role for this
// instant, steer them, integrate motion, move the ball, and DERIVE events from
// the geometry (a goal because the ball crossed the line — never a roll).
//
// step() mutates the world in place and returns the events that emerged this
// tick.  It's deterministic given the same world + rng, which is the whole
// point: same seed ⇒ same match.
//
// PER-TICK SHAPE
//   1. Role assignment   — who chases, who presses, who holds shape.
//   2. Desired velocities — steering blend per player.
//   3. Integrate players  — accelerate toward desire, move, drain stamina.
//   4. Ball update        — glued to carrier + decisions, OR loose physics.
//   5. Event resolution   — goals / saves / out-of-play / tackles / collection.

import {
  type Vec2, vec, add, sub, scale, len, dist, dist2, truncate, normalize, ZERO,
} from './vec2.ts';
import { type Rng } from './rng.ts';
import {
  type SimPlayer, type SimWorld, type SimEvent, type TeamSide,
  PITCH_LENGTH, PITCH_WIDTH, GOAL_Y_MIN, GOAL_Y_MAX, CENTRE_SPOT,
  attackingGoalX, defendingGoalX,
} from './types.ts';
import {
  effectiveMaxSpeed, seek, arrive, pursueBall, separation,
} from './steering.ts';
import {
  chooseAction, passKick, shotKick, shotQuality,
  tackleProbability, foulProbability, cardForFoul, saveProbability, ballPathWithinReach, isOffsidePosition,
  isInPenaltyArea, penaltyGoalProbability,
} from './possession.ts';
import { dynamicAnchor } from './formation.ts';

// ── Tunable physics constants ─────────────────────────────────────────────────

/** Max player acceleration in m/s².  Caps how fast velocity can change — gives
 *  mass/inertia so dots ease into motion rather than teleporting. */
const MAX_ACCEL = 9;

/** Loose-ball rolling deceleration in m/s².  Brings a struck ball to rest over
 *  a realistic distance (a 24 m/s pass dies after ~25m). */
const BALL_DECEL = 11;

/** Radius (m) within which a player collects a loose ball on its path. */
const CONTROL_RADIUS = 1.4;

/** Radius (m) within which a defender may attempt a tackle on the carrier. */
const TACKLE_RADIUS = 1.7;

/** Seconds a carrier holds the ball between decisions (shoot/pass/dribble). */
const DECISION_INTERVAL_SEC = 0.45;

/** How far ahead of the carrier the ball sits while dribbling (m). */
const DRIBBLE_LEAD = 1.3;

/** How far toward goal a dribbler aims each carry (m). */
const DRIBBLE_REACH = 9;

/** Distance (m) from own goal within which the keeper rushes a loose ball. */
const KEEPER_RUSH_DIST = 15;

/** Seconds of dead-ball pause after a goal (celebration / reset breather). */
const GOAL_PAUSE_SEC = 1.5;

/** Slow-down radius (m) used by arrive() for holding formation anchors. */
const ANCHOR_SLOW_RADIUS = 6;

/** Teammate personal-space radius (m) for separation. */
const SEPARATION_RADIUS = 4.5;

/** Cooldown ticks applied to a freshly-loose ball so the kicker can't instantly
 *  re-collect their own pass/shot. */
const LOOSE_POP_COOLDOWN_TICKS = 3;

/** Share of fouls committed inside the box that are given as a penalty.  Most
 *  box contact is waved away or advantage is played; only clear fouls are given,
 *  the rest become a quick free kick (as before).  Tuned so penalties land at a
 *  realistic ~0.25-0.3/match given how much play this engine funnels into the
 *  box.  Drawn only on box fouls, so open-play scoring is left undisturbed. */
const PENALTY_AWARD_RATE = 0.13;

/** Multiplier on the foul chance of a player who is ALREADY on a yellow card.
 *  A booked player jockeys rather than dives in (a second yellow means a red), so
 *  they foul far less — which keeps second-yellow dismissals realistic. */
const BOOKED_FOUL_FACTOR = 0.45;

/** Earliest match-clock second a tactical substitution is considered (≈ 55'). */
const SUB_MIN_SEC = 55 * 60;

/** Spacing (s) between a side's changes so all three don't fire at once (≈ 9'),
 *  giving a realistic ~55' / 64' / 73' cadence. */
const SUB_SPACING_SEC = 9 * 60;

/** A tiring starter is replaced once their stamina drops below this. Tuned so a
 *  side makes ~2-3 changes over a full match. */
const SUB_STAMINA_THRESHOLD = 0.55;

/** How strongly a play-style's press+tackle deltas scale tackle commitment.
 *  With the summed deltas in ±0.30, K=2 spans ≈ ×0.80 (Counter) … ×1.60 (High
 *  Pressing) — visible differences in tackles won and where the ball is won. */
const STYLE_PRESS_K = 2;

// ── Small helpers ─────────────────────────────────────────────────────────────

/** Outfield players (everyone but the keeper) of a side, sent-off players excluded. */
function outfield(players: readonly SimPlayer[]): SimPlayer[] {
  return players.filter((p) => p.role !== 'GK' && !p.sentOff);
}

/** The keeper of a side, or undefined if (defensively) none is flagged GK. */
function keeperOf(players: readonly SimPlayer[]): SimPlayer | undefined {
  return players.find((p) => p.role === 'GK');
}

/** Nearest player in `list` to a point, with its distance.  null for empty list. */
function nearestTo(list: readonly SimPlayer[], p: Vec2): { player: SimPlayer; d: number } | null {
  let best: SimPlayer | null = null;
  let bestD2 = Infinity;
  for (const pl of list) {
    const d2 = dist2(pl.pos, p);
    if (d2 < bestD2) { bestD2 = d2; best = pl; }
  }
  return best ? { player: best, d: Math.sqrt(bestD2) } : null;
}

/** Where the keeper should sit: just off its own line, tracking the ball's y. */
function keeperHold(keeper: SimPlayer, ballPos: Vec2): Vec2 {
  const goalX = defendingGoalX(keeper.side);
  const offset = goalX === 0 ? 3 : -3; // stand 3m in front of the line
  const y = Math.max(GOAL_Y_MIN - 2, Math.min(GOAL_Y_MAX + 2, ballPos.y));
  return vec(goalX + offset, y);
}

// ── Player integration ──────────────────────────────────────────────────────

/**
 * Move one player toward a desired velocity, respecting acceleration + top
 * speed, then integrate position and drain/recover stamina.  Mutates `p`.
 *
 * @param p        The player.
 * @param desired  Desired velocity from the steering blend (m/s).
 * @param dt       Timestep (s).
 */
function integratePlayer(p: SimPlayer, desired: Vec2, dt: number): void {
  // Accelerate toward the desired velocity, capped by MAX_ACCEL·dt.
  const deltaV = truncate(sub(desired, p.vel), MAX_ACCEL * dt);
  p.vel = truncate(add(p.vel, deltaV), effectiveMaxSpeed(p));
  p.pos = add(p.pos, scale(p.vel, dt));

  // Keep on the pitch (touchline/goal-line are hard walls for bodies).
  p.pos = vec(
    Math.max(0, Math.min(PITCH_LENGTH, p.pos.x)),
    Math.max(0, Math.min(PITCH_WIDTH, p.pos.y)),
  );

  // Stamina: drains with the square of speed fraction (sprinting costs most),
  // recovers gently when nearly stationary.  Clamped to [0.2, 1].
  const speedFrac = len(p.vel) / Math.max(1, p.maxSpeed);
  if (speedFrac > 0.3) {
    p.stamina -= speedFrac * speedFrac * 0.0016 * dt * 60; // ~tuned for 90 min
  } else {
    p.stamina += 0.0006 * dt * 60;
  }
  p.stamina = Math.max(0.2, Math.min(1, p.stamina));
}

// ── Restarts ──────────────────────────────────────────────────────────────────

/** Reset both teams to their formation home positions (used after a goal).
 *  Sent-off players are left parked off the pitch — they don't re-join. */
function resetToFormation(world: SimWorld): void {
  for (const p of [...world.home, ...world.away]) {
    if (p.sentOff) continue;
    p.pos = p.homePos;
    p.vel = ZERO;
  }
}

/**
 * Give the ball to a side at a restart spot.  Picks the nearest player of that
 * side to the spot as the receiver and glues the ball to them.
 */
function awardBall(world: SimWorld, side: TeamSide, spot: Vec2): void {
  const list = side === 'home' ? world.home : world.away;
  const receiver = nearestTo(list, spot)?.player ?? list[0];
  world.ball.pos = spot;
  world.ball.vel = ZERO;
  world.ball.ownerId = receiver ? receiver.id : null;
  world.ball.heldSec = 0;
  world.ball.loosePopCooldown = 0;
  world.ball.lastTouch = null;
  world.ball.offsideFor = null;
}

/** Full kickoff reset after a goal: shape reset + ball to centre for conceder. */
function kickoffReset(world: SimWorld, concedingSide: TeamSide): void {
  resetToFormation(world);
  awardBall(world, concedingSide, CENTRE_SPOT);
}

/**
 * Send a player off (a red card, or a second yellow).  They're parked on the
 * nearest touchline and flagged `sentOff`, which excludes them from role
 * assignment, integration, challenges and ball collection — so their team
 * finishes the match a man down.  They stay in the roster (and in replay frames)
 * so the viewer simply renders them off the field of play.  Mutates `player`.
 */
function sendOff(player: SimPlayer): void {
  player.sentOff = true;
  player.vel = ZERO;
  player.pos = vec(player.pos.x, player.pos.y < PITCH_WIDTH / 2 ? 0 : PITCH_WIDTH);
}

/**
 * Consider a tactical substitution for one side.  After the hour mark (and with
 * the three changes spaced out), the most tired outfield starter — never the
 * keeper, the ball-carrier or an already sent-off player — is replaced by a
 * fresh bench player who inherits their formation slot and comes on with full
 * stamina.  The outgoing player simply leaves the pitch (and the replay frames);
 * the team stays eleven strong.  Deterministic (no rng), so it's twin-identical.
 * Mutates the world and emits a `substitution` event when a change is made.
 *
 * @param world   The match world.
 * @param side    Which side to consider subbing.
 * @param minute  Current match minute (for the emitted event).
 * @param events  The tick's event sink.
 */
function maybeSubstitute(world: SimWorld, side: TeamSide, minute: number, events: SimEvent[]): void {
  const subsLeft = side === 'home' ? world.homeSubsLeft : world.awaySubsLeft;
  const bench = side === 'home' ? world.homeBench : world.awayBench;
  if (subsLeft <= 0 || bench.length === 0) return;
  // Space the changes: the Nth change waits until ≈ 55' + N·spacing (the 3 is
  // the standard change allowance the world is seeded with).
  const made = 3 - subsLeft;
  if (world.clockSec < SUB_MIN_SEC + made * SUB_SPACING_SEC) return;

  const team = side === 'home' ? world.home : world.away;
  let off: SimPlayer | null = null;
  for (const p of team) {
    if (p.role === 'GK' || p.sentOff || p.id === world.ball.ownerId) continue;
    if (!off || p.stamina < off.stamina) off = p;
  }
  if (!off || off.stamina > SUB_STAMINA_THRESHOLD) return;

  // Prefer a like-for-like bench player; fall back to whoever's available.
  let bi = bench.findIndex((b) => b.role === off!.role);
  if (bi < 0) bi = 0;
  const fresh = bench.splice(bi, 1)[0]!;
  // The sub inherits the outgoing player's slot (role + home anchor) and comes
  // on where they left, with a full tank.
  const on: SimPlayer = {
    ...fresh, role: off.role, homePos: off.homePos, pos: off.pos,
    vel: ZERO, stamina: 1, yellowCards: 0, sentOff: false,
  };
  team[team.indexOf(off)] = on;
  if (side === 'home') world.homeSubsLeft -= 1; else world.awaySubsLeft -= 1;
  events.push({ tSec: world.clockSec, minute, type: 'substitution', side, playerId: on.id, otherId: off.id });
}

/**
 * Resolve a penalty kick awarded for a foul in the box: the fouled side's taker
 * against the defending keeper.  Emits a `penalty` award beat, then resolves on a
 * single rng draw weighted by taker-vs-keeper quality:
 *   - GOAL → credit the side, then the normal post-goal reset + dead-ball pause
 *     (identical to an open-play goal, so the restart looks the same).
 *   - SAVE → the keeper gathers and play restarts with the defending side.
 * Mutates the world in place.
 *
 * @param world  The match world.
 * @param taker  The fouled attacker, who takes the kick.
 * @param minute The current match minute (for the emitted events).
 * @param rng    Seeded source (exactly one draw — keeps the twin streams aligned).
 * @param events The tick's event sink.
 */
function resolvePenalty(world: SimWorld, taker: SimPlayer, minute: number, rng: Rng, events: SimEvent[]): void {
  const attackingSide = taker.side;
  const defendingSide: TeamSide = attackingSide === 'home' ? 'away' : 'home';
  const keeper = keeperOf(defendingSide === 'home' ? world.home : world.away);
  events.push({ tSec: world.clockSec, minute, type: 'penalty', side: attackingSide, playerId: taker.id });

  if (rng() < penaltyGoalProbability(taker, keeper)) {
    if (attackingSide === 'home') world.score[0] += 1; else world.score[1] += 1;
    events.push({ tSec: world.clockSec, minute, type: 'goal', side: attackingSide, playerId: taker.id });
    kickoffReset(world, defendingSide);
    world.deadBallTicks = Math.round(GOAL_PAUSE_SEC / world.dtSec);
    world.phase = 'dead_ball';
  } else if (keeper) {
    // Saved: keeper gathers, play restarts with the defending side.
    events.push({ tSec: world.clockSec, minute, type: 'save', side: defendingSide, playerId: keeper.id, otherId: taker.id });
    awardBall(world, defendingSide, keeper.pos);
  } else {
    awardBall(world, defendingSide, CENTRE_SPOT);
  }
}

// ── The tick ───────────────────────────────────────────────────────────────

/**
 * Advance the world by one timestep and return any events that emerged.
 *
 * @param world  The mutable match world.
 * @param rng    Seeded random source (decisions, contests).
 * @param dt     Timestep in seconds.
 * @returns      Events emitted this tick (often empty).
 */
export function step(world: SimWorld, rng: Rng, dt: number): SimEvent[] {
  const events: SimEvent[] = [];
  world.clockSec += dt;
  // No upper clamp: stoppage time runs past 90:00, so added-time events read as
  // minute 91+ (the DB allows 0–120).  The tick loop bounds how far this goes.
  const minute = Math.max(1, Math.ceil(world.clockSec / 60));

  // ── Dead-ball pause (post-goal breather) ──────────────────────────────────
  // Players drift home; nobody acts on the ball until the pause elapses.
  if (world.phase === 'dead_ball') {
    world.deadBallTicks -= 1;
    for (const p of [...world.home, ...world.away]) {
      if (p.sentOff) continue; // sent off — stays parked, doesn't reset to shape
      integratePlayer(p, arrive(p, p.homePos, ANCHOR_SLOW_RADIUS), dt);
    }
    if (world.deadBallTicks <= 0) world.phase = 'open_play';
    return events;
  }

  // ── Substitutions ─────────────────────────────────────────────────────────
  // Once players tire in the second half, each side may bring on fresh legs.
  maybeSubstitute(world, 'home', minute, events);
  maybeSubstitute(world, 'away', minute, events);

  const ball = world.ball;
  if (ball.loosePopCooldown > 0) ball.loosePopCooldown -= 1;

  const owner = ball.ownerId
    ? [...world.home, ...world.away].find((p) => p.id === ball.ownerId) ?? null
    : null;
  const possessingSide: TeamSide | null = owner ? owner.side : null;

  // ── 1+2. Role assignment & desired velocities ─────────────────────────────
  // Build a desired velocity for every player based on their role this tick.
  const desired = new Map<string, Vec2>();

  // Identify the press/chase players up front.
  const homeOut = outfield(world.home);
  const awayOut = outfield(world.away);
  const nearestHome = nearestTo(homeOut, ball.pos);
  const nearestAway = nearestTo(awayOut, ball.pos);

  for (const side of ['home', 'away'] as const) {
    const team = side === 'home' ? world.home : world.away;
    const mates = team;
    const nearest = side === 'home' ? nearestHome : nearestAway;

    for (const p of team) {
      // A sent-off player takes no part: no role, no desired velocity — they sit
      // parked on the touchline (skipped in integration below).
      if (p.sentOff) continue;
      // Keeper logic: rush a nearby loose ball, else hold the line.
      if (p.role === 'GK') {
        const ballNear = dist(ball.pos, vec(defendingGoalX(side), PITCH_WIDTH / 2)) < KEEPER_RUSH_DIST;
        if (!owner && ballNear) {
          desired.set(p.id, pursueBall(p, ball.pos, ball.vel));
        } else {
          desired.set(p.id, arrive(p, keeperHold(p, ball.pos), 3));
        }
        continue;
      }

      if (owner && p.id === owner.id) {
        // The carrier is handled in the ball section (dribble target); hold
        // position here as a placeholder so it has a desired velocity entry.
        desired.set(p.id, ball.vel);
        continue;
      }

      const isPossessing = possessingSide === side;
      const sep = separation(p, mates, SEPARATION_RADIUS);

      if (!owner) {
        // Loose ball: this side's nearest outfielder chases; others hold shape.
        if (nearest && p.id === nearest.player.id) {
          desired.set(p.id, pursueBall(p, ball.pos, ball.vel));
        } else {
          desired.set(p.id, add(arrive(p, dynamicAnchor(p, ball.pos), ANCHOR_SLOW_RADIUS), sep));
        }
      } else if (isPossessing) {
        // Supporting the carrier: hold the (ball-shifted) formation anchor.
        desired.set(p.id, add(arrive(p, dynamicAnchor(p, ball.pos), ANCHOR_SLOW_RADIUS), sep));
      } else {
        // Defending: the nearest outfielder presses the ball; rest hold shape.
        if (nearest && p.id === nearest.player.id) {
          desired.set(p.id, seek(p, ball.pos));
        } else {
          desired.set(p.id, add(arrive(p, dynamicAnchor(p, ball.pos), ANCHOR_SLOW_RADIUS), sep));
        }
      }
    }
  }

  // ── 3. Integrate all players ──────────────────────────────────────────────
  for (const p of [...world.home, ...world.away]) {
    if (p.sentOff) continue; // parked off the pitch — frozen in place
    integratePlayer(p, desired.get(p.id) ?? ZERO, dt);
  }

  // ── 4. Ball update ────────────────────────────────────────────────────────
  if (owner) {
    // ── Owned: glue ball just ahead of the carrier, then maybe act ──────────
    const heading = len(owner.vel) > 0.5 ? normalize(owner.vel) : normalize(sub(vec(attackingGoalX(owner.side), PITCH_WIDTH / 2), owner.pos));
    // Clamp the glued position to the pitch: a real dribbler keeps the ball in
    // play, so the ball never sits off the touchline just because the carrier
    // is hugging it (which would otherwise show as out-of-bounds in a frame).
    const glued = add(owner.pos, scale(heading, DRIBBLE_LEAD));
    ball.pos = vec(
      Math.max(0, Math.min(PITCH_LENGTH, glued.x)),
      Math.max(0, Math.min(PITCH_WIDTH, glued.y)),
    );
    ball.vel = owner.vel;
    ball.heldSec += dt;

    // A defender in range challenges: win the ball cleanly, foul (free kick),
    // or miss and let the carrier play on.  RNG draws are ordered tackle →
    // foul → card so the seeded stream stays deterministic across both twins.
    const defenders = owner.side === 'home' ? awayOut : homeOut;
    const challenger = nearestTo(defenders, owner.pos);
    let challengeResolved = false;
    if (challenger && challenger.d < TACKLE_RADIUS) {
      // STYLE: the defending manager's press/tackle deltas scale how committed
      // the challenge is — High Pressing & Aggressive win the ball more often
      // (and higher up), Counterattacking sits off.  Balanced = 1×.
      const dStyle = challenger.player.side === 'home' ? world.homeStyle : world.awayStyle;
      const pressFactor = 1 + (dStyle.press + dStyle.tackle) * STYLE_PRESS_K;
      if (rng() < tackleProbability(challenger.player, owner) * pressFactor) {
        // Tackle won: ball pops loose toward the tackler.
        ball.ownerId = null;
        ball.vel = scale(normalize(sub(challenger.player.pos, owner.pos)), 6);
        ball.loosePopCooldown = LOOSE_POP_COOLDOWN_TICKS;
        ball.heldSec = 0;
        ball.lastTouch = { side: challenger.player.side, isShot: false, sq: 0 };
        ball.offsideFor = null;
        events.push({ tSec: world.clockSec, minute, type: 'tackle', side: challenger.player.side, playerId: challenger.player.id, otherId: owner.id });
        challengeResolved = true;
      } else if (rng() < foulProbability(challenger.player, owner) * (challenger.player.yellowCards > 0 ? BOOKED_FOUL_FACTOR : 1)) {
        // Foul.  A cynical foul near goal may draw a yellow or (rarely) red; a
        // SECOND yellow to the same player becomes a red, and any red sends them
        // off (no extra rng draw — the count is deterministic on the cards shown).
        let card = cardForFoul(owner.pos, owner.side, rng);
        if (card === 'yellow') {
          challenger.player.yellowCards += 1;
          if (challenger.player.yellowCards >= 2) card = 'red'; // second booking → off
        }
        if (card === 'red') sendOff(challenger.player);
        events.push({
          tSec: world.clockSec, minute, type: 'foul',
          side: challenger.player.side, playerId: challenger.player.id, otherId: owner.id,
          ...(card ? { card } : {}),
        });
        // A clear foul inside the box is a penalty (the rng draw fires only there,
        // so open-play stays undisturbed); otherwise a quick free kick at the spot.
        if (isInPenaltyArea(owner.pos, owner.side) && rng() < PENALTY_AWARD_RATE) {
          resolvePenalty(world, owner, minute, rng, events);
        } else {
          awardBall(world, owner.side, owner.pos);
        }
        challengeResolved = true;
      }
      // else: challenge missed — fall through to the carrier's decision.
    }

    if (!challengeResolved && ball.heldSec >= DECISION_INTERVAL_SEC) {
      // Time to decide.
      ball.heldSec = 0;
      const action = chooseAction(owner, world, rng);
      if (action.kind === 'shoot') {
        const sq = shotQuality(owner.pos, owner.side);
        ball.ownerId = null;
        ball.vel = shotKick(owner, rng);
        ball.loosePopCooldown = LOOSE_POP_COOLDOWN_TICKS;
        ball.lastTouch = { side: owner.side, isShot: true, sq, playerId: owner.id };
        ball.offsideFor = null;
        // The 'shot' vs 'goal'/'save' event is emitted on resolution below.
      } else if (action.kind === 'pass') {
        ball.ownerId = null;
        ball.vel = passKick(owner, action.target, rng);
        ball.loosePopCooldown = LOOSE_POP_COOLDOWN_TICKS;
        ball.lastTouch = { side: owner.side, isShot: false, sq: 0 };
        // Flag the pass if it's played to a player standing in an offside
        // position; offside is only CALLED if that same player collects it
        // (resolveLooseBall).  An onside teammate or a defender collecting it
        // clears the flag with no whistle.
        ball.offsideFor = isOffsidePosition(action.target, owner.pos, world) ? action.target.id : null;
        events.push({ tSec: world.clockSec, minute, type: 'pass', side: owner.side, playerId: owner.id, otherId: action.target.id });
      } else {
        // Dribble: aim a carry toward goal; ball stays glued next tick.
        // (No state change needed — the carrier's steering already drives
        //  toward goal via the dribble target computed below.)
      }
    }

    // If still dribbling (owner unchanged), nudge the carrier's desired
    // velocity toward goal for next tick by overwriting their integration is
    // already done; instead we set their velocity target implicitly through
    // the glued ball.  To actually advance, give the owner a goal-ward shove.
    if (ball.ownerId === owner.id) {
      // Carry FORWARD toward the goal line, drifting only gently toward the
      // centre so wide players keep the width instead of every carrier
      // funnelling through the middle.  The lateral pull sharpens as the carrier
      // nears the goal — wingers stay wide in build-up and cut inside in the
      // final third to shoot.
      const goalX = attackingGoalX(owner.side);
      const goalProximity = 1 - Math.min(1, Math.abs(owner.pos.x - goalX) / 35); // 0 far … 1 at the line
      const centreBias = 0.22 + 0.5 * goalProximity;                             // 0.22 wide → 0.72 in the box
      const aimY = owner.pos.y * (1 - centreBias) + (PITCH_WIDTH / 2) * centreBias;
      const goalPt = vec(goalX, aimY);
      const carryTarget = add(owner.pos, scale(normalize(sub(goalPt, owner.pos)), DRIBBLE_REACH));
      const drive = seek(owner, carryTarget);
      // Re-integrate the owner with the dribble drive (overrides the placeholder).
      const deltaV = truncate(sub(drive, owner.vel), MAX_ACCEL * dt);
      owner.vel = truncate(add(owner.vel, deltaV), effectiveMaxSpeed(owner));
      // Position already moved this tick with the old vel; the corrected vel
      // takes effect next tick — acceptable at 10Hz and keeps integration single-pass.
    }
  } else {
    // ── Loose / in flight: friction + collision/goal/out resolution ─────────
    const from = ball.pos;
    // Apply rolling friction to the ball's speed.
    const spd = len(ball.vel);
    if (spd > 0) {
      const newSpd = Math.max(0, spd - BALL_DECEL * dt);
      ball.vel = newSpd === 0 ? ZERO : scale(normalize(ball.vel), newSpd);
    }
    const to = add(from, scale(ball.vel, dt));
    ball.pos = to;

    const resolved = resolveLooseBall(world, from, to, rng, minute, events);
    if (!resolved) {
      // Nobody intercepted, no goal/out — leave the ball where it rolled.
      ball.pos = to;
    }
  }

  return events;
}

/**
 * Resolve what happens to a loose ball that travelled `from`→`to` this tick:
 * a goal-line crossing (goal / save / goal-kick / corner), a touchline exit
 * (throw-in), or collection/interception by the nearest reaching player.
 *
 * Mutates the world (score, ball ownership, phase) and pushes any events.
 *
 * @returns true if the ball's state was changed (collected / restarted), so
 *          the caller knows resolution happened this tick.
 */
function resolveLooseBall(
  world: SimWorld,
  from: Vec2,
  to: Vec2,
  rng: Rng,
  minute: number,
  events: SimEvent[],
): boolean {
  const ball = world.ball;

  // ── Goal-line exits (x ≤ 0 is home's goal, x ≥ 105 is away's) ──────────────
  // Detect by ABSOLUTE endpoint position rather than a sign-change crossing:
  // a ball released exactly on the line (e.g. a carrier dispossessed on the
  // byline) would otherwise slip past the crossing test and drift off-pitch
  // forever.  Absolute detection catches both the clean crossing and the
  // already-beyond case.
  if (to.x <= 0 || to.x >= PITCH_LENGTH) {
    const lineX = to.x <= 0 ? 0 : PITCH_LENGTH;
    // y where the path meets the line (interpolated); if the start is already
    // beyond the line, fall back to the endpoint's y.
    const denom = (to.x - from.x);
    const t = Math.abs(denom) < 1e-9 ? 1 : (lineX - from.x) / denom;
    const tt = t < 0 ? 0 : t > 1 ? 1 : t;
    const yAt = from.y + tt * (to.y - from.y);
    // defendingSide is whoever's goal this line is.
    const defendingSide: TeamSide = lineX === 0 ? 'home' : 'away';
    const attackingSide: TeamSide = lineX === 0 ? 'away' : 'home';

    if (yAt >= GOAL_Y_MIN && yAt <= GOAL_Y_MAX) {
      // On target for the goal mouth — keeper gets a save attempt.
      const team = defendingSide === 'home' ? world.home : world.away;
      const keeper = keeperOf(team);
      const sq = ball.lastTouch?.isShot ? ball.lastTouch.sq : 0.2; // stray rollers easy to save
      const saved = keeper ? rng() < saveProbability(keeper, sq) : false;
      if (saved && keeper) {
        events.push({ tSec: world.clockSec, minute, type: 'save', side: defendingSide, playerId: keeper.id });
        // Keeper claims it.
        ball.pos = keeper.pos;
        ball.vel = ZERO;
        ball.ownerId = keeper.id;
        ball.heldSec = 0;
        ball.loosePopCooldown = 0;
        ball.lastTouch = null;
        ball.offsideFor = null;
        return true;
      }
      // GOAL.  Credit the scorer's side, reset for kickoff, and start the
      // post-goal dead-ball pause (GOAL_PAUSE_SEC converted to ticks via the
      // world's fixed timestep).
      const lastTouch = ball.lastTouch;
      const scorerSide = lastTouch?.side ?? attackingSide;
      if (scorerSide === 'home') world.score[0] += 1; else world.score[1] += 1;
      // Attribute the goal to the shooter only when it came from their shot, so a
      // deflection or stray roll into the net (an own-goal in spirit) credits nobody
      // rather than a phantom striker.  The adapter increments the scorer's goal
      // tally + payload team off this playerId.
      events.push({
        tSec: world.clockSec,
        minute,
        type: 'goal',
        side: scorerSide,
        ...(lastTouch?.isShot && lastTouch.playerId ? { playerId: lastTouch.playerId } : {}),
      });
      kickoffReset(world, scorerSide === 'home' ? 'away' : 'home');
      world.deadBallTicks = Math.round(GOAL_PAUSE_SEC / world.dtSec);
      world.phase = 'dead_ball';
      return true;
    }

    // Crossed the goal line OUTSIDE the mouth → corner or goal kick.
    if (ball.lastTouch?.side === attackingSide || ball.lastTouch == null) {
      // Attacker put it out → goal kick to the defending side.
      events.push({ tSec: world.clockSec, minute, type: 'out_goalkick', side: defendingSide });
      const spot = vec(defendingSide === 'home' ? 5 : PITCH_LENGTH - 5, PITCH_WIDTH / 2);
      awardBall(world, defendingSide, spot);
    } else {
      // Defender put it out → corner to the attacking side.
      events.push({ tSec: world.clockSec, minute, type: 'out_corner', side: attackingSide });
      const cornerY = yAt < PITCH_WIDTH / 2 ? 0.5 : PITCH_WIDTH - 0.5;
      const spot = vec(lineX === 0 ? 0.5 : PITCH_LENGTH - 0.5, cornerY);
      awardBall(world, attackingSide, spot);
    }
    return true;
  }

  // ── Touchline exits (y = 0 or y = 68) → throw-in to the other team ────────
  if (to.y <= 0 || to.y >= PITCH_WIDTH) {
    const throwTo: TeamSide = ball.lastTouch?.side === 'home' ? 'away' : 'home';
    const spot = vec(
      Math.max(1, Math.min(PITCH_LENGTH - 1, to.x)),
      to.y <= 0 ? 0.5 : PITCH_WIDTH - 0.5,
    );
    events.push({ tSec: world.clockSec, minute, type: 'out_throw', side: throwTo });
    awardBall(world, throwTo, spot);
    return true;
  }

  // ── Collection / interception by the nearest reaching player ──────────────
  if (ball.loosePopCooldown <= 0) {
    let claimer: SimPlayer | null = null;
    let claimerD2 = Infinity;
    for (const p of [...world.home, ...world.away]) {
      if (p.sentOff) continue; // off the pitch — can't reach the ball
      if (ballPathWithinReach(p.pos, from, to, CONTROL_RADIUS)) {
        const d2 = dist2(p.pos, to);
        if (d2 < claimerD2) { claimerD2 = d2; claimer = p; }
      }
    }
    if (claimer) {
      // Offside: the flagged attacker collecting their own team's pass is caught
      // offside → indirect free kick to the defending side at the spot.
      if (ball.offsideFor === claimer.id) {
        const defendingSide: TeamSide = claimer.side === 'home' ? 'away' : 'home';
        events.push({ tSec: world.clockSec, minute, type: 'offside', side: claimer.side, playerId: claimer.id });
        awardBall(world, defendingSide, claimer.pos); // awardBall clears offsideFor
        return true;
      }
      const wasAttackingSide = ball.lastTouch?.side ?? null;
      ball.ownerId = claimer.id;
      ball.pos = claimer.pos;
      ball.vel = ZERO;
      ball.heldSec = 0;
      ball.lastTouch = null;
      ball.offsideFor = null;
      // If the claimer is the OPPONENT of whoever last kicked it, that's an
      // interception (a defensive read), worth surfacing as an event.
      if (wasAttackingSide && claimer.side !== wasAttackingSide) {
        events.push({ tSec: world.clockSec, minute, type: 'interception', side: claimer.side, playerId: claimer.id });
      }
      return true;
    }
  }

  return false;
}
