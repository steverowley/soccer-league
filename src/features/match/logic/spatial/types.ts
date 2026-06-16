// ── features/match/logic/spatial/types.ts ────────────────────────────────────
// Domain types + pitch geometry for the authoritative spatial match engine.
//
// This is the contract every other module in spatial/ builds on.  The engine
// is a real agent simulation: 22 players and a ball move continuously through
// pitch-metre space, and match events (goals, shots, fouls, out-of-play) are
// DERIVED from that motion rather than rolled for.
//
// FRAME OF REFERENCE
//   x ∈ [0, 105]  pitch length.  Home defends x=0, attacks toward x=105.
//   y ∈ [0,  68]  pitch width.   0 = top touchline, 68 = bottom touchline.
//   All distances metres, all speeds metres/second, all times seconds.

import type { Vec2 } from './vec2';

// ── Pitch geometry ────────────────────────────────────────────────────────────

/** Standard FIFA pitch length in metres.  x spans [0, PITCH_LENGTH]. */
export const PITCH_LENGTH = 105;

/** Standard FIFA pitch width in metres.  y spans [0, PITCH_WIDTH]. */
export const PITCH_WIDTH = 68;

/** Goal mouth width in metres (real-world 7.32m).  Centred on the y-axis. */
export const GOAL_WIDTH = 7.32;

/** Lowest y of the goal mouth — a ball must cross the line between this… */
export const GOAL_Y_MIN = (PITCH_WIDTH - GOAL_WIDTH) / 2; // ≈ 30.34

/** …and this y to count as a goal rather than going out for a goal kick. */
export const GOAL_Y_MAX = (PITCH_WIDTH + GOAL_WIDTH) / 2; // ≈ 37.66

/** Centre spot — kickoff position and the ball's rest point between goals. */
export const CENTRE_SPOT: Vec2 = { x: PITCH_LENGTH / 2, y: PITCH_WIDTH / 2 };

/** Which side of the pitch a team attacks / defends. */
export type TeamSide = 'home' | 'away';

/**
 * The x-coordinate of the goal `side` is ATTACKING (trying to score into).
 * Home attacks the x=105 goal; away attacks the x=0 goal.
 */
export function attackingGoalX(side: TeamSide): number {
  return side === 'home' ? PITCH_LENGTH : 0;
}

/** The x-coordinate of the goal `side` is DEFENDING.  Inverse of attackingGoalX. */
export function defendingGoalX(side: TeamSide): number {
  return side === 'home' ? 0 : PITCH_LENGTH;
}

// ── Player ──────────────────────────────────────────────────────────────────

/** Coarse on-pitch role.  Mirrors the `players.position` column vocabulary. */
export type Role = 'GK' | 'DF' | 'MF' | 'FW';

/**
 * The per-player attributes the spatial engine actually consults.  All on a
 * roughly 38–95 scale (matching the DB stat columns).  These map directly to
 * physical and decision capabilities — there are no hidden multipliers.
 */
export interface SimPlayerStats {
  /** Drives shot power + accuracy when finishing. */
  shooting:    number;
  /** Pass range + accuracy. */
  passing:     number;
  /** Close control while carrying; resists being tackled. */
  dribbling:   number;
  /** Top sprint speed (scaled into m/s in player init). */
  speed:       number;
  /** Acceleration + how slowly stamina drains. */
  stamina:     number;
  /** Tackling success + interception reach. */
  tackling:    number;
  /** Off-ball reading: marking tightness + interception anticipation. */
  positioning: number;
  /** Shot-stopping for keepers; aerial reach. */
  goalkeeping: number;
  /** Pass-selection quality — picking the better option more often. */
  vision:      number;
}

/**
 * Static description of one player handed to the engine at kickoff.
 * `formationSlot` is the player's normalised home position for the team's
 * shape (see formation.ts) — the anchor they return to when not involved.
 */
export interface SimPlayerInput {
  /** Stable identity — entity_id preferred, falls back to player name. */
  id:       string;
  name:     string;
  role:     Role;
  stats:    SimPlayerStats;
  /**
   * Home position as a fraction of the pitch FROM THIS TEAM'S OWN GOAL:
   *   fx ∈ [0,1]  0 = own goal line, 1 = opponent goal line
   *   fy ∈ [0,1]  0 = top touchline, 1 = bottom touchline
   * Stored team-relative so the same slot table works for both sides; the
   * engine mirrors it into absolute pitch coords per side at init.
   */
  formationSlot: { fx: number; fy: number };
}

/**
 * A player's live state during simulation.  Mutated in place each tick by the
 * step function (the engine owns these objects; nothing outside step.ts writes
 * them).  `target` is the point the player's steering is currently seeking.
 */
export interface SimPlayer {
  readonly id:    string;
  readonly name:  string;
  readonly role:  Role;
  readonly side:  TeamSide;
  readonly stats: SimPlayerStats;
  /** Absolute home anchor in pitch metres (formationSlot mapped per side). */
  readonly homePos: Vec2;
  /** Top speed in m/s (derived from the speed stat). */
  readonly maxSpeed: number;
  /** Current position in pitch metres. */
  pos: Vec2;
  /** Current velocity in m/s. */
  vel: Vec2;
  /** Remaining energy in [0,1]; scales effective speed as it drains. */
  stamina: number;
}

// ── Ball ──────────────────────────────────────────────────────────────────

/**
 * Ball state.  When `ownerId` is set the ball is glued to that carrier and
 * moves with them; when null the ball is loose / in flight and integrates
 * under its own velocity with rolling friction.
 */
