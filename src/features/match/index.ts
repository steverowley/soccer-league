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
export { AgentSystem } from './logic/AgentSystem';

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

// ── Match event type (shared, engine-independent) ─────────────────────────
// The persisted match_events shape, consumed by the interference resolver and
// the spatial adapter.  Extracted here after the legacy simulateFullMatch /
// gameEngine.js were deleted (#389).
export type { SimulatedEvent } from './logic/simEvent';

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

// ── UI — canvas match viewer (Tiny Terraces pixel-art) ─────────────────────
// The MatchDetail page renders <MatchViewer> beside the LiveCommentary feed for
// in_progress / scheduled matches.  It replays the spatial engine's
// `match_positions` frames as animated little dudes on a to-scale pitch, with an
// in-game broadcast ⇄ follow camera toggle.  PitchSurface is kept because the
// MiniPitch chip on the Matches list still renders the static SVG surface.
export { MatchViewer } from './ui/viewer/MatchViewer';
export type { MatchViewerProps, MatchViewerPlayer } from './ui/viewer/MatchViewer';
// Always-available admin showcase: a looping synthetic match in the viewer.
export { MatchViewerDemo } from './ui/viewer/MatchViewerDemo';
export { PitchSurface } from './ui/pitch/PitchSurface';

// ── Mini-pitch chip + shared broadcast hook (issue isl-a8i) ───────────────
// MiniPitch is a tiny pitch preview for the Matches list page that
// shows a live match's ball position in ~100px width.  It subscribes
// via useMatchEventLatest, which opens ONE shared Realtime channel
// regardless of how many MiniPitch chips mount on the page — see
// the isl-a8i acceptance criterion.
export { MiniPitch } from './ui/pitch/MiniPitch';
export type { MiniPitchProps } from './ui/pitch/MiniPitch';
export { useMatchEventLatest } from './ui/pitch/useMatchEventsBroadcast';

// ── League standings (Supabase-backed) ────────────────────────────────────
// Replaces the legacy localStorage-based `computeStandings` in
// `src/lib/matchResultsService.ts`.  Reads completed `matches` rows joined
// to `competitions` filtered by `league_id`, aggregates W/D/L/Pts/GD per
// team, and returns the same `StandingsRow` shape the UI already consumes.
export { fetchLeagueStandings } from './api/standings';
export type { StandingsRow as LeagueStandingsRow } from './api/standings';

// ── Match-detail fetch + list reads ───────────────────────────────────────
// Originally in `src/lib/supabase.ts` as singleton-consuming functions;
// #387 slices 1 + 2 moved them behind the typed-client DI pattern.
// Future call sites should import from this barrel.
export {
  getMatch,
  getLiveMatches,
  getUpcomingMatches,
} from './api/matches';

// ── Teams + roster reads (#387 slice 4) ───────────────────────────────────
export {
  getTeams,
  getTeam,
  getPlayersForTeam,
} from './api/teams';

// ── Player + manager detail reads (#387 slice 5) ──────────────────────────
export { getPlayer } from './api/players';
export {
  getManager,
} from './api/managers';
export type {
  ManagerWithContext,
} from './api/managers';

// ── Idol leaderboard reads (#387 slice 6) ─────────────────────────────────
export {
  getIdolBoard,
  getPlayerIdolRank,
  getTopIdolsForArchitect,
} from './api/idols';
export type {
  IdolRow,
  IdolBoardResult,
  TopIdolForArchitect,
} from './api/idols';

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

// ── Spatial position playback ──────────────────────────────────────────────
// `getMatchPositions` fetches the pre-computed `match_positions` frames; the
// canvas <MatchViewer> replays them, interpolating between the 2-second snaps.
export { getMatchPositions } from './api/matchPositions';
export type { PositionSnapshot } from './api/matchPositions';

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
  getActiveSeason,
} from './api/seasons';
export type { SeasonSummary } from './api/seasons';

// ── Automatic season rollover (#568) ───────────────────────────────────────
// Idempotent "create season N+1" engine: deactivates the prior season, inserts
// the next active season, and builds its 4 league competitions + round-robin
// fixtures (real-dated, worker-claimable), 2 empty cup shells, and per-team
// focus_options.  Consumed by the rollover CLI and the enact-due-seasons job.
export { rolloverSeason } from './api/seasonRollover';
export type { RolloverResult, RolloverOptions } from './api/seasonRollover';
