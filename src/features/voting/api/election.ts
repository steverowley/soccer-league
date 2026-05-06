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
  // Cast through `unknown` first because the raw row carries the nested
  // `players` / `teams` objects which aren't part of IncinerationRecord —
  // TypeScript otherwise rejects the direct cast as non-overlapping.
  return ((data ?? []) as Array<Record<string, unknown>>).map(row => ({
    ...(row as unknown as IncinerationRecord),
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
 * Mark a player as incinerated atomically — soft-deletes the player AND writes
 * the audit row in a single Postgres transaction via the `incinerate_player`
 * RPC (migration 0014).
 *
 * WHY AN RPC AND NOT TWO CLIENT-SIDE WRITES:
 * Running the UPDATE and INSERT as separate PostgREST calls leaves a window
 * where the player can be flipped to `is_active=false` while the audit-row
 * INSERT silently fails (network hiccup, RLS rejection, FK violation).  That
 * would leave the player out of all rosters, vanished from the /lost memorial,
 * and the Architect's decree text lost forever.  The RPC wraps both writes in
 * one transaction: either both commit, or neither does.
 *
 * The RPC returns the new incinerations.id so callers can attach Decree rows
 * back to a known audit record.
 *
 * @param db         Injected Supabase client.
 * @param playerId   UUID of the player being incinerated.
 * @param seasonId   UUID of the current season.
 * @param teamId     Team slug of the player's club.
 * @param idolRank   Global idol rank at time of selection (nullable; recorded
 *                   for the Phase 2 audit trail proving the love-is-dangerous
 *                   weighting actually fired).
 * @param decreeText The Architect's spoken line for this incineration — the
 *                   permanent record displayed on /lost.
 * @returns          The UUID of the freshly inserted incinerations row.
 */
export async function incinerate(
  db: IslSupabaseClient,
  playerId: string,
  seasonId: string,
  teamId: string,
  idolRank: number | null,
  decreeText: string,
): Promise<string> {
  const { data, error } = await (db as AnyDb).rpc('incinerate_player', { // CAST:election
    p_player_id:   playerId,
    p_season_id:   seasonId,
    p_team_id:     teamId,
    p_idol_rank:   idolRank,
    p_decree_text: decreeText,
  });
  if (error) throw error;
  // RPC returns the new incinerations.id directly (RETURNS UUID).
  return data as string;
}
