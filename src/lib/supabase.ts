// ── supabase.ts ──────────────────────────────────────────────────────────────
// Typed replacements for every helper in supabase.js.
//
// KEY DIFFERENCE FROM supabase.js
// ─────────────────────────────────
// Every async function accepts `db: IslSupabaseClient` as its first argument
// instead of importing the singleton directly.  Call-sites obtain `db` from
// `useSupabase()` (React context) so unit tests can inject a fake client
// without patching module globals.
//
// Pure normaliser helpers (normalizeTeam, normalizeLeague,
// normalizeTeamForEngine) are re-exported unchanged — they contain no I/O.
//
// BACKWARD COMPAT
// ───────────────
// App.jsx imports `from "./lib/supabase.js"` (explicit extension) so it
// continues to use the singleton-based JS file unaffected.

import type { IslSupabaseClient } from '@shared/supabase/client';

// ── Re-exported pure helpers ─────────────────────────────────────────────────

export function normalizeTeam(team: Record<string, unknown>) {
  return {
    ...team,
    homeGround: team['home_ground'],
    leagueId:   team['league_id'],
  };
}

export function normalizeLeague(league: Record<string, unknown>) {
  return {
    ...league,
    shortName: league['short_name'],
  };
}

type RawTeamForEngine = {
  name: string;
  short_name?: string | null;
  id?: string;
  color?: string | null;
  home_ground?: string | null;
  location?: string | null;
  capacity?: string | null;
  players?: Array<{
    name: string;
    position: string;
    starter?: boolean | null;
    attacking?: number | null;
    defending?: number | null;
    mental?: number | null;
    athletic?: number | null;
    technical?: number | null;
    jersey_number?: number | null;
    // Phase 3: incinerated players have is_active=false and must never appear
    // in match rosters.  Filtered out in normalizeTeamForEngine.
    is_active?: boolean | null;
  }>;
  managers?: Array<{ name: string; style?: string | null }>;
};

export function normalizeTeamForEngine(team: RawTeamForEngine) {
  const manager = team.managers?.[0];
  return {
    name:      team.name,
    shortName: team.short_name
      || team.id?.split('-')[0]?.slice(0, 3).toUpperCase()
      || team.name?.slice(0, 3).toUpperCase()
      || 'UNK',
    color:     team.color || '#888888',
    stadium: {
      name:     team.home_ground || team.name,
      planet:   team.location   || 'Unknown',
      capacity: team.capacity   || '50,000',
    },
    tactics: manager?.style?.toLowerCase().replace(/\s+/g, '_') || null,
    manager: manager
      ? { name: manager.name, personality: manager.style || 'Balanced' }
      : undefined,
    // Filter out incinerated players (is_active=false) before mapping into the
    // engine shape.  The engine has no concept of permadeath — it expects every
    // row in `players` to be eligible to start or sub on.  An incinerated player
    // left in the array would still be rotated into matches by the manager AI,
    // breaking the soul of the love-is-dangerous mechanic.  Default `is_active`
    // to true when the field is missing (legacy rows / non-Phase 3 schemas)
    // so this filter never silently drops live players.
    players: (team.players || [])
      .filter(p => p.is_active !== false)
      .map(p => ({
        name:          p.name,
        position:      p.position,
        starter:       p.starter ?? true,
        attacking:     p.attacking  ?? 70,
        defending:     p.defending  ?? 70,
        mental:        p.mental     ?? 70,
        athletic:      p.athletic   ?? 70,
        technical:     p.technical  ?? 70,
        jersey_number: p.jersey_number,
      })),
  };
}

// ── Seasons ───────────────────────────────────────────────────────────────────

export async function getActiveSeason(db: IslSupabaseClient) {
  const { data, error } = await db
    .from('seasons')
    .select('*')
    .eq('is_active', true)
    .single();
  if (error) throw error;
  return data;
}

// ── Leagues ───────────────────────────────────────────────────────────────────

export async function getLeagues(db: IslSupabaseClient) {
  const { data, error } = await db
    .from('leagues')
    .select('*')
    .order('name');
  if (error) throw error;
  return data;
}

// ── Competitions ──────────────────────────────────────────────────────────────

