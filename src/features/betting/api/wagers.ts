// ── betting/api/wagers.ts ────────────────────────────────────────────────────
// WHY: Supabase queries for the wager lifecycle — placement, history, and
// settlement. All queries take an injected Supabase client; no direct imports.
//
// CREDIT MUTATION STRATEGY — ATOMIC RPC (migration 0053)
// ──────────────────────────────────────────────────────────
// `placeWager` calls a SECURITY DEFINER RPC that wraps the whole transaction
// with `SELECT … FOR UPDATE` row locking, preventing the TOCTOU double-spend the
// previous read-modify-write allowed under concurrent bets:
//   - place_wager(match_id, team_choice, stake, odds)
//
// Settlement is NOT done here: it runs server-side in the match-worker, and
// `settle_wager` is service-role only (migration 0074 / #557). This file only
// places and reads wagers.

import type { IslSupabaseClient } from '@shared/supabase/client';
import type { Wager, TeamChoice } from '../types';
// #386 slice 1: boundary-validate every wager row before returning it
// to consumers. Drift in the table shape now surfaces as a warn-log +
// dropped row, not a runtime `undefined`.
import { parseWagerRow, parseWagerRows } from './wagers.schema';

// ── Wager placement ────────────────────────────────────────────────────────

/**
 * Place a new wager via the atomic `place_wager` Postgres RPC (migration
 * 0053). The RPC validates credits, locks the profile row with FOR UPDATE,
 * inserts the wager, and decrements credits in a single transaction —
 * preventing the TOCTOU double-spend that the previous read-modify-write
 * implementation allowed under concurrent bets.
 *
 * The `userId` argument is no longer trusted — the RPC reads `auth.uid()`
 * from the caller's JWT. It's kept in the signature for backwards
 * compatibility with existing call sites (and gets ignored).
 *
 * @param db           Injected Supabase client.
 * @param userId       Deprecated/ignored — RPC uses auth.uid().
 * @param matchId      The match UUID to bet on.
 * @param teamChoice   'home', 'draw', or 'away'.
 * @param stake        Credits to wager (>= MIN_BET).
 * @param oddsSnapshot Decimal odds at time of placement.
 * @returns            The inserted Wager row, or null on error.
 */
export async function placeWager(
  db: IslSupabaseClient,
  _userId: string,
  matchId: string,
  teamChoice: TeamChoice,
  stake: number,
  oddsSnapshot: number,
): Promise<Wager | null> {
  // Typed RPC call against the regenerated database.ts (place_wager landed
  // in migration 0053 and is now in the schema export). The RPC returns a
  // single row matching the `wagers` table shape; we re-assert as `Wager`
  // below since the generated `Returns` is structurally identical but uses
  // string literals where our `TeamChoice` domain type is narrower.
  const { data, error } = await db.rpc('place_wager', {
    p_match_id: matchId,
    p_team_choice: teamChoice,
    p_stake: stake,
    p_odds: oddsSnapshot,
  });

  if (error) {
    console.warn('[placeWager] RPC failed:', error.message);
    return null;
  }

  // RPC return is structurally a wagers row; validate at the boundary
  // so a future RPC-shape change is caught here rather than rendering
  // a partial card in MatchDetail.
  return parseWagerRow(data, 'placeWager') as Wager | null;
}

// ── Wager queries ───────────────────────────────────────────────────────────

/**
 * Fetch all wagers for a specific user, ordered newest first.
 * Used on the profile page bet history view.
 *
 * @param db      Injected Supabase client.
 * @param userId  The user's UUID.
 * @param limit   Maximum rows to return (default 50).
 * @returns       Array of Wager rows.
 */
export async function getUserWagers(
  db: IslSupabaseClient,
  userId: string,
  limit = 50,
): Promise<Wager[]> {
  const { data, error } = await db
    .from('wagers')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.warn('[getUserWagers] failed:', error.message);
    return [];
  }
  return parseWagerRows((data ?? []) as unknown[], 'getUserWagers') as Wager[];
}

/**
 * Fetch the most recent wager a single user has placed on a single match.
 *
 * Used by the live match viewer to render a "your wager" panel: stake +
 * choice while the match is in progress, then payout / lost / void after
 * settlement. We return only the latest wager because users normally place
 * one bet per fixture; if they place multiple, the freshest is the most
 * useful surface.
 *
 * @param db       Injected Supabase client.
 * @param userId   The viewing user's UUID.
 * @param matchId  The match UUID.
 * @returns        Latest Wager row for that (user, match) pair, or null
 *                 when no wager exists / on query error.
 */
export async function getUserWagerForMatch(
  db:       IslSupabaseClient,
  userId:   string,
  matchId:  string,
): Promise<Wager | null> {
  const { data, error } = await db
    .from('wagers')
    .select('*')
    .eq('user_id',  userId)
    .eq('match_id', matchId)
    // Latest first so .limit(1) returns the freshest wager. PostgREST's
    // ordering is stable on (created_at DESC, id DESC) given the table PK.
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // maybeSingle returns null with no error when there are zero rows — that's
  // the common path for users who haven't bet on this match.
  if (error) {
    console.warn('[getUserWagerForMatch] failed:', error.message);
    return null;
  }
  return parseWagerRow(data, 'getUserWagerForMatch') as Wager | null;
}

// Settlement lives in the match-worker (service-role `settle_wager`), not in the
// browser — see migration 0074 / #557.
