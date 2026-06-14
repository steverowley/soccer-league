// ── features/match/api/standings.schema.ts ───────────────────────────────────
// Zod boundary validation for the two reads that feed league standings
// (#386). `fetchLeagueStandings` previously cast raw PostgREST results
// straight to `as MatchRow[]` / `as TeamRow[]`, so a rename of e.g.
// `matches.home_score` or the nested `competitions.league_id` join would
// compile-pass and silently corrupt every league table on `/` and
// `/leagues/:id`. Validating both row sets makes that drift LOUD: malformed
// rows warn-log and drop, so the table degrades (a few missing fixtures)
// instead of NaN-ing the whole standings computation.

import { z } from 'zod';

// ── Match row ────────────────────────────────────────────────────────────────

/**
 * The subset of `matches` columns the standings aggregation reads, plus the
 * nested `competitions(league_id, type)` join used to keep only league
 * fixtures. Scores are nullable (a fixture can be completed-but-unscored
 * mid-write); the aggregation already skips null-scored rows. `competitions`
 * is nullable to tolerate an orphan match whose competition row is missing —
 * such a row simply fails the league/type filter downstream.
 */
export const StandingsMatchRowSchema = z.object({
  home_team_id: z.string(),
  away_team_id: z.string(),
  home_score:   z.number().nullable(),
  away_score:   z.number().nullable(),
  played_at:    z.string().nullable(),
  competitions: z
    .object({
      league_id: z.string().nullable(),
      type:      z.string(),
    })
    .nullable(),
});

export type StandingsMatchRow = z.infer<typeof StandingsMatchRowSchema>;

// ── Team row ─────────────────────────────────────────────────────────────────

/**
 * The base team scaffold (every league team appears in the table even at
 * 0 pts). Only id + name are read here.
 */
export const StandingsTeamRowSchema = z.object({
  id:   z.string(),
  name: z.string(),
});

export type StandingsTeamRow = z.infer<typeof StandingsTeamRowSchema>;

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse the completed-fixture rows. Malformed entries warn-log and drop, so a
 * single drifted row costs one fixture in the table rather than poisoning the
 * whole aggregation.
 *
 * @param rows  Raw rows from the matches+competitions select.
 * @param tag   Caller label for the warn-log prefix.
 */
export function parseStandingsMatchRows(rows: unknown[], tag: string): StandingsMatchRow[] {
  const out: StandingsMatchRow[] = [];
  for (const row of rows) {
    const parsed = StandingsMatchRowSchema.safeParse(row);
    if (parsed.success) {
      out.push(parsed.data);
    } else {
      console.warn(`[${tag}] dropped malformed standings match row:`, parsed.error.issues);
    }
  }
  return out;
}

/**
 * Parse the base team rows. Malformed entries warn-log and drop; a dropped
 * team simply won't get a zero-stat scaffold row (it can still be tallied from
 * its match rows under a fallback id).
 *
 * @param rows  Raw rows from the teams select.
 * @param tag   Caller label for the warn-log prefix.
 */
export function parseStandingsTeamRows(rows: unknown[], tag: string): StandingsTeamRow[] {
  const out: StandingsTeamRow[] = [];
  for (const row of rows) {
    const parsed = StandingsTeamRowSchema.safeParse(row);
    if (parsed.success) {
      out.push(parsed.data);
    } else {
      console.warn(`[${tag}] dropped malformed standings team row:`, parsed.error.issues);
    }
  }
  return out;
}
