// ── features/entities/api/entities.schema.ts ─────────────────────────────
// Slice 4 of #386. Zod boundary validation for the narrative rows the
// Architect's context-hydration path + the news feed read from
// Supabase. Same drift-tolerance pattern as the earlier slices:
// malformed rows warn-log and drop, valid rows pass through.
//
// WHY THE NARRATIVE TABLE MATTERS
// ───────────────────────────────
// `narratives` is the spine of the game's social surface. The
// Architect hydrates the most recent N rows into its context before
// every match; the NewsFeedPage and MatchDetail build-up panel both
// project from the same table. If a future migration renames
// `entities_involved` → `entity_ids`, the Architect would silently
// stop knowing who its lore is about — and the news feed would render
// untargeted headlines. Zod here makes that drift LOUD instead.

import { z } from 'zod';

// ── Source enum ───────────────────────────────────────────────────────────

/**
 * `narratives.source` values. Mirrors the union in entities/types.ts
 * (and the CHECK constraint in 0019_narratives.sql).
 *
 * - architect — Cosmic Architect post-match dispatches.
 * - match     — engine-emitted commentary lines (Vox / Nexus-7 / Zara).
 * - scheduled — galaxy-tick cron dispatches.
 * - manual    — admin-inserted rows; reserved for content moderation.
 */
export const NarrativeSourceSchema = z.enum([
  'architect',
  'match',
  'scheduled',
  'manual',
]);

// ── Row schema ────────────────────────────────────────────────────────────

/**
 * Full `narratives` row. `entities_involved` is a uuid[] in Postgres
 * but stringly-typed at the boundary because PostgREST serialises
 * it as a JSON array of strings — the entity ids themselves can be
 * slugs OR UUIDs depending on entity kind, so we don't constrain
 * the inner format here.
 *
 * `acknowledged_by` is the per-user read-receipt list (used by the
 * news feed to render "NEW" badges for unseen narratives).
 */
export const NarrativeSchema = z.object({
  id:                 z.string(),
  kind:               z.string(),
  summary:            z.string(),
  entities_involved:  z.array(z.string()),
  source:             NarrativeSourceSchema,
  created_at:         z.string(),
  acknowledged_by:    z.array(z.string()),
});

export type ZodNarrative = z.infer<typeof NarrativeSchema>;

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Parse an array of narrative rows. Malformed entries warn-log + drop;
 * the news feed / Architect-hydration path always receives a valid
 * subset rather than null. Drift in the underlying schema therefore
 * degrades gracefully (fewer rows shown) instead of crashing the
 * page or poisoning the Architect's in-memory context.
 *
 * @param rows  Raw rows from `.select('*')`.
 * @param tag   Caller label for the warn-log prefix.
 */
export function parseNarrativeRows(
  rows: unknown[],
  tag:  string,
): ZodNarrative[] {
  const out: ZodNarrative[] = [];
  for (const row of rows) {
    const parsed = NarrativeSchema.safeParse(row);
    if (parsed.success) {
      out.push(parsed.data);
    } else {
      console.warn(`[${tag}] dropped malformed narrative row:`, parsed.error.issues);
    }
  }
  return out;
}
