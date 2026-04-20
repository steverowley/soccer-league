// ── features/match/types.ts ───────────────────────────────────────────────────
// Shared TypeScript interfaces for the match feature.
//
// WHY THIS FILE EXISTS
// ─────────────────────
// The match simulator (App.jsx + gameEngine.js) and the AI commentary system
// (AgentSystem) share many structural shapes that need to be typed once and
// imported by both.  Keeping them here — rather than inline in each module —
// avoids drift and makes the shapes discoverable.
//
// The IArchitect interface is defined here (not in the architect feature) so
// AgentSystem can accept a CosmicArchitect instance without a direct cross-
// feature import.  CosmicArchitect satisfies IArchitect structurally (duck
// typing) — no explicit `implements` is needed.

// ── Player (engine shape) ────────────────────────────────────────────────────
//
// The shape of a player as it arrives from normalizeTeamForEngine() in
// src/lib/supabase.js.  Only the fields read by AgentSystem are declared here;
// the engine uses additional numeric stat columns that don't affect commentary.

export interface MatchPlayer {
  /** Display name used in all event strings and feed items. */
  name: string;
  /** Position label e.g. 'GK', 'CB', 'ST'. */
  position: string;
  /** Squad number shown as "#N" in commentary. Optional — null/undefined = bare name. */
  jersey_number?: number;
  /** Open bag for any additional engine fields (stats, flags). */
  [key: string]: unknown;
}

// ── Team (engine shape) ──────────────────────────────────────────────────────

export interface MatchTeam {
  /** Full club name e.g. "Mars Athletic". */
  name: string;
  /** Short identifier used in event objects e.g. "mars". */
  shortName: string;
  /** Hex team colour used to tint feed items. */
  color: string;
  /** Full squad for the match (home/away combined by engine). */
  players: MatchPlayer[];
  /** Open bag for league, stadium, history fields. */
  [key: string]: unknown;
}

// ── Personnel ────────────────────────────────────────────────────────────────

export interface MatchReferee {
  name: string;
  /**
   * 0–100 leniency score.  >70 = lenient (hates stopping play, lets fouls go).
   * Drives the referee system-prompt style in generateRefDecision().
   */
  leniency: number;
  /**
   * 0–100 strictness score.  >70 = by-the-book zero tolerance.
   * When neither leniency nor strictness exceeds 70, style = pragmatic/inconsistent.
   */
  strictness: number;
}

export interface MatchManager {
  /** Display name used in touchline-reaction feed items. */
  name: string;
  /** Plain-English personality tag e.g. 'aggressive', 'calm'. Injected into system prompt. */
  personality: string;
  /** Current emotional state; varies during a match. Injected into decision prompts. */
  emotion?: string;
  /** Back-reference to the manager's team — used in generateManagerDecision(). */
  team?: { name: string };
  [key: string]: unknown;
}

// ── Agent (player AI state) ──────────────────────────────────────────────────
//
// Each active player has a corresponding agent object that tracks their
// psychological state during the match.  These are created by createAIManager()
// in App.jsx and passed to AgentSystem methods so commentary reflects the
// player's current mood, not just their static attributes.

export interface PlayerAgent {
  /** The underlying squad player object. */
  player: MatchPlayer;
  /** True if this player belongs to the home team. */
  isHome: boolean;
  /**
   * 0–100 confidence level.  High confidence → bold inner thoughts.
   * Low confidence → self-doubt and hesitation.
   */
  confidence?: number;
  /**
   * 0–100 fatigue level.  Injected into player-thought prompts so the LLM
   * can express tiredness in the final stretch of a match.
   */
  fatigue?: number;
  /** Current emotional state string e.g. 'elated', 'frustrated', 'neutral'. */
  emotion?: string;
  /**
   * Personality key (one of the 8 archetypes from PERS_DESC).
   * Controls the system-prompt injected for player inner thoughts.
   */
  personality?: string;
  /**
   * Running form score; higher = performing well recently.
   * Used by CosmicArchitect.maybeUpdate() to select spotlight players.
   */
  form?: number;
  [key: string]: unknown;
}

