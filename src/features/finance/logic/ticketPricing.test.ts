// ── ticketPricing.test.ts ────────────────────────────────────────────────────
// WHY: Unit tests for ticket revenue calculation. Revenue feeds into team
// finances and ultimately affects voting power, so the math must be correct.

import { describe, it, expect } from 'vitest';
import {
  calculateTicketRevenue,
  DEFAULT_TICKET_PRICE,
} from './ticketPricing';

describe('calculateTicketRevenue', () => {
  it('multiplies fan count by default ticket price', () => {
    expect(calculateTicketRevenue(42)).toBe(42 * DEFAULT_TICKET_PRICE);
  });

  it('uses custom ticket price when provided', () => {
    expect(calculateTicketRevenue(10, 20)).toBe(200);
  });

  it('returns 0 for zero fans', () => {
    expect(calculateTicketRevenue(0)).toBe(0);
  });

  it('returns 0 for negative fan count (clamps to 0)', () => {
    expect(calculateTicketRevenue(-5)).toBe(0);
  });

  it('handles large fan counts', () => {
    expect(calculateTicketRevenue(10000)).toBe(10000 * DEFAULT_TICKET_PRICE);
  });
});

describe('DEFAULT_TICKET_PRICE', () => {
  it('is 5 credits', () => {
    expect(DEFAULT_TICKET_PRICE).toBe(5);
  });
});
