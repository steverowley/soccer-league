// ── credits.test.ts ──────────────────────────────────────────────────────────
// WHY: The credit system is the backbone of the game's economy — betting
// (Phase 2), voting (Phase 4), and training (Phase 6) all flow through
// credit balances. A bug here (e.g. allowing negative balances, accepting
// sub-minimum bets, or miscalculating payouts) would silently corrupt every
// user's account. These tests pin every edge case.
//
// Test strategy:
//   - Boundary tests: exact minimums, zero balances, edge-of-valid inputs.
//   - Error path tests: verify that debitCredits throws on overdraft.
//   - Semantic tests: confirm canAffordBet enforces BOTH the minimum bet
//     threshold AND the balance check, not just one or the other.

import { describe, expect, it } from 'vitest';
import {
  canAffordBet,
  canAffordVote,
  creditPayout,
  debitCredits,
  MIN_BET,
  STARTING_CREDITS,
} from './credits';

describe('constants', () => {
  it('STARTING_CREDITS matches the game design doc (200)', () => {
    expect(STARTING_CREDITS).toBe(200);
  });

  it('MIN_BET matches the game design doc (10)', () => {
    expect(MIN_BET).toBe(10);
  });
});

describe('canAffordBet', () => {
  it('returns true when balance covers stake and stake >= MIN_BET', () => {
    expect(canAffordBet(200, 50)).toBe(true);
  });

  it('returns true when stake equals balance exactly', () => {
    // "All in" bets are legal per the design doc ("no maximum").
    expect(canAffordBet(100, 100)).toBe(true);
  });

  it('returns true at the exact MIN_BET threshold', () => {
    expect(canAffordBet(10, 10)).toBe(true);
  });

  it('returns false when stake < MIN_BET even if balance is sufficient', () => {
    expect(canAffordBet(200, 5)).toBe(false);
    expect(canAffordBet(200, 9)).toBe(false);
    expect(canAffordBet(200, 0)).toBe(false);
  });

  it('returns false when balance < stake even if stake >= MIN_BET', () => {
    expect(canAffordBet(8, 10)).toBe(false);
    expect(canAffordBet(49, 50)).toBe(false);
  });

  it('returns false for negative stakes', () => {
    expect(canAffordBet(200, -10)).toBe(false);
  });

  it('returns false when balance is zero', () => {
    expect(canAffordBet(0, 10)).toBe(false);
  });
});

describe('debitCredits', () => {
  it('returns the correct new balance', () => {
    expect(debitCredits(200, 50)).toBe(150);
    expect(debitCredits(100, 100)).toBe(0);
    expect(debitCredits(10, 10)).toBe(0);
  });

  it('throws if the resulting balance would be negative', () => {
    expect(() => debitCredits(8, 10)).toThrow('resulting balance -2 is negative');
    expect(() => debitCredits(0, 1)).toThrow('resulting balance');
  });
});

describe('creditPayout', () => {
  it('adds the full payout to the current balance', () => {
    // Bet 50 at 2.5x odds → payout = 125 (includes original stake)
    expect(creditPayout(150, 125)).toBe(275);
  });

  it('works from a zero balance (edge case: user went all-in and won)', () => {
    // User bet all 200 credits, won at 3.0x → payout = 600
    expect(creditPayout(0, 600)).toBe(600);
  });

  it('handles fractional payouts by not rounding (caller rounds)', () => {
    // The odds engine may produce fractional payouts; creditPayout does
    // NOT round — the settlement logic in Phase 2 decides the rounding
    // strategy (floor, round, ceil) based on house-margin rules.
    expect(creditPayout(100, 33.33)).toBeCloseTo(133.33);
  });
});

describe('canAffordVote', () => {
  it('returns true for any positive spend within balance', () => {
    expect(canAffordVote(200, 1)).toBe(true);
    expect(canAffordVote(200, 200)).toBe(true);
  });

  it('returns false when spend exceeds balance', () => {
    expect(canAffordVote(5, 10)).toBe(false);
  });

  it('returns false for zero spend (must put at least 1 credit)', () => {
    expect(canAffordVote(200, 0)).toBe(false);
  });

  it('returns false for negative spend', () => {
    expect(canAffordVote(200, -5)).toBe(false);
  });

  it('returns false when balance is zero', () => {
    expect(canAffordVote(0, 1)).toBe(false);
  });
});
