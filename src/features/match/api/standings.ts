// ── features/match/api/standings.ts ──────────────────────────────────────────
// WHY: The league standings on `/` (Home featured league) and `/leagues/:id`
// (LeagueDetail) were originally computed from a localStorage cache populated
// by an old JS-only simulator (`src/lib/matchResultsService.ts`).  The
// Supabase-backed worker took over match simulation long ago and nothing
// populates that localStorage cache any more — so every team showed 0 P /
// 0 W / 0 pts forever, but legacy localStorage entries from old browser
// sessions silently bled through to produce "phantom" stats on whichever
// team appeared first in `TEAMS_BY_LEAGUE`.
//
// This module replaces that stale path with a single Supabase-backed query
// that derives standings from the canonical source of truth: completed
// `matches` rows whose `competition.league_id` matches the requested league.
//
// SHAPE COMPATIBILITY
// ───────────────────
// The returned `StandingsRow` shape is the same object the rest of the UI
// (StandingsTable, Home, LeagueDetail) already consumes from the legacy
// `computeStandings` function, so callers only need to switch which
// function they call — no prop-shape edits required.
//
// NO RPC, NO VIEW
// ───────────────
// PostgREST's REST surface can do this with a single nested-select join,
// and the result set is small (≤ 32 matches × 28 rounds = ~900 rows per
// league per season).  A DB view would force a migration without giving
// us anything we can't compute client-side in O(n).  Keeping it inline
// means a hot-fix to the aggregation rules is just a TS edit.

import type { IslSupabaseClient } from '@shared/supabase/client';
// #386: drift-validate both reads at the api boundary. Malformed rows
// warn-log and drop instead of NaN-ing the whole table via a blind cast.
import { parseStandingsMatchRows, parseStandingsTeamRows } from './standings.schema';

// ── Public types ────────────────────────────────────────────────────────────

/**
 * One row of the league standings table.  Field names match the legacy
 * shape `computeStandings()` produces so we can drop this in to the
 * existing renderers (`StandingsTable`, `Home`, `LeagueDetail`) with
 * zero presenter edits.
 *
 * `form` is the last-5 results (most-recent first).  Newly-promoted teams
 * with < 5 completed matches return a shorter array.
 */
export interface StandingsRow {
  /** Team slug (matches `teams.id`).  Used for `/teams/:id` deep links. */
  id:       string;
  /** Human-readable team name.  Pulled from `teams.name`. */
  team:     string;
  /** Convenience field renderers like Home use to build a Link target. */
  teamLink: string;
  /** Total completed matches involving this team in this league. */
  played:   number;
  wins:     number;
  draws:    number;
  loses:    number;
  /** Goals for + goals against — surfaced separately so GD ties can be broken further. */
  gf:       number;
  ga:       number;
  /** Goal difference (gf − ga). */
  gd:       number;
  /** Standard 3-1-0 points. */
  points:   number;
  /** Last-5 form, most-recent first.  Shorter when < 5 matches played. */
  form:     Array<'W' | 'D' | 'L'>;
}

// The minimal row shapes this aggregation reads (matches + base teams) now
// live in `standings.schema.ts` as Zod schemas, so the boundary is validated
// rather than blind-cast. See `StandingsMatchRow` / `StandingsTeamRow` there.

/**
 * Outcome of a standings fetch.
 *
 * WHY this exists: `fetchLeagueStandings` returns `[]` for BOTH "this league
 * has played no fixtures" and "the query failed", because supabase-js reports
 * transport and PostgREST errors in the resolved `{ error }` field rather than
 * by rejecting — so a caller's `.catch()` never runs. Callers that need to
 * tell those apart (the /leagues cards, which otherwise announce "Awaiting
 * first kick-off" over a mid-season table) use `fetchLeagueStandingsResult`.
 */
export type StandingsResult =
  /** The query succeeded. `rows` may be empty — that genuinely means no table yet. */
  | { ok: true;  rows: StandingsRow[] }
  /** The query failed. Nothing is known about the table; `reason` is warn-logged. */
  | { ok: false; reason: string };

// ── Public entry points ─────────────────────────────────────────────────────

/**
 * Compute league standings for `leagueId` from the canonical Supabase
 * source of truth.
 *
 * Aggregation rules (matches the historical `computeStandings`):
 *   • Win = 3 pts, Draw = 1 pt, Loss = 0 pts.
 *   • GD tiebreak then GF tiebreak then stable-sort fallback.
 *   • Cup / playoff fixtures are excluded — only `competitions.type='league'`
 *     contributes to the table.
 *   • Only the CURRENT season contributes. A league accumulates one
 *     `competitions` row per season, so without this the table summed every
 *     season ever played (see `resolveCurrentSeasonId`).
 *   • Only `matches.status='completed'` rows count (in-progress and
 *     scheduled matches are pre-result).
 *   • Form column = last 5 results, most-recent first.  Older results
 *     beyond the window are silently dropped.
 *
 * Every team registered to the league is returned, even if they haven't
 * played a match — those rows just have all-zero stats and an empty form
 * array.  This keeps the table stable in size across the season.
 *
 * @param db        Injected typed Supabase client (`IslSupabaseClient`).
 * @param leagueId  Slug from `leagues.id` (e.g. `'rocky-inner'`).
 * @returns         Standings rows sorted by points DESC → GD DESC → GF DESC.
 *                  Returns `[]` on any DB error (warn-logged but never throws)
 *                  — use `fetchLeagueStandingsResult` when the caller needs to
 *                  tell an empty table from a failed query.
 */
