// ── supabase.js ───────────────────────────────────────────────────────────────
// Single entry-point for all Supabase interaction.
//
// HOW IT FITS INTO THE APP
// ────────────────────────
// Every page that needs live data imports from this file — never from the raw
// Supabase client directly.  This keeps the query shapes in one place and
// makes it easy to swap or mock the backend later.
//
// DATA MODEL OVERVIEW
// ───────────────────
// The ISL database is organised around two top-level concepts:
//
//   seasons        – a calendar year of play (Season 1 — 2600, etc.)
//   competitions   – a specific tournament/league run within a season
//                    type='league'  → a single league's round-robin run
//                    type='cup'     → a cross-league knockout/group cup
//                    type='playoff' → end-of-season promotion/relegation
//
// Teams enter competitions through competition_teams (which also records
// cup group assignments).  Matches belong to a competition, not a league.
// Standings are derived at read-time by aggregating completed match rows.
//
// QUERY PATTERNS
// ──────────────
// Most pages need a specific season → its competitions → their matches.
// The helper chain is:
//   getActiveSeason()  →  getCompetitionsForSeason(id)
//                      →  getMatchesForCompetition(id)
//                      →  getStandings(id)   (league competitions only)
//
// Write operations (saving results, player stats) are authenticated and
// expected to be called from an admin context, not the public site.

import { createClient } from '@supabase/supabase-js';

// ── Client initialisation ─────────────────────────────────────────────────────
// The anon key is safe to expose in browser bundles — Supabase enforces
// Row Level Security policies on the database side.  All tables are readable
// by anonymous users; writes require an authenticated session.
const SUPABASE_URL  = 'https://ddtpbipkqamuxnvupddc.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkdHBiaXBrcWFtdXhudnVwZGRjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwMDMzODgsImV4cCI6MjA4OTU3OTM4OH0.L8Vv2mxDlhXa3hl9xhR0MWNd1JYoooZH0HqRi_LJyAw';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

// ── Field normalisation helpers ───────────────────────────────────────────────
// The database uses snake_case column names (home_ground, league_id, short_name)
// while the front-end components were originally written against the camelCase
// shape defined in leagueData.js (homeGround, leagueId, shortName).
//
// These helpers bridge that gap so page components can use consistent property
// names regardless of whether the data came from the DB or the static file.
// They are thin — they spread all original fields and add camelCase aliases —
// so every DB field is still accessible directly if needed.

/**
 * Normalises a raw team row returned by Supabase into the camelCase shape
 * expected by page components (TeamCard, TeamDetail, TeamRosterCard, etc.).
 *
 * Aliases added:
 *   home_ground  → homeGround   (used by MetaRow labels and TeamCard)
 *   league_id    → leagueId     (used for routing /leagues/:leagueId)
 *
 * The nested `leagues` object (present when the query joins the leagues table)
 * is left intact so callers can access `team.leagues.name` for the league name.
 *
 * @param {object} team  Raw team row from Supabase (snake_case fields).
 * @returns {object}     Team with both snake_case originals and camelCase aliases.
 */
export function normalizeTeam(team) {
  return {
    ...team,
    homeGround: team.home_ground,
    leagueId:   team.league_id,
  };
}

/**
 * Normalises a raw league row returned by Supabase into the camelCase shape
 * expected by page components (filter tabs in Players.jsx, etc.).
 *
 * Alias added:
 *   short_name → shortName   (used by the league filter tab labels)
 *
 * @param {object} league  Raw league row from Supabase (snake_case fields).
 * @returns {object}       League with both snake_case original and camelCase alias.
 */
export function normalizeLeague(league) {
  return {
    ...league,
    shortName: league.short_name,
  };
}

// ── Seasons ───────────────────────────────────────────────────────────────────
// Seasons are the outermost container.  All competitions, matches, and
// standings are scoped to a season.  Exactly one season has is_active=true;
// the database enforces this with a partial unique index.

