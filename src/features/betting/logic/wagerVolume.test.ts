// ── betting/logic/wagerVolume.test.ts ────────────────────────────────────────
// Unit tests for the live wager-volume aggregator.

import { describe, expect, it } from 'vitest';
import {
  MIN_WAGERS_FOR_SIGNAL,
  summariseMatchWagers,
  summariseFromViewRows,
  type AggregatableWager,
  type WagerVolumeViewRow,
} from './wagerVolume';

const w = (team_choice: 'home' | 'draw' | 'away', stake: number): AggregatableWager => ({
  team_choice,
  stake,
});

describe('summariseMatchWagers — empty input', () => {
  it('returns an all-zero summary with hasSignal=false', () => {
    const r = summariseMatchWagers([]);
    expect(r.totalWagers).toBe(0);
    expect(r.totalStake).toBe(0);
    expect(r.home).toEqual({ stake: 0, percent: 0, count: 0 });
    expect(r.draw).toEqual({ stake: 0, percent: 0, count: 0 });
    expect(r.away).toEqual({ stake: 0, percent: 0, count: 0 });
    expect(r.hasSignal).toBe(false);
  });
});

describe('summariseMatchWagers — counts and stakes', () => {
  it('groups by team_choice and sums stakes', () => {
    const r = summariseMatchWagers([
      w('home', 100), w('home', 50),
      w('draw', 30),
      w('away', 200), w('away', 100), w('away', 100),
    ]);
    expect(r.home.stake).toBe(150);
    expect(r.home.count).toBe(2);
    expect(r.draw.stake).toBe(30);
    expect(r.draw.count).toBe(1);
    expect(r.away.stake).toBe(400);
    expect(r.away.count).toBe(3);
    expect(r.totalStake).toBe(580);
    expect(r.totalWagers).toBe(6);
  });
});

describe('summariseMatchWagers — percent distribution', () => {
  it('splits cleanly when stakes divide evenly', () => {
    const r = summariseMatchWagers([
      w('home', 100), w('home', 100),
      w('draw', 100), w('draw', 100),
      w('away', 100), w('away', 100),
    ]);
    // 200/600/600 each → exactly 33/33/34 (33+33+34=100)
    expect(r.home.percent + r.draw.percent + r.away.percent).toBe(100);
  });

  it('always sums to exactly 100 even with rounding remainders', () => {
    // 1/1/1 of equal stake produces 33.33/33.33/33.33; rounding must
    // distribute the leftover 1% to one side, never lose it to 99.
    const cases: AggregatableWager[][] = [
      [w('home', 10), w('draw', 10), w('away', 10)],
      [w('home', 10), w('draw', 10), w('away', 10), w('home', 10), w('draw', 10), w('away', 10)],
      // Asymmetric — one side dominates but tied between the other two.
      [w('home', 70), w('draw', 15), w('away', 15)],
      // All on one side.
      [w('home', 100), w('home', 100)],
      // Two sides only.
      [w('home', 50), w('away', 50)],
    ];
    for (const wagers of cases) {
      const r = summariseMatchWagers(wagers);
      expect(r.home.percent + r.draw.percent + r.away.percent).toBe(100);
    }
  });

  it('handles a single wager (100% to that side)', () => {
    const r = summariseMatchWagers([w('home', 50)]);
    expect(r.home.percent).toBe(100);
    expect(r.draw.percent).toBe(0);
    expect(r.away.percent).toBe(0);
  });
});

describe('summariseMatchWagers — hasSignal threshold', () => {
  it('hasSignal=false below MIN_WAGERS_FOR_SIGNAL', () => {
    for (let n = 0; n < MIN_WAGERS_FOR_SIGNAL; n++) {
      const wagers = Array.from({ length: n }, () => w('home', 50));
      expect(summariseMatchWagers(wagers).hasSignal).toBe(false);
    }
  });

  it('hasSignal=true at or above MIN_WAGERS_FOR_SIGNAL', () => {
    const wagers = Array.from({ length: MIN_WAGERS_FOR_SIGNAL }, () => w('home', 50));
    expect(summariseMatchWagers(wagers).hasSignal).toBe(true);
  });

  it('threshold constant is between 1 and 50 (sanity)', () => {
    expect(MIN_WAGERS_FOR_SIGNAL).toBeGreaterThan(0);
    expect(MIN_WAGERS_FOR_SIGNAL).toBeLessThan(50);
  });
});

