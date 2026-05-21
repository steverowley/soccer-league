// ── shadowDistribution.test.ts ─────────────────────────────────────────────
// Unit tests for the pure aggregator in `shadowDistribution.ts`.
//
// What we lock down:
//   1. Empty input returns the zeroed summary (not NaN, not an exception).
//   2. Outcome counts add up to `n`.
//   3. Goal averages round to one decimal.
//   4. Perturbation tallies count every row.
//   5. Unrecognised outcome strings don't crash, are skipped from outcome
//      counts, but DO count toward `n` + perturbations.

import { describe, expect, it } from 'vitest';
import { aggregateShadowRows } from './shadowDistribution';

describe('aggregateShadowRows', () => {
  /** Zero-row input must produce a clean zeroed summary. */
  it('returns zeroed summary on empty input', () => {
    const result = aggregateShadowRows([]);
    expect(result).toEqual({
      n: 0,
      outcomes: { home: 0, draw: 0, away: 0 },
      avgHomeGoals: 0,
      avgAwayGoals: 0,
      perturbations: {},
    });
  });

  /** Outcome counts mirror the input rows. */
  it('counts outcomes and rolls up averages', () => {
    const rows = [
      { home_goals: 2, away_goals: 1, outcome: 'home' as const, perturbation: 'real_engine' },
      { home_goals: 0, away_goals: 2, outcome: 'away' as const, perturbation: 'real_engine' },
      { home_goals: 1, away_goals: 1, outcome: 'draw' as const, perturbation: 'rng_only' },
      { home_goals: 3, away_goals: 0, outcome: 'home' as const, perturbation: 'rng_only' },
    ];
    const result = aggregateShadowRows(rows);
    expect(result.n).toBe(4);
    expect(result.outcomes).toEqual({ home: 2, draw: 1, away: 1 });
    // 2+0+1+3 = 6 / 4 = 1.5
    expect(result.avgHomeGoals).toBe(1.5);
    // 1+2+1+0 = 4 / 4 = 1.0
    expect(result.avgAwayGoals).toBe(1);
    expect(result.perturbations).toEqual({ real_engine: 2, rng_only: 2 });
  });

  /** Averages must be rounded to one decimal. */
  it('rounds averages to one decimal place', () => {
    // 1+1+2 = 4 / 3 = 1.333…
    const result = aggregateShadowRows([
      { home_goals: 1, away_goals: 0, outcome: 'home', perturbation: 'rng_only' },
      { home_goals: 1, away_goals: 0, outcome: 'home', perturbation: 'rng_only' },
      { home_goals: 2, away_goals: 0, outcome: 'home', perturbation: 'rng_only' },
    ]);
    expect(result.avgHomeGoals).toBe(1.3);
  });

  /**
   * Unrecognised outcome strings must not crash the aggregator.  They
   * count toward `n` + perturbations but are dropped from the typed
   * outcome counter so a future schema change can't silently inflate
   * one of the three values.
   */
  it('skips unrecognised outcome strings but still counts them in n', () => {
    const rows = [
      { home_goals: 1, away_goals: 0, outcome: 'mystery' as 'home', perturbation: 'rng_only' },
      { home_goals: 0, away_goals: 1, outcome: 'away' as const, perturbation: 'rng_only' },
    ];
    const result = aggregateShadowRows(rows);
    expect(result.n).toBe(2);
    expect(result.outcomes).toEqual({ home: 0, draw: 0, away: 1 });
    expect(result.perturbations).toEqual({ rng_only: 2 });
  });
});
