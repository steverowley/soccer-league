// ── voting/api/election.ts ────────────────────────────────────────────────────
// Supabase queries for Election Night orchestration and the memorial page.
// All functions take an injected Supabase client (no direct import of supabase
// singleton — dependency injection keeps these unit-testable and backend-safe).
//
// TABLES / VIEWS USED (created by migrations 0006 + 0013):
//   seasons           — status field added in 0013
//   season_decrees    — the Architect's Election Night pronouncements (0013)
//   incinerations     — permadeath audit log (0013)
//   players           — is_active / incineration_date columns (0013)
//   focus_tally       — voting results view (0006)
//
// ALL CASTS marked CAST:election for grep-and-remove after database.ts regen.
// ──────────────────────────────────────────────────────────────────────────────

import type { IslSupabaseClient } from '@shared/supabase/client';
import type { FocusTallyEntry }   from '../types';

// TYPE ESCAPE HATCH — tables added in 0013 not yet in generated database.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

// ── Shape interfaces ───────────────────────────────────────────────────────────
// Manually typed until database.ts is regenerated after 0013 is applied.

/** A season row with the phase fields added in migration 0013. */
export interface SeasonWithPhase {
  id: string;
  name: string;
  year: number;
  is_active: boolean;
  start_date: string | null;
  end_date: string | null;
  status: 'in_play' | 'election_open' | 'election_closed' | 'completed';
  election_opens_at: string | null;
  election_closes_at: string | null;
  created_at: string;
}

/** A row from the season_decrees table. */
export interface SeasonDecree {
  id: string;
  season_id: string;
  decree_type: 'incineration' | 'transformation' | 'focus_enacted' | 'blessing' | 'proclamation';
  player_id: string | null;
  team_id: string | null;
  text: string;
  sequence_order: number;
  created_at: string;
}

/** A row from the incinerations table joined with the player name. */
export interface IncinerationRecord {
  id: string;
  player_id: string;
  season_id: string;
  team_id: string | null;
  idol_rank_at_time: number | null;
  decree_text: string;
  replacement_player_id: string | null;
  created_at: string;
  /** Joined from players. */
  player_name: string | null;
  /** Joined from players. */
  team_name: string | null;
}

// ── Season phase reads ─────────────────────────────────────────────────────────

/**
 * Fetch the active season including phase fields added in migration 0013.
 * Returns null when no season is active (e.g. between seasons).
 *
 * @param db  Injected Supabase client.
 */
export async function getActiveSeasonWithPhase(db: IslSupabaseClient): Promise<SeasonWithPhase | null> {
  const { data, error } = await (db as AnyDb) // CAST:election
    .from('seasons')
    .select('*')
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw error;
  return data as SeasonWithPhase | null;
}

// ── Decree reads ──────────────────────────────────────────────────────────────

/**
 * Fetch all decrees for a season, ordered by their Election Night sequence.
 *
 * Used by the ElectionNight page to power the live ticker and by the memorial
 * page to show what was decreed each season.
 *
 * @param db        Injected Supabase client.
 * @param seasonId  UUID of the season to fetch decrees for.
 */
export async function getSeasonDecrees(
  db: IslSupabaseClient,
  seasonId: string,
): Promise<SeasonDecree[]> {
  const { data, error } = await (db as AnyDb) // CAST:election
    .from('season_decrees')
    .select('*')
    .eq('season_id', seasonId)
    .order('sequence_order', { ascending: true });
  if (error) throw error;
  return (data ?? []) as SeasonDecree[];
}

// ── Incineration reads ────────────────────────────────────────────────────────

/**
 * Fetch all incineration records across all seasons for the memorial page.
 * Joins player name and team name so the memorial page doesn't need extra
 * queries.
 *
 * Results are ordered by created_at DESC (most recent first) so the most
 * recent loss appears at the top of the /lost page.
 *
 * @param db  Injected Supabase client.
 */
