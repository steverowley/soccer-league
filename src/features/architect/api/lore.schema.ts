// ── features/architect/api/lore.schema.ts ────────────────────────────────
// Slice 5 of #386. Zod boundary validation for the architect_lore
// rows that hydrate the LoreStore at pre-match time and persist
// dirty entries at flush time.
//
// WHY THIS SLICE MATTERS
// ──────────────────────
// The Architect's `getContext()` must stay synchronous (CLAUDE.md
// engineering invariant 2) — it's called 5–10 times in <500ms during
// goal bursts, all reads served from the in-memory LoreStore. That
// store is populated by ONE pre-match round-trip through
// loadAllLore(). If a future migration adds a NOT NULL column or
// renames `scope`, every in-flight `getContext()` would silently get
// undefined values back from the lore lookup — degrading the
// Architect's narrative continuity without any error surface.
//
// With Zod at the boundary, the same drift surfaces as a warn-log +
// dropped row at hydration time, so the operator notices on the
// next match-worker log scan rather than after a season of muted
// architect output.

import { z } from 'zod';

// ── Row schema ────────────────────────────────────────────────────────────

/**
 * Full `architect_lore` row, mirroring
 * `Database['public']['Tables']['architect_lore']['Row']`. The
 * `payload` column is a jsonb catch-all — every (scope, key) pair
 * stores its own bespoke shape (player arcs, manager fate threads,
 * rivalry counters, etc.), so we accept any JSON-compatible value
 * here. Narrowing per-scope is the LoreStore's job, not the
 * api-boundary parser's.
 */
export const ArchitectLoreRowSchema = z.object({
  id:          z.string(),
  scope:       z.string(),
  key:         z.string(),
  payload:     z.unknown(),    // jsonb — narrow per-scope downstream
  updated_at:  z.string(),
});

export type ZodArchitectLoreRow = z.infer<typeof ArchitectLoreRowSchema>;

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Parse a single architect_lore row (returned by upsertLoreRow's
 * .single() call). Returns null + warn-log on drift so the caller's
 * existing null-handling path triggers.
 *
 * @param row  Raw row from `.single()`.
 * @param tag  Caller label for the warn-log prefix.
 */
export function parseArchitectLoreRow(
  row: unknown,
  tag: string,
): ZodArchitectLoreRow | null {
  if (row == null) return null;
  const parsed = ArchitectLoreRowSchema.safeParse(row);
  if (parsed.success) return parsed.data;
  console.warn(`[${tag}] malformed architect_lore row, returning null:`, parsed.error.issues);
  return null;
}

/**
 * Parse an array of architect_lore rows. Malformed entries warn-log
 * and drop; the LoreStore receives only valid rows. Drift therefore
 * degrades gracefully (fewer lore entries hydrated → some
 * narratives reset, but the match still plays) rather than crashing
 * the pre-match hydration phase.
 *
 * @param rows  Raw rows from `.select('*')`.
 * @param tag   Caller label for the warn-log prefix.
 */
export function parseArchitectLoreRows(
  rows: unknown[],
  tag:  string,
): ZodArchitectLoreRow[] {
  const out: ZodArchitectLoreRow[] = [];
  for (const row of rows) {
    const parsed = ArchitectLoreRowSchema.safeParse(row);
    if (parsed.success) {
      out.push(parsed.data);
    } else {
      console.warn(`[${tag}] dropped malformed architect_lore row:`, parsed.error.issues);
    }
  }
  return out;
}
