// ── gameEngine.types.ts ───────────────────────────────────────────────────────
// Canonical TypeScript interfaces for the game engine domain.
//
// WHY A SEPARATE FILE: gameEngine.ts and simulateHelpers.ts mutually depend on
// many of the same shapes (EnginePlayer, MatchEvent, AIManager, …).  Putting
// types in their own module breaks the circular reference problem: both files
// can `import type { … } from './gameEngine.types'` without importing each
// other's runtime code.
//
// INVARIANT: the field names in EnginePlayer MUST NOT change without a matching
// update to normalizeTeamForEngine() in supabase.js — that function translates
// snake_case DB column names into this camelCase shape.  See CLAUDE.md for the
// full list of protected column names.

import type { ManagerEmotion, Personality, Position, WeatherCondition } from './constants';

// ── Player / Team ─────────────────────────────────────────────────────────────

/**
 * A squad member as consumed by the game engine.
 *
 * Fields are camelCase because normalizeTeamForEngine() converts the DB's
 * snake_case columns before passing data to the engine.  Numeric stats range
 * from roughly 38 (low) to 90 (elite).
 */
export interface EnginePlayer {
  name:          string;
  position:      Position;
  starter:       boolean;
  jersey_number: number;
  /** Primary stat for shooting, running, and finishing. */
  attacking:     number;
  /** Primary stat for tackling, blocking, and goalkeeping. */
  defending:     number;
  /** Composure, decision-making, set-piece quality. */
  mental:        number;
  /** Speed, stamina, heading; drives fatigue accumulation. */
  athletic:      number;
  /** Passing, dribbling, free-kick accuracy. */
  technical:     number;
}

/** Manager shape consumed by commentary, halftime reports, and late-game logic. */
export interface EngineManager {
  name:        string;
  /** Tactical style string matching `managers.style` in the DB. */
  personality: string;
}

/** A venue with weather-table lookup key. */
export interface EngineStadium {
  name:     string;
  planet:   string;
  capacity: string;
}

/** A complete team object as consumed by the game engine. */
export interface EngineTeam {
  name:      string;
  shortName: string;
  color:     string;
  stadium:   EngineStadium;
  manager:   EngineManager;
  tactics:   string;
  players:   EnginePlayer[];
}

// ── Per-player stats accumulated during a match ───────────────────────────────

/**
 * Mutable per-player stats log maintained by App.jsx and consulted by
 * generateEvent and simulateHelpers throughout the match.
 */
export interface PlayerMatchStats {
  goals:          number;
  assists:        number;
  shots:          number;
  saves:          number;
  tackles:        number;
  yellowCard:     boolean;
  redCard:        boolean;
  /** Minute the player was substituted ON (present only for subs). */
  subbedOnMinute?: number;
  /** True if this player came on as a substitute. */
  subbedOn?:       boolean;
}

/** Map from player name → their running stats for this match. */
export type PlayerStatsMap = Record<string, PlayerMatchStats>;

// ── Match events ──────────────────────────────────────────────────────────────

/**
 * A single feed entry in the match timeline.  Almost every field is optional
 * because different event types carry different subsets of metadata.
 */
export interface MatchEvent {
  minute:      number;
  type:        string;
  team:        string;           // shortName of the team that caused the event
  commentary:  string;
  /** [home delta, away delta] applied to the running momentum state. */
  momentumChange: [number, number];

  // ── Outcome / scoring ────────────────────────────────────────────────────
  // NOTE: `T | undefined` (rather than just `T?`) is required because the
  // tsconfig has exactOptionalPropertyTypes: true — without the explicit
  // | undefined, callers cannot pass `field: maybeUndefinedValue`.
  player?:     string | undefined; // primary actor
  defender?:   string | undefined; // defending actor (for contests)
  assister?:   string | undefined;
  isGoal?:     boolean | undefined;
  isVAROverturned?: boolean | undefined;
  isInjury?:   boolean | undefined;
  outcome?:    string | undefined; // 'saved' | 'post' | 'miss' | 'clean_tackle' | …
  cardType?:   'yellow' | 'red' | undefined;

  // ── Substitution ──────────────────────────────────────────────────────────
  substituteInfo?: { in: string; out: string } | undefined;

  // ── Embedded sub-event sequences ─────────────────────────────────────────
  // Sequences are flattened by flattenSequences() in simulateHelpers.ts before
  // being inserted into the running event log.
  penaltySequence?:       MatchEvent[] | undefined;
  freekickSequence?:      MatchEvent[] | undefined;
  counterSequence?:       MatchEvent[] | undefined;
  confrontationSequence?: MatchEvent[] | undefined;
  nearMissSequence?:      MatchEvent[] | undefined;
}

// ── Agent (player AI) ─────────────────────────────────────────────────────────

/**
 * Runtime agent wrapping an EnginePlayer.  Created by createAgent() at kickoff.
 * The agent maintains ephemeral per-match state (fatigue, morale, confidence)
 * that the engine consults on every contest roll.
 */
