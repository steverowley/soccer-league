// ── tally.test.ts ───────────────────────────────────────────────────────────
// WHY: Unit tests for vote tallying and winner determination. These ensure
// the collective voting mechanic works correctly — getting this wrong would
// enact the wrong focus and break the social experiment's trust.

import { describe, it, expect } from 'vitest';
import { pickWinner, determineTeamFocuses, computeVotePercentages } from './tally';
import type { FocusTallyEntry } from '../types';

// ── Helper ──────────────────────────────────────────────────────────────────

function entry(
  overrides: Partial<FocusTallyEntry> & { option_key: string },
): FocusTallyEntry {
  return {
    option_id: `id-${overrides.option_key}`,
    team_id: 'mars-athletic',
    season_id: 'season-1',
    label: overrides.option_key,
    description: null,
    tier: 'major',
    vote_count: 0,
    total_credits: 0,
    ...overrides,
  };
}

// ── pickWinner ──────────────────────────────────────────────────────────────

describe('pickWinner', () => {
  it('returns null for empty array', () => {
    expect(pickWinner([])).toBeNull();
  });

  it('returns null when all options have 0 credits', () => {
    const entries = [
      entry({ option_key: 'a', total_credits: 0 }),
      entry({ option_key: 'b', total_credits: 0 }),
    ];
    expect(pickWinner(entries)).toBeNull();
  });

  it('picks the option with the most credits', () => {
    const entries = [
      entry({ option_key: 'a', total_credits: 100, vote_count: 5 }),
      entry({ option_key: 'b', total_credits: 200, vote_count: 3 }),
      entry({ option_key: 'c', total_credits: 50, vote_count: 10 }),
    ];
    expect(pickWinner(entries)!.option_key).toBe('b');
  });

  it('breaks credit ties by vote_count', () => {
    const entries = [
      entry({ option_key: 'a', total_credits: 100, vote_count: 3 }),
      entry({ option_key: 'b', total_credits: 100, vote_count: 7 }),
    ];
    expect(pickWinner(entries)!.option_key).toBe('b');
  });

  it('breaks full ties alphabetically by option_key', () => {
    const entries = [
      entry({ option_key: 'zebra', total_credits: 100, vote_count: 5 }),
      entry({ option_key: 'alpha', total_credits: 100, vote_count: 5 }),
    ];
    expect(pickWinner(entries)!.option_key).toBe('alpha');
  });

  it('ignores zero-credit options even if they have votes somehow', () => {
    const entries = [
      entry({ option_key: 'a', total_credits: 0, vote_count: 10 }),
      entry({ option_key: 'b', total_credits: 50, vote_count: 1 }),
    ];
    expect(pickWinner(entries)!.option_key).toBe('b');
  });
});

// ── determineTeamFocuses ────────────────────────────────────────────────────

describe('determineTeamFocuses', () => {
  it('picks separate winners for major and minor tiers', () => {
    const entries = [
      entry({ option_key: 'major_a', tier: 'major', total_credits: 200, vote_count: 5 }),
      entry({ option_key: 'major_b', tier: 'major', total_credits: 100, vote_count: 3 }),
      entry({ option_key: 'minor_a', tier: 'minor', total_credits: 50, vote_count: 2 }),
      entry({ option_key: 'minor_b', tier: 'minor', total_credits: 150, vote_count: 8 }),
    ];
    const result = determineTeamFocuses('mars-athletic', 'season-1', entries);
    expect(result.team_id).toBe('mars-athletic');
    expect(result.season_id).toBe('season-1');
    expect(result.major!.option_key).toBe('major_a');
    expect(result.minor!.option_key).toBe('minor_b');
  });

  it('returns null for a tier with no votes', () => {
    const entries = [
      entry({ option_key: 'major_a', tier: 'major', total_credits: 100, vote_count: 3 }),
      entry({ option_key: 'minor_a', tier: 'minor', total_credits: 0, vote_count: 0 }),
    ];
    const result = determineTeamFocuses('mars-athletic', 'season-1', entries);
    expect(result.major!.option_key).toBe('major_a');
    expect(result.minor).toBeNull();
  });

  it('handles empty entries', () => {
    const result = determineTeamFocuses('mars-athletic', 'season-1', []);
    expect(result.major).toBeNull();
    expect(result.minor).toBeNull();
  });
});

// ── computeVotePercentages ──────────────────────────────────────────────────

describe('computeVotePercentages', () => {
  it('computes correct percentages', () => {
    const entries = [
      entry({ option_key: 'a', total_credits: 75 }),
      entry({ option_key: 'b', total_credits: 25 }),
    ];
    const pcts = computeVotePercentages(entries);
    expect(pcts[0]!.percentage).toBe(75);
    expect(pcts[1]!.percentage).toBe(25);
  });

  it('returns 0% for all when no credits spent', () => {
    const entries = [
      entry({ option_key: 'a', total_credits: 0 }),
      entry({ option_key: 'b', total_credits: 0 }),
    ];
    const pcts = computeVotePercentages(entries);
    expect(pcts[0]!.percentage).toBe(0);
    expect(pcts[1]!.percentage).toBe(0);
  });

  it('rounds percentages to integers', () => {
    const entries = [
      entry({ option_key: 'a', total_credits: 1 }),
      entry({ option_key: 'b', total_credits: 2 }),
    ];
    const pcts = computeVotePercentages(entries);
    expect(pcts[0]!.percentage).toBe(33); // 1/3 ≈ 33%
    expect(pcts[1]!.percentage).toBe(67); // 2/3 ≈ 67%
  });

  it('handles single option', () => {
    const entries = [entry({ option_key: 'a', total_credits: 500 })];
    const pcts = computeVotePercentages(entries);
    expect(pcts[0]!.percentage).toBe(100);
  });

  it('preserves option IDs in output', () => {
    const entries = [entry({ option_key: 'xyz', total_credits: 10 })];
    const pcts = computeVotePercentages(entries);
    expect(pcts[0]!.optionId).toBe('id-xyz');
  });
});