/**
 * Fetch every season in reverse chronological order (newest first).
 * Used by season-switcher dropdowns and archive pages.
 *
 * @returns {Promise<Array<{id: string, name: string, year: number, is_active: boolean, start_date: string, end_date: string}>>}
 */
export async function getSeasons() {
  const { data, error } = await supabase
    .from('seasons')
    .select('*')
    .order('year', { ascending: false });
  if (error) throw error;
  return data;
}

/**
 * Fetch the single active season.
 * Throws if no season is marked active (i.e. the database has not been seeded).
 *
 * @returns {Promise<{id: string, name: string, year: number, start_date: string, end_date: string}>}
 */
export async function getActiveSeason() {
  const { data, error } = await supabase
    .from('seasons')
    .select('*')
    .eq('is_active', true)
    .single();  // enforced by DB: at most one active season
  if (error) throw error;
  return data;
}

// ── Leagues ───────────────────────────────────────────────────────────────────
// Leagues are the top-level structural containers for teams and competitions.
// There are four active leagues: rocky-inner, gas-giants, outer-reaches,
// kuiper-belt.  League rows are stable reference data — they change very rarely
// and can be fetched once and cached at the page level.

/**
 * Fetch all ISL leagues ordered alphabetically by name.
 *
 * Returns the raw DB shape (id, name, short_name, description).  Pass each
 * result through normalizeLeague() when the caller needs the camelCase
 * shortName alias used by filter-tab components.
 *
 * @returns {Promise<Array<{id: string, name: string, short_name: string, description: string}>>}
 */
export async function getLeagues() {
  const { data, error } = await supabase
    .from('leagues')
    .select('*')
    .order('name');
  if (error) throw error;
  return data;
}

// ── Competitions ──────────────────────────────────────────────────────────────
// A competition is either a league run (type='league', format='round_robin')
// or a cup (type='cup', format='knockout' | 'group_knockout').
//
// League competitions have a league_id pointing to their parent league.
// Cross-league cups (e.g. ISL Champions Cup) have league_id = NULL — they
// pull in the top N teams from each league via competition_teams.

/**
 * Fetch all competitions for a given season, each including its league name
 * and the list of participating teams (with group/seeding info for cups).
 *
 * The .order('type') call puts 'cup' before 'league' alphabetically, which
 * happens to match the desired display order (cup featured at top).
 * Adjust if the display order should differ.
 *
 * @param {string} seasonId - UUID of the parent season
 * @returns {Promise<Array>} competitions with nested leagues + competition_teams
 */
export async function getCompetitionsForSeason(seasonId) {
  const { data, error } = await supabase
    .from('competitions')
    .select(`
      *,
      leagues (id, name, short_name),
      competition_teams (
        group_name,
        seeding,
        teams (id, name, color, location)
      )
    `)
    .eq('season_id', seasonId)
    .order('type');
  if (error) throw error;
  return data;
}

/**
 * Fetch a single competition with full detail: season, league, and all
 * participating teams (full team rows).  Used by the competition detail page.
 *
 * @param {string} competitionId - UUID of the competition
 * @returns {Promise<object>} competition row with nested relations
 */
export async function getCompetition(competitionId) {
  const { data, error } = await supabase
    .from('competitions')
    .select(`
      *,
      seasons (id, name, year),
      leagues (id, name, short_name),
      competition_teams (
        group_name,
        seeding,
        teams (*)
      )
    `)
    .eq('id', competitionId)
    .single();
  if (error) throw error;
  return data;
}

// ── Matches ───────────────────────────────────────────────────────────────────
// Matches are the atomic record of game data.  home_score / away_score are
// NULL until the match is completed.  The match scoreboard page derives its
// display from match_player_stats rows joined here.

/**
 * Fetch all matches for a competition, ordered by kick-off time (nulls first
 * so unscheduled fixtures appear before completed ones).
 *
 * Home and away team names are aliased to avoid the Supabase ambiguous FK
 * error that would result from a plain `.select('teams(*)')`.
 *
 * @param {string} competitionId - UUID of the competition
 * @returns {Promise<Array>} match rows with home_team and away_team objects
 */
