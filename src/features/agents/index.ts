// ── features/agents/index.ts ────────────────────────────────────────────────
// Public barrel for the agent system.  Cross-feature imports MUST come
// through this file — never reach into `logic/` or `api/` directly.  This
// is the boundary that `eslint no-restricted-imports` enforces for every
// other feature and the convention will be applied here from day one so
// future phases (memory write path, decision resolvers, enricher) can be
// added without callers needing to update their import paths.
//
// Phase 0 surface: only the commentary corpus.  Phase 1+ adds persona,
// memory, snippet, and decision-layer exports alongside these.

// ── Types ───────────────────────────────────────────────────────────────────
// Shared shapes for commentary today; will be joined by Persona, Memory,
// Snippet, DecisionKind etc in Phase 1 once the schema migration lands.
export type {
  CommentaryActors,
  CommentaryContext,
  CommentaryFlavourSet,
  CommentaryOutcome,
  CommentaryPhase,
  CommentaryType,
} from './types';

// ── Logic — commentary corpus ───────────────────────────────────────────────
// Read-only template pools extracted from the legacy `gameEngine.js`.  The
// engine's `buildCommentary()` delegates here.  Re-exporting both the
// top-level entry point and the internal building blocks because tests
// (and the eventual Phase 1 snippet importer) need access to the pool
// builder and weirdness gate independently of the picker.
export {
  buildCommentaryPools,
  commentaryFlavourSet,
  commentaryPhase,
  maybePickWeirdness,
  pickCommentary,
} from './logic/commentaryCorpus';
export type { CommentaryPools } from './logic/commentaryCorpus';
