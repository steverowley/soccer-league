// ── features/voting/api/focuses.schema.ts ────────────────────────────────
// Slice 3 of #386. Zod boundary validation for the three voting read
// surfaces in focuses.ts:
//
//   - getTeamFocusOptions → FocusOption[]   (focus_options table)
//   - castVote             → FocusVote      (focus_votes table, insert returns)
//   - getTeamTally         → FocusTallyEntry[] (focus_tally view)
//
// Same pattern as wagers.schema / matchEvents.schema:
//   * `*Schema` exports the z.object definition.
//   * `parse*` helpers warn-log + drop (array) or return null (single)
//     so a column rename never lands as a half-rendered UI panel.

import { z } from 'zod';

// ── Tier enum ─────────────────────────────────────────────────────────────

/**
 * `focus_options.tier` CHECK values. Two-tier voting:
 *   major — one high-impact focus per team per season (sign a star,
 *           stadium upgrade, etc.).
 *   minor — one low-impact focus per team per season (preseason
 *           camp, youth promotion, etc.).
 */
export const FocusTierSchema = z.enum(['major', 'minor']);

// ── Row schemas ───────────────────────────────────────────────────────────

/**
 * Full `focus_options` row. `description` is nullable because some
 * templates only carry a label. `team_id` is a text slug (e.g.
 * 'mars-athletic'), NOT a UUID — matches the teams.id PK shape.
 */
export const FocusOptionSchema = z.object({
  id:           z.string(),
  team_id:      z.string(),
  season_id:    z.string(),
  option_key:   z.string(),
  label:        z.string(),
  description:  z.string().nullable(),
  tier:         FocusTierSchema,
  created_at:   z.string(),
});

/**
 * Full `focus_votes` row. `credits_spent` is the per-vote credit
 * allocation; the table has CHECK (credits_spent > 0).
 */
export const FocusVoteSchema = z.object({
  id:               z.string(),
  user_id:          z.string(),
  focus_option_id:  z.string(),
  credits_spent:    z.number().int().positive(),
  created_at:       z.string(),
});

/**
 * `focus_tally` view row. Same column set as FocusOption plus the
 * aggregated `vote_count` + `total_credits`. The view fans out one
 * row per option even when the option has zero votes (LEFT JOIN to
 * focus_votes), so 0 is a legal aggregate value.
 */
export const FocusTallyEntrySchema = z.object({
  option_id:      z.string(),
  team_id:        z.string(),
  season_id:      z.string(),
  option_key:     z.string(),
  label:          z.string(),
  description:    z.string().nullable(),
  tier:           FocusTierSchema,
  vote_count:     z.number().int().min(0),
  total_credits:  z.number().int().min(0),
});

export type ZodFocusOption     = z.infer<typeof FocusOptionSchema>;
export type ZodFocusVote       = z.infer<typeof FocusVoteSchema>;
export type ZodFocusTallyEntry = z.infer<typeof FocusTallyEntrySchema>;

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Parse an array of focus_options rows. Drops malformed entries with
 * a warn-log so the picker still renders the valid options.
 *
 * @param rows  Raw rows from `.select('*')`.
 * @param tag   Caller label for the warn-log prefix.
 */
export function parseFocusOptionRows(
  rows: unknown[],
  tag:  string,
): ZodFocusOption[] {
  return parseArrayWith(FocusOptionSchema, rows, tag, 'focus_option');
}

/**
 * Parse a single focus_votes row (returned from the insert chain in
 * castVote). Returns null + warn-log on drift so the caller's
 * existing null-handling path triggers.
 */
export function parseFocusVoteRow(
  row: unknown,
  tag: string,
): ZodFocusVote | null {
  if (row == null) return null;
  const parsed = FocusVoteSchema.safeParse(row);
  if (parsed.success) return parsed.data;
  console.warn(`[${tag}] malformed focus_vote row, returning null:`, parsed.error.issues);
  return null;
}

/**
 * Parse an array of focus_tally view rows. The view has the same
 * drift surface as a regular table (column renames in the underlying
 * SQL view definition would leak through), so the same drop-on-fail
 * semantics apply.
 */
export function parseFocusTallyRows(
  rows: unknown[],
  tag:  string,
): ZodFocusTallyEntry[] {
  return parseArrayWith(FocusTallyEntrySchema, rows, tag, 'focus_tally');
}

// ── Internal: shared array-parse template ────────────────────────────────

/**
 * Apply a Zod schema to every row in an array, dropping invalid rows
 * with a warn-log. Shared by parseFocusOptionRows + parseFocusTallyRows
 * so the drop-and-keep behaviour is identical across both surfaces.
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
