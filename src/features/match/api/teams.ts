// ── features/match/api/teams.ts ───────────────────────────────────────────
// Slice 4 of #387 — dissolving src/lib/supabase.ts.
//
// Three list reads moved here:
//   - getTeams(db, leagueId?, withPlayers?)  — list teams, optionally by
//                                              league, optionally with the
//                                              full player roster nested.
//   - getTeam(db, teamId)                    — single team + nested
//                                              leagues / players /
//                                              managers join.
//   - getPlayersForTeam(db, teamId)          — narrow player picker for
//                                              the Profile / Training UIs.
//
// All take the typed `IslSupabaseClient` via parameter injection so the
// rest of the app can drop the lib singleton.

import type { IslSupabaseClient } from '@shared/supabase/client';

// ── getTeams ──────────────────────────────────────────────────────────────

/**
 * List teams, optionally filtered to a single league and optionally with
 * each team's full player roster joined in (`withPlayers=true`).
 *
 * Used by /profile (allegiance picker — leagueId omitted, withPlayers
 * false) and /welcome (same call shape).
 *
 * @param db          Injected Supabase client.
 * @param leagueId    When set, restrict to teams in this league. Pass
 *                    `null` (the default) for the full 32-team list.
 * @param withPlayers When `true`, nest the team's `players` array on
 *                    each row. Defaults to false to keep the picker
 *                    payload small.
 */
export async function getTeams(
  db:          IslSupabaseClient,
  leagueId:    string | null = null,
  withPlayers: boolean       = false,
) {
  const playerSelect = withPlayers
    ? ', players(id, name, position, nationality, age, overall_rating, personality, starter)'
    : '';
  let query = db
    .from('teams')
    .select(`*, leagues(id, name, short_name)${playerSelect}`);
  if (leagueId) query = query.eq('league_id', leagueId);
  const { data, error } = await query.order('name');
  if (error) throw error;
  return data ?? [];
}

// ── getTeam ───────────────────────────────────────────────────────────────

/**
 * Fetch a single team row with the nested joins TeamDetail renders:
 * league meta, the full player roster, and any managers attached.
 *
 * Throws on Supabase error so TeamDetail's existing `.catch()` shows
 * the "Unknown Club" fallback path unchanged from the previous
 * lib-singleton implementation.
 *
 * @param db      Injected Supabase client.
 * @param teamId  Team slug (matches `teams.id`).
 * @returns       The joined team row.
 */
export async function getTeam(db: IslSupabaseClient, teamId: string) {
  const { data, error } = await db
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

// ── getPlayersForTeam ─────────────────────────────────────────────────────

/**
 * Players for a single team — used by the Profile allegiance picker and
 * the Training roster. Returns the narrow column set those pickers
 * consume; the full player row is intentionally not joined to keep the
 * payload small in the common picker render path.
 *
 * This function already took `db` as a parameter in `src/lib/supabase.ts`
 * (it predates the dissolution effort). Slice 4 moves it under the
 * match feature so consumers stop importing from the singleton file.
 *
 * @param db      Injected Supabase client.
 * @param teamId  Team slug.
 * @returns       Array of player rows (id, name, position,
 *                jersey_number, starter), ordered starter-first then
 *                jersey-number ascending.
 */
export async function getPlayersForTeam(
  db:     IslSupabaseClient,
  teamId: string,
): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await db
    .from('players')
    .select('id, name, position, jersey_number, starter')
    .eq('team_id', teamId)
    .order('starter',       { ascending: false })
    .order('jersey_number', { ascending: true  });
  if (error) throw error;
  return (data ?? []) as Array<Record<string, unknown>>;
}