export async function getMatchesForCompetition(competitionId) {
  const { data, error } = await supabase
    .from('matches')
    .select(`
      *,
      home_team:teams!matches_home_team_id_fkey (id, name, color),
      away_team:teams!matches_away_team_id_fkey (id, name, color)
    `)
    .eq('competition_id', competitionId)
    .order('played_at', { nullsFirst: true });
  if (error) throw error;
  return data;
}

/**
 * Fetch a single match with its full player stats breakdown.
 * Used by the match scoreboard / detail page.
 *
 * @param {string} matchId - UUID of the match
 * @returns {Promise<object>} match row with competition, both teams, and per-player stats
 */
export async function getMatch(matchId) {
  const { data, error } = await supabase
    .from('matches')
    .select(`
      *,
      competitions (id, name, type, format),
      home_team:teams!matches_home_team_id_fkey (*),
      away_team:teams!matches_away_team_id_fkey (*),
      match_player_stats (
        *,
        players (id, name, position, overall_rating)
      )
    `)
    .eq('id', matchId)
    .single();
  if (error) throw error;
  return data;
}

// ── Teams ─────────────────────────────────────────────────────────────────────

/**
 * Fetch teams, optionally scoped to one league.
 * Returns teams alphabetically — the UI can re-sort if needed.
 *
 * @param {string|null} leagueId   - slug like 'rocky-inner', or null for all teams
 * @param {boolean}     withPlayers - when true, include nested players array
 * @returns {Promise<Array>} team rows with their parent league's name/shortName
 */
export async function getTeams(leagueId = null, withPlayers = false) {
  const playerSelect = withPlayers
    ? ', players(id, name, position, nationality, age, overall_rating, personality, starter)'
    : '';
  let query = supabase
    .from('teams')
    .select(`*, leagues(id, name, short_name)${playerSelect}`);
  if (leagueId) query = query.eq('league_id', leagueId);
  const { data, error } = await query.order('name');
  if (error) throw error;
  return data;
}

/**
 * Fetch a single team with its full squad (players) and manager.
 * Used by the Team Detail page.
 *
 * @param {string} teamId - text slug, e.g. 'mercury-runners'
 * @returns {Promise<object>} team row with nested leagues, players[], managers[]
 */
export async function getTeam(teamId) {
  const { data, error } = await supabase
    .from('teams')
    .select(`
      *,
      leagues (id, name, short_name),
      players (*),
      managers (*)
    `)
    .eq('id', teamId)
    .single();
  if (error) throw error;
  return data;
}

// ── Player detail ─────────────────────────────────────────────────────────────
// Used by the PlayerDetail page (/players/:playerId).
//
// Season stats are NOT stored as a summary row — they are computed on read by
// summing all match_player_stats rows for the player.  This keeps the match row
// as the single source of truth (same philosophy as getStandings) and means
// stats automatically reflect newly simulated matches without any extra writes.
//
// match_player_stats.rating is nullable (not every appearance is rated), so
// avg_rating is tracked via a separate count (_rcnt) to avoid dividing by zero
// or diluting the average with zero-rated rows.

/**
 * Fetch a single player by UUID, including their parent team name and all
 * aggregated season stats computed from match_player_stats.
 *
 * Two Supabase queries run in parallel to minimise latency:
 *   1. The player row joined with teams(id, name) — used for the hero breadcrumb.
 *      The join key is players.team_id → teams.id (FK).  PostgREST resolves it
 *      automatically and returns the team object at player.teams (table name,
 *      plural).
 *   2. All match_player_stats rows for the player — aggregated in JS because
 *      PostgREST's select DSL does not support SUM/AVG on nested relations.
 *
 * If the player has never appeared in a match, seasonStats is returned with
 * all-zero counters and avg_rating: null (so the UI can display "—" rather
 * than "0.0").
 *
 * @param {string} playerId - UUID of the target player (from players.id)
 * @returns {Promise<{
 *   id: string, name: string, position: string, age: number,
 *   nationality: string, overall_rating: number, personality: string,
 *   starter: boolean, team_id: string,
 *   teams: { id: string, name: string },
 *   seasonStats: {
 *     goals: number, assists: number, yellow_cards: number,
 *     red_cards: number, minutes_played: number,
 *     matches_played: number, avg_rating: number|null
 *   }
 * }>}
 */
