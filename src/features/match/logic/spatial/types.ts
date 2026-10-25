// ── features/match/logic/spatial/types.ts ────────────────────────────────────
// Domain types + pitch geometry for the authoritative spatial match engine.
//
// This is the contract every other module in spatial/ builds on.  The engine
// is an emergent simulation (engine v2, docs/emergent-engine.md): 22 players
// and a 2.5D ball move continuously through pitch-metre space, every outcome
// (a tackle, a save, a foul, a goal) is decided by geometry, physics and time,
// and match events are DERIVED from that motion.  Nothing rolls for success.
// The only random inputs are human imprecision in execution and perception.
//
// FRAME OF REFERENCE
//   x in [0, 105]  pitch length.  Home defends x=0, attacks toward x=105.
//   y in [0,  68]  pitch width.   0 = top touchline, 68 = bottom touchline.
//   z >= 0         ball height above the grass.
//   All distances metres, all speeds metres/second, all times seconds.

import type { Vec2 } from './vec2';
import type { Rng } from './rng';
import type { TeamTactics, SubRole, PhaseChange } from './phase';

// ── Pitch geometry ────────────────────────────────────────────────────────────

/** Standard FIFA pitch length in metres.  x spans [0, PITCH_LENGTH]. */
export const PITCH_LENGTH = 105;

/** Standard FIFA pitch width in metres.  y spans [0, PITCH_WIDTH]. */
export const PITCH_WIDTH = 68;

/** Goal mouth width in metres (real-world 7.32m).  Centred on the y-axis. */
export const GOAL_WIDTH = 7.32;

/** Crossbar height in metres (real-world 2.44m). */
export const GOAL_HEIGHT = 2.44;

/** Lowest y of the goal mouth: a ball must cross the line between this... */
export const GOAL_Y_MIN = (PITCH_WIDTH - GOAL_WIDTH) / 2; // about 30.34

/** ...and this y (under the bar) to count as a goal. */
export const GOAL_Y_MAX = (PITCH_WIDTH + GOAL_WIDTH) / 2; // about 37.66

/** Centre spot: kickoff position. */
export const CENTRE_SPOT: Vec2 = { x: PITCH_LENGTH / 2, y: PITCH_WIDTH / 2 };

/** Penalty-area depth from the goal line (m): the real-world "18-yard box". */
export const PENALTY_AREA_DEPTH = 16.5;

/** Penalty-area full width (m): the goal mouth + 16.5m either side. */
export const PENALTY_AREA_WIDTH = GOAL_WIDTH + 2 * 16.5;

/** Lowest y of the penalty area. */
export const PENALTY_AREA_Y_MIN = (PITCH_WIDTH - PENALTY_AREA_WIDTH) / 2; // about 13.84

/** Highest y of the penalty area. */
export const PENALTY_AREA_Y_MAX = (PITCH_WIDTH + PENALTY_AREA_WIDTH) / 2; // about 54.16

/** Distance of the penalty spot from the goal line (m). */
export const PENALTY_SPOT_DIST = 11;

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

/** The other side. */
export function otherSide(side: TeamSide): TeamSide {
  return side === 'home' ? 'away' : 'home';
}

// ── Player ──────────────────────────────────────────────────────────────────

/** Coarse on-pitch role.  Mirrors the `players.position` column vocabulary. */
export type Role = 'GK' | 'DF' | 'MF' | 'FW';

/**
 * The per-player attributes the spatial engine actually consults.  All on a
 * roughly 38-95 scale (matching the DB stat columns).  In engine v2 every stat
 * acts through a physical or perceptual channel: an execution error, a speed,
 * a reach, a reaction time or a decision temperature.  None is a success
 * probability.
 */
export interface SimPlayerStats {
  /** Strike power and strike accuracy (kick error on shots). */
  shooting:    number;
  /** Pass accuracy (kick error on passes, crosses and clearances). */
  passing:     number;
  /** Close control: touch accuracy while carrying and first-touch capacity. */
  dribbling:   number;
  /** Top sprint speed (scaled into m/s in player init). */
  speed:       number;
  /** How slowly energy drains, and therefore how late fatigue bites. */
  stamina:     number;
  /** Challenge technique: lunge reach and timing accuracy. */
  tackling:    number;
  /** Reading play: reaction delay and anticipation (perception error). */
  positioning: number;
  /** Keepers: dive speed, reach, handling and reaction. */
  goalkeeping: number;
  /** Decision quality: softmax temperature over options. */
  vision:      number;
}

/**
 * Static description of one player handed to the engine at kickoff.
 * `formationSlot` is the player's normalised home position for the team's
 * shape (see formation.ts): the anchor they return to when not involved.
 */
