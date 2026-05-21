// ── features/agents/index.ts ────────────────────────────────────────────────
// Public barrel for the agent system.  Cross-feature imports MUST come
// through this file — never reach into `logic/` or `api/` directly.  This
// is the boundary that `eslint no-restricted-imports` enforces for every
// other feature and the convention is applied here from day one so future
// phases (memory write path, decision resolvers, enricher) can be added
// without callers needing to update their import paths.
//
// Surface by phase:
//   Phase 0 — commentary corpus (`pickCommentary`, pool builders).
//   Phase 1 — persona / memory / snippet types + retrieval + composer.
//   Phase 2+ — memory writer, decision resolvers, enricher (TBD).

// ── Types ───────────────────────────────────────────────────────────────────
// Shared shapes for commentary + voice corpus.  Decision-layer types
// (DecisionKind, …) will be added in Phase 6.
export type {
  AgentRunInsert,
  AgentRunKind,
  AgentRunRow,
  CommentaryActors,
  CommentaryContext,
  CommentaryFlavourSet,
  CommentaryOutcome,
  CommentaryPhase,
  CommentaryType,
  ComposeNarrativeArgs,
  ComposeSlots,
  MemoryInsert,
  MemoryRow,
  PersonaInsert,
  PersonaRow,
  PickSnippetArgs,
  PickSnippetResult,
  SnippetInsert,
  SnippetKind,
  SnippetRow,
} from './types';

// ── Logic — commentary corpus (Phase 0) ─────────────────────────────────────
// Read-only template pools extracted from the legacy `gameEngine.js`.  The
// engine's `buildCommentary()` delegates here.  Re-exporting both the
// top-level entry point and the internal building blocks because tests
// (and the eventual Phase 5 snippet importer) need access to the pool
// builder and weirdness gate independently of the picker.
export {
  buildCommentaryPools,
  commentaryFlavourSet,
  commentaryPhase,
  maybePickWeirdness,
  pickCommentary,
} from './logic/commentaryCorpus';
export type { CommentaryPools } from './logic/commentaryCorpus';

// ── Logic — voice corpus retrieval + composition (Phase 1) ─────────────────
// Pure, sync, no I/O.  Caller hydrates the snippet pool via api/snippets
// then asks `pickSnippet` for the best match and `composeNarrative` to
// slot-fill a template skeleton.
export { pickSnippet, scoreSnippet } from './logic/corpus';
export { composeNarrative, slotNames } from './logic/composer';

// ── API — Supabase queries (Phase 1) ────────────────────────────────────────
// Cross-feature consumers should hit these via the barrel rather than
// reaching into `api/*` directly.
export {
  bumpSnippetUsage,
  insertSnippet,
  listSnippetsForEntity,
} from './api/snippets';
export {
  bumpMemoryConsumed,
  insertMemory,
  listMemoriesForEntity,
} from './api/memories';
export {
  getPersona,
  listPersonasForEntities,
  upsertPersona,
} from './api/personas';
export { logAgentRun } from './api/agentRuns';

// ── Logic — memory writer (Phase 2) ─────────────────────────────────────────
// Pure mappings from bus payloads to entity_memories rows.  Consumed by
// the client-side MemoryWriteListener AND by the server-side
// supabase/functions/match-worker/writeMatchMemories.ts (duplicated TS
// because edge functions can't reach into src/).
export {
  ARCHITECT_TOUCHED_SALIENCE,
  buildArchitectMemories,
  buildMatchCompletionMemories,
  buildSeasonEndedMemories,
  LOPSIDED_SCORE_DELTA,
  MATCH_RESULT_SALIENCE,
  SEASON_CONCLUDED_SALIENCE,
} from './logic/memoryWriter';
export type { MatchCompletionContext } from './logic/memoryWriter';

// ── UI — bus listener (Phase 2) ─────────────────────────────────────────────
// Side-effect React component mounted once at the app root.  Subscribes
// to match.completed / season.ended / architect.intervened and writes
// the resulting memory rows.  Renders null.
export { MemoryWriteListener } from './ui/MemoryWriteListener';