// ── Match events ─────────────────────────────────────────────────────────────
//
// Events are produced by genEvent() in gameEngine.js and passed to
// AgentSystem.queueEvent().  Only the fields read by commentary logic are
// declared; the engine adds many additional fields for simulation purposes.

export interface MatchEvent {
  /** Event type key e.g. 'goal', 'foul', 'injury', 'team_talk', 'penalty_kick'. */
  type?: string;
  /** Primary player name (event subject). */
  player?: string;
  /** Opposing player name (for tackles, duels, confrontations). */
  defender?: string;
  /** Name of the fouling player for card events. */
  foulerName?: string;
  /** Assisting player name for goal events. */
  assister?: string;
  /** Outcome descriptor e.g. 'saved', 'miss', 'goal'. */
  outcome?: string;
  /** Team short-name of the acting team (matches MatchTeam.shortName). */
  team?: string;
  /** True when the event resulted in a goal being credited. */
  isGoal?: boolean;
  /** 'yellow' | 'red' when a card was issued. */
  cardType?: string;
  /** True when the decision is disputed (e.g. after a VAR review). */
  isControversial?: boolean;
  /** True for injury events. */
  isInjury?: boolean;
  /** Human-readable procedural description from the engine. */
  commentary?: string;
  /** Match minute when this event occurred. */
  minute?: number;

  // ── Architect interference flags ──────────────────────────────────────────
  // Set by the engine when the Architect has touched this event.  Characters
  // react with confusion/disbelief — they have no knowledge of the cosmic cause.

  /** Goal was cancelled by Architect intervention. */
  architectAnnulled?: boolean;
  /** Outcome was forced by Architect (e.g. force_red_card, phantom_foul). */
  architectForced?: boolean;
  /** Goal was conjured from nothing by the Architect. */
  architectConjured?: boolean;
  /** Goal was attributed to the wrong team by the Architect. */
  architectStolen?: boolean;
  /** A prior near-miss was replayed as a goal by the Architect. */
  architectEcho?: boolean;
  /** Goal was overturned by VAR (independent of Architect). */
  isVAROverturned?: boolean;

  [key: string]: unknown;
}

export interface GameState {
  /** [homeGoals, awayGoals] */
  score: [number, number];
  /** Current match minute (0–90+). */
  minute: number;
  [key: string]: unknown;
}

// ── Feed items (commentary output) ───────────────────────────────────────────
//
// Every AI-generated response is returned as a feed item that the UI renders
// in the commentary column.  The `type` discriminant drives rendering.

export interface BaseFeedItem {
  type: string;
  name: string;
  emoji: string;
  color: string;
  text: string;
  minute: number;
}

/** Captain Vox play-by-play narration. Supports streaming via isStreaming flag. */
export interface PlayByPlayItem extends BaseFeedItem {
  type: 'play_by_play';
  commentatorId: 'captain_vox';
  role: string;
  /** Stable ID for in-place streaming updates via play_by_play_update messages. */
  id?: string;
  /** True while tokens are still arriving; renderer shows a blinking cursor. */
  isStreaming?: boolean;
}

/**
 * Streaming token patch for a play_by_play item.
 * The `id` matches the PlayByPlayItem.id so the UI can update in place.
 * isStreaming=false on the final update signals the stream is complete.
 */
export interface PlayByPlayUpdateItem {
  type: 'play_by_play_update';
  id: string;
  text: string;
  isStreaming?: boolean;
}

/** Reaction from Nexus-7 or Zara Bloom. */
export interface CommentatorItem extends BaseFeedItem {
  type: 'commentator';
  commentatorId: string;
  role: string;
}

/** Inner thought from a player's perspective. */
export interface PlayerThoughtItem extends BaseFeedItem {
  type: 'player_thought';
  /** Used to look up team colour for the feed card. */
  isHome: boolean;
}

/** Touchline reaction from the home or away manager. */
export interface ManagerItem extends BaseFeedItem {
  type: 'manager';
  isHome: boolean;
}

