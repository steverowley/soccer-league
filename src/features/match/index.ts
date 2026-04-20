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