export async function fetchLeagueStandings(
  db: IslSupabaseClient,
  leagueId: string,
): Promise<StandingsRow[]> {
  const result = await fetchLeagueStandingsResult(db, leagueId);
  return result.ok ? result.rows : [];
}

/**
 * Same aggregation as `fetchLeagueStandings`, but reports query failure
 * instead of flattening it to an empty table. See `StandingsResult`.
 *
 * @param db        Injected typed Supabase client (`IslSupabaseClient`).
 * @param leagueId  Slug from `leagues.id` (e.g. `'rocky-inner'`).
 * @returns         `{ ok: true, rows }` on success (rows may be empty), or
 *                  `{ ok: false, reason }` when either query errored.
 */
/**
 * Outcome of resolving which season the league table should cover.
 *
 * `seasonId === null` means "do not scope" — the database holds no seasons at
 * all, so there is nothing to disambiguate and every league competition is
 * effectively the only one. That is distinct from a failed read, which
 * surfaces as `ok: false` so a transient error never silently blanks a table.
 */
type SeasonScope =
  | { ok: true; seasonId: string | null }
  | { ok: false; reason: string };

/**
 * Decide which season's fixtures the standings should aggregate.
 *
 * WHY THIS EXISTS (2026-08-14)
 * ────────────────────────────
 * `competitions` gains a new row per league per season, and the standings read
 * only filtered on league + type + completed. Rocky Inner had three league
 * competitions (Seasons 1–3) with 12 completed matches each, so the table
 * showed a 36-match, three-season aggregate: Earth United on 17 played, Venus
 * Volcanic on 5, in a league where nobody had played more than 7.
 *
 * Preference order:
 *   1. The season flagged `is_active` — there is at most one by DB constraint.
 *   2. Failing that, the newest by `year`, so an archived-but-unrolled league
 *      still shows its most recent table rather than an empty one.
 *
 * @param db  Injected typed Supabase client.
 * @returns   The season to scope to, `null` to skip scoping, or a failure.
 */
async function resolveCurrentSeasonId(db: IslSupabaseClient): Promise<SeasonScope> {
  const { data, error } = await db
    .from('seasons')
    .select('id, year, is_active')
    .order('year', { ascending: false, nullsFirst: false });

  if (error) {
    console.warn(`[fetchLeagueStandings] season fetch failed: ${error.message}`);
    return { ok: false, reason: `season fetch failed: ${error.message}` };
  }

  const rows = (data ?? []) as Array<{ id?: unknown; is_active?: unknown }>;
  const usable = rows.filter((r): r is { id: string; is_active: boolean } => typeof r.id === 'string');
  if (usable.length === 0) return { ok: true, seasonId: null };

  // `usable` is already year-DESC, so [0] is the newest when none is flagged.
  return { ok: true, seasonId: (usable.find((r) => r.is_active) ?? usable[0]!).id };
}

