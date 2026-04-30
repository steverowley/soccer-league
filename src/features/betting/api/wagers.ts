// ── betting/api/wagers.ts ────────────────────────────────────────────────────
// WHY: Supabase queries for the wager lifecycle — placement, history, and
// settlement. All queries take an injected Supabase client; no direct imports.
//
// The `wagers` table is created by migration 0004_betting.sql (applied).
// database.ts predates that migration so the `wagers` table is absent from
// generated types — we cast to `any` (marked CAST:wagers) until types are
// regenerated after the next `supabase gen types` run.
//
// CREDIT MUTATION STRATEGY
// ─────────────────────────
// All credit changes (deduct on bet, credit on win) use a read-modify-write
// pattern: read current balance → compute new value → write back. This is safe
// at current traffic levels. When the simulator moves server-side, replace with
// a single Supabase RPC wrapping the wager insert + credit deduct in one
// transaction for true atomicity.
//
// SETTLEMENT FLOW:
//   1. Match completes → `match.completed` event fires on the in-app bus.
//   2. WagerSettlementListener calls `settleMatchWagers()` with the final score.
//   3. For each open wager on that match:
//      a. Determine outcome via `resolveWager()` (pure logic, no Supabase).
//      b. Update wager row (status + payout).
//      c. Credit the winner's profile balance (read-modify-write).
//   4. Updates are sequential; individual failures are logged but don't abort
//      the batch — partial settlement beats no settlement.

import type { IslSupabaseClient } from '@shared/supabase/client';
import type { Wager, TeamChoice } from '../types';
import { determineOutcome, resolveWager } from '../logic/settlement';

// TYPE ESCAPE HATCH — see profiles.ts for the pattern explanation.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

// ── Wager placement ────────────────────────────────────────────────────────

/**
 * Place a new wager. Inserts a wager row and deducts the stake from the
 * user's credit balance in two sequential operations.
 *
 * IMPORTANT: The caller must verify `canAffordBet()` before calling this.
 * The DB CHECK constraint on `profiles.credits >= 0` provides a safety net,
 * but the caller should fail fast to avoid a confusing Supabase error.
 *
 * @param db           Injected Supabase client.
 * @param userId       The betting user's UUID.
 * @param matchId      The match UUID to bet on.
 * @param teamChoice   'home', 'draw', or 'away'.
 * @param stake        Credits to wager (>= MIN_BET).
 * @param oddsSnapshot Decimal odds at time of placement.
 * @returns            The inserted Wager row, or null on error.
 */
export async function placeWager(
  db: IslSupabaseClient,
  userId: string,
  matchId: string,
  teamChoice: TeamChoice,
  stake: number,
  oddsSnapshot: number,
): Promise<Wager | null> {
  // 1. Insert the wager row.
  const { data: wager, error: wagerErr } = await (db as AnyDb) // CAST:wagers
    .from('wagers')
    .insert({
      user_id: userId,
      match_id: matchId,
      team_choice: teamChoice,
      stake,
      odds_snapshot: oddsSnapshot,
    })
    .select()
    .single();

  if (wagerErr) {
    console.warn('[placeWager] insert failed:', wagerErr.message);
    return null;
  }

  // 2. Deduct stake from the user's credit balance (read-modify-write).
  const { data: profile } = await (db as AnyDb) // CAST:profiles
    .from('profiles')
    .select('credits')
    .eq('id', userId)
    .single();

  if (profile) {
    await (db as AnyDb)
      .from('profiles')
      .update({ credits: (profile as { credits: number }).credits - stake })
      .eq('id', userId);
  }

  return wager as Wager;
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
  const { data, error } = await (db as AnyDb) // CAST:wagers
    .from('wagers')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.warn('[getUserWagers] failed:', error.message);
    return [];
  }
  return (data ?? []) as Wager[];
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
  const { data, error } = await (db as AnyDb) // CAST:wagers
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
  return (data ?? null) as Wager | null;
}

/**
 * Fetch all open wagers for a specific match. Used by the settlement
 * process to find wagers that need resolving.
 *
 * @param db       Injected Supabase client.
 * @param matchId  The match UUID.
 * @returns        Array of open Wager rows.
 */
export async function getOpenWagersForMatch(
  db: IslSupabaseClient,
  matchId: string,
): Promise<Wager[]> {
  const { data, error } = await (db as AnyDb) // CAST:wagers
    .from('wagers')
    .select('*')
    .eq('match_id', matchId)
    .eq('status', 'open');

  if (error) {
    console.warn('[getOpenWagersForMatch] failed:', error.message);
    return [];
  }
  return (data ?? []) as Wager[];
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

    // Update the wager row with resolved status and payout.
    const { error: updateErr } = await (db as AnyDb) // CAST:wagers
      .from('wagers')
      .update({ status, payout: payout || null })
      .eq('id', wager.id);

    if (updateErr) {
      console.warn(`[settleMatchWagers] update failed for wager ${wager.id}:`, updateErr.message);
      continue;
    }

    // Credit the winner's profile balance (read-modify-write).
    // Only fires for won wagers — lost wagers have payout=0 and no credit change.
    if (status === 'won' && payout > 0) {
      const { data: profile } = await (db as AnyDb) // CAST:profiles
        .from('profiles')
        .select('credits')
        .eq('id', wager.user_id)
        .single();

      if (profile) {
        await (db as AnyDb)
          .from('profiles')
          .update({ credits: (profile as { credits: number }).credits + payout })
          .eq('id', wager.user_id);
      }
    }

    settled++;
  }

  return settled;
}
