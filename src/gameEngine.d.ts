// ── gameEngine.d.ts ──────────────────────────────────────────────────────────
// Ambient type declarations for the JavaScript module `gameEngine.js`.
//
// WHY THIS EXISTS
// ───────────────
// `gameEngine.js` is 2725 LOC of complex match-simulation code that consumes
// camelCase player data and produces minute-by-minute event streams. A full
// `.js → .ts` conversion is high-risk (no automated tests cover the simulator
// itself) and out of scope for the current Package 7 work.  This declaration
// file gives every consumer (simulateHelpers.ts, future TS components) full
// type safety at the call boundary while leaving the implementation untouched.
//
// HOW TYPESCRIPT RESOLVES THIS
// ─────────────────────────────
// When both `gameEngine.js` and `gameEngine.d.ts` exist next to each other,
// TypeScript uses the `.d.ts` file as the source of type information.  At
// runtime, Vite continues to load the `.js` source unchanged.  This is the
// standard incremental-typing pattern published by the TypeScript team.
//
// WHEN UPDATING THE JS SOURCE
// ───────────────────────────
// Any change to a function signature in gameEngine.js MUST be mirrored in this
// file.  The `npm run check` typecheck does NOT detect drift between the .js
// implementation and the .d.ts declaration — it trusts the declaration.

import type {
  AIManager, ContestCtx, ContestResult, EnginePlayer, EngineTeam,
  MatchEvent, PlayerAgent, PlayerStatsMap, SubResult,
} from './gameEngine.types';

// ── Agent / manager construction ──────────────────────────────────────────────

/**
 * Create a runtime agent wrapping an `EnginePlayer`.  Called once per squad
 * member (16 per team) at kickoff.  The agent maintains live per-match state
 * (fatigue, morale, confidence) consulted on every contest roll.
 *
 * @param player Static player data (camelCase shape from normalizeTeamForEngine).
 * @param isHome True for home-side agents — gates a small home-advantage bonus.
 */
export function createAgent(player: EnginePlayer, isHome: boolean): PlayerAgent;

/**
 * Construct the AI Manager (AIM) — the master orchestrator for one match.
 * Spawns agents for both squads, selects a random referee, samples the
 * planet weather, and exposes the methods used by simulateHelpers (tactical
 * shouts, substitutions, agent lookup).
 */
export function createAIManager(homeTeam: EngineTeam, awayTeam: EngineTeam): AIManager;

// ── Squad / stats utilities ───────────────────────────────────────────────────

/**
 * Filter `team.players` down to only the active (on-pitch) players named
 * in `active`.  Returned in the same order as the input array.
 */
export function getActive(team: EngineTeam, active: string[]): EnginePlayer[];

/** Aggregated team-level stat snapshot computed from the active XI. */
export interface TeamStats {
  /** Mean attacking stat across active players. */
  atk: number;
  /** Mean defending stat across active players. */
  def: number;
  /** Mean mental stat across active players. */
  men: number;
  /** Mean athletic stat across active players. */
  ath: number;
  /** Mean technical stat across active players. */
  tec: number;
}

/**
 * Compute per-stat averages over the active XI.  Used by genEvent() to
 * pick the contest type (attack vs. defence) and by the halftime report.
 */
export function teamStats(team: EngineTeam, active: string[]): TeamStats;

/**
 * Pick one player weighted by the named stat ('attacking', 'defending', …)
 * and the requested position filter ('FW', 'DF', or 'any').
 */
export function getPlayer(
  team:   EngineTeam,
  active: string[],
  stat:   keyof EnginePlayer,
  pos:    'GK' | 'DF' | 'MF' | 'FW' | 'any',
): EnginePlayer;

/**
 * Form bonus (positive = in form, negative = poor form) derived from the
 * player's recent goals/assists/cards in `stats`.  Range roughly −10..+10.
 */
export function formBonus(name: string, stats: PlayerStatsMap): number;

/**
 * Choose a substitute to replace the named outgoing player.  Picks from the
 * bench based on position match and remaining substitutions.  Returns
 * `{ substitute: null }` when no eligible bench player is available.
 */