export async function fetchLeagueStandingsResult(
  db: IslSupabaseClient,
  leagueId: string,
): Promise<StandingsResult> {
  // ── Step 0: pin the table to one season ─────────────────────────────────
  const scope = await resolveCurrentSeasonId(db);
  if (!scope.ok) return { ok: false, reason: scope.reason };

  // ── Step 1: load every completed league fixture in this league ───────────
  // Filters pushed into the PostgREST query (#391). Pre-#391 this loaded
  // EVERY completed match across EVERY league + competition type, then
  // .filter()d client-side — O(total-completed-matches) per page render
  // even though the table only needs O(matches-in-this-league) rows.
  //
  // `competitions!inner(...)` forces an inner join so non-league
  // competitions (cups) and orphan matches drop server-side. The
  // chained .eq() on the nested column resolves through PostgREST's
  // embedded-resource filter syntax.
  //
  // played_at DESC sort survives so the form-window accumulation below
  // still sees results newest-first.
  const matchQuery = (db as any)
    .from('matches')
    .select('home_team_id, away_team_id, home_score, away_score, played_at, competitions!inner(league_id, type, season_id)')
    .eq('status', 'completed')
    .eq('competitions.league_id', leagueId)
    .eq('competitions.type', 'league');

  // Skipped only when the database holds no seasons at all — see SeasonScope.
  if (scope.seasonId !== null) matchQuery.eq('competitions.season_id', scope.seasonId);

  const { data: matchRows, error: matchErr } = await matchQuery
    .order('played_at', { ascending: false, nullsFirst: false });

  if (matchErr) {
    console.warn(`[fetchLeagueStandings] match fetch failed: ${matchErr.message}`);
    return { ok: false, reason: `match fetch failed: ${matchErr.message}` };
  }
  // Validate at the boundary (#386), then keep the defensive client-side
  // filter as a belt-and-braces guard: PostgREST embedded-filter syntax is
  // occasionally surprising on view joins / orphan rows, and the predicate is
  // O(rows) so the cost is trivial compared to the round-trip we just saved.
  const rows = parseStandingsMatchRows((matchRows ?? []) as unknown[], 'fetchLeagueStandings').filter(
    (m) =>
      m.competitions?.league_id === leagueId &&
      m.competitions?.type === 'league' &&
      // Belt-and-braces on the season too: a two-level embedded filter is
      // exactly the kind of PostgREST syntax this guard exists to catch, and
      // getting it wrong resurrects the multi-season aggregate.
      (scope.seasonId === null || m.competitions?.season_id === scope.seasonId),
  );

  // ── Step 2: load every team in the league for the base row scaffold ─────
  // Pulled separately so teams that haven't played a single match still
  // appear in the table at 0 pts.  Filtering by `league_id` mirrors the
  // legacy `TEAMS_BY_LEAGUE` static mapping.
  const { data: teamRows, error: teamErr } = await (db as any)
    .from('teams')
    .select('id, name')
    .eq('league_id', leagueId)
    .order('name', { ascending: true });

  if (teamErr) {
    console.warn(`[fetchLeagueStandings] team fetch failed: ${teamErr.message}`);
    return { ok: false, reason: `team fetch failed: ${teamErr.message}` };
  }
  const teams = parseStandingsTeamRows((teamRows ?? []) as unknown[], 'fetchLeagueStandings');

  // ── Step 3: aggregate scoreboards per team ──────────────────────────────
  // `acc` keyed by team_id, initialised once we see the team in either a
  // match row or the base team list (whichever comes first).  The form
  // array is appended in match-order (newest first because of the DESC
  // sort), so slicing to the first 5 is equivalent to "last 5 results".
  const init = (id: string, name: string): StandingsRow => ({
    id,
    team: name,
    teamLink: `/teams/${id}`,
    played: 0, wins: 0, draws: 0, loses: 0,
    gf: 0, ga: 0, gd: 0, points: 0,
    form: [],
  });

  const acc: Record<string, StandingsRow> = {};
  for (const t of teams) acc[t.id] = init(t.id, t.name);

  for (const m of rows) {
    if (m.home_score === null || m.away_score === null) continue;
    const homeId = m.home_team_id;
    const awayId = m.away_team_id;

    // Teams that left the league mid-season would have a match row but no
    // base team entry.  We still tally them so league points add up; the
    // missing team row means no display name available — fall back to id.
    if (!acc[homeId]) acc[homeId] = init(homeId, homeId);
    if (!acc[awayId]) acc[awayId] = init(awayId, awayId);

    const home = acc[homeId];
    const away = acc[awayId];

    home.played++; away.played++;
    home.gf += m.home_score; home.ga += m.away_score;
    away.gf += m.away_score; away.ga += m.home_score;

    // Trim form arrays to the 5-most-recent rolling window.  Push then
    // slice keeps the most-recent push at index 0 (because rows were sorted
    // DESC) provided we only push to teams with < 5 entries already.
    const FORM_WINDOW = 5;
    if (m.home_score > m.away_score) {
      home.wins++; away.loses++;
      if (home.form.length < FORM_WINDOW) home.form.push('W');
      if (away.form.length < FORM_WINDOW) away.form.push('L');
    } else if (m.home_score < m.away_score) {
      home.loses++; away.wins++;
      if (home.form.length < FORM_WINDOW) home.form.push('L');
      if (away.form.length < FORM_WINDOW) away.form.push('W');
    } else {
      home.draws++; away.draws++;
      if (home.form.length < FORM_WINDOW) home.form.push('D');
      if (away.form.length < FORM_WINDOW) away.form.push('D');
    }
  }

  // ── Step 4: finalise derived fields + sort ──────────────────────────────
  // Points = 3 W + 1 D (per ISL rules, see CLAUDE.md "Tournament Structure").
  // GD computed last so we can sort by it without re-derivation cost.
  for (const row of Object.values(acc)) {
    row.points = row.wins * 3 + row.draws;
    row.gd     = row.gf - row.ga;
  }

  return {
    ok: true,
    rows: Object.values(acc).sort(
      (a, b) =>
        b.points - a.points ||
        (b.gd - a.gd)      ||
        (b.gf - a.gf),
    ),
  };
}