/** Referee justification for a card or controversial call. */
export interface RefereeItem extends BaseFeedItem {
  type: 'referee';
}

/** The Architect's in-match Proclamation — dark, poetic, cosmic. */
export interface ArchitectProclamationItem extends BaseFeedItem {
  type: 'architect_proclamation';
  narrativeArc: string;
  featuredMortals: string[];
  cosmicThread: string;
}

export type FeedItem =
  | PlayByPlayItem
  | PlayByPlayUpdateItem
  | CommentatorItem
  | PlayerThoughtItem
  | ManagerItem
  | RefereeItem
  | ArchitectProclamationItem;

// ── Commentator profile ───────────────────────────────────────────────────────

/**
 * Static definition of an on-air commentator persona.
 * Three profiles exist: captain_vox, nexus7, zara_bloom.
 * Each profile's `system` prompt shapes all LLM responses for that voice.
 */
export interface CommentatorProfile {
  /** Stable identifier used as the history map key in AgentSystem. */
  id: string;
  /** Display name shown in feed cards. */
  name: string;
  /** Emoji icon shown beside the commentator name. */
  emoji: string;
  /** Role label e.g. 'Play-by-Play', 'AI Analyst', 'Color Analyst'. */
  role: string;
  /** Hex colour used to tint this commentator's feed cards. */
  color: string;
  /** Full system prompt that establishes the voice, style, and constraints. */
  system: string;
}

// ── Architect interface (IArchitect) ──────────────────────────────────────────
//
// AgentSystem accepts this interface rather than a concrete CosmicArchitect
// instance. This decouples the match feature from the architect feature —
// CosmicArchitect satisfies IArchitect by structural (duck) typing so App.jsx
// can pass it in without any cross-feature import in AgentSystem itself.
//
// CRITICAL CONSTRAINT: getContext() MUST remain synchronous.  It is called
// on every LLM prompt and can fire 5–10 times in <500 ms during a goal burst.
// Blocking it on a Supabase round-trip would stall all commentary.

export interface IArchitect {
  /**
   * Compact multi-line context string injected into every AgentSystem prompt.
   * Includes rivalry lore, the current narrative arc, the primary featured
   * mortal, the active cosmic edict, sealed fate, and active intentions.
   * Returns '' if no Proclamation has been issued yet.
   * MUST be synchronous.
   */
  getContext(): string;

  /**
   * Returns the combined character arc for a specific player:
   * cross-match lore arc + what has been written for them this match.
   * Returns '' if no arc has been recorded.
   */
  getCharacterArc(playerName: string): string;

  /**
   * Returns the names of the up-to-2 players currently spotlighted by the
   * Architect.  AgentSystem uses this to apply tier promotion — minor events
   * involving featured mortals are bumped to 'medium' so they get more voices.
   */
  getFeaturedMortals(): string[];
}

// ── AgentSystem constructor context ──────────────────────────────────────────

export interface AgentMatchContext {
  homeTeam: MatchTeam;
  awayTeam: MatchTeam;
  referee: MatchReferee;
  homeManager: MatchManager;
  awayManager: MatchManager;
  homeTactics: string;
  awayTactics: string;
  /** Stadium metadata injected into match context strings. */
  stadium: { name: string; planet?: string; capacity?: number } | null;
  /** Weather condition string from the WX constants in constants.js. */
  weather: string;
  /**
   * Optional CosmicArchitect (or any IArchitect-compatible object).
   * When present, its context is appended to every prompt and featured mortals
   * receive tier promotion in _processEventDirect.
   */
  architect?: IArchitect | null;
}

// ── CosmicArchitect constructor context ──────────────────────────────────────
//
// Subset of AgentMatchContext — the Architect doesn't need referee or tactics.

export interface ArchitectMatchContext {
  homeTeam: MatchTeam;
  awayTeam: MatchTeam;
  homeManager: MatchManager;
  awayManager: MatchManager;
  stadium: { name: string; planet?: string } | null;
  weather: string;
}
