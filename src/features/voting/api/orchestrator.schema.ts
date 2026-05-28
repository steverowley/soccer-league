// ── features/voting/api/orchestrator.schema.ts ───────────────────────────
// Final slice of #386. Zod boundary validation for the three read surfaces
// inside `runElectionNight`:
//
//   players (id, name, team_id, nationality, position) → ActivePlayerRow
//   player_idol_score (player_id, global_rank)         → IdolRankRow
//   teams (id, name)                                   → TeamNameRow
//
// Drift-tolerant template mirrors focuses.schema.ts:
//   * `*Schema` exports the z.object definition.
//   * `parse*Rows` helpers warn-log + drop a malformed row so a column
//     rename never aborts the whole Election Night ceremony — the loop
//     proceeds with the remaining valid rows.
//
// Why DROP instead of THROW: Election Night writes irreversible
// audit + decree rows. An exception mid-ceremony would leave partial
// state on disk. Drop-and-warn lets the orchestrator's existing
// per-target try/catch handle the consequences gracefully.

import { z } from 'zod';

// ── Row schemas ───────────────────────────────────────────────────────────

/**
 * Subset of `players` rows the orchestrator reads via
 *   `.select('id, name, team_id, nationality, position').eq('is_active', true)`.
 *
 * `team_id`, `nationality`, `position` are all nullable per the public
 * schema — the orchestrator handles null `team_id` by excluding the player
 * from the candidate pool (a team-less player can't be incinerated under
 * a team banner) and null `position` / `nationality` by falling back to
 * neutral defaults inside the replacement-player builder.
 */
export const ActivePlayerRowSchema = z.object({
  id:          z.string(),
  name:        z.string(),
  team_id:     z.string().nullable(),
  nationality: z.string().nullable(),
  position:    z.string().nullable(),
});

/**
 * Subset of the `player_idol_score` view rows the orchestrator reads via
 *   `.select('player_id, global_rank')`.
 *
 * Both columns are nullable because the view LEFT-JOINs from players to
 * the aggregated idol vote tally — a player who has never been idol-voted
 * appears with null `global_rank`.  Rows with null `player_id` cannot be
 * matched back to a player row and are dropped at parse time.
 */
export const IdolRankRowSchema = z.object({
  player_id:    z.string().nullable(),
  global_rank:  z.number().int().nullable(),
});

/**
 * Subset of `teams` rows the orchestrator reads via `.select('id, name')`.
 *
 * Both columns are NOT NULL in the public schema — `teams.id` is the slug
 * PK and `teams.name` is the human-readable label rendered in decree text.
 */
export const TeamNameRowSchema = z.object({
  id:   z.string(),
  name: z.string(),
});

export type ZodActivePlayerRow = z.infer<typeof ActivePlayerRowSchema>;
export type ZodIdolRankRow     = z.infer<typeof IdolRankRowSchema>;
export type ZodTeamNameRow     = z.infer<typeof TeamNameRowSchema>;

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Parse a batch of `players` rows.  Drops malformed entries with a
 * warn-log so the candidate pool still includes every valid player.
 *
 * @param rows  Raw rows from `.select('id, name, ...').eq('is_active', true)`.
 * @param tag   Caller label for the warn-log prefix.
 */
export function parseActivePlayerRows(
  rows: unknown[],
  tag:  string,
): ZodActivePlayerRow[] {
  return parseArrayWith(ActivePlayerRowSchema, rows, tag, 'active_player');
}

/**
 * Parse a batch of `player_idol_score` view rows.  Drops malformed
 * entries — a missing global_rank for a single player just means that
 * player's idol-weighted draw weight falls back to the default.
 */
export function parseIdolRankRows(
  rows: unknown[],
  tag:  string,
): ZodIdolRankRow[] {
  return parseArrayWith(IdolRankRowSchema, rows, tag, 'idol_rank');
}

/**
 * Parse a batch of `teams` rows.  Drops malformed entries — a missing
 * team name falls back to "their team" in decree text via the
 * orchestrator's `teamDisplay()` helper, so a dropped row degrades the
 * ceremony gracefully.
 */
export function parseTeamNameRows(
  rows: unknown[],
  tag:  string,
): ZodTeamNameRow[] {
  return parseArrayWith(TeamNameRowSchema, rows, tag, 'team_name');
}

// ── Internal: shared array-parse template ────────────────────────────────

/**
 * Apply a Zod schema to every row in an array, dropping invalid rows
 * with a warn-log.  Shared by all three parse helpers so the
 * drop-and-keep semantics are identical across the surfaces.
 */
function parseArrayWith<S extends z.ZodTypeAny>(
  schema:    S,
  rows:      unknown[],
  tag:       string,
  rowLabel:  string,
): z.infer<S>[] {
  const out: z.infer<S>[] = [];
  for (const row of rows) {
    const parsed = schema.safeParse(row);
    if (parsed.success) {
      out.push(parsed.data);
    } else {
      console.warn(`[${tag}] dropped malformed ${rowLabel} row:`, parsed.error.issues);
    }
  }
  return out;
}