export async function getCompetitionsForSeason(db: IslSupabaseClient, seasonId: string) {
  const { data, error } = await db
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

// ── Matches ───────────────────────────────────────────────────────────────────

export async function getMatchesWithTeamDetail(db: IslSupabaseClient, competitionId: string) {
  const { data, error } = await db
    .from('matches')
    .select(`
      *,
      home_team:teams!matches_home_team_id_fkey (id, name, color, location, home_ground),
      away_team:teams!matches_away_team_id_fkey (id, name, color, location, home_ground)
    `)
    .eq('competition_id', competitionId)
    .order('round', { nullsFirst: true })
    .order('played_at', { nullsFirst: true });
  if (error) throw error;
  return data;
}

export async function getLiveMatches(db: IslSupabaseClient) {
  const { data, error } = await db
    .from('matches')
    .select(`
      *,
      home_team:teams!matches_home_team_id_fkey (id, name, color, location, home_ground),
      away_team:teams!matches_away_team_id_fkey (id, name, color, location, home_ground)
    `)
    .eq('status', 'in_progress')
    .order('scheduled_at', { nullsFirst: true });
  if (error) throw error;
  return data ?? [];
}

export async function getUpcomingMatches(db: IslSupabaseClient, limit = 6) {
  const { data, error } = await db
    .from('matches')
    .select(`
      *,
      home_team:teams!matches_home_team_id_fkey (id, name, color, location, home_ground),
      away_team:teams!matches_away_team_id_fkey (id, name, color, location, home_ground)
    `)
    .eq('status', 'scheduled')
    .not('scheduled_at', 'is', null)
    .order('scheduled_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function getMatch(db: IslSupabaseClient, matchId: string) {
  const { data, error } = await db
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

export async function getTeams(db: IslSupabaseClient, leagueId: string | null = null, withPlayers = false) {
  const playerSelect = withPlayers
    ? ', players(id, name, position, nationality, age, overall_rating, personality, starter)'
    : '';
  let query = db
    .from('teams')
    .select(`*, leagues(id, name, short_name)${playerSelect}`);
  if (leagueId) query = query.eq('league_id', leagueId);
  const { data, error } = await query.order('name');
  if (error) throw error;
  return data;
}

export async function getTeam(db: IslSupabaseClient, teamId: string) {
  const { data, error } = await db
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

/**
 * Fetch only the players for a specific team. More efficient than
 * getTeams(db, null, true) when only one team's roster is needed.
 */
export async function getPlayersForTeam(db: IslSupabaseClient, teamId: string) {
  const { data, error } = await db
    .from('players')
    .select('id, name, position, nationality, age, overall_rating, personality, starter, jersey_number')
    .eq('team_id', teamId)
    .order('starter', { ascending: false })
    .order('name');
  if (error) throw error;
  return data ?? [];
}

export async function getTeamForEngine(db: IslSupabaseClient, teamId: string) {
  const { data, error } = await db
    .from('teams')
    .select('*, players(*), managers(*)')
    .eq('id', teamId)
    .single();
  if (error) throw error;
  return normalizeTeamForEngine(data as unknown as RawTeamForEngine);
}

// ── Players ───────────────────────────────────────────────────────────────────

/**
 * Fetch a single player row plus their aggregated season stats.
 * Distinct from `getPlayer` in `gameEngine.js`, which is an in-engine
 * roster lookup used by the simulator — kept under separate names so
 * fallow's duplicate-export check stays clean and so callers aren't
 * surprised by which signature they get.
 */
export async function getPlayerWithStats(db: IslSupabaseClient, playerId: string) {
  const [playerResult, statsResult] = await Promise.all([
    db.from('players').select('*, teams(id, name)').eq('id', playerId).single(),
    db.from('match_player_stats')
      .select('goals, assists, yellow_cards, red_cards, minutes_played, rating')
      .eq('player_id', playerId),
  ]);

  if (playerResult.error) throw playerResult.error;
  if (statsResult.error)  throw statsResult.error;

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
      avg_rating,
    },
  };
}

/**
 * Named alias for `getPlayerWithStats` that preserves the import contract
 * expected by `PlayerDetail.jsx` and any other JS callers. The two names
 * are intentionally distinct in `supabase.js` (singleton) vs here (DI) to
 * avoid confusion with the in-engine `getPlayer` inside `gameEngine.js`,
 * which does a lightweight roster lookup rather than a stats aggregate.
 *
 * Prefer importing `getPlayerWithStats` directly in new TypeScript code —
 * this alias exists only to avoid a breaking rename across legacy JSX files.
 */
export const getPlayer = getPlayerWithStats;

/**
 * Fetch the `player_idol_score` view row for a single player.
 *
 * The idol score view is computed from wager activity: fans who bet on a
 * player's team accumulate idolisation points for that player. Global rank
 * and team rank are both stored so the PlayerDetail page can surface
 * "Idol rank: #N leaguewide" without a second query.
 *
 * Returns `null` (via `.maybeSingle()`) rather than throwing when the player
 * has no idol score row yet — new or unwagered-on players are unranked rather
 * than errored.
 *
 * @param db       - Injected Supabase client.
 * @param playerId - UUID of the player whose idol rank to fetch.
 * @returns The full `player_idol_score` row, or `null` if unranked.
 */
export async function getPlayerIdolRank(db: IslSupabaseClient, playerId: string) {
  const { data, error } = await db
    .from('player_idol_score')
    .select('*')
    .eq('player_id', playerId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Fetch the global idol board and per-team breakdowns for the /idols page.
 *
 * WHY TWO QUERIES
 * ────────────────
 * The global top-N leaderboard and the per-club top-5 serve different UI
 * sections and have different size requirements. Fetching them separately
 * avoids pulling 700+ rows for the global board when we only need a bounded
 * set, and avoids filtering by a window function result (unsupported in
 * PostgREST) by using `team_rank` as a plain materialised column instead.
 *
 * WHY idol_score = 0 ROWS ARE INCLUDED
 * ──────────────────────────────────────
 * Players with zero idolisation appear at the bottom of the board. Their
 * presence is intentional narrative design — the absence of fan attention
 * is itself a cosmic signal that fans can interpret and discuss.
 *
 * @param db          - Injected Supabase client.
 * @param opts.globalLimit  - Max rows for the leaderboard section. Default 20.
 * @param opts.teamLimit    - Max `team_rank` value for the club section. Default 5.
 * @returns `{ global: IdolRow[], byTeam: Record<teamId, IdolRow[]> }`
 */
export async function getIdolBoard(
  db: IslSupabaseClient,
  { globalLimit = 20, teamLimit = 5 }: { globalLimit?: number; teamLimit?: number } = {},
) {
  // ── Global leaderboard ────────────────────────────────────────────────────
  const { data: topRows, error: topErr } = await db
    .from('player_idol_score')
    .select('*')
    .order('global_rank', { ascending: true })
    .limit(globalLimit);
  if (topErr) throw topErr;

  // ── Per-team top-N ────────────────────────────────────────────────────────
  // team_rank is a materialised window-function column on the view, so
  // PostgREST can filter it with a simple .lte() call.
  const { data: teamRows, error: teamErr } = await db
    .from('player_idol_score')
    .select('*')
    .lte('team_rank', teamLimit)
    .order('team_id', { ascending: true })
    .order('team_rank', { ascending: true });
  if (teamErr) throw teamErr;

  // Group by-team rows into a plain object keyed by team_id for O(1) lookup
  // in the club-breakdown section of the Idols page. Rows whose team_id is
  // null (orphaned players with no club) are skipped — the view column is
  // nullable because PostgreSQL marks every view column nullable by default.
  const byTeam = (teamRows ?? []).reduce<Record<string, typeof teamRows>>((acc, row) => {
    if (!row.team_id) return acc;
    if (!acc[row.team_id]) acc[row.team_id] = [];
    acc[row.team_id]!.push(row);
    return acc;
  }, {});

  return { global: topRows ?? [], byTeam };
}

/**
 * Fetch the top N "hot idol movers" — players whose training-click activity
 * has spiked in the trailing 7-day window.  Reads from the
 * `player_idol_movers` view created by migration 0016.
 *
 * WHY A SEPARATE QUERY FROM getIdolBoard
 *   The absolute idol board (rank 1..20) and the movers strip serve different
 *   UI purposes — the board is "who the cosmos has watched longest", the
 *   strip is "who the cosmos is paying attention to RIGHT NOW".  They have
 *   different ordering, different inputs (the movers view excludes
 *   favourite_player picks entirely; absolute board includes both halves of
 *   the idol_score formula).  Fetching the same view twice in parallel was
 *   tempting but would obscure that the two surfaces answer different
 *   questions.
 *
 * GRACEFUL DEGRADATION
 *   Returns an empty array on error rather than throwing — the movers strip
 *   is enriching UI, not load-bearing.  A failed fetch must never block the
 *   Home or /idols page render.
 *
 * @param db     Injected Supabase client.
 * @param limit  Max rows to return.  Default 5 matches the Home strip width
 *               at desktop; pages can request more for a dedicated section.
 * @returns      Array of mover rows, ordered by recent_clicks DESC.
 */
export async function getHotIdolMovers(db: IslSupabaseClient, limit = 5) {
  try {
    const { data, error } = await db
      .from('player_idol_movers')
      .select('*')
      .order('recent_clicks', { ascending: false })
      .order('name', { ascending: true })
      .limit(limit);
    if (error) {
      console.warn('[getHotIdolMovers] failed:', error.message);
      return [];
    }
    return data ?? [];
  } catch (e) {
    console.warn('[getHotIdolMovers] threw:', e);
    return [];
  }
}

