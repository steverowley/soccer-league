// ── fanBoost.test.ts ────────────────────────────────────────────────────────
// WHY: Unit tests for fan support boost logic. The boost directly affects
// match outcomes, so correctness here prevents unfair advantages.

import { describe, it, expect } from 'vitest';
import {
  calculateFanBoost,
  FAN_BOOST_POINTS,
  FAN_PRESENCE_WINDOW_MS,
} from './fanBoost';

describe('calculateFanBoost', () => {
  it('boosts home team when they have more fans', () => {
    const result = calculateFanBoost(15, 8);
    expect(result.boostedSide).toBe('home');
    expect(result.boostAmount).toBe(FAN_BOOST_POINTS);
    expect(result.homeFanCount).toBe(15);
    expect(result.awayFanCount).toBe(8);
  });

  it('boosts away team when they have more fans', () => {
    const result = calculateFanBoost(5, 12);
    expect(result.boostedSide).toBe('away');
    expect(result.boostAmount).toBe(FAN_BOOST_POINTS);
  });

  it('no boost when fan counts are equal', () => {
    const result = calculateFanBoost(10, 10);
    expect(result.boostedSide).toBe('none');
    expect(result.boostAmount).toBe(0);
  });

  it('no boost when both teams have zero fans', () => {
    const result = calculateFanBoost(0, 0);
    expect(result.boostedSide).toBe('none');
    expect(result.boostAmount).toBe(0);
  });

  it('boosts with just 1 fan advantage', () => {
    const result = calculateFanBoost(1, 0);
    expect(result.boostedSide).toBe('home');
    expect(result.boostAmount).toBe(FAN_BOOST_POINTS);
  });

  it('preserves fan counts in the result', () => {
    const result = calculateFanBoost(42, 99);
    expect(result.homeFanCount).toBe(42);
    expect(result.awayFanCount).toBe(99);
  });
});

describe('constants', () => {
  it('FAN_BOOST_POINTS is 2', () => {
    expect(FAN_BOOST_POINTS).toBe(2);
  });

  it('FAN_PRESENCE_WINDOW_MS is 5 minutes', () => {
    expect(FAN_PRESENCE_WINDOW_MS).toBe(300_000);
  });
});
