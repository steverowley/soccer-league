// ── feature: match ──────────────────────────────────────────────────────────
// WHY: The match feature owns the complete lifecycle of a single fixture —
// from pre-match odds computation through minute-by-minute simulation to
// result persistence and the `match.completed` event that triggers downstream
// systems (betting settlement, fan-boost accounting, Architect reaction).
//
// What lives here (Phase -1 moves existing code into these paths):
//   - `logic/engine.ts`      — the full match simulator (ported from
//     `src/gameEngine.js`, 1100+ LOC). Handles 13+ event types, personality-
//     driven contests, weather, momentum, tension curves, multi-step sequences
//     (penalties, freekicks, sieges, counters). PURE TypeScript — no React,
//     no Supabase. Fully unit-testable in isolation.
//   - `logic/commentary.ts`  — AI commentary personas (Captain Vox, Nexus-7,
//     Zara Bloom). Ported from `src/agents.js` (~lines 1–1362).
//   - `api/matches.ts`       — Supabase reads/writes for `matches` +
//     `match_player_stats`, wrapped in Zod schemas. Replaces
//     `src/lib/matchResultsService.js`.
//   - `ui/`                  — Match page components (ported from
//     `src/components/MatchComponents.jsx`).
//
// Critical invariant (NEVER violate):
//   `src/gameEngine.js` consumes player data in camelCase shape produced by
//   `normalizeTeamForEngine()` in `src/lib/supabase.js:381–437`. The engine
//   reads `attacking`, `defending`, `mental`, `athletic`, `technical`,
//   `jersey_number`, and `starter` directly. These columns must never be
//   dropped from the `players` table — even after the Phase 5 entity migration
//   adds an `entity_id` FK.
//
// Cross-feature wiring:
//   - Emits `match.completed` on the event bus when a result is persisted.
//   - Calls `profiles.last_seen_at` query (auth feature) at kickoff for the
//     fan-support boost (Phase 3).
//   - Consumes `architect_lore` pre-hydration before starting the sim loop
//     (Phase 5.1).
//
// STATUS: scaffold only — Phase -1 moves existing code here; subsequent phases
//   extend the feature.

// ── AgentSystem (AI commentary dispatcher) ────────────────────────────────
export { AgentSystem, COMMENTATOR_PROFILES } from './logic/AgentSystem';

// ── Shared match types ────────────────────────────────────────────────────
export type {
  MatchPlayer,
  MatchTeam,
  MatchReferee,
  MatchManager,
  PlayerAgent,
  MatchEvent,
  GameState,
  FeedItem,
  CommentatorProfile,
  IArchitect,
  AgentMatchContext,
  ArchitectMatchContext,
} from './types';

// ── Cup bracket draw (pure logic) ─────────────────────────────────────────
export { drawSingleElim } from './logic/cupDraw';
export type {
  BracketTeam,
  StoredBracket,
  StoredBracketRound,
  StoredBracketMatch,
} from './logic/cupDraw';

// ── Cup seeder + round advancer (DB layer) ────────────────────────────────
export {
  seedCupCompetitions,
  advanceCupRound,
  CELESTIAL_CUP_COMPETITION_ID,
  SOLAR_SHIELD_COMPETITION_ID,
} from './api/cupSeeder';
export type {
  SeedCupResult,
  SeedSeasonCupsResult,
  AdvanceCupRoundResult,
} from './api/cupSeeder';

// ── Full-match simulation (pure orchestrator, Package 10) ─────────────────
export { simulateFullMatch } from './logic/simulateFullMatch';
export type {
  SimulatedMatchResult,
  SimulatedEvent,
} from './logic/simulateFullMatch';

// ── Pitch view primitives (issue isl-doe) ─────────────────────────────────
// Pure-logic foundation for the 2D top-down pitch view.  Formation slot
// tables, engine-event → movement-archetype mapping, and the PitchState
// shape with an idle-drift convergence step.  No UI, no DB — every other
// pitch-view issue (2/6 onward) sits on top of these primitives.
export {
  FORMATIONS,
  getFormationSlots,
  isFormationKey,
} from './logic/pitch/formations';
export type {
  FormationKey,
  PitchPoint,
  Side as PitchSide,
} from './logic/pitch/formations';