export interface SimPlayerInput {
  /** Stable identity: entity_id preferred, falls back to player name. */
  id:       string;
  name:     string;
  role:     Role;
  stats:    SimPlayerStats;
  /**
   * Home position as a fraction of the pitch FROM THIS TEAM'S OWN GOAL:
   *   fx in [0,1]  0 = own goal line, 1 = opponent goal line
   *   fy in [0,1]  0 = top touchline, 1 = bottom touchline
   */
  formationSlot: { fx: number; fy: number };
}

/**
 * Personality multipliers on the utility evaluator (design 4.7).  Each is 1
 * for a balanced player; an archetype bends the SAME considerations everyone
 * scores, never a separate system.
 */
export interface PersonalityWeights {
  /** Multiplier on the value of shooting. */
  readonly shoot: number;
  /** Multiplier on the value of passing. */
  readonly pass: number;
  /** Multiplier on the value of carrying the ball. */
  readonly dribble: number;
  /** Multiplier on the appetite to commit to a challenge. */
  readonly challenge: number;
  /** Multiplier on off-ball work rate (pressing, recovering, running). */
  readonly work: number;
  /** Multiplier on risk aversion (cost of losing the ball). */
  readonly caution: number;
}

/** The off-ball job a player is currently doing (design 4.6). */
export type OffBallJob =
  | 'shape'    // hold the authored formation anchor
  | 'chase'    // go for a loose ball / meet a pass
  | 'press'    // close down the carrier (jockey goal-side)
  | 'counterpress' // one of the manager's counter-pressers just after a loss
  | 'cover'    // second defender behind the presser
  | 'mark'     // goal-side of an attacker
  | 'support'  // offer an angle to the carrier
  | 'run'      // run in behind the defensive line
  | 'setpiece';// a restart position

/** A committed challenge in progress (design 4.3). */
export interface Lunge {
  /** Where the defender's foot is going. */
  readonly at: Vec2;
  /** Match-clock second at which the foot arrives and contact is judged. */
  readonly resolveSec: number;
  /** Closing speed when committed (m/s): feeds foul severity. */
  readonly closing: number;
  /** id of the carrier being challenged. */
  readonly targetId: string;
}

/**
 * A player's live state during simulation.  Mutated in place each tick by the
 * step function (the engine owns these objects; nothing outside spatial/
 * writes them).
 */
export interface SimPlayer {
  readonly id:    string;
  readonly name:  string;
  role:  Role;
  /** Role inside his line (CB, FB, DM, CM, WM, W, ST), from his formation
   *  slot; a substitute inherits it with the slot. */
  subRole: SubRole;
  readonly side:  TeamSide;
  readonly stats: SimPlayerStats;
  /** Absolute home anchor in pitch metres (formationSlot mapped per side). */
  homePos: Vec2;
  /** Top speed in m/s (derived from the speed stat). */
  readonly maxSpeed: number;
  /** This player's private imprecision stream: hash(seed, index, salt). */
  readonly rng: Rng;
  /** Personality multipliers (all 1 when personality is ablated or absent). */
  readonly traits: PersonalityWeights;
  /** Current position in pitch metres. */
  pos: Vec2;
  /** Current velocity in m/s. */
  vel: Vec2;
  /** Remaining energy in [0,1]; scales effective speed and execution error. */
  stamina: number;
  /** Confidence in [0,1]; rises with success, falls with mistakes. */
  confidence: number;
  /** Yellow cards this player has been shown; a second one becomes a red. */
  yellowCards: number;
  /** Fouls committed so far (persistent infringement is a booking). */
  foulsCommitted: number;
  /** True once shown a red (or a second yellow): parked off the pitch. */
  sentOff: boolean;
  /** Current off-ball job and the point it is steering toward. */
  job: OffBallJob;
  jobTarget: Vec2;
  /** id of the opponent this player is marking/pressing, when relevant. */
  jobRef: string | null;
  /** Match-clock second of the next off-ball re-evaluation. */
  nextThinkSec: number;
  /** Match-clock second before which this player cannot touch the ball
   *  (reaction to a new ball path, or recovery after being beaten). */
  noTouchUntil: number;
  /** Match-clock second until which a beaten/fallen player moves slowly. */
  recoverUntil: number;
  /** A committed challenge in progress, or null. */
  lunge: Lunge | null;
  /** Keepers: a committed dive toward a point (and height), or null. */
  dive: { at: Vec2; z: number } | null;
  /** A strike being wound up: the decided shot is struck at `at` if the ball
   *  is still at his feet then (a back-lift takes time, and can be blocked
   *  or tackled in it). Opaque here; possession.ts owns the action shape. */
  windup: { action: unknown; at: number } | null;
  /** Clock second until which he is throwing himself into a shooting lane
   *  (leg or body out: a wider reach for a struck ball). */
  blockUntil: number;
  /** Match-clock second before which this player has not yet reacted to the
   *  latest change in the ball's path (perception delay). */
  reactUntil: number;
  /** Job-specific offset (support angle relative to the carrier). */
  jobOffset: Vec2;
  /** Consecutive carry decisions (anti-passivity decay). */
  holds: number;
  /** Bookkeeping, not state: his index in world.home then world.away as of
   *  the latest buildContext (offball.ts PlayerTable); -1 before then. */
  slot: number;
}

