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
    players: (team.players || []).map(p => ({
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

export async function getSeasons(db: IslSupabaseClient) {
  const { data, error } = await db
    .from('seasons')
    .select('*')
    .order('year', { ascending: false });
  if (error) throw error;
  return data;
}

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

export async function getCompetition(db: IslSupabaseClient, competitionId: string) {
  const { data, error } = await db
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

export async function getMatchesForCompetition(db: IslSupabaseClient, competitionId: string) {
  const { data, error } = await db
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

export async function getPlayer(db: IslSupabaseClient, playerId: string) {
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

// ── Standings ─────────────────────────────────────────────────────────────────

export async function getStandings(db: IslSupabaseClient, competitionId: string) {
  const { data: matches, error } = await db
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

  type TeamRef = { id: string; name: string; color: string | null };
  const table: Record<string, {
    team: TeamRef; played: number; won: number; drawn: number; lost: number;
    gf: number; ga: number; gd: number; points: number;
  }> = {};

  const ensure = (team: TeamRef) => {
    if (!table[team.id]) {
      table[team.id] = { team, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 0 };
    }
  };

  for (const m of matches) {
    const homeTeam = m['home_team'] as unknown as TeamRef;
    const awayTeam = m['away_team'] as unknown as TeamRef;
    if (!homeTeam || !awayTeam) continue;
    ensure(homeTeam);
    ensure(awayTeam);

    const h = table[m.home_team_id!]!;
    const a = table[m.away_team_id!]!;
    h.played++; a.played++;
    h.gf += m.home_score ?? 0; h.ga += m.away_score ?? 0;
    a.gf += m.away_score ?? 0; a.ga += m.home_score ?? 0;

    if ((m.home_score ?? 0) > (m.away_score ?? 0)) {
      h.won++; h.points += 3; a.lost++;
    } else if ((m.home_score ?? 0) < (m.away_score ?? 0)) {
      a.won++; a.points += 3; h.lost++;
    } else {
      h.drawn++; h.points++; a.drawn++; a.points++;
    }
  }

  return Object.values(table)
    .map(r => ({ ...r, gd: r.gf - r.ga }))
    .sort((a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf);
}

// ── Write operations ──────────────────────────────────────────────────────────

export async function saveMatchResult(
  db: IslSupabaseClient,
  matchId: string,
  { homeScore, awayScore, weather, stadium }: {
    homeScore: number; awayScore: number; weather?: string; stadium?: string;
  },
) {
  const { error } = await db
    .from('matches')
    .update({
      home_score: homeScore,
      away_score: awayScore,
      weather: weather ?? null,
      stadium: stadium ?? null,
      status:    'completed',
      played_at: new Date().toISOString(),
    })
    .eq('id', matchId);
  if (error) throw error;
}

export async function saveMatchPlayerStats(
  db: IslSupabaseClient,
  stats: Array<{
    match_id: string; player_id: string; team_id: string;
    goals: number; assists: number; yellow_cards: number;
    red_cards: number; minutes_played: number; rating?: number;
  }>,
) {
  const { error } = await db
    .from('match_player_stats')
    .upsert(stats, { onConflict: 'match_id,player_id' });
  if (error) throw error;
}
