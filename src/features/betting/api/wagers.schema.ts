// ── betting/api/wagers.schema.ts ─────────────────────────────────────────
// Slice 1 of #386 ("Zod schemas on betting/voting/match/architect/entities").
// Adds boundary validation for every row read from the `wagers` table.
//
// WHY
// ───
// Engineering principle 5 (CLAUDE.md) says all Supabase reads pass
// through Zod. The wagers module compiles fine without it because the
// generated `Database` types match the table shape — but that's a
// COMPILE-time guarantee, not a RUNTIME one. If a future migration
// renames `odds_snapshot` to `odds` and database.ts isn't regenerated,
// every wager-card render silently breaks with `undefined` showing
// up in the UI.
//
// With Zod at the boundary, the same drift fails LOUD: the parse step
// catches the mismatch, the api function returns the documented null /
// empty-array fallback, and a warn-log surfaces the discrepancy so the
// operator notices on the next dashboard check.
//
// This file is the schema definition. Consumers (`wagers.ts`) import
// `WagerSchema` and call `.safeParse(row)` at each boundary. The
// inferred `Wager` type from this schema is the canonical runtime
// shape; the manual interface in `types.ts` stays as the public
// declaration of intent.

import { z } from 'zod';

// ── Enums mirroring CHECK constraints ────────────────────────────────────

/**
 * `wagers.status` CHECK values (per 0004_betting.sql).
 * Order matches the CHECK constraint so a drift in either direction
 * (DB constraint loosened, app enum tightened) trips Zod loudly.
 */
export const WagerStatusSchema = z.enum(['open', 'won', 'lost', 'void']);

/**
 * `wagers.team_choice` CHECK values. Three-way outcome — home / draw /
 * away. Same drift-detection rationale as WagerStatusSchema.
 */
export const TeamChoiceSchema = z.enum(['home', 'draw', 'away']);

// ── Row schema ────────────────────────────────────────────────────────────

/**
 * Full `wagers` row shape, validated at the api boundary. Matches the
 * table definition in 0004_betting.sql:
 *   id           UUID PRIMARY KEY DEFAULT gen_random_uuid()
 *   user_id      UUID            (NULL allowed post-#415 anonymisation)
 *   match_id     UUID            NOT NULL
 *   team_choice  TEXT            NOT NULL CHECK (...)
 *   stake        INTEGER         NOT NULL CHECK (stake >= 10)
 *   odds_snapshot NUMERIC        NOT NULL CHECK (odds_snapshot > 1.0)
 *   status       TEXT            NOT NULL CHECK (...)
 *   payout       INTEGER         NULL (NULL while open / on loss)
 *   created_at   TIMESTAMPTZ     NOT NULL DEFAULT now()
 *
 * The `user_id` nullable post-#415: when a fan GDPR-deletes their
 * account, their wager rows are set to user_id=NULL but preserved for
 * leaderboard history. The schema reflects that.
 */
// The UUID columns are validated server-side by the DB CHECK +
// gen_random_uuid() default; we just need `z.string()` here so the
// schema's drift-detection role stays narrow (column renames /
// type-shifts trip it, not UUID-versioning trivia from test fixtures).
export const WagerSchema = z.object({
  id:             z.string(),
  user_id:        z.string().nullable(),
  match_id:       z.string(),
  team_choice:    TeamChoiceSchema,
  stake:          z.number().int().min(10),
  odds_snapshot:  z.number().gt(1.0),
  status:         WagerStatusSchema,
  payout:         z.number().int().nullable(),
  created_at:     z.string(),
});

/**
 * Inferred TypeScript type from the Zod schema. Use this as the
 * canonical RUNTIME shape; the manual `Wager` interface in
 * `../types.ts` stays as a documentation-quality declaration of
 * intent (and re-asserts the narrower `TeamChoice` / `WagerStatus`
 * domain types).
 */
export type ZodWager = z.infer<typeof WagerSchema>;

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Safely parse an array of wager rows. Rows that fail validation are
 * dropped with a warn-log; the array path always returns a valid
 * subset rather than null.
 *
 * @param rows  Raw rows from `.select('*')`.
 * @param tag   Caller name for the warn-log prefix.
 * @returns     The subset of rows that validated; never throws.
 */
export function parseWagerRows(
  rows: unknown[],
  tag:  string,
): ZodWager[] {
  const out: ZodWager[] = [];
  for (const row of rows) {
    const parsed = WagerSchema.safeParse(row);
    if (parsed.success) {
      out.push(parsed.data);
    } else {
      console.warn(`[${tag}] dropped malformed wager row:`, parsed.error.issues);
    }
  }
  return out;
}

/**
 * Safely parse a single wager row. Returns null on validation failure
 * with a warn-log, so single-row reads still produce a usable fallback.
 *
 * @param row   Raw row from `.maybeSingle()` or `.single()`.
 * @param tag   Caller name for the warn-log prefix.
 */
export function parseWagerRow(
  row:  unknown,
  tag:  string,
): ZodWager | null {
  if (row == null) return null;
  const parsed = WagerSchema.safeParse(row);
  if (parsed.success) return parsed.data;
  console.warn(`[${tag}] malformed wager row, returning null:`, parsed.error.issues);
  return null;
}
