import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../types/database';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase: SupabaseClient<Database> = createClient<Database>(SUPABASE_URL, SUPABASE_ANON);


// #387 EXTRACTIONS SO FAR
// ────────────────────────
// Slice 1: `getMatch`
//   → features/match/api/matches.ts
// Slice 2: `getLiveMatches`, `getUpcomingMatches`,
//          LIVE_WINDOW_SECONDS pacing constant
//   → features/match/api/matches.ts
// Slice 3 (this PR): `getActiveSeason`
//   → features/match/api/seasons.ts
//
// This slice also deleted as dead code: normalizeTeam, normalizeLeague,
// getSeasons, getLeagues, getCompetitionsForSeason, getCompetition,
// getMatchesForCompetition, getMatchesWithTeamDetail. Verified via
// grep across src/ — no consumers in the live tree.

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

export function normalizeTeamForEngine(team: Record<string, unknown>): EngineTeam {
  const name = team.name as string;
  const id = team.id as string | undefined;
  const shortName = team.short_name as string | undefined;
  const color = team.color as string | undefined;
  const homeGround = team.home_ground as string | undefined;
  const location = team.location as string | undefined;
  const capacity = team.capacity as string | undefined;
  const managers = team.managers as Array<Record<string, unknown>> | undefined;
  const players = team.players as Array<Record<string, unknown>> | undefined;

  const manager = managers?.[0];

  return {
    name,
    shortName:
      shortName || id?.split('-')[0]?.slice(0, 3).toUpperCase() || name?.slice(0, 3).toUpperCase() || 'UNK',
    color: color || '#888888',

    stadium: {
      name: homeGround || name,
      planet: location || 'Unknown',
      capacity: capacity || '50,000',
    },

    tactics: (manager?.style as string | undefined)?.toLowerCase().replace(/\s+/g, '_') || null,

    manager: manager ? { name: manager.name as string, personality: (manager.style as string) || 'Balanced' } : undefined,

    players: (players || [])
      .filter((p) => (p.is_active as boolean) !== false)
      .map((p) => ({
        name: p.name as string,
        position: p.position as string,
        starter: (p.starter as boolean) ?? true,
        // entity_id threads through so reflex-tier resolvers can look up
        // the player's persona + memories.  Optional — pre-Phase 2
        // fixtures still omit it; engine falls back to name-only behavior.
        entity_id: (p.entity_id as string | null | undefined) ?? null,
        attacking: (p.attacking as number) ?? 70,
        defending: (p.defending as number) ?? 70,
        mental: (p.mental as number) ?? 70,
        athletic: (p.athletic as number) ?? 70,
        technical: (p.technical as number) ?? 70,
        jersey_number: (p.jersey_number as number) ?? 0,
      })) as EnginePlayer[],
  } as EngineTeam;
}

