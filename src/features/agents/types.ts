// ── features/agents/types.ts ────────────────────────────────────────────────
// Shared types for the agents feature.  Phase 0 populated the
// commentary-corpus surface; Phase 1 adds Persona, Memory, Snippet, and
// retrieval-engine types backed by the 0035_voice_corpus migration.

import type { Tables, TablesInsert } from '@/types/database';

/** Event kind a commentary line covers — one per primary on-pitch action. */
export type CommentaryType = 'shot' | 'freekick' | 'penalty' | 'header' | 'tackle';

/**
 * Outcome of a commentary event.  Tackle uses (won|contested|lost); every
 * other type uses (goal|saved|miss|post).  Kept as a single union to keep
 * call sites simple — invalid pairs return an empty pool, surfaced via the
 * caller's fallback string.
 */
export type CommentaryOutcome = 'goal' | 'saved' | 'miss' | 'post' | 'won' | 'contested' | 'lost';

/** Match phase derived from the minute clock — controls phase-specific pools. */
export type CommentaryPhase = 'early' | 'midgame' | 'late' | 'dying';

/**
 * The two named participants in a commentary event.  Both are optional so
 * the function falls back to generic strings ("The player", "the keeper")
 * if the caller hasn't resolved a player identity.
 */
export interface CommentaryActors {
  attacker?: string;
  defender?: string;
}

/**
 * Boolean flavour flags derived from {@link CommentaryFlavour} string arrays.
 * Bundled as a struct so the picker doesn't repeat seven `.includes()` calls
 * for every event.
 */
export interface CommentaryFlavourSet {
  exhausted: boolean;
  clutch: boolean;
  anxious: boolean;
  ecstatic: boolean;
  confident: boolean;
  creative: boolean;
  lowConfidence: boolean;
}

/** Context object passed to commentary builders by `gameEngine.genEvent()`. */
export interface CommentaryContext {
  /** Match minute (1..90+).  Drives `CommentaryPhase` and dying-minute lines. */
  min: number;
  /** Goal difference from the acting player's perspective (positive = leading). */
  scoreDiff: number;
  /** Goals this acting player has scored in this match — unlocks on-fire / hat-trick lines. */
  playerGoals: number;
  /** True when the Architect has actively featured this player via an intention or sealed fate. */
  isArchitectFeatured: boolean;
}

// ── Voice corpus — Phase 1 types ────────────────────────────────────────────
// Shapes for the persisted voice corpus introduced by migration 0035.  The
// corpus generalises the Phase 0 in-engine template pools to every entity:
// each agentic entity has a persona (stable anchor), a stream of memories
// (structured facts), and a snippet library (text fragments) that the
// composer slot-fills into user-facing narratives.

/** Row shape of `entity_persona`, sourced from generated database types. */
export type PersonaRow = Tables<'entity_persona'>;
/** Insert payload for `entity_persona`. */
export type PersonaInsert = TablesInsert<'entity_persona'>;

/** Row shape of `entity_memories`. */
export type MemoryRow = Tables<'entity_memories'>;
/** Insert payload for `entity_memories`. */
export type MemoryInsert = TablesInsert<'entity_memories'>;

/** Row shape of `entity_snippets`. */
export type SnippetRow = Tables<'entity_snippets'>;
/** Insert payload for `entity_snippets`. */
export type SnippetInsert = TablesInsert<'entity_snippets'>;

/** Row shape of `agent_runs`. */
export type AgentRunRow = Tables<'agent_runs'>;

/**
 * Snippet kinds — controlled vocabulary used for `entity_snippets.kind`.
 * Kept open in the SQL schema (no CHECK constraint) so future kinds can
 * be introduced without a migration; the TS union exists for call-site
 * autocompletion.  Each kind maps to a different narrative role:
 *
 *   quote       — direct quotation attributable to the entity
 *   observation — third-person observation by or about the entity
 *   lament      — sorrowful reflection
 *   boast       — celebratory self-reference
 *   rumour      — unverified claim (journalists / bookies)
 *   prediction  — forward-looking statement
 *   taunt       — directed at a subject entity
 *   eulogy      — said about a retired or incinerated entity
 *   journal     — player's training-note style entry
 */
export type SnippetKind =
  | 'quote'
  | 'observation'
  | 'lament'
  | 'boast'
  | 'rumour'
  | 'prediction'
  | 'taunt'
  | 'eulogy'
  | 'journal';

/**
 * Operation classifications recorded into `agent_runs.kind`.  The first
 * four denote LLM calls (and have token counts); `corpus_hit` and
 * `corpus_miss` denote retrieval outcomes (token counts are zero) and
 * are used to compute the cache-hit-rate metric that gates Phase 5
 * cost claims.
 */
export type AgentRunKind =
  | 'enrich'        // corpus-enricher generated new snippets
  | 'drama'         // drama-tick generated a world-changing event
  | 'persona_seed'  // personaFactory generated voice_paragraph+core_quotes
  | 'decision'      // decision resolver consulted the LLM
  | 'corpus_hit'    // retrieval served a cached snippet (no LLM)
  | 'corpus_miss';  // retrieval found no match; LLM fallback fired

/**
 * Arguments to {@link pickSnippet} in `logic/corpus.ts`.  All filters are
 * AND-combined; the picker may still return null if no candidate matches.
 */
export interface PickSnippetArgs {
  /** Which entity's library to draw from. */
  entityId: string;
  /** Snippet kind to filter by (quote / observation / boast / …). */
  kind: SnippetKind;
  /**
   * Tags the served snippet must overlap with at least one of.  An empty
   * or omitted array means "any tag accepted" — the picker still filters
   * by entity+kind but doesn't gate on context.
   */
  contextTags?: readonly string[];
  /**
   * Subjects the served snippet may not reference.  Used to dedupe within
   * a session ("don't quote Vex-9 again on this news refresh").
   */
  excludeSubjects?: readonly string[];
  /**
   * Specific snippet IDs to skip.  Used to dedupe within a single
   * composition that picks N snippets in sequence.
   */
  excludeIds?: readonly string[];
  /**
   * Optional valence preference (-2..+2).  When set, snippets with a
   * matching valence get a small score boost; mismatches do NOT exclude.
   */
  preferValence?: number;
}

/** Result of {@link pickSnippet}.  Null when no candidate met the filters. */
export interface PickSnippetResult {
  /** The chosen snippet row. */
  snippet: SnippetRow;
  /** The score the picker assigned (kept for debugging + telemetry). */
  score: number;
}

/**
 * Slot map passed to {@link composeNarrative}.  Each `${key}` placeholder
 * in the skeleton string is replaced with the matching value; undefined /
 * null slots collapse to an empty string so a missing slot never renders
 * literal "${undefined}" in user-visible text.
 */
export type ComposeSlots = Record<string, string | number | undefined | null>;

/** Arguments to {@link composeNarrative}. */
export interface ComposeNarrativeArgs {
  /** Template string with `${name}` placeholders matching keys in `slots`. */
  skeleton: string;
  /** Slot values keyed by placeholder name. */
  slots: ComposeSlots;
}
