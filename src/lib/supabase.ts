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
// Slice 3: `getActiveSeason`
//   → features/match/api/seasons.ts
// Slice 4: `getTeams`, `getTeam`, `getPlayersForTeam`
//   → features/match/api/teams.ts
// Slice 5: `getPlayer`, `getManager` + `ManagerWithContext`
//   → features/match/api/{players,managers}.ts
// Slice 6 (this PR): `getIdolBoard`, `getPlayerIdolRank`,
//                    `getTopIdolsForArchitect` + IdolRow / IdolBoardResult
//                    / TopIdolForArchitect types
//   → features/match/api/idols.ts
//
// Slice 3 also deleted as dead code: normalizeTeam, normalizeLeague,
// getSeasons, getLeagues, getCompetitionsForSeason, getCompetition,
// getMatchesForCompetition, getMatchesWithTeamDetail. Verified via
// grep across src/ — no consumers in the live tree.


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