describe('summariseMatchWagers — non-negative invariants', () => {
  it('every percent is between 0 and 100', () => {
    const r = summariseMatchWagers([
      w('home', 1000),
      w('draw', 1),
      w('away', 50),
    ]);
    for (const side of ['home', 'draw', 'away'] as const) {
      expect(r[side].percent).toBeGreaterThanOrEqual(0);
      expect(r[side].percent).toBeLessThanOrEqual(100);
    }
  });
});

// ── View-row variant tests (RLS bypass path) ──────────────────────────────
// Exercises summariseFromViewRows which consumes pre-aggregated rows from
// the `wager_volume_v` SQL view.  The view returns 0–3 rows per match
// (one per team_choice that has at least one bet) so the test fixtures
// stay tight.

/** Compact row builder for the view-shape tests. */
const vRow = (
  team_choice: 'home' | 'draw' | 'away',
  total_stake: number,
  bet_count: number,
): WagerVolumeViewRow => ({ team_choice, total_stake, bet_count });

describe('summariseFromViewRows', () => {
  it('returns all-zero summary for empty input', () => {
    const r = summariseFromViewRows([]);
    expect(r.totalWagers).toBe(0);
    expect(r.totalStake).toBe(0);
    expect(r.hasSignal).toBe(false);
  });

  it('maps view rows directly to per-side breakdowns', () => {
    const r = summariseFromViewRows([
      vRow('home', 150, 2),
      vRow('draw', 30,  1),
      vRow('away', 400, 3),
    ]);
    expect(r.home).toEqual({ stake: 150, percent: r.home.percent, count: 2 });
    expect(r.draw).toEqual({ stake: 30,  percent: r.draw.percent, count: 1 });
    expect(r.away).toEqual({ stake: 400, percent: r.away.percent, count: 3 });
    expect(r.totalWagers).toBe(6);
    expect(r.totalStake).toBe(580);
  });

  it('handles missing sides as zero', () => {
    // Only home and away — draw row absent, which is the common case.
    const r = summariseFromViewRows([
      vRow('home', 200, 4),
      vRow('away', 300, 6),
    ]);
    expect(r.draw).toEqual({ stake: 0, percent: 0, count: 0 });
    expect(r.totalWagers).toBe(10);
  });

  it('honours the MIN_WAGERS_FOR_SIGNAL threshold', () => {
    const below = summariseFromViewRows([vRow('home', 50, MIN_WAGERS_FOR_SIGNAL - 1)]);
    expect(below.hasSignal).toBe(false);

    const at = summariseFromViewRows([vRow('home', 50, MIN_WAGERS_FOR_SIGNAL)]);
    expect(at.hasSignal).toBe(true);
  });

  it('always sums percents to exactly 100 (view-row path)', () => {
    const r = summariseFromViewRows([
      vRow('home', 70, 7),
      vRow('draw', 15, 3),
      vRow('away', 15, 3),
    ]);
    expect(r.home.percent + r.draw.percent + r.away.percent).toBe(100);
  });

  it('produces identical output to summariseMatchWagers for equivalent input', () => {
    const wagers: AggregatableWager[] = [
      w('home', 100), w('home', 50),
      w('draw', 30),
      w('away', 200), w('away', 100), w('away', 100),
    ];
    const fromIndividual = summariseMatchWagers(wagers);
    const fromView = summariseFromViewRows([
      vRow('home', 150, 2),
      vRow('draw', 30,  1),
      vRow('away', 400, 3),
    ]);
    expect(fromView).toEqual(fromIndividual);
  });
});