// ── Ball ──────────────────────────────────────────────────────────────────

/** What kind of deliberate strike last sent the ball on its way. */
export type KickKind =
  | 'pass' | 'through' | 'cross' | 'long' | 'clear' | 'shot'
  | 'throw' | 'goalkick' | 'corner' | 'freekick' | 'penalty' | 'kickoff'
  | 'dribble' | 'header' | 'parry' | 'deflection' | 'poke';

/** Provenance of the last deliberate kick (who, what, toward what). */
export interface KickInfo {
  readonly kind: KickKind;
  readonly side: TeamSide;
  readonly playerId: string;
  readonly from: Vec2;
  readonly tSec: number;
  /** Intended receiver for passes, if any. */
  readonly targetId: string | null;
  /** Intended destination point. */
  readonly aim: Vec2;
  /** For shots: has an outcome event (goal/save/shot/woodwork) been emitted? */
  resolved: boolean;
  /** For shots: did it strike the frame on its way? */
  woodwork: boolean;
}

/**
 * Ball state (2.5D).  The ball is ALWAYS a physical body: it moves under its
 * own velocity, gravity, drag and rolling friction.  `ownerId` names the
 * player in possession (the dribbler who last controlled it), purely as a
 * label for frames and decisions: a dribbled ball is free between touches.
 */
export interface SimBall {
  pos: Vec2;
  vel: Vec2;
  /** Height above the grass (m) and vertical speed (m/s). */
  z: number;
  vz: number;
  /** id of the player in possession, or null when loose / in flight. */
  ownerId: string | null;
  /** Last player (any side) to touch the ball, and when. */
  lastTouchId: string | null;
  lastTouchSide: TeamSide | null;
  lastTouchSec: number;
  /** When the current owner took control (he needs a moment to settle the
   *  ball and look up before he can pass). */
  controlSec: number;
  /** The last deliberate strike. */
  kick: KickInfo | null;
  /**
   * Offside flag for a pass in flight: the id of a receiver who was in an
   * offside position at the instant of the pass.  If that player is the next
   * to touch the ball, offside is called.  Cleared on any other touch.
   */
  offsideFor: string | null;
}

// ── World ─────────────────────────────────────────────────────────────────

/** Coarse phase of play: gates which behaviours and events are legal. */
export type SimPhase =
  | 'kickoff'    // reserved
  | 'open_play'  // normal flowing play
  | 'dead_ball'  // a restart is being set up (players take position)
  | 'finished';  // full time

/** Kinds of restart, each delivered through the same kick model. */
export type RestartKind = 'kickoff' | 'throw' | 'corner' | 'goalkick' | 'freekick' | 'penalty' | 'keeper';

/** A pending restart: the taker walks to the spot and then plays it. */
export interface Restart {
  readonly kind: RestartKind;
  readonly side: TeamSide;
  readonly spot: Vec2;
  takerId: string;
  /** Earliest match-clock second at which the restart may be taken. */
  readonly readyAt: number;
  /** For indirect free kicks (offside): no direct shot. */
  readonly indirect: boolean;
}

/**
 * Additive tendency deltas for a manager's play-style (shoot / pass / dribble /
 * tackle / press), bounded +-0.20.  Applied as zero-default deltas on the
 * utility terms: a delta of 0 changes nothing.
 */
export interface StyleModifier {
  readonly shoot:   number;
  readonly pass:    number;
  readonly dribble: number;
  readonly tackle:  number;
  readonly press:   number;
}

/**
 * Ablation switches (design section 6).  Every flag defaults ON; turning one
 * off removes that subsystem so its contribution can be measured.
 */
export interface EngineFlags {
  /** Execution and perception error (kick, touch, reaction noise). */
  imprecision:     boolean;
  /** Softmax among near-best options (off = always the top option). */
  utilitySoftness: boolean;
  /** Personality multipliers on the evaluator. */
  personality:     boolean;
  /** Per-player confidence (rises with success, falls with mistakes). */
  confidence:      boolean;
  /** The home crowd: a little more alertness and running from the home side. */
  homeAdvantage:   boolean;
  /** Per-team momentum (pressing intensity, shot appetite). */
  momentum:        boolean;
  /** Score-and-clock term (leading sits deeper, trailing takes risks). */
  scoreClockTerm:  boolean;
  /** Body contact: running into the carrier is a charge (a foul). */
  bodyContact:     boolean;
  /** Each manager's own game model (off = one neutral preset for both sides). */
  gameModel:       boolean;
}

