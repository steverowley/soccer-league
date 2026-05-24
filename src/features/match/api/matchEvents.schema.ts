// ── features/match/api/matchEvents.schema.ts ─────────────────────────────
// Slice 2 of #386. Zod boundary validation for the two shapes the
// live-match viewer reads from Supabase:
//
//   - MatchEventRow  — full event log row (read in bulk + via Realtime
//                      INSERT broadcasts).
//   - LiveMatchRow   — match row + nested home/away team metadata, the
//                      hand-built shape the viewer needs to paint the
//                      scoreline / meta header.
//
// WHY THIS SLICE MATTERS
// ──────────────────────
// MatchEvent rows arrive in two distinct paths:
//   1. The initial bulk fetch in getMatchEvents — known shape, table
//      row type from database.ts.
//   2. Realtime postgres_changes broadcasts in subscribeToMatchEvents —
//      same row shape, but routed through Supabase's broadcast wire,
//      which has historically had subtle shape drift (extra event-
//      metadata keys, missing payload, etc.). Validating both paths
//      with the same schema keeps the viewer's filter pipeline safe.
//
// LiveMatchRow is even more important because the nested team join
// (`teams!matches_home_team_id_fkey(...)`) is hand-typed; a future
// rename of `teams.home_ground` or `teams.location` would compile fine
// but break the viewer header at runtime. Zod catches that.

import { z } from 'zod';

// ── MatchEventRow schema ──────────────────────────────────────────────────

/**
 * Mirrors `Database['public']['Tables']['match_events']['Row']` from
 * the generated types. Validated at every read entry point in
 * matchEvents.ts (both the bulk SELECT and the Realtime INSERT
 * broadcast).
 *
 * `payload` is the catch-all jsonb column where each event type stores
 * its own bespoke fields. We accept any JSON-compatible value here —
 * narrowing by event-type discriminant is the renderer's job, not
 * the api-boundary parser's.
 */
export const MatchEventRowSchema = z.object({
  id:          z.string(),
  match_id:    z.string(),
  minute:      z.number().int().min(0),
  subminute:   z.number().int().min(0),
  type:        z.string(),
  payload:     z.unknown(),   // jsonb — narrow downstream by event type
  created_at:  z.string(),
});

export type ZodMatchEventRow = z.infer<typeof MatchEventRowSchema>;

// ── LiveMatchRow schema ───────────────────────────────────────────────────

/**
 * Inner team shape joined to both `home_team` and `away_team` columns.
 * Mirrors the field list inside the relational select in
 * getLiveMatch().
 *
 * Nullable string fields are tolerated (some are blank during early-
 * season fixture provisioning); the viewer renders fallbacks for
 * `null` rather than asserting they're present.
 */
const LiveMatchTeamSchema = z.object({
  id:           z.string(),
  name:         z.string(),
  short_name:   z.string().nullable(),
  color:        z.string().nullable(),
  home_ground:  z.string().nullable(),
  location:     z.string().nullable(),
});

/**
 * Full joined row shape returned by getLiveMatch().
 * PostgREST embeds the related rows as either an OBJECT or a
 * single-element array depending on cardinality detection. The
 * matchEvents.ts call site uses the canonical FK alias syntax so
 * the OBJECT path is what we expect, but the schema accepts both
 * via `z.union` to tolerate occasional array-shape regressions.
 */
export const LiveMatchRowSchema = z.object({
  id:             z.string(),
  status:         z.string(),
  home_score:     z.number().int().nullable(),
  away_score:     z.number().int().nullable(),
  scheduled_at:   z.string().nullable(),
  played_at:      z.string().nullable(),
  competition_id: z.string(),
  home_team:      LiveMatchTeamSchema,
  away_team:      LiveMatchTeamSchema,
});

export type ZodLiveMatchRow = z.infer<typeof LiveMatchRowSchema>;

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Parse a single match_events row. Returns null on validation failure
 * + warn-log so the Realtime listener can drop a malformed payload
 * without crashing the page.
 *
 * @param row  Raw row from Supabase (bulk or Realtime).
 * @param tag  Caller label for the warn-log prefix.
 */
export function parseMatchEventRow(
  row: unknown,
  tag: string,
): ZodMatchEventRow | null {
  if (row == null) return null;
  const parsed = MatchEventRowSchema.safeParse(row);
  if (parsed.success) return parsed.data;
  console.warn(`[${tag}] dropped malformed match_event row:`, parsed.error.issues);
  return null;
}

/**
 * Parse an array of match_events rows. Bad rows are dropped with a
 * warn-log; the array always contains only valid entries.
 */
export function parseMatchEventRows(
  rows: unknown[],
  tag:  string,
): ZodMatchEventRow[] {
  const out: ZodMatchEventRow[] = [];
  for (const row of rows) {
    const parsed = MatchEventRowSchema.safeParse(row);
    if (parsed.success) {
      out.push(parsed.data);
    } else {
      console.warn(`[${tag}] dropped malformed match_event row:`, parsed.error.issues);
    }
  }
  return out;
}

/**
 * Parse a single LiveMatchRow. Returns null on validation failure +
 * warn-log so the MatchDetail page renders the "Unknown Match"
 * fallback rather than a half-populated header.
 */
export function parseLiveMatchRow(
  row: unknown,
  tag: string,
): ZodLiveMatchRow | null {
  if (row == null) return null;
  const parsed = LiveMatchRowSchema.safeParse(row);
  if (parsed.success) return parsed.data;
  console.warn(`[${tag}] malformed live-match row, returning null:`, parsed.error.issues);
  return null;
}
