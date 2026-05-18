import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Database } from '../types/database';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase: SupabaseClient<Database> = createClient<Database>(SUPABASE_URL, SUPABASE_ANON);

export function normalizeTeam(team: Database['public']['Tables']['teams']['Row']) {
  return {
    ...team,
    homeGround: team.home_ground,
    leagueId: team.league_id,
  };
}

export function normalizeLeague(league: Database['public']['Tables']['leagues']['Row']) {
  return {
    ...league,
    shortName: league.short_name,
  };
}

export async function getSeasons() {
  const { data, error } = await supabase
    .from('seasons')
    .select('*')
    .order('year', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getActiveSeason() {
  const { data, error } = await supabase
    .from('seasons')
    .select('*')
    .eq('is_active', true)
    .single();
  if (error) throw error;
  return data;
}

export async function getLeagues() {
  const { data, error } = await supabase
    .from('leagues')
    .select('*')
    .order('name');
  if (error) throw error;
  return data ?? [];
}

export async function getCompetitionsForSeason(seasonId: string) {
  const { data, error } = await supabase
    .from('competitions')
    .select(
      `
      *,
      leagues (id, name, short_name),
      competition_teams (
        group_name,
        seeding,
        teams (id, name, color, location)
      )
    `,
    )
    .eq('season_id', seasonId)
    .order('type');
  if (error) throw error;
  return data ?? [];
}

export async function getCompetition(competitionId: string) {
  const { data, error } = await supabase
    .from('competitions')
    .select(
      `
      *,
      seasons (id, name, year),
      leagues (id, name, short_name),
      competition_teams (
        group_name,
        seeding,
        teams (*)
      )
    `,
    )
    .eq('id', competitionId)
    .single();
  if (error) throw error;
  return data;
}

export async function getMatchesForCompetition(competitionId: string) {
  const { data, error } = await supabase
    .from('matches')
    .select(
      `
      *,
      home_team:teams!matches_home_team_id_fkey (id, name, color),
      away_team:teams!matches_away_team_id_fkey (id, name, color)
    `,
    )
    .eq('competition_id', competitionId)
    .order('played_at', { nullsFirst: true });
  if (error) throw error;
  return data ?? [];
}

export async function getMatchesWithTeamDetail(competitionId: string) {
  const { data, error } = await supabase
    .from('matches')
    .select(
      `
      *,
      home_team:teams!matches_home_team_id_fkey (id, name, color, location, home_ground),
      away_team:teams!matches_away_team_id_fkey (id, name, color, location, home_ground)
    `,
    )
    .eq('competition_id', competitionId)
    .order('round', { nullsFirst: true })
    .order('played_at', { nullsFirst: true });
  if (error) throw error;
  return data ?? [];
}

export async function getLiveMatches() {
  const { data, error } = await supabase
    .from('matches')
    .select(
      `
      *,
      home_team:teams!matches_home_team_id_fkey (id, name, color, location, home_ground),
      away_team:teams!matches_away_team_id_fkey (id, name, color, location, home_ground)
    `,
    )
    .eq('status', 'in_progress')
    .order('scheduled_at', { nullsFirst: true });
  if (error) throw error;
  return data ?? [];
}

export async function getUpcomingMatches(limit = 6) {
  const { data, error } = await supabase
    .from('matches')
    .select(
      `
      *,
      home_team:teams!matches_home_team_id_fkey (id, name, color, location, home_ground),
      away_team:teams!matches_away_team_id_fkey (id, name, color, location, home_ground)
    `,
    )
    .eq('status', 'scheduled')
    .not('scheduled_at', 'is', null)
    .order('scheduled_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function getMatch(matchId: string) {
  const { data, error } = await supabase
    .from('matches')
    .select(
      `
      *,
      competitions (id, name, type, format),
      home_team:teams!matches_home_team_id_fkey (*),
      away_team:teams!matches_away_team_id_fkey (*),
      match_player_stats (
        *,
        players (id, name, position, overall_rating)
      )
    `,
    )
    .eq('id', matchId)
    .single();
  if (error) throw error;
  return data;
}

export async function getTeams(leagueId: string | null = null, withPlayers = false) {
  const playerSelect = withPlayers
    ? ', players(id, name, position, nationality, age, overall_rating, personality, starter)'
    : '';
  let query = supabase
    .from('teams')
    .select(`*, leagues(id, name, short_name)${playerSelect}`);
  if (leagueId) query = query.eq('league_id', leagueId);
  const { data, error } = await query.order('name');
  if (error) throw error;
  return data ?? [];
}

export async function getTeam(teamId: string) {
  const { data, error } = await supabase
    .from('teams')
    .select(
      `
      *,
      leagues (id, name, short_name),
      players (*),
      managers (*)
    `,
    )
    .eq('id', teamId)
    .single();
  if (error) throw error;
  return data;
}

interface EnginePlayer {
  name: string;
  position: string;
  starter: boolean;
  attacking: number;
  defending: number;
  mental: number;
  athletic: number;
  technical: number;
  jersey_number?: number | null;
}

interface EngineManager {
  name: string;
  personality: string;
}

interface EngineTeam {
  name: string;
  shortName: string;
  color: string;
  stadium: {
    name: string;
    planet: string;
    capacity: string;
  };
  tactics: string | null;
  manager?: EngineManager;
  players: EnginePlayer[];
}

export function normalizeTeamForEngine(team: any): EngineTeam {
  const manager = team.managers?.[0];

  return {
    name: team.name,
    shortName:
      team.short_name || team.id?.split('-')[0]?.slice(0, 3).toUpperCase() || team.name?.slice(0, 3).toUpperCase() || 'UNK',
    color: team.color || '#888888',

    stadium: {
      name: team.home_ground || team.name,
      planet: team.location || 'Unknown',
      capacity: team.capacity || '50,000',
    },

    tactics: manager?.style?.toLowerCase().replace(/\s+/g, '_') || null,

    manager: manager ? { name: manager.name, personality: manager.style || 'Balanced' } : undefined,

    players: (team.players || [])
      .filter((p: any) => p.is_active !== false)
      .map((p: any) => ({
        name: p.name,
        position: p.position,
        starter: p.starter ?? true,
        attacking: p.attacking ?? 70,
        defending: p.defending ?? 70,
        mental: p.mental ?? 70,
        athletic: p.athletic ?? 70,
        technical: p.technical ?? 70,
        jersey_number: p.jersey_number,
      })),
  };
}

export async function getTeamForEngine(teamId: string): Promise<EngineTeam> {
  const { data, error } = await supabase
    .from('teams')
    .select('*, players(*), managers(*)')
    .eq('id', teamId)
    .single();
  if (error) throw error;
  return normalizeTeamForEngine(data);
}

interface SeasonStats {
  goals: number;
  assists: number;
  yellow_cards: number;
  red_cards: number;
  minutes_played: number;
  matches_played: number;
  avg_rating: number | null;
}

interface PlayerWithStats extends Database['public']['Tables']['players']['Row'] {
  teams: { id: string; name: string };
  seasonStats: SeasonStats;
}

export async function getPlayer(playerId: string): Promise<PlayerWithStats> {
  const [playerResult, statsResult] = await Promise.all([
    supabase.from('players').select('*, teams(id, name)').eq('id', playerId).single(),
    supabase
      .from('match_player_stats')
      .select('goals, assists, yellow_cards, red_cards, minutes_played, rating')
      .eq('player_id', playerId),
  ]);

  if (playerResult.error) throw playerResult.error;
  if (statsResult.error) throw statsResult.error;

  const statRows = statsResult.data ?? [];
  const agg = statRows.reduce(
    (acc: any, row: any) => ({
      goals: acc.goals + (row.goals ?? 0),
      assists: acc.assists + (row.assists ?? 0),
      yellow_cards: acc.yellow_cards + (row.yellow_cards ?? 0),
      red_cards: acc.red_cards + (row.red_cards ?? 0),
      minutes_played: acc.minutes_played + (row.minutes_played ?? 0),
      matches_played: acc.matches_played + 1,
      _rsum: acc._rsum + (row.rating ?? 0),
      _rcnt: acc._rcnt + (row.rating != null ? 1 : 0),
    }),
    {
      goals: 0,
      assists: 0,
      yellow_cards: 0,
      red_cards: 0,
      minutes_played: 0,
      matches_played: 0,
      _rsum: 0,
      _rcnt: 0,
    },
  );

  const avg_rating = agg._rcnt > 0 ? +(agg._rsum / agg._rcnt).toFixed(1) : null;

  return {
    ...playerResult.data,
    seasonStats: {
      goals: agg.goals,
      assists: agg.assists,
      yellow_cards: agg.yellow_cards,
      red_cards: agg.red_cards,
      minutes_played: agg.minutes_played,
      matches_played: agg.matches_played,
      avg_rating,
    },
  };
}

interface StandingsRow {
  team: any;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  gd: number;
  points: number;
}

export async function getStandings(competitionId: string): Promise<StandingsRow[]> {
  const { data: matches, error } = await supabase
    .from('matches')
    .select(
      `
      home_team_id, away_team_id,
      home_score, away_score,
      home_team:teams!matches_home_team_id_fkey (id, name, color),
      away_team:teams!matches_away_team_id_fkey (id, name, color)
    `,
    )
    .eq('competition_id', competitionId)
    .eq('status', 'completed');
  if (error) throw error;

  const table: Record<string, any> = {};

  const ensure = (team: any) => {
    if (!table[team.id]) {
      table[team.id] = {
        team,
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        gf: 0,
        ga: 0,
        gd: 0,
        points: 0,
      };
    }
  };

  for (const m of matches ?? []) {
    ensure(m.home_team);
    ensure(m.away_team);

    const h = table[m.home_team_id];
    const a = table[m.away_team_id];

    h.played++;
    a.played++;
    h.gf += m.home_score;
    h.ga += m.away_score;
    a.gf += m.away_score;
    a.ga += m.home_score;

    if (m.home_score > m.away_score) {
      h.won++;
      h.points += 3;
      a.lost++;
    } else if (m.home_score < m.away_score) {
      a.won++;
      a.points += 3;
      h.lost++;
    } else {
      h.drawn++;
      h.points++;
      a.drawn++;
      a.points++;
    }
  }

  return Object.values(table)
    .map((r: any) => ({ ...r, gd: r.gf - r.ga }))
    .sort((a: any, b: any) => b.points - a.points || (b.gd - a.gd) || (b.gf - a.gf));
}

interface MatchResultInput {
  homeScore: number;
  awayScore: number;
  weather?: string;
  stadium?: string;
}

export async function saveMatchResult(matchId: string, { homeScore, awayScore, weather, stadium }: MatchResultInput) {
  const { error } = await supabase
    .from('matches')
    .update({
      home_score: homeScore,
      away_score: awayScore,
      weather,
      stadium,
      status: 'completed',
      played_at: new Date().toISOString(),
    })
    .eq('id', matchId);
  if (error) throw error;
}

interface MatchPlayerStat {
  match_id: string;
  player_id: string;
  team_id: string;
  goals: number;
  assists: number;
  yellow_cards: number;
  red_cards: number;
  minutes_played: number;
  rating?: number;
}

export async function saveMatchPlayerStats(stats: MatchPlayerStat[]) {
  const { error } = await supabase
    .from('match_player_stats')
    .upsert(stats, { onConflict: 'match_id,player_id' });
  if (error) throw error;
}

interface IdolRow {
  id: string;
  name: string;
  team_id: string;
  global_rank: number;
  team_rank: number;
  favourite_count: number;
  training_count_14d: number;
}

interface IdolBoardResult {
  global: IdolRow[];
  byTeam: Record<string, IdolRow[]>;
}

export async function getIdolBoard(
  db: SupabaseClient<Database>,
  { globalLimit = 20, teamLimit = 5 } = {},
): Promise<IdolBoardResult> {
  const { data: topRows, error: topErr } = await db
    .from('player_idol_score')
    .select('*')
    .order('global_rank', { ascending: true })
    .limit(globalLimit);
  if (topErr) throw topErr;

  const { data: teamRows, error: teamErr } = await db
    .from('player_idol_score')
    .select('*')
    .lte('team_rank', teamLimit)
    .order('team_id', { ascending: true })
    .order('team_rank', { ascending: true });
  if (teamErr) throw teamErr;

  const byTeam = (teamRows ?? []).reduce(
    (acc: Record<string, IdolRow[]>, row: any) => {
      if (!acc[row.team_id]) acc[row.team_id] = [];
      acc[row.team_id].push(row);
      return acc;
    },
    {},
  );

  return { global: (topRows ?? []) as IdolRow[], byTeam };
}

export async function getPlayerIdolRank(db: SupabaseClient<Database>, playerId: string): Promise<IdolRow | null> {
  const { data, error } = await db
    .from('player_idol_score')
    .select('*')
    .eq('player_id', playerId)
    .maybeSingle();
  if (error) throw error;
  return (data as IdolRow | null) ?? null;
}

interface TopIdolForArchitect {
  name: string;
  globalRank: number;
}

export async function getTopIdolsForArchitect(db: SupabaseClient<Database>, limit = 10): Promise<TopIdolForArchitect[]> {
  try {
    const { data, error } = await db
      .from('player_idol_score')
      .select('name, global_rank')
      .order('global_rank', { ascending: true })
      .limit(limit);
    if (error) return [];
    return ((data ?? []) as any[]).map((r: any) => ({ name: r.name, globalRank: r.global_rank }));
  } catch {
    return [];
  }
}