export interface PlayerAgent {
  /** The underlying static player data. */
  player:      EnginePlayer;
  /** Assigned personality key (e.g. 'selfish', 'workhorse'). */
  personality: Personality;
  /** True for the player with the highest mental stat in the XI. */
  isCaptain:   boolean;
  /** True for the player assigned the "clutch performer" role at kickoff. */
  isClutch:    boolean;
  /** Fatigue accumulation (0–100). High fatigue → poor contest rolls. */
  fatigue:     number;
  /** Running morale score influenced by goals, subs, and captain rallies. */
  morale:      number;
  /**
   * Adjusts contest rolls.  Updated by updateConfidence(delta) calls from
   * applyLateGameLogic and buildPostGoalExtras.
   */
  confidence:  number;
  /** Accumulates a yellow-card risk count during the match. */
  disciplinary: number;

  /** Apply a confidence delta (positive or negative). */
  updateConfidence(delta: number): void;
}

// ── Manager AI ────────────────────────────────────────────────────────────────

/**
 * Runtime manager object wrapping static EngineManager data.  Tracks live
 * emotion state and exposes tactical decision methods used by simulateHelpers.
 */
export interface LiveManager {
  name:     string;
  emotion:  ManagerEmotion;
  personality: string;
}

/**
 * A result returned by the halftime / tactical report generator.
 * Carries the human-readable commentary string shown in the feed.
 */
export interface TacticalShoutResult {
  commentary: string;
}

/**
 * Substitution result object returned by makeSub().
 * `substitute` is null when no valid bench player is available.
 */
export interface SubResult {
  newActive: string[];
  substitute: string | null;
}

/**
 * The AI Manager (AIM) — orchestrates both squads' agent pools and provides
 * tactical decision hooks called by simulateHelpers throughout the match.
 *
 * Created once per match by createAIManager(); passed into genEvent(),
 * buildPostGoalExtras(), and applyLateGameLogic() on every minute tick.
 */
export interface AIManager {
  homeManager:      LiveManager;
  awayManager:      LiveManager;
  /** All 16 home agents (starters + bench). */
  homeAgents:       PlayerAgent[];
  /** All 16 away agents (starters + bench). */
  awayAgents:       PlayerAgent[];
  /** Currently active (on-pitch) home agents — updated by handleSubstitution. */
  activeHomeAgents: PlayerAgent[];
  /** Currently active (on-pitch) away agents. */
  activeAwayAgents: PlayerAgent[];
  /** Randomly selected referee name for this match. */
  referee:          { name: string };
  /** Weather condition picked from the home ground's PLANET_WX table. */
  weather:          WeatherCondition;
  /**
   * Maximum active flashpoints in narrativeResidue.  Set at createAIManager
   * time; consulted by updateNarrativeResidue to prevent runaway state.
   * Typical value: 4.
   */
  maxFlashpoints:   number;
  /**
   * Number of consecutive near-misses that triggers a shot-probability bonus.
   * Typical value: 2–3.  Stored here so it can vary by manager aggression.
   */
  nearMissThreshold: number;

  /** Return the agent for the named player, or undefined if not found. */
  getAgentByName(name: string): PlayerAgent | undefined;

  /**
   * Fire a late-game tactical shout if random chance allows.
   * @param isHome  True for the home manager.
   * @param minute  Current match minute.
   * @param scoreDiff  Positive = home leading, negative = home trailing.
   * @returns A commentary object, or null if the manager stays silent.
   */
  managerTacticalShout(
    isHome: boolean,
    minute: number,
    scoreDiff: number,
  ): TacticalShoutResult | null;

  /**
   * Swap two agents in the active pool — called after a substitution event.
   * @param outName   Name of the player leaving the pitch.
   * @param inName    Name of the substitute coming on.
   * @param isHome    True if the substituting team is home.
   */
  handleSubstitution(outName: string, inName: string, isHome: boolean): void;
}

// ── Flashpoints ───────────────────────────────────────────────────────────────

/**
 * A short-lived narrative state created by specific events (goals, fouls,
 * penalties, subs, VAR decisions) that biases subsequent event selection and
 * contest outcomes until it expires.
 *
 * See updateNarrativeResidue() in simulateHelpers.ts for the full list of
 * 15 flashpoint types and their creation conditions.
 */
