// ── features/agents/types.ts ────────────────────────────────────────────────
// Shared types for the agents feature.  Phase 0 only populates the
// commentary-corpus surface; Phase 1 will add Persona, Memory, Snippet,
// and decision-layer types alongside these.

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