/**
 * One instrumentation record: a deciding moment with the numbers that
 * decided it.  Emitted only when a trace sink is configured; it never feeds
 * back into the simulation.
 */
export interface TraceRecord {
  tSec: number;
  kind: string;
  playerId?: string;
  side?: TeamSide;
  /** Ball position and height at the moment. */
  ball: { x: number; y: number; z: number };
  data: Record<string, number | string | boolean | null>;
}

export interface SimWorld {
  home: SimPlayer[];
  away: SimPlayer[];
  /** Unused substitutes for each side; players move from here onto the pitch. */
  homeBench: SimPlayer[];
  awayBench: SimPlayer[];
  /** Substitutions still available to each side (starts at 3). */
  homeSubsLeft: number;
  awaySubsLeft: number;
  /** Each side's manager play-style deltas (Balanced zeros if none set). */
  homeStyle: StyleModifier;
  awayStyle: StyleModifier;
  ball: SimBall;
  /** Goals as [home, away]. */
  score: [number, number];
  /** Match clock in seconds since kickoff. */
  clockSec: number;
  phase: SimPhase;
  /** The pending restart while phase is 'dead_ball'. */
  restart: Restart | null;
  /** Regulation length (s), for the score-and-clock term. */
  readonly matchSeconds: number;
  /** Team momentum in [-1, 1], [home, away]. */
  momentum: [number, number];
  /** The most recent shot (for crediting a goal that goes in off a parry). */
  lastShot: { playerId: string; side: TeamSide; tSec: number } | null;
  /** Ablation switches in force for this match. */
  readonly flags: EngineFlags;
  /** Optional instrumentation sink. */
  readonly trace: ((r: TraceRecord) => void) | null;
  /** The fixed physics timestep (s) this match runs at. */
  readonly dtSec: number;
  /** Each side's phase of play and the manager's plan (phase.ts). */
  readonly tactics: { readonly home: TeamTactics; readonly away: TeamTactics };
}

// ── Emergent events ───────────────────────────────────────────────────────

/**
 * A primitive event the engine emits when the simulation produces a notable
 * moment.  The adapter maps these onto the richer `match_events` vocabulary.
 * Kept deliberately minimal here: this is ground truth, not prose.
 */
export interface SimEvent {
  /** Match-clock seconds at which it occurred. */
  tSec:    number;
  /** Whole-minute bucket (1-90, more in added time) for match_events. */
  minute:  number;
  type:
    | 'kickoff'
    | 'goal'
    | 'shot'        // shot that did NOT score and was not saved (off target / blocked)
    | 'pass'        // a pass played to a team-mate (every attempt)
    | 'tackle'      // a challenge that won the ball from the carrier
    | 'interception'// a pass cut out by an opponent
    | 'foul'        // a challenge that met the man, not the ball (may carry a card)
    | 'penalty'     // a foul inside the box: penalty kick (followed by a goal, save or shot)
    | 'woodwork'    // a shot that struck the frame and did not go in
    | 'substitution'// a fresh sub replaces a tiring player (playerId on, otherId off)
    | 'offside'     // attacker played the ball from an offside position
    | 'out_throw'   // ball left via touchline
    | 'out_goalkick'
    | 'out_corner'
    | 'save';       // keeper stopped an on-target shot (playerId = the saver)
  /** The acting team, where meaningful. */
  side?:     TeamSide;
  /** The acting player id, where meaningful. */
  playerId?: string;
  /** Secondary player id (the fouled player, the shooter on a save, ...). */
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
 * A single sampled instant of the match: every player + the ball at one
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
  /** Total match length in seconds simulated (default 90*60 = 5400). */
  matchSeconds: number;
  /** Seconds between stored position frames (replay sample rate). */
  frameEverySec: number;
  /** Random seed: same seed + same teams gives an identical match. */
  seed:         number;
  /**
   * Whether to play deterministic added (stoppage) time after regulation.
   * On for real matches; tests that assert an exact frame count switch it off.
   */
  stoppage:     boolean;
  /** Ablation switches; any omitted flag is on. */
  flags?:       Partial<EngineFlags>;
  /** Instrumentation sink for trace records (scripts only). */
  trace?:       (r: TraceRecord) => void;
}

/** The full output of one simulated match. */
export interface SpatialMatchResult {
  finalScore: [number, number];
  events: SimEvent[];
  frames: PositionFrame[];
  /** Each side's phase-of-play timeline: the phase entered, on every change
   *  (additive and optional; frames and events are unchanged). */
  phases?: { home: PhaseChange[]; away: PhaseChange[] };
}
