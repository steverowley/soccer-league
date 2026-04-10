// ── betting/logic/settlement.ts ──────────────────────────────────────────────
// WHY: Pure settlement logic — determines wager outcomes and calculates
// payouts. No React, no Supabase. The API layer feeds match results into
// these functions and applies the database mutations.
//
// SETTLEMENT RULES:
//   1. A match result is determined by comparing home_score vs away_score.
//   2. The user's team_choice ('home', 'draw', 'away') is compared to the
//      actual outcome.
//   3. On a win: payout = floor(stake × odds_snapshot). Floor is used to
//      avoid fractional credits — the House keeps the rounding.
//   4. On a loss: payout = 0 (stake already deducted at bet placement).
//   5. On void: payout = stake (full refund).
//
// All functions are pure and deterministic — no side effects, no DB calls.

import type { TeamChoice, WagerStatus } from '../types';

// ── Match outcome determination ─────────────────────────────────────────────

/**
 * Determine the match outcome from final scores.
 *
 * @param homeScore  Goals scored by the home team.
 * @param awayScore  Goals scored by the away team.
 * @returns          'home' if home wins, 'away' if away wins, 'draw' if tied.
 */
export function determineOutcome(
  homeScore: number,
  awayScore: number,
): TeamChoice {
  if (homeScore > awayScore) return 'home';
  if (awayScore > homeScore) return 'away';
  return 'draw';
}

// ── Wager resolution ────────────────────────────────────────────────────────

/**
 * Resolve a single wager against the match outcome. Returns the new status
 * and payout amount.
 *
 * @param teamChoice    The user's bet ('home', 'draw', 'away').
 * @param outcome       The actual match outcome.
 * @param stake         Credits wagered.
 * @param oddsSnapshot  Decimal odds at time of placement.
 * @returns             { status, payout } — the resolved wager fields.
 *
 * @example
 *   resolveWager('home', 'home', 100, 2.50)
 *   // → { status: 'won', payout: 250 }
 *
 *   resolveWager('home', 'away', 100, 2.50)
 *   // → { status: 'lost', payout: 0 }
 */
export function resolveWager(
  teamChoice: TeamChoice,
  outcome: TeamChoice,
  stake: number,
  oddsSnapshot: number,
): { status: WagerStatus; payout: number } {
  if (teamChoice === outcome) {
    return {
      status: 'won',
      payout: calculatePayout(stake, oddsSnapshot),
    };
  }
  return { status: 'lost', payout: 0 };
}

/**
 * Calculate the payout for a winning wager. Uses floor() to avoid
 * fractional credits — the Bookie keeps the rounding.
 *
 * Payout is the total return, including the original stake. For example,
 * with odds of 2.50 and a stake of 100: payout = floor(100 × 2.50) = 250.
 * The user's net profit is 250 - 100 = 150.
 *
 * @param stake         Credits wagered.
 * @param oddsSnapshot  Decimal odds at time of placement.
 * @returns             Total payout in credits (always integer).
 */
export function calculatePayout(stake: number, oddsSnapshot: number): number {
  return Math.floor(stake * oddsSnapshot);
}

/**
 * Calculate the net credit change for a resolved wager. This is what gets
 * added to the user's credit balance after settlement.
 *
 * - Won:  +payout (stake was already deducted at placement)
 * - Lost: 0 (nothing returned; stake was deducted at placement)
 * - Void: +stake (full refund of the original stake)
 * - Open: 0 (not yet settled)
 *
 * @param status  Resolved wager status.
 * @param stake   Original stake amount.
 * @param payout  Payout amount (0 for lost/void/open).
 * @returns       Net credits to add to the user's balance.
 */
export function netCreditChange(
  status: WagerStatus,
  stake: number,
  payout: number,
): number {
  switch (status) {
    case 'won':
      return payout;
    case 'lost':
      return 0;
    case 'void':
      return stake;
    case 'open':
      return 0;
  }
}

/**
 * Calculate the House (Bookie) profit/loss from a single resolved wager.
 * The House gains the stake on losses and pays out on wins. Over time,
 * the ~5% margin in the odds ensures the House profits on average.
 *
 * - Won:  House loses (payout - stake). The stake was collected; payout returned.
 * - Lost: House gains stake.
 * - Void: House gains 0 (stake refunded).
 * - Open: 0 (not yet settled).
 *
 * @param status  Resolved wager status.
 * @param stake   Original stake amount.
 * @param payout  Payout amount (only meaningful for 'won').
 * @returns       Net credits gained by the House (negative = loss).
 */
export function houseProfitFromWager(
  status: WagerStatus,
  stake: number,
  payout: number,
): number {
  switch (status) {
    case 'won':
      return stake - payout; // Negative: house pays out more than collected.
    case 'lost':
      return stake;          // Positive: house keeps the stake.
    case 'void':
      return 0;
    case 'open':
      return 0;
  }
}