export function makeSub(
  team:     EngineTeam,
  out:      string,
  active:   string[],
  subsUsed: number,
  stats:    PlayerStatsMap,
): SubResult;

/**
 * Compute Most Valuable Player from the final stats map and the two teams.
 * Returns the player's name string, or '—' if no clear MVP can be identified.
 */
export function calcMVP(stats: PlayerStatsMap, home: EngineTeam, away: EngineTeam): string;

// ── Contest resolution ────────────────────────────────────────────────────────

/**
 * Resolve a single attacker-vs-defender contest.  Used for shots, tackles,
 * dribbles, blocks, saves — anything where two players' stats are compared
 * to determine the outcome.
 *
 * The optional `ctx` parameter applies flashpoint biases and weather
 * penalties on top of the raw dice roll.
 */
export function resolveContest(
  atkPlayer: EnginePlayer,
  atkAgent:  PlayerAgent,
  defPlayer: EnginePlayer,
  defAgent:  PlayerAgent,
  ctx?:      ContestCtx,
): ContestResult;

// ── Commentary builder ────────────────────────────────────────────────────────

/** Actor names referenced inside a commentary template string. */
export interface CommentaryActors {
  player?:    string;
  defender?:  string;
  assister?:  string;
  team?:      string;
  defTeam?:   string;
  manager?:   string;
}

/**
 * Build the commentary string for a given event type and outcome.
 * Picks one of several flavour variants and substitutes actor names.
 */
export function buildCommentary(
  type:    string,
  actors:  CommentaryActors,
  outcome: string,
  flavour?: string[],
  ctx?:    Record<string, unknown>,
): string;

// ── Sequence generators ───────────────────────────────────────────────────────
//
// All gen*Seq functions return an object with a `sequence` array of events.
// The `sequence` is what gets spread into the running event log by
// flattenSequences() or the late-game logic in simulateHelpers.ts.

/** Standard return shape for every multi-step sequence generator. */
export interface SequenceResult {
  sequence: MatchEvent[];
  /** Optional outcome flag bubbled up by the celebration / VAR generators. */
  outcome?: string;
}

/**
 * Free-kick sequence: foul → wall set → kick → outcome.
 * `aim` is the requested target ('left' | 'right' | 'centre' | 'top') —
 * an unspecified value lets the generator pick randomly.
 */
export function genFreekickSeq(
  min:     number,
  taker:   string,
  gk:      string,
  posTeam: string,
  defTeam: string,
  aim?:    string,
  ctx?:    Record<string, unknown>,
): SequenceResult;

/**
 * Goal celebration sequence: scorer reaction → teammate pile-on →
 * manager reaction → restart.  Length varies with manager emotion and
 * the scorer's personality.
 */
export function genCelebrationSeq(
  min:           number,
  scorer:        string | undefined,
  team:          string,
  mgrName?:      string,
  mgrEmotion?:   string,
  scorerAgent?:  PlayerAgent,
): SequenceResult;

/**
 * VAR check sequence: review → decision → restart.  When `overturned` is
 * true, the goal is wiped and the score is rolled back by the caller.
 */
export function genVARSeq(
  min:        number,
  scorer:     string | undefined,
  team:       string,
  ref:        { name: string },
  overturned: boolean,
): SequenceResult;

/**
 * Late-game siege sequence: 3-event all-out-attack push.  Fired once per
 * match by applyLateGameLogic() when a team is losing past minute 85.
 */
export function genSiegeSeq(
  min:        number,
  team:       string,
  defTeam:    string,
  clutchName: string,
): SequenceResult;

/**
 * Manager sent-off sequence: 4-event ejection.  Fired once per manager
 * per match when their emotion has reached 'angry' and a random roll hits.
 */
export function genManagerSentOffSeq(
  min:         number,
  managerName: string,
  refName:     string,
  team:        string,
): SequenceResult;

/**
 * Comeback sequence fired when a goal equalises after the scoring team
 * was 2+ goals behind.  Captain rallies teammates; team confidence +8.
 */
export function genComebackSeq(
  min:         number,
  scorer:      string | undefined,
  captainName: string | undefined,
  team:        string,
): SequenceResult;

