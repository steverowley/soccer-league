// ── betting/api/oddsRepo.schema.ts ───────────────────────────────────────────
// Slice of #386 ("Zod schemas on betting/voting/match/architect/entities").
// Boundary validation for rows read from the `match_odds` table.
//
// WHY
// ───
// Engineering principle 5 (CLAUDE.md): all Supabase reads pass through Zod so DB
// drift fails LOUD at the boundary. `oddsRepo` compiles fine without it because
// the generated `Database` types match the table — but that's a COMPILE-time
// guarantee, not a RUNTIME one. If a future migration renames `home_odds` (or
// shifts its type) and database.ts isn't regenerated, every odds read would
// silently surface `undefined` in the WagerWidget — which now also renders
// inline in the onboarding starter bet, so the breakage would hit a brand-new
// fan's very first action.
//
// With Zod at the boundary the same drift fails loud: the parse catches the
// mismatch, the api function returns its documented `null` fallback (WagerWidget
// then shows its graceful "odds not posted yet" branch), and a warn-log surfaces
// the discrepancy.

import { z } from 'zod';

// ── Row schema ──────────────────────────────────────────────────────────────

/**
 * Full `match_odds` row shape, validated at the api boundary. Matches the table
 * definition (0004_betting.sql) — every column NOT NULL:
 *   match_id    UUID         PK / FK → matches
 *   home_odds   NUMERIC      decimal odds for a home win
 *   draw_odds   NUMERIC      decimal odds for a draw
 *   away_odds   NUMERIC      decimal odds for an away win
 *   computed_at TIMESTAMPTZ  when the odds generator last priced this match
 *
 * The three odds are bounded `> 1.0`: decimal odds of 1.0 imply a free bet,
 * which the ~5% house margin makes impossible — the same drift-detection bound
 * `WagerSchema.odds_snapshot` uses (those snapshots come from this very table).
 */
export const MatchOddsSchema = z.object({
  match_id:    z.string(),
  home_odds:   z.number().gt(1.0),
  draw_odds:   z.number().gt(1.0),
  away_odds:   z.number().gt(1.0),
  computed_at: z.string(),
});

/**
 * Inferred runtime shape from the schema. Use as the canonical RUNTIME shape;
 * the manual `MatchOdds` interface in `../types.ts` stays as the declaration of
 * intent.
 */
export type ZodMatchOdds = z.infer<typeof MatchOddsSchema>;

// ── Helper ────────────────────────────────────────────────────────────────────

/**
 * Safely parse a single `match_odds` row. Returns null on validation failure
 * (with a warn-log), so single-row reads keep their documented null fallback
 * instead of leaking a malformed/undefined-laden object into the UI.
 *
 * @param row  Raw row from `.single()` / `.maybeSingle()`.
 * @param tag  Caller name for the warn-log prefix.
 */
export function parseMatchOddsRow(row: unknown, tag: string): ZodMatchOdds | null {
  if (row == null) return null;
  const parsed = MatchOddsSchema.safeParse(row);
  if (parsed.success) return parsed.data;
  console.warn(`[${tag}] malformed match_odds row, returning null:`, parsed.error.issues);
  return null;
}
