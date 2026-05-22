// ── KEEP IN SYNC WITH supabase/functions/match-worker/gameEngine.types.ts ──────────
// Deno edge function deploys reject relative imports outside the function
// directory, so this file is duplicated from the canonical match-worker
// copy (isl-hhz).  Edits MUST be applied to BOTH places in lockstep.  When
// the duplication starts hurting, lift the shared engine into
// supabase/functions/_shared/match-engine/ and update both workers.
//
// To verify the two copies are in sync:
//   diff supabase/functions/match-worker/gameEngine.types.ts supabase/functions/shadow-match-worker/gameEngine.types.ts
// The diff should show ONLY this banner block — every other byte must match.

// ── gameEngine.types.ts ───────────────────────────────────────────────────────
// Type definitions for the match simulation engine.
// These types describe the engine's internal data structures (agents, managers,
// teams, players, events) without exposing the full gameEngine implementation.

import type { Personality, ManagerEmotion, WeatherCondition } from './constants.ts';

/** A player's stat line: the core attributes that drive contest resolution. */
export interface PlayerStats {
  attacking: number;    // shooting ability (35–95)
  defending: number;    // defensive strength (30–90)
  passing: number;      // distribution accuracy (40–92)
  dribbling: number;    // ball control & skill (25–90)
  speed: number;        // acceleration & top speed (30–92)
  stamina: number;      // work rate & fatigue resistance (35–95)
  strength: number;     // physical duels (25–90)
  positioning: number;  // tactical awareness (35–95)
  vision: number;       // creating chances (30–92)
  goalkeeping: number;  // save ability (40–95) — GK only
  aggression: number;   // foul frequency (30–90)
  mental: number;       // composure under pressure (35–95)
  technical: number;    // ball control in tight spaces (30–95)
  athletic: number;     // overall fitness (35–95)
}

/** A database player row normalized to the engine's camelCase format. */
export interface EnginePlayer extends PlayerStats {
  id: string;
  name: string;
  position: 'GK' | 'DF' | 'MF' | 'FW';
  age: number;
  number: number;
  starter: boolean;
}

/** A database team row normalized to the engine's format with rosters. */
export interface EngineTeam {
  id: string;
  name: string;
  /** Short identifier (e.g. "MAR", "VEN") used by gameEngine.js as the event
   *  `team` tag.  simulateFullMatch credits goals by matching `ev.team` against
   *  this field — it MUST be populated by normalizeTeamForEngine or every goal
   *  silently falls to the away column. */
  shortName: string;
  /** Team colour (CSS / hex) baked into every goal event's `animation.color`
   *  payload.  If absent, the renderer falls back to a neutral default and the
   *  goal-celebration UI loses its team identity. */
  color: string;
  /** Stadium object consumed by gameEngine.js `createAIManager`:
   *    `homeTeam.stadium || pick(STADIUMS)` → `PLANET_WX[stadium.planet]`
   *  Supplying this from the team's own DB row keeps the planet/weather
   *  correlation real; omitting it makes the engine pick a random stadium
   *  and therefore the wrong PLANET_WX distribution. */
  stadium: {
    name: string;
    planet: string;
    capacity: string;
  };
  homeGround: string;
  planet: string;
  players: EnginePlayer[];
  manager: {
    id: string;
    name: string;
    attacking: number;
    defending: number;
    mental: number;
    athletic: number;
    technical: number;
  };
}

/** An AI-driven agent representing a player's live state during the match. */
export interface Agent {
  player: EnginePlayer;
  isHome: boolean;
  personality: Personality;

  confidence: number;        // 0–100: affects shot accuracy & contest outcomes
  fatigue: number;           // 0–100: increments ~0.8–1.2 per minute
  form: number;              // cumulative performance modifier
  morale: number;            // team-level morale (affected by goals)

  emotion: 'neutral' | 'ecstatic' | 'proud' | 'frustrated' | 'anxious' | 'devastated';
  emotionIntensity: number;  // 0–100: how strong the emotion is
  emotionDuration: number;   // minutes until fades to neutral

  injuryRisk: number;        // 5/10/20% chance based on fatigue
  isCaptain: boolean;        // highest-mental player on each side
  isClutch: boolean;         // 15% of players: +14 bonus in 80th min+ with close score
  penaltyAbility: number;    // (mental + attacking) / 2 + random(0–20)

  // Methods
  getDecisionBonus(): number;
  updateFatigue(mins: number): void;
  updateConfidence(delta: number): void;
  updateEmotion(newEmotion: string, intensity: number, duration: number): void;
}

/** An AI manager driving substitutions, tactics, and emotional responses. */
export interface AIManager {
  id: string;
  name: string;
  emotion: ManagerEmotion;
  formation: '4-4-2' | '3-4-3' | '4-5-1' | '5-4-1';
  playStyle: 'offensive' | 'balanced' | 'defensive' | 'direct' | 'possession' | 'counterattacking' | 'high_pressing' | 'aggressive';

  attackingIntent: number;   // 0–100: how aggressive the team plays
  defensiveIntent: number;   // 0–100: how deep they sit

  team: EngineTeam;
  agents: Agent[];

  subs: Agent[];             // available substitutes
  subsMade: number;          // how many subs used (max 3)
  lastSubMinute: number;     // when was last substitution
}

/** A single match event that occurred during the 90-minute simulation. */
export interface MatchEvent {
  minute: number;            // 0–90 (0 = before kickoff)
  subminute: number;         // 0–59 for events within a minute
  type: string;              // 'goal', 'shot', 'foul', 'card', 'injury', etc.

  // Players involved
  playerId?: string;         // primary player in the event
  assistPlayerId?: string;   // for assists on goals

  // Event-specific data
  payload?: Record<string, unknown>;
}

/** The complete match simulation output. */
export interface SimulationResult {
  events: MatchEvent[];
  homeScore: number;
  awayScore: number;
  homeGoalScorers: string[];
  awayGoalScorers: string[];
  mvpName: string;
  weather: WeatherCondition;
  attendance: number;
}