export async function getAllIncinerations(db: IslSupabaseClient): Promise<IncinerationRecord[]> {
  const { data, error } = await (db as AnyDb) // CAST:election
    .from('incinerations')
    .select(`
      *,
      players!player_id ( name ),
      teams!team_id ( name )
    `)
    .order('created_at', { ascending: false });
  if (error) throw error;

  // Flatten the nested join objects into flat fields.
  return ((data ?? []) as Array<Record<string, unknown>>).map(row => ({
    ...(row as IncinerationRecord),
    player_name: (row['players'] as { name?: string } | null)?.name ?? null,
    team_name:   (row['teams']   as { name?: string } | null)?.name ?? null,
  }));
}

// ── Voting tally reads ────────────────────────────────────────────────────────

/**
 * Fetch the full focus_tally for a season — all teams, both tiers.
 * Used by the Election Night page to show what each team's fans voted for.
 *
 * @param db        Injected Supabase client.
 * @param seasonId  Season UUID.
 */
export async function getSeasonFocusTally(
  db: IslSupabaseClient,
  seasonId: string,
): Promise<FocusTallyEntry[]> {
  const { data, error } = await (db as AnyDb) // CAST:election
    .from('focus_tally')
    .select('*')
    .eq('season_id', seasonId)
    .order('team_id', { ascending: true })
    .order('tier',    { ascending: true })
    .order('total_credits', { ascending: false });
  if (error) throw error;
  return (data ?? []) as FocusTallyEntry[];
}

// ── Phase mutations ───────────────────────────────────────────────────────────
// NOTE: In production these writes are performed by a server-side Edge Function
// (authenticated service role) rather than the browser client.  These functions
// are provided for dev/admin use and for the Election Night trigger in
// ElectionNight.jsx (DEV-gated).

/**
 * Advance a season to the next phase.
 *
 * Valid transitions:
 *   in_play → election_open
 *   election_open → election_closed
 *   election_closed → completed
 *
 * Does NOT validate the current status — callers must check before advancing.
 *
 * @param db        Injected Supabase client.
 * @param seasonId  UUID of the season to advance.
 * @param newStatus The target status.
 */
export async function advanceSeasonPhase(
  db: IslSupabaseClient,
  seasonId: string,
  newStatus: SeasonWithPhase['status'],
): Promise<void> {
  const { error } = await (db as AnyDb) // CAST:election
    .from('seasons')
    .update({ status: newStatus })
    .eq('id', seasonId);
  if (error) throw error;
}

/**
 * Write a batch of season decrees.  Used by the Election Night orchestrator
 * after generating Architect text for each decree via Claude.
 *
 * @param db       Injected Supabase client.
 * @param decrees  Array of decree objects (without id/created_at).
 */
export async function insertSeasonDecrees(
  db: IslSupabaseClient,
  decrees: Omit<SeasonDecree, 'id' | 'created_at'>[],
): Promise<void> {
  const { error } = await (db as AnyDb) // CAST:election
    .from('season_decrees')
    .insert(decrees);
  if (error) throw error;
}

/**
 * Mark a player as incinerated.  Sets is_active = false and records
 * incineration_date on the players row, then inserts an incinerations audit
 * row.  Both writes must succeed; if either fails the error propagates.
 *
 * @param db         Injected Supabase client.
 * @param playerId   UUID of the player being incinerated.
 * @param seasonId   UUID of the current season.
 * @param teamId     Team slug of the player's club.
 * @param idolRank   Global idol rank at time of selection (nullable).
 * @param decreeText The Architect's spoken line for this incineration.
 */
export async function incinerate(
  db: IslSupabaseClient,
  playerId: string,
  seasonId: string,
  teamId: string,
  idolRank: number | null,
  decreeText: string,
): Promise<void> {
  // Mark the player inactive first so no concurrent query can assign them to
  // a new match while the incinerations row is being written.
  const { error: playerErr } = await (db as AnyDb) // CAST:election
    .from('players')
    .update({ is_active: false, incineration_date: new Date().toISOString() })
    .eq('id', playerId);
  if (playerErr) throw playerErr;

  // Write the audit row.
  const { error: auditErr } = await (db as AnyDb) // CAST:election
    .from('incinerations')
    .insert({
      player_id: playerId,
      season_id: seasonId,
      team_id: teamId,
      idol_rank_at_time: idolRank,
      decree_text: decreeText,
    });
  if (auditErr) throw auditErr;
}