export async function getPlayer(playerId) {
  // ── Parallel fetch ────────────────────────────────────────────────────────
  // Run both queries simultaneously; neither depends on the other's result.
  const [playerResult, statsResult] = await Promise.all([
    supabase
      .from('players')
      .select('*, teams(id, name)')
      .eq('id', playerId)
      .single(),
    supabase
      .from('match_player_stats')
      .select('goals, assists, yellow_cards, red_cards, minutes_played, rating')
      .eq('player_id', playerId),
  ]);

  if (playerResult.error) throw playerResult.error;
  if (statsResult.error)  throw statsResult.error;

  // ── Aggregate match stats in JavaScript ───────────────────────────────────
  // Accumulate per-appearance values into season totals.  _rsum / _rcnt are
  // private accumulators for the weighted average; they are stripped from the
  // final seasonStats object below.
  //
  // ?? 0 guards against null columns (schema defaults are 0, but defensive).
  // rating uses a separate null check because 0.0 is a valid (if rare) rating
  // and should not be excluded from the average — only truly null values are.
  const statRows = statsResult.data ?? [];
  const agg = statRows.reduce(
    (acc, row) => ({
      goals:          acc.goals          + (row.goals          ?? 0),
      assists:        acc.assists        + (row.assists        ?? 0),
      yellow_cards:   acc.yellow_cards   + (row.yellow_cards   ?? 0),
      red_cards:      acc.red_cards      + (row.red_cards      ?? 0),
      minutes_played: acc.minutes_played + (row.minutes_played ?? 0),
      matches_played: acc.matches_played + 1,
      _rsum:          acc._rsum          + (row.rating         ?? 0),
      _rcnt:          acc._rcnt          + (row.rating != null ? 1 : 0),
    }),
    { goals: 0, assists: 0, yellow_cards: 0, red_cards: 0,
      minutes_played: 0, matches_played: 0, _rsum: 0, _rcnt: 0 }
  );

  // ── Average rating ────────────────────────────────────────────────────────
  // Only computed when at least one rated appearance exists.  toFixed(1)
  // produces a 1-decimal string; unary + converts it back to a number so
  // consumers can format it themselves (e.g. "7.4" or "—").
  const avg_rating = agg._rcnt > 0
    ? +(agg._rsum / agg._rcnt).toFixed(1)
    : null;

  return {
    ...playerResult.data,
    seasonStats: {
      goals:          agg.goals,
      assists:        agg.assists,
      yellow_cards:   agg.yellow_cards,
      red_cards:      agg.red_cards,
      minutes_played: agg.minutes_played,
      matches_played: agg.matches_played,
      avg_rating,     // null when player has no rated appearances
    },
  };
}

// ── Standings ─────────────────────────────────────────────────────────────────
// Standings are NOT stored in the database — they are computed on read from
// the completed matches in a competition.  This avoids the complexity of
// maintaining a denormalised standings table and keeps the match row as the
// single source of truth.
//
// Standard football points system:
//   Win  → 3 points
//   Draw → 1 point each
//   Loss → 0 points
//
// Tie-breaking order: points → goal difference → goals for.
// (Head-to-head is not yet implemented; add it here if needed.)

