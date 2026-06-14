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

// ── Public entry point ──────────────────────────────────────────────────────

/**
 * Compute league standings for `leagueId` from the canonical Supabase
 * source of truth.
 *
 * Aggregation rules (matches the historical `computeStandings`):
 *   • Win = 3 pts, Draw = 1 pt, Loss = 0 pts.
 *   • GD tiebreak then GF tiebreak then stable-sort fallback.
 *   • Cup / playoff fixtures are excluded — only `competitions.type='league'`
 *     contributes to the table.
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
 *                  Returns `[]` on any DB error (warn-logged but never throws).
 */
export async function fetchLeagueStandings(
  db: IslSupabaseClient,
  leagueId: string,
): Promise<StandingsRow[]> {
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
  const { data: matchRows, error: matchErr } = await (db as any)
    .from('matches')
    .select('home_team_id, away_team_id, home_score, away_score, played_at, competitions!inner(league_id, type)')
    .eq('status', 'completed')
    .eq('competitions.league_id', leagueId)
    .eq('competitions.type', 'league')
    .order('played_at', { ascending: false, nullsFirst: false });

  if (matchErr) {
    console.warn(`[fetchLeagueStandings] match fetch failed: ${matchErr.message}`);
    return [];
  }
  // Validate at the boundary (#386), then keep the defensive client-side
  // filter as a belt-and-braces guard: PostgREST embedded-filter syntax is
  // occasionally surprising on view joins / orphan rows, and the predicate is
  // O(rows) so the cost is trivial compared to the round-trip we just saved.
  const rows = parseStandingsMatchRows((matchRows ?? []) as unknown[], 'fetchLeagueStandings').filter(
    (m) => m.competitions?.league_id === leagueId && m.competitions?.type === 'league',
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
    return [];
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

  return Object.values(acc).sort(
    (a, b) =>
      b.points - a.points ||
      (b.gd - a.gd)      ||
      (b.gf - a.gf),
  );
}
