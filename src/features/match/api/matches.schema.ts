// ── features/match/api/matches.schema.ts ─────────────────────────────────────
// Zod boundary validation for the live/upcoming match-LIST reads (#386).
//
// `getLiveMatches` / `getUpcomingMatches` (matches.ts) feed the Home matchday
// panel and the /matches schedule. Both previously returned `data ?? []` with
// no validation, so a rename of `matches.scheduled_at` or the nested
// `home_team`/`away_team` join shape would compile-pass and render a broken or
// empty matchday. This schema makes that drift LOUD: a row that no longer
// matches the contract is dropped with a warn-log rather than half-rendering a
// fixture card.
//
// NOTE — the deep single-match read (`getMatch`, with its nested managers /
// lineups / match_player_stats tree) is a separate, larger slice; this one
// covers only the two list reads that share an identical select shape.

import { z } from 'zod';

// ── Nested team summary ──────────────────────────────────────────────────────

/**
 * The team columns both list queries join: `(id, name, color, location,
 * home_ground)`. The three presentational fields are nullable (blank during
 * early-season fixture provisioning); the panel renders fallbacks for null.
 */
const MatchListTeamSchema = z.object({
  id:          z.string(),
  name:        z.string(),
  color:       z.string().nullable(),
  location:    z.string().nullable(),
  home_ground: z.string().nullable(),
});

// ── Match list row ───────────────────────────────────────────────────────────

/**
 * The fields the matchday panel relies on from each list row. Mirrors the
 * non-null/nullable shape of `matches` in the generated types (scores +
 * scheduled_at nullable; ids + status non-null). Extra `matches` columns the
 * `*` select returns are ignored (Zod strips unknown keys on parse but still
 * reports success), so this validates the contract without constraining the
 * wide row. `home_team`/`away_team` are nullable to tolerate a join hiccup
 * rather than dropping an otherwise-valid fixture.
 */
export const MatchListRowSchema = z.object({
  id:           z.string(),
  status:       z.string(),
  home_team_id: z.string(),
  away_team_id: z.string(),
  scheduled_at: z.string().nullable(),
  home_score:   z.number().nullable(),
  away_score:   z.number().nullable(),
  home_team:    MatchListTeamSchema.nullable(),
  away_team:    MatchListTeamSchema.nullable(),
});

export type MatchListRow = z.infer<typeof MatchListRowSchema>;

// ── Helper ───────────────────────────────────────────────────────────────────

/**
 * Drop rows that fail the match-list contract, warn-logging each. Generic over
 * the element type so the caller's original (wide, fully-typed) row objects are
 * returned untouched — this validates presence/types of the critical fields at
 * the boundary without narrowing or transforming the consumer-facing shape.
 *
 * @param rows  The raw `data ?? []` array from a list query.
 * @param tag   Caller label for the warn-log prefix.
 * @returns     The subset of `rows` that satisfies MatchListRowSchema.
 */
export function dropInvalidMatchListRows<T>(rows: T[], tag: string): T[] {
  return rows.filter((row) => {
    const parsed = MatchListRowSchema.safeParse(row);
    if (parsed.success) return true;
    console.warn(`[${tag}] dropped malformed match list row:`, parsed.error.issues);
    return false;
  });
}