/**
 * Compute the current standings table for a league competition.
 * Only 'completed' matches contribute; scheduled/in-progress matches are
 * ignored so the table reflects the actual played state.
 *
 * @param {string} competitionId - UUID of a competition with type='league'
 * @returns {Promise<Array<{
 *   team: object,
 *   played: number, won: number, drawn: number, lost: number,
 *   gf: number, ga: number, gd: number, points: number
 * }>>} rows sorted by points desc, then gd desc, then gf desc
 */
export async function getStandings(competitionId) {
  const { data: matches, error } = await supabase
    .from('matches')
    .select(`
      home_team_id, away_team_id,
      home_score, away_score,
      home_team:teams!matches_home_team_id_fkey (id, name, color),
      away_team:teams!matches_away_team_id_fkey (id, name, color)
    `)
    .eq('competition_id', competitionId)
    .eq('status', 'completed');
  if (error) throw error;

  // Build a map keyed by team ID.  We upsert each team on first encounter
  // rather than pre-loading competition_teams so this function works even
  // if the competition_teams table is out of sync.
  const table = {};

  /** Lazily initialise a team's standings row on first match encounter. */
  const ensure = (team) => {
    if (!table[team.id]) {
      table[team.id] = {
        team,
        played: 0, won: 0, drawn: 0, lost: 0,
        gf: 0, ga: 0, gd: 0, points: 0,
      };
    }
  };

  for (const m of matches) {
    ensure(m.home_team);
    ensure(m.away_team);

    const h = table[m.home_team_id];
    const a = table[m.away_team_id];

    h.played++; a.played++;
    h.gf += m.home_score; h.ga += m.away_score;
    a.gf += m.away_score; a.ga += m.home_score;

    if (m.home_score > m.away_score) {
      h.won++; h.points += 3;  // 3 pts for a win
      a.lost++;
    } else if (m.home_score < m.away_score) {
      a.won++; a.points += 3;
      h.lost++;
    } else {
      h.drawn++; h.points++;   // 1 pt each for a draw
      a.drawn++; a.points++;
    }
  }

  return Object.values(table)
    .map(r => ({ ...r, gd: r.gf - r.ga }))
    .sort((a, b) =>
      b.points - a.points ||   // 1st tie-break: points
      b.gd     - a.gd     ||   // 2nd tie-break: goal difference
      b.gf     - a.gf          // 3rd tie-break: goals for
    );
}

// ── Write operations ──────────────────────────────────────────────────────────
// These are called after the match simulator finishes.  They expect an
// authenticated Supabase session (service-role key in a server context or
// a logged-in admin user in the browser).

/**
 * Persist the final score and metadata for a completed match.
 * Sets status='completed' and stamps played_at with the current UTC time.
 *
 * @param {string} matchId - UUID of the match to update
 * @param {{ homeScore: number, awayScore: number, weather?: string, stadium?: string }} result
 * @returns {Promise<void>}
 */
export async function saveMatchResult(matchId, { homeScore, awayScore, weather, stadium }) {
  const { error } = await supabase
    .from('matches')
    .update({
      home_score: homeScore,
      away_score: awayScore,
      weather,
      stadium,
      status:    'completed',
      played_at: new Date().toISOString(),
    })
    .eq('id', matchId);
  if (error) throw error;
}

/**
 * Bulk-upsert per-player stats for a match.
 * Uses upsert (not insert) so re-simulating a match overwrites previous stats
 * rather than duplicating rows.  The unique constraint on (match_id, player_id)
 * is the conflict target.
 *
 * @param {Array<{
 *   match_id: string,
 *   player_id: string,
 *   team_id: string,
 *   goals: number,
 *   assists: number,
 *   yellow_cards: number,
 *   red_cards: number,
 *   minutes_played: number,
 *   rating?: number
 * }>} stats - one row per player who appeared in the match
 * @returns {Promise<void>}
 */
export async function saveMatchPlayerStats(stats) {
  const { error } = await supabase
    .from('match_player_stats')
    .upsert(stats, { onConflict: 'match_id,player_id' });
  if (error) throw error;
}