export {
  ARCHETYPES,
  eventToArchetype,
  listMappedEventTypes,
} from './logic/pitch/archetypes';
export type { Archetype } from './logic/pitch/archetypes';

export {
  IDLE_DRIFT_EPSILON,
  IDLE_DRIFT_RATE,
  idleDriftStep,
  initPitchState,
} from './logic/pitch/pitchState';
export type {
  BallDot,
  PitchPhase,
  PitchState,
  PlayerDot,
} from './logic/pitch/pitchState';

// ── UI — pitch view (issue isl-5b6) ────────────────────────────────────────
// Static SVG composition of the pitch surface + 22 dots + ball in the
// 4-4-2 rest state.  The MatchDetail page renders this in a 2-column
// layout beside the LiveCommentary feed for in_progress / scheduled
// matches; completed matches keep the current commentary-only layout.
// Animation lands in the next pitch-view issue (3/6, isl-lfo).
export { PitchView } from './ui/pitch/PitchView';
export type { PitchViewProps } from './ui/pitch/PitchView';
export { PitchSurface } from './ui/pitch/PitchSurface';

// ── League standings (Supabase-backed) ────────────────────────────────────
// Replaces the legacy localStorage-based `computeStandings` in
// `src/lib/matchResultsService.ts`.  Reads completed `matches` rows joined
// to `competitions` filtered by `league_id`, aggregates W/D/L/Pts/GD per
// team, and returns the same `StandingsRow` shape the UI already consumes.
export { fetchLeagueStandings } from './api/standings';
export type { StandingsRow as LeagueStandingsRow } from './api/standings';

// ── Live match — data layer only ───────────────────────────────────────────
// MatchLivePage + MatchBuildUp UIs were removed in the 2026-05 nuke; the
// pure elapsed-minute helpers and the Supabase + Realtime client stay
// because they remain useful for the rebuilt match surfaces.
export {
  computeElapsedGameMinute,
  filterEventsByElapsedMinute,
} from './logic/elapsedMinute';
export {
  getLiveMatch,
  getMatchEvents,
  getMatchDurationSeconds,
  subscribeToMatchEvents,
  DEFAULT_MATCH_DURATION_SECONDS,
} from './api/matchEvents';
export type {
  LiveMatchRow,
  MatchEventRow,
} from './api/matchEvents';

// ── Per-player surfaces (powers /players/:playerId) ───────────────────────
// Recent appearances + narrative mentions for the Player Detail page.
// Pulled into the feature barrel so the page (and any future surface
// rendering a player's match log) imports from the feature root rather
// than reaching into a deep API path.
export {
  getPlayerRecentMatches,
  getNarrativesMentioningPlayer,
} from './api/playerStats';
export type {
  PlayerRecentMatch,
  NarrativeMention,
} from './api/playerStats';

// ── Cup bracket — listener stays, visual bracket UI removed ────────────────
// CupBracket (visual) was removed in the 2026-05 nuke and will be rebuilt.
// CupRoundAdvancerListener stays — pure side-effect listener that fills
// bracket winners + inserts next-round fixtures on `match.completed`.
export { CupRoundAdvancerListener } from './ui/CupRoundAdvancerListener';

// ── Season lifecycle (Package 13) ──────────────────────────────────────────
// Pure helpers + DB layer for the seasons.status state machine.  The match
// worker drives the active → voting → enacted transitions; admin tooling
// will surface the same helpers from the UI layer in Package 14.
export {
  isSeasonComplete,
  nextStatus,
} from './logic/seasonLifecycle';
export type {
  LeagueFixtureCounts,
  SeasonStatus,
} from './logic/seasonLifecycle';
export {
  getSeasonStatus,
  getLeagueFixtureCountsForSeason,
  transitionSeasonStatus,
  getSeasonIdForMatch,
  listAllSeasons,
  getSeasonSummary,
} from './api/seasons';
export type { SeasonSummary } from './api/seasons';
