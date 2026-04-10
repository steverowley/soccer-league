// ── credits.ts ───────────────────────────────────────────────────────────────
// WHY: Pure functions for credit balance validation. These are called by the
// betting UI (Phase 2) before submitting a wager and by the voting UI
// (Phase 4) before spending credits on a focus. Keeping them in logic/
// rather than in the UI components means:
//   1. They're unit-testable without rendering React.
//   2. The same validation runs both client-side (instant feedback) and
//      can be re-verified server-side (Edge Function or Supabase RPC) if
//      we ever need a trust boundary tighter than RLS CHECK constraints.
//
// DESIGN: All functions take plain values (number, not Profile) so they
// don't couple to the DB row shape. If the Profile type changes, only the
// call site adjusts — the logic stays stable.
//
// The DB also has a CHECK (credits >= 0) constraint as a backstop, but
// these functions exist to give the UI an answer BEFORE hitting the DB so
// we can show "insufficient credits" immediately rather than waiting for a
// round-trip error.

/**
 * The starting credit balance for every new user, matching the
 * `profiles.credits DEFAULT 200` in migration 0001_profiles.sql and the
 * game design doc's "Start with 200 Intergalactic Credits" spec.
 *
 * Exported so the signup confirmation UI and tests can reference a single
 * constant rather than hard-coding 200 in multiple places.
 */
export const STARTING_CREDITS = 200;

/**
 * Minimum wager size per the game design doc ("Minimum bet: 10 Intergalactic
 * Credits, no maximum"). Used by the betting UI's validation and by
 * `canAffordBet` below.
 */
export const MIN_BET = 10;

/**
 * Check whether a user's current balance can cover a proposed wager.
 *
 * Returns `true` if the user has enough credits AND the stake meets the
 * minimum bet threshold. Returns `false` otherwise — the UI should show an
 * appropriate message rather than submitting the wager.
 *
 * @param currentCredits  The user's credit balance (from `profiles.credits`).
 * @param stake           The proposed wager amount.
 * @returns               `true` if the bet is affordable and valid.
 *
 * @example
 * canAffordBet(200, 50)  // true — 200 >= 50 && 50 >= MIN_BET
 * canAffordBet(200, 5)   // false — 5 < MIN_BET
 * canAffordBet(8, 10)    // false — 8 < 10
 */
export function canAffordBet(currentCredits: number, stake: number): boolean {
  return stake >= MIN_BET && currentCredits >= stake;
}

/**
 * Compute the credit balance after a successful wager placement (debit).
 *
 * Does NOT mutate anything — returns the new balance as a plain number.
 * The caller is responsible for persisting the change via the api layer.
 *
 * Throws if the resulting balance would be negative, which should never
 * happen if `canAffordBet` was checked first — the throw is a defensive
 * guard against call-site bugs, not normal control flow.
 *
 * @param currentCredits  The user's credit balance before the bet.
 * @param stake           The amount being wagered.
 * @returns               The new balance (currentCredits - stake).
 */
export function debitCredits(currentCredits: number, stake: number): number {
  const newBalance = currentCredits - stake;
  if (newBalance < 0) {
    throw new Error(
      `debitCredits: resulting balance ${newBalance} is negative ` +
        `(current=${currentCredits}, stake=${stake}). ` +
        'Caller must check canAffordBet() before debiting.',
    );
  }
  return newBalance;
}

/**
 * Compute the credit balance after a winning wager payout (credit).
 *
 * Payout includes the original stake — so if you bet 50 at 2.5x odds and
 * win, `payout` is 125 (50 × 2.5), not 75. This matches standard decimal
 * odds semantics used in Phase 2's odds engine.
 *
 * @param currentCredits  The user's credit balance before the payout.
 * @param payout          The total payout amount (stake × odds).
 * @returns               The new balance (currentCredits + payout).
 */
export function creditPayout(currentCredits: number, payout: number): number {
  return currentCredits + payout;
}

/**
 * Check whether a user can afford to spend credits on a season-end vote
 * (Phase 4). Unlike betting, voting has no minimum spend — you can put as
 * few as 1 credit toward a focus if you want. The only constraint is that
 * credits must be positive and the user must have enough.
 *
 * @param currentCredits  The user's credit balance.
 * @param spend           The proposed voting spend.
 * @returns               `true` if affordable (spend > 0 && balance >= spend).
 */
export function canAffordVote(currentCredits: number, spend: number): boolean {
  return spend > 0 && currentCredits >= spend;
}