export interface SimBall {
  pos: Vec2;
  vel: Vec2;
  /** id of the player in possession, or null when loose / in flight. */
  ownerId: string | null;
  /**
   * Ticks remaining before a loose ball can be claimed again.  Prevents the
   * just-passed-from player from instantly re-collecting their own pass and
   * stops jitter where two players trade possession every tick.
   */
  loosePopCooldown: number;
  /**
   * Seconds the current owner has held the ball since their last decision.
   * Drives the decision cadence — a carrier acts every DECISION_INTERVAL_SEC
   * rather than re-deciding every physics tick (which would look twitchy).
   * Reset to 0 on every possession change and after each decision.
   */
  heldSec: number;
  /**
   * Provenance of the last deliberate kick — who struck it and whether it was
   * a shot (and from what quality position).  When the ball crosses a goal
   * line this tells step.ts whether to resolve a save (shot) and how hard the
   * keeper's job is.  null before the first kick of a possession.
   */
  lastTouch: { side: TeamSide; isShot: boolean; sq: number; playerId?: string } | null;
  /**
   * Offside flag for a pass in flight.  Set to the receiver's id when a pass is
   * struck to a player who is in an offside position at that instant; if that
   * same player collects the ball, the engine calls offside.  null whenever the
   * ball is not a pass-in-flight to a flagged attacker — it is set only on a
   * pass and cleared on any collection, restart, shot or tackle.
   */
  offsideFor: string | null;
}

// ── World ─────────────────────────────────────────────────────────────────

/** Coarse phase of play — gates which behaviours and events are legal. */
export type SimPhase =
  | 'kickoff'    // ball on centre spot, waiting to be played
  | 'open_play'  // normal flowing play
  | 'dead_ball'  // stoppage (goal scored, ball out) — brief pause then restart
  | 'finished';  // 90 minutes elapsed

/**
 * The complete mutable world the engine steps forward.  One instance per match.
 */
export interface SimWorld {
  home: SimPlayer[];
  away: SimPlayer[];
  ball: SimBall;
  /** Goals as [home, away]. */
  score: [number, number];
  /** Match clock in seconds since kickoff (0 … 90·60). */
  clockSec: number;
  phase: SimPhase;
  /** Ticks remaining in the current dead-ball pause before the restart. */
  deadBallTicks: number;
  /**
   * The fixed physics timestep (s) this match runs at.  Stored on the world so
   * event-resolution code (which doesn't take dt) can convert a duration like
   * the post-goal pause into a tick count deterministically.
   */
  readonly dtSec: number;
}

// ── Emergent events ───────────────────────────────────────────────────────

/**
 * A primitive event the engine emits when geometry produces a notable moment.
 * Phase 2 of the rebuild maps these onto the richer `match_events` vocabulary
 * (with commentary, momentum, etc.) so the existing narrative layer keeps
 * working.  Kept deliberately minimal here — this is ground truth, not prose.
 */
export interface SimEvent {
  /** Match-clock seconds at which it occurred. */
  tSec:    number;
  /** Whole-minute bucket (1–90) for match_events compatibility. */
  minute:  number;
  type:
    | 'kickoff'
    | 'goal'
    | 'shot'        // shot that did NOT score (saved / off target)
    | 'pass'        // completed pass (sampled, not every pass)
    | 'tackle'      // possession won by a defender
    | 'interception'
    | 'foul'        // failed challenge that fouls the carrier → free kick (may carry a card)
    | 'offside'     // attacker collected a teammate's pass while in an offside position
    | 'out_throw'   // ball left via touchline
    | 'out_goalkick'
    | 'out_corner'
    | 'save';       // keeper stopped a shot
  /** The acting team, where meaningful. */
  side?:     TeamSide;
  /** The acting player id, where meaningful. */
  playerId?: string;
  /** Secondary player id (e.g. the defender on a tackle, keeper on a save). */
  otherId?:  string;
  /** Card shown on a foul, when one is given.  Absent = no card. */
  card?:     'yellow' | 'red';
}

// ── Position frames (the viewer payload) ──────────────────────────────────

/** One player's position in a stored frame.  Compact for JSONB storage. */
export interface FramePlayer {
  id: string;
  /** Position rounded to 0.1m to keep frame JSON small. */
  x:  number;
  y:  number;
}

/**
 * A single sampled instant of the match — every player + the ball at one
 * clock time.  The client replays a stream of these, interpolating between
 * them with CSS transitions for smooth motion.
 */
export interface PositionFrame {
  tSec: number;
  players: FramePlayer[];
  ball: { x: number; y: number; ownerId: string | null };
}

// ── Engine configuration ──────────────────────────────────────────────────

/**
 * Tunable simulation parameters.  Defaults live in simulateSpatialMatch.ts;
 * callers override only when they need to (tests use a short matchSeconds).
 */
export interface SimConfig {
  /** Physics timestep in seconds.  Smaller = smoother + slower. */
  dtSec:        number;
  /** Total match length in seconds simulated (default 90·60 = 5400). */
  matchSeconds: number;
  /** Seconds between stored position frames (replay sample rate). */
  frameEverySec: number;
  /** Random seed — same seed + same teams ⇒ identical match. */
  seed:         number;
}

/** The full output of one simulated match. */
export interface SpatialMatchResult {
  finalScore: [number, number];
  events: SimEvent[];
  frames: PositionFrame[];
}
