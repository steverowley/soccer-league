// ── shared/utils/rankLabels.test.ts ─────────────────────────────────────────
// Tied ranks read "=N" (docs/design-language.md, section 7).

import { describe, expect, it } from 'vitest';
import { ordinal, placeLabel, rankLabels, standingsTieKey } from './rankLabels';

describe('rankLabels', () => {
  it('numbers distinct rows 1, 2, 3 without padding', () => {
    expect(rankLabels([3, 2, 1], String)).toEqual(['1', '2', '3']);
  });

  it('gives tied rows the same "=N" rank and skips the places they share', () => {
    expect(rankLabels([9, 7, 7, 7, 4, 4, 1], String)).toEqual(['1', '=2', '=2', '=2', '=5', '=5', '7']);
  });

  it('ties standings only when points, goal difference and goals scored all match', () => {
    const rows = [
      { points: 3, gd: 2, gf: 3 },
      { points: 3, gd: 2, gf: 3 },
      { points: 3, gd: 2, gf: 2 },
      { points: 1, gd: 0, gf: 1 },
    ];
    expect(rankLabels(rows, standingsTieKey)).toEqual(['=1', '=1', '3', '4']);
  });

  it('handles an empty table', () => {
    expect(rankLabels([], String)).toEqual([]);
  });
});

describe('ordinal and placeLabel', () => {
  it('writes English ordinals, including the teens', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal)).toEqual(
      ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th'],
    );
  });

  it('keeps a tie as =N and turns a plain rank into an ordinal', () => {
    expect(placeLabel('2')).toBe('2nd');
    expect(placeLabel('=2')).toBe('=2');
  });
});
