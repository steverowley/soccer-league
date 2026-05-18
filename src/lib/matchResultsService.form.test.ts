// ── lib/matchResultsService.form.test.js ─────────────────────────────────────
// Targeted tests for the standings form-tracking added in this commit.
// Existing wins/draws/loses logic was already covered by manual playtest
// and by the standings UI rendering; these tests pin down the new
// last-5 form behaviour added to computeStandings.
//
// SCOPE
//   • form array is most-recent-first (results arrive newest-first)
//   • capped at 5 entries per team
//   • each entry is one of 'W' | 'D' | 'L'
//   • home team perspective vs away team perspective is correctly mirrored

import { describe, expect, it } from 'vitest';
import { computeStandings, type MatchResult } from './matchResultsService';


function result(
  home: string,
  homeGoals: number,
  away: string,
  awayGoals: number,
  leagueId: string = 'rocky-inner',
) {
  return {
    homeLeagueId:     leagueId,
    awayLeagueId:     leagueId,
    homeLeagueTeamId: home,
    awayLeagueTeamId: away,
    homeGoals,
    awayGoals,
  } as unknown as MatchResult;
}

/** Minimal base row.  All non-stat fields default in the merge step. */
const baseRows = [
  { id: 'mars-athletic',  team: 'Mars Athletic'  },
  { id: 'earth-united',   team: 'Earth United'   },
  { id: 'venus-volcanic', team: 'Venus Volcanic' },
];

describe('computeStandings — form tracking', () => {
  it('returns empty form array for teams with no results', () => {
    const rows = computeStandings('rocky-inner', baseRows, []);
    expect(rows.every(r => Array.isArray(r.form) && r.form.length === 0)).toBe(true);
  });

  it('records W for the winning side and L for the losing side', () => {
    const rows = computeStandings('rocky-inner', baseRows, [
      result('mars-athletic', 2, 'earth-united', 0),
    ]);
    const mars  = rows.find(r => r.id === 'mars-athletic')!;
    const earth = rows.find(r => r.id === 'earth-united')!;
    expect(mars.form).toEqual(['W']);
    expect(earth.form).toEqual(['L']);
  });

  it('records D for both sides on a draw', () => {
    const rows = computeStandings('rocky-inner', baseRows, [
      result('mars-athletic', 1, 'earth-united', 1),
    ]);
    expect(rows.find(r => r.id === 'mars-athletic')!.form).toEqual(['D']);
    expect(rows.find(r => r.id === 'earth-united')!.form).toEqual(['D']);
  });

  it('orders form most-recent-first (matches newest-first input)', () => {
    // Mars wins the most recent match (index 0), then loses, then draws.
    const rows = computeStandings('rocky-inner', baseRows, [
      result('mars-athletic', 3, 'earth-united', 0),   // newest: W for Mars
      result('mars-athletic', 0, 'earth-united', 1),   // middle: L for Mars
      result('mars-athletic', 1, 'earth-united', 1),   // oldest: D for Mars
    ]);
    expect(rows.find(r => r.id === 'mars-athletic')!.form).toEqual(['W', 'L', 'D']);
    expect(rows.find(r => r.id === 'earth-united')!.form).toEqual(['L', 'W', 'D']);
  });

  it('caps the form array at 5 entries per team', () => {
    // Eight consecutive Mars wins; only the most recent 5 should appear.
    const results = Array.from({ length: 8 }, () =>
      result('mars-athletic', 1, 'earth-united', 0));
    const rows = computeStandings('rocky-inner', baseRows, results);
    const mars  = rows.find(r => r.id === 'mars-athletic')!;
    const earth = rows.find(r => r.id === 'earth-united')!;
    expect(mars.form).toEqual(['W', 'W', 'W', 'W', 'W']);
    expect(earth.form).toEqual(['L', 'L', 'L', 'L', 'L']);
  });
});