export interface Flashpoint {
  /** Discriminant string (e.g. 'retaliation', 'momentum_surge'). */
  type:           string;
  /** The player most affected (null for team-wide or league-wide flashpoints). */
  primaryPlayer:  string | null;
  /** Secondary player for two-player flashpoints (e.g. retaliation). */
  secondaryPlayer?: string | null;
  /**
   * 'home' | 'away' — the team whose agents are affected.
   * null for league-wide effects (ref_controversy, weather_chaos).
   */
  teamKey:        string | null;
  /** Match minute at which this flashpoint becomes inactive. */
  expiresMin:     number;
  /** Minute this flashpoint was created (for debugging / logging). */
  createdMin:     number;
  /**
   * Bonus/penalty applied to agent contest rolls while active.
   * Positive = advantage for the affected player/team.
   * Negative = disadvantage.
   */
  contestMod:     number;
  /**
   * Multiplier applied to the probability of a card being issued when
   * the affected player is involved in a foul contest.
   * e.g. 1.8 = 80% more likely to produce a card.
   */
  cardBias?:      number;
  /**
   * Additive adjustment to the player-selection probability weight.
   * Positive = more likely to be selected as the event's primary actor.
   */
  selectBias?:    number;
  /**
   * Extra probability added to the current event curve segment's base.
   * Used by crowd_eruption to temporarily boost home event frequency.
   */
  pressureBonus?: number;
  /**
   * Multiplier applied to all weather penalties in resolveContest.
   * Used by weather_chaos (doubles existing weather penalties).
   */
  weatherMult?:   number;
  /**
   * Probability of re-injury if the fragile player is involved in a tackle.
   * Set by injury_fragile (range 0.25–0.45).
   */
  reinjuryRisk?:  number;
}

// ── Narrative residue ─────────────────────────────────────────────────────────

/**
 * Causal memory of the match — updated every minute by updateNarrativeResidue().
 * Drives event probability and contest outcome biases based on the match's
 * recent history.
 */
export interface NarrativeResidue {
  /**
   * Accumulated tension from shots, corners, and near-misses.
   * Fed into getEventProbability() as a bonus — a team under sustained
   * pressure generates events more frequently.
   * Range: 0–100 per team.  Resets to 0 when the team scores.
   */
  pressure:   { home: number; away: number };
  /**
   * Running count of consecutive near-misses per team.
   * When this reaches aim.nearMissThreshold, genEvent() applies a
   * roll bonus that pushes toward the shot branch.  Resets on goal.
   */
  nearMisses: { home: number; away: number };
  /** Live flashpoints still within their expiry window. */
  flashpoints: Flashpoint[];
}

// ── Match state ───────────────────────────────────────────────────────────────

/**
 * The full match state object threaded through simulateMinute() on every tick.
 * App.jsx holds this in React state; simulateHelpers receives `prev` (the
 * snapshot from the previous tick) and returns a new snapshot.
 *
 * This type describes the READ fields consumed by simulateHelpers — it does
 * not describe the full React state object held by App.jsx.
 */
export interface MatchState {
  /** [homeGoals, awayGoals]. */
  score:            [number, number];
  /** Flat event log — all events that have fired so far, oldest first. */
  events:           MatchEvent[];
  homeTeam:         EngineTeam;
  awayTeam:         EngineTeam;
  /** Names of currently on-pitch players, keyed by team. */
  activePlayers:    { home: string[]; away: string[] };
  playerStats:      PlayerStatsMap;
  /** How many substitutions each team has used (max 3). */
  substitutionsUsed: { home: number; away: number };
  /** Red-card count per team (affects chaos level). */
  redCards:          { home: number; away: number };
  /** Set after a manager is sent to the stands — prevents repeated ejections. */
  managerSentOff?:  { home?: boolean; away?: boolean };
  narrativeResidue: NarrativeResidue;
}

// ── Contest context / result ──────────────────────────────────────────────────

/**
 * Optional context passed into resolveContest() to apply flashpoint biases
 * and weather penalties to the raw dice roll.
 */
export interface ContestCtx {
  flashpoints?:    Flashpoint[];
  weatherPenalty?: number;
  weatherMult?:    number;
}

/**
 * Outcome of a single attacker-vs-defender contest roll.
 */
export interface ContestResult {
  /** True if the attacker won the contest (shot on target, successful dribble, etc.). */
  atkWins:    boolean;
  /** The raw attacker roll (before any biases). */
  atkRoll:    number;
  /** The raw defender roll. */
  defRoll:    number;
  /** Net roll after flashpoint/weather modifiers. */
  netRoll:    number;
}

// ── Tension variant ───────────────────────────────────────────────────────────

/**
 * Governs the event-frequency distribution for an entire match.
 * Chosen once at kickoff by pickTensionVariant() from the teams' attacking
 * averages; stored in matchState.tensionVariant.
 *
 *   standard       Natural ebb and flow.
 *   frantic        End-to-end; +0.08 to every curve segment.
 *   cagey          Frustrating; −0.10 before min 70, +0.18 after.
 *   slow_burn      Quiet for an hour, then maximum chaos; −0.12/+0.22.
 *   back_and_forth Volatile throughout; per-segment jitter baked at kickoff.
 */
export type TensionVariant =
  | 'standard'
  | 'frantic'
  | 'cagey'
  | 'slow_burn'
  | 'back_and_forth';