export async function getTeamForEngine(teamId: string): Promise<EngineTeam> {
  const { data, error } = await supabase
    .from('teams')
    .select('*, players(*), managers(*)')
    .eq('id', teamId)
    .single();
  if (error) throw error;
  return normalizeTeamForEngine(data as Parameters<typeof normalizeTeamForEngine>[0]);
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

type PlayerWithStats = {
  seasonStats: SeasonStats;
  [key: string]: unknown;
};

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
    (acc: { goals: number; assists: number; yellow_cards: number; red_cards: number; minutes_played: number; matches_played: number; _rsum: number; _rcnt: number }, row: { goals?: number | null; assists?: number | null; yellow_cards?: number | null; red_cards?: number | null; minutes_played?: number | null; rating?: number | null }) => ({
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
  } as PlayerWithStats;
}

// ── Manager fetch ────────────────────────────────────────────────────────────
// Powers the /managers/:managerId detail page (bd isl-aai).  Returns the
// manager row joined to its current team + the entity row + entity_traits
// so the page can render bio fields without a chain of follow-up queries.

/**
 * Manager row + adjacent context the detail page renders.
 *
 * `teams` is the join from `managers.team_id` (null when the manager
 * is detached — e.g. after a drama-tier resignation).  `entity` and
 * `traits` come from the Universal Agent System entity graph so the
 * page can read JSON-shaped flavour (tactical preferences, voice
 * fragments) without exposing raw engine stats.
 */
export interface ManagerWithContext {
  id: string;
  name: string;
  nationality: string | null;
  style: string | null;
  team_id: string | null;
  entity_id: string | null;
  teams: { id: string; name: string; color: string | null } | null;
  entity: { id: string; display_name: string | null; meta: Json | null } | null;
  traits: Array<{ trait_key: string; trait_value: Json }>;
}

/**
 * Fetch a manager + the join to teams + their entity row + traits.
 *
 * Best-effort: returns null when the manager id doesn't exist or the
 * primary query errors so callers can render the standard "Unknown
 * Manager" surface rather than getting a thrown error.  Entity / trait
 * lookup failures degrade silently — the page still renders with
 * `entity: null` / `traits: []` and the bio just omits those fields.
 *
 * @param db         Injected Supabase client.
 * @param managerId  Manager UUID.
 * @returns          Manager bundle or null.
 */
export async function getManager(
  db: SupabaseClient<Database>,
  managerId: string,
): Promise<ManagerWithContext | null> {
  const { data: managerRow, error: managerErr } = await db
    .from('managers')
    .select('id, name, nationality, style, team_id, entity_id, teams(id, name, color)')
    .eq('id', managerId)
    .maybeSingle();

  if (managerErr || !managerRow) {
    if (managerErr) console.warn('[getManager] manager fetch failed:', managerErr.message);
    return null;
  }

  // Entity + traits — best-effort.  Empty results render gracefully.
  let entity: ManagerWithContext['entity'] = null;
  let traits: ManagerWithContext['traits'] = [];

  if (managerRow.entity_id) {
    const [entityRes, traitsRes] = await Promise.all([
      db.from('entities')
        .select('id, display_name, meta')
        .eq('id', managerRow.entity_id)
        .maybeSingle(),
      db.from('entity_traits')
        .select('trait_key, trait_value')
        .eq('entity_id', managerRow.entity_id),
    ]);
    if (entityRes.data) entity = entityRes.data;
    if (traitsRes.data) traits = traitsRes.data;
  }

  // ── Normalise PostgREST's embedded `teams` shape ─────────────────────────
  // PostgREST embeds a related row as either an OBJECT (the canonical
  // one-to-one shape) or an ARRAY of length 0/1 (when the relationship
  // is detected as ambiguous or has no enforced cardinality).
  // `ManagerWithContext.teams` is typed as a singular object, so a
  // runtime array would silently break `manager.teams?.name` accesses
  // in ManagerDetail.  Flatten any array shape to the first element (or
  // null) so the consumer always sees one canonical type.
  const rawTeams = (managerRow as { teams?: unknown }).teams;
  const teamsObject: ManagerWithContext['teams'] = Array.isArray(rawTeams)
    ? ((rawTeams[0] as ManagerWithContext['teams']) ?? null)
    : ((rawTeams as ManagerWithContext['teams']) ?? null);

  return {
    ...(managerRow as unknown as ManagerWithContext),
    teams: teamsObject,
    entity,
    traits,
  };
}

interface StandingsRow {
  team: { id: string; name: string; color: string | null };
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

  const table: Record<string, StandingsRow> = {};

  const ensure = (team: Record<string, unknown>) => {
    const id = team.id as string;
    if (!table[id]) {
      table[id] = {
        team: team as StandingsRow['team'],
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

    const h = table[(m.home_team_id as string)];
    const a = table[(m.away_team_id as string)];

    if (!h || !a) continue;

    const homeScore = m.home_score as number;
    const awayScore = m.away_score as number;

    h.played++;
    a.played++;
    h.gf += homeScore;
    h.ga += awayScore;
    a.gf += awayScore;
    a.ga += homeScore;

    if (homeScore > awayScore) {
      h.won++;
      h.points += 3;
      a.lost++;
    } else if (homeScore < awayScore) {
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
    .map((r) => ({ ...r, gd: r.gf - r.ga }))
    .sort((a, b) => b.points - a.points || (b.gd - a.gd) || (b.gf - a.gf));
}

interface MatchResultInput {
  homeScore: number;
  awayScore: number;
  weather?: string;
  stadium?: string;
}

export async function saveMatchResult(matchId: string, { homeScore, awayScore, weather, stadium }: MatchResultInput) {
  const updateData: Record<string, unknown> = {
    home_score: homeScore,
    away_score: awayScore,
    status: 'completed',
    played_at: new Date().toISOString(),
  };
  if (weather !== undefined) updateData.weather = weather;
  if (stadium !== undefined) updateData.stadium = stadium;

  const { error } = await supabase
    .from('matches')
    .update(updateData)
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
    (acc: Record<string, unknown[]>, row: Record<string, unknown>) => {
      const teamId = row.team_id as string;
      if (!acc[teamId]) acc[teamId] = [];
      acc[teamId].push(row);
      return acc;
    },
    {},
  ) as Record<string, IdolRow[]>;

  return { global: ((topRows as unknown) ?? []) as IdolRow[], byTeam };
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
    return ((data as unknown ?? []) as Array<Record<string, unknown>>).map((r) => ({ name: r.name as string, globalRank: r.global_rank as number }));
  } catch {
    return [];
  }
}

// ── db-injected helpers used by Profile and Training pages ──────────────────
// These take an explicit SupabaseClient first argument (dependency injection
// pattern) so the pages can use the client from useSupabase() rather than
// importing the singleton.  The underlying queries are identical to the
// singleton-based counterparts above.

/** Flat list of all teams (with league join) — injected-client variant. */
export async function getTeamsWithDb(
  db: SupabaseClient<Database>,
): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await db
    .from('teams')
    .select('*, leagues(id, name, short_name)')
    .order('name');
  if (error) throw error;
  return (data ?? []) as Array<Record<string, unknown>>;
}

/** Players for a single team — used by the Profile allegiance picker and
 *  the Training roster.  Returns the fields the pickers consume. */
export async function getPlayersForTeam(
  db: SupabaseClient<Database>,
  teamId: string,
): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await db
    .from('players')
    .select('id, name, position, jersey_number, starter')
    .eq('team_id', teamId)
    .order('starter', { ascending: false })
    .order('jersey_number', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Array<Record<string, unknown>>;
}
