// ── betting/api/wagers.ts ────────────────────────────────────────────────────
// WHY: Supabase queries for the wager lifecycle — placement, history, and
// settlement. All queries take an injected Supabase client; no direct imports.
//
// CREDIT MUTATION STRATEGY — ATOMIC RPCs (migration 0053)
// ──────────────────────────────────────────────────────────
// `placeWager` and `settleMatchWagers` previously did non-atomic
// read-modify-write on `profiles.credits` (a TOCTOU race that allowed
// double-spending under concurrent bets). Both paths now call SECURITY
// DEFINER RPCs that wrap the whole transaction with `SELECT … FOR UPDATE`
// row locking:
//   - place_wager(match_id, team_choice, stake, odds)
//   - settle_wager(wager_id, status, payout)  — idempotent
//
// SETTLEMENT FLOW (unchanged shape, atomic implementation):
//   1. Match completes → `match.completed` event fires on the in-app bus.
//   2. WagerSettlementListener calls `settleMatchWagers()` with the final score.
//   3. For each open wager: determine outcome via `resolveWager()` (pure
//      logic, no Supabase), then call `settle_wager` RPC which locks the
//      wager row, updates status + payout, and credits the winner in one
//      transaction. The RPC is idempotent — a second call on the same
//      already-settled wager is a no-op (returns false).

import type { IslSupabaseClient } from '@shared/supabase/client';
import type { Wager, TeamChoice } from '../types';
import { determineOutcome, resolveWager } from '../logic/settlement';
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

/**
 * Fetch all open wagers for a specific match. Used by the settlement
 * process to find wagers that need resolving.
 *
 * @param db       Injected Supabase client.
 * @param matchId  The match UUID.
 * @returns        Array of open Wager rows.
 */
async function getOpenWagersForMatch(
  db: IslSupabaseClient,
  matchId: string,
): Promise<Wager[]> {
  const { data, error } = await db
    .from('wagers')
    .select('*')
    .eq('match_id', matchId)
    .eq('status', 'open');

  if (error) {
    console.warn('[getOpenWagersForMatch] failed:', error.message);
    return [];
  }
  return parseWagerRows((data ?? []) as unknown[], 'getOpenWagersForMatch') as Wager[];
}

// ── Settlement ──────────────────────────────────────────────────────────────

/**
 * Settle all open wagers for a completed match. For each wager:
 *   1. Determine outcome from scores.
 *   2. Resolve the wager (won/lost + payout).
 *   3. Update the wager row.
 *   4. Credit the winner's profile balance.
 *
 * Returns the number of wagers settled. Errors on individual wagers are
 * logged but don't abort the entire batch — partial settlement is better
 * than no settlement.
 *
 * NOTE: When the engine moves server-side, this should become a single
 * Supabase RPC wrapping all updates in a transaction.
 *
 * @param db         Injected Supabase client.
 * @param matchId    The completed match UUID.
 * @param homeScore  Final home goals.
 * @param awayScore  Final away goals.
 * @returns          Number of wagers successfully settled.
 */
export async function settleMatchWagers(
  db: IslSupabaseClient,
  matchId: string,
  homeScore: number,
  awayScore: number,
): Promise<number> {
  const outcome = determineOutcome(homeScore, awayScore);
  const openWagers = await getOpenWagersForMatch(db, matchId);

  if (openWagers.length === 0) return 0;

  let settled = 0;

  for (const wager of openWagers) {
    const { status, payout } = resolveWager(
      wager.team_choice,
      outcome,
      wager.stake,
      wager.odds_snapshot,
    );

    // Settle via the atomic `settle_wager` RPC (migration 0053). The RPC
    // locks the wager row, updates status + payout, and credits the winner
    // in one transaction. Returns false if the wager was already settled
    // (idempotent) — we still count it as "handled" so the worker doesn't
    // loop on the same wager forever.
    const { data: applied, error: rpcErr } = await db.rpc('settle_wager', {
      p_wager_id: wager.id,
      p_status: status,
      p_payout: payout || 0,
    });

    if (rpcErr) {
      console.warn(`[settleMatchWagers] RPC failed for wager ${wager.id}:`, rpcErr.message);
      continue;
    }
    if (applied === false) {
      // Wager was already settled by a concurrent run. Skip counting it.
      continue;
    }

    settled++;
  }

  return settled;
}