/**
 * Counter-attack sequence: regain → break → support run → outcome.
 * Used for fast-transition shot events.
 */
export function genCounterSeq(
  min:            number,
  counterPlayer:  string,
  counterGk:      string,
  counterTeam:    string,
  supportPlayer:  string,
): SequenceResult;

/**
 * Confrontation sequence: foul aftermath when both players' tempers flare.
 * `addCard` indicates whether a card was already issued for the foul itself.
 */
export function genConfrontationSeq(
  min:           number,
  fouler:        string,
  fouled:        string,
  ref:           { name: string },
  addCard:       boolean,
  foulerAgent?:  PlayerAgent,
  fouledAgent?:  PlayerAgent,
): SequenceResult;

/**
 * Near-miss sequence: build-up → shot → save/post.  Increments the
 * possessing team's near-miss counter in narrativeResidue.
 */
export function genNearMissSeq(
  min:     number,
  player:  string,
  gk:      string,
  posTeam: string,
  defTeam: string,
): SequenceResult;

/**
 * Penalty sequence: foul → ref decision → spot kick → outcome.
 * `cardType` is the card given for the foul; `aim` is the kicker's target.
 */
export function genPenaltySeq(
  min:      number,
  atk:      string,
  def:      string,
  team:     string,
  defTeam:  string,
  cardType: 'yellow' | 'red' | null,
  aim:      string | undefined,
  gk:       string,
  ctx?:     Record<string, unknown>,
): SequenceResult;

// ── Top-level event generator ─────────────────────────────────────────────────

/**
 * Per-team AI influence bag returned by `aim.getDecisionInfluence()`.
 * Each side's record carries decision-bias counts (e.g. SHOOT, ATTACK)
 * derived from the personality mix of the active XI.  genEvent reads
 * these to bias its event-branch roll — high SHOOT pushes toward shots,
 * high ATTACK pushes toward attacking transitions.
 *
 * The shape is open-ended (`Record<string, number>`) because the engine
 * adds bias keys over time as new personalities are introduced; pinning
 * the keys would force a `.d.ts` update for every new agent type.
 */
export interface AIInfluence {
  home: Record<string, number>;
  away: Record<string, number>;
}

/** Generic context bag passed through to genEvent for flashpoint application. */
export type GenEventContext = Record<string, unknown>;

/**
 * The main per-minute event generator.  Produces a single event object that
 * may carry an embedded sequence array (penaltySequence, freekickSequence,
 * counterSequence, confrontationSequence, nearMissSequence) for the caller
 * to flatten via simulateHelpers.flattenSequences().
 *
 * Returns `null` for quiet minutes (no event fires).
 *
 * NOTE on positional argument order vs. naming:
 *   - `aiInfluence` (10th) is the per-team SHOOT/ATTACK bias bag (or null
 *     when no AI is driving the match — e.g. in tests).  genEvent guards
 *     against null with `if (aiInfluence) …`.
 *   - `aim` (11th) is the AIManager itself, used for agent lookup, late-game
 *     interventions, and getAgentByName() calls inside contest resolution.
 *     Required (the engine doesn't tolerate a null AIManager).
 */
export function genEvent(
  min:                number,
  homeTeam:           EngineTeam,
  awayTeam:           EngineTeam,
  momentum:           [number, number],
  possession:         number,
  playerStats:        PlayerStatsMap,
  score:              [number, number],
  activePlayers:      { home: string[]; away: string[] },
  substitutionsUsed:  { home: number; away: number },
  aiInfluence:        AIInfluence | null,
  aim:                AIManager,
  chaosLevel?:        number,
  lastEventType?:     string | null,
  genCtx?:            GenEventContext,
): MatchEvent | null;

// ── Social-feed flavour generator ─────────────────────────────────────────────

/**
 * Produce a satirical social-feed snippet for the given event.  Used by the
 * post-match summary screen to inject Architect-flavoured commentary into
 * the event log.  `ms` is the kickoff timestamp used to seed the post time.
 */
export function genSocial(event: MatchEvent, min: number, ms: number): string;
