// ── settlement.test.ts ──────────────────────────────────────────────────────
// WHY: Unit tests for settlement logic — outcome determination, payout
// calculation, and credit change accounting. These are critical financial
// operations; correctness here prevents credit leaks or phantom payouts.

import { describe, it, expect } from 'vitest';
import {
  determineOutcome,
  resolveWager,
  calculatePayout,
  netCreditChange,
  houseProfitFromWager,
} from './settlement';

// ── determineOutcome ────────────────────────────────────────────────────────

describe('determineOutcome', () => {
  it('returns "home" when home wins', () => {
    expect(determineOutcome(3, 1)).toBe('home');
  });

  it('returns "away" when away wins', () => {
    expect(determineOutcome(0, 2)).toBe('away');
  });

  it('returns "draw" on equal scores', () => {
    expect(determineOutcome(1, 1)).toBe('draw');
  });

  it('handles 0-0 draw', () => {
    expect(determineOutcome(0, 0)).toBe('draw');
  });

  it('handles high-scoring home win', () => {
    expect(determineOutcome(5, 4)).toBe('home');
  });
});

// ── resolveWager ────────────────────────────────────────────────────────────

describe('resolveWager', () => {
  it('returns "won" when choice matches outcome', () => {
    const result = resolveWager('home', 'home', 100, 2.5);
    expect(result.status).toBe('won');
    expect(result.payout).toBe(250);
  });

  it('returns "lost" when choice does not match outcome', () => {
    const result = resolveWager('home', 'away', 100, 2.5);
    expect(result.status).toBe('lost');
    expect(result.payout).toBe(0);
  });

  it('handles draw bets correctly', () => {
    const won = resolveWager('draw', 'draw', 50, 3.2);
    expect(won.status).toBe('won');
    expect(won.payout).toBe(160); // floor(50 × 3.2)

    const lost = resolveWager('draw', 'home', 50, 3.2);
    expect(lost.status).toBe('lost');
    expect(lost.payout).toBe(0);
  });

  it('handles away bets correctly', () => {
    const result = resolveWager('away', 'away', 200, 1.8);
    expect(result.status).toBe('won');
    expect(result.payout).toBe(360); // floor(200 × 1.8)
  });
});

// ── calculatePayout ─────────────────────────────────────────────────────────

describe('calculatePayout', () => {
  it('multiplies stake by odds and floors', () => {
    expect(calculatePayout(100, 2.5)).toBe(250);
  });

  it('floors fractional results', () => {
    // 100 × 2.33 = 233.0 exactly, but test with harder fraction:
    expect(calculatePayout(33, 2.75)).toBe(90); // 33 × 2.75 = 90.75 → 90
  });

  it('handles minimum bet at low odds', () => {
    expect(calculatePayout(10, 1.1)).toBe(11); // 10 × 1.1 = 11
  });

  it('handles large stakes', () => {
    expect(calculatePayout(10000, 5.0)).toBe(50000);
  });
});

// ── netCreditChange ─────────────────────────────────────────────────────────

describe('netCreditChange', () => {
  it('returns payout for won wagers', () => {
    expect(netCreditChange('won', 100, 250)).toBe(250);
  });

  it('returns 0 for lost wagers', () => {
    expect(netCreditChange('lost', 100, 0)).toBe(0);
  });

  it('returns stake for void wagers (refund)', () => {
    expect(netCreditChange('void', 100, 0)).toBe(100);
  });

  it('returns 0 for open wagers', () => {
    expect(netCreditChange('open', 100, 0)).toBe(0);
  });
});

// ── houseProfitFromWager ────────────────────────────────────────────────────

describe('houseProfitFromWager', () => {
  it('house loses on won wagers (payout > stake)', () => {
    // stake=100, payout=250 → house pays 150 net → profit = -150
    expect(houseProfitFromWager('won', 100, 250)).toBe(-150);
  });

  it('house gains stake on lost wagers', () => {
    expect(houseProfitFromWager('lost', 100, 0)).toBe(100);
  });

  it('house breaks even on void wagers', () => {
    expect(houseProfitFromWager('void', 100, 0)).toBe(0);
  });

  it('house breaks even on open wagers', () => {
    expect(houseProfitFromWager('open', 100, 0)).toBe(0);
  });

  it('house can break even on won wager at odds=1 (impossible but mathematical edge case)', () => {
    // If odds were exactly 1.0 (not allowed by DB), payout = stake → profit = 0.
    expect(houseProfitFromWager('won', 100, 100)).toBe(0);
  });
});
