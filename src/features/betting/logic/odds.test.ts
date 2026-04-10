// ── odds.test.ts ────────────────────────────────────────────────────────────
// WHY: Unit tests for the pure odds calculation pipeline. These verify the
// mathematical model produces sensible football-like odds across a range of
// team quality and form scenarios.

import { describe, it, expect } from 'vitest';
import {
  effectiveRating,
  computeProbabilities,
  probsToOdds,
  computeMatchOdds,
  computeAvgRating,
  computeForm,
  HOUSE_MARGIN,
  FORM_WINDOW,
} from './odds';
import type { TeamOddsInput } from '../types';

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Build a TeamOddsInput with neutral form. */
function team(avgRating: number, wins = 0, draws = 0, losses = 0): TeamOddsInput {
  return { avgRating, form: { wins, draws, losses } };
}

// ── effectiveRating ─────────────────────────────────────────────────────────

describe('effectiveRating', () => {
  it('returns base rating when form is neutral', () => {
    expect(effectiveRating(team(80, 2, 1, 2))).toBe(80); // net = 0
  });

  it('increases rating for positive form', () => {
    const rating = effectiveRating(team(75, 4, 1, 0));
    expect(rating).toBeGreaterThan(75);
  });

  it('decreases rating for negative form', () => {
    const rating = effectiveRating(team(75, 0, 1, 4));
    expect(rating).toBeLessThan(75);
  });

  it('applies 1.5 points per net form result', () => {
    // 3 wins, 0 losses → net +3 → +4.5
    expect(effectiveRating(team(80, 3, 2, 0))).toBe(84.5);
  });
});

// ── computeProbabilities ────────────────────────────────────────────────────

describe('computeProbabilities', () => {
  it('probabilities sum to 1.0', () => {
    const probs = computeProbabilities(team(80), team(75));
    const sum = probs.home + probs.draw + probs.away;
    expect(sum).toBeCloseTo(1.0, 10);
  });

  it('equal teams have home advantage', () => {
    const probs = computeProbabilities(team(75), team(75));
    expect(probs.home).toBeGreaterThan(probs.away);
  });

  it('draw probability is highest when teams are equal', () => {
    const equalProbs = computeProbabilities(team(75), team(75));
    const unequalProbs = computeProbabilities(team(85), team(65));
    expect(equalProbs.draw).toBeGreaterThan(unequalProbs.draw);
  });

  it('better home team has higher home win probability', () => {
    const probs = computeProbabilities(team(85), team(65));
    expect(probs.home).toBeGreaterThan(0.5);
    expect(probs.away).toBeLessThan(0.3);
  });

  it('better away team can still have higher win probability', () => {
    const probs = computeProbabilities(team(60), team(90));
    expect(probs.away).toBeGreaterThan(probs.home);
  });

  it('draw probability never goes below 5%', () => {
    const probs = computeProbabilities(team(99), team(40));
    expect(probs.draw).toBeGreaterThanOrEqual(0.05);
  });

  it('form affects probabilities', () => {
    const noForm = computeProbabilities(team(75), team(75));
    const goodForm = computeProbabilities(team(75, 5, 0, 0), team(75, 0, 0, 5));
    // Home on a winning streak vs away on a losing streak → higher home prob.
    expect(goodForm.home).toBeGreaterThan(noForm.home);
  });

  it('produces realistic odds for closely matched teams', () => {
    const probs = computeProbabilities(team(78), team(76));
    // Expect roughly: home ~40-45%, draw ~22-26%, away ~30-35%
    expect(probs.home).toBeGreaterThan(0.35);
    expect(probs.home).toBeLessThan(0.55);
    expect(probs.draw).toBeGreaterThan(0.15);
    expect(probs.draw).toBeLessThan(0.30);
  });
});

// ── probsToOdds ─────────────────────────────────────────────────────────────

describe('probsToOdds', () => {
  it('all odds are > 1.0', () => {
    const odds = probsToOdds({ home: 0.5, draw: 0.25, away: 0.25 });
    expect(odds.homeOdds).toBeGreaterThan(1);
    expect(odds.drawOdds).toBeGreaterThan(1);
    expect(odds.awayOdds).toBeGreaterThan(1);
  });

  it('overround equals 1 + HOUSE_MARGIN', () => {
    const odds = probsToOdds({ home: 0.5, draw: 0.25, away: 0.25 });
    const impliedSum = 1 / odds.homeOdds + 1 / odds.drawOdds + 1 / odds.awayOdds;
    expect(impliedSum).toBeCloseTo(1 + HOUSE_MARGIN, 1);
  });

  it('higher probability → lower odds', () => {
    const odds = probsToOdds({ home: 0.6, draw: 0.2, away: 0.2 });
    expect(odds.homeOdds).toBeLessThan(odds.drawOdds);
    expect(odds.homeOdds).toBeLessThan(odds.awayOdds);
  });

  it('odds are rounded to 2 decimal places', () => {
    const odds = probsToOdds({ home: 0.333, draw: 0.333, away: 0.334 });
    const decimals = (n: number) => (n.toString().split('.')[1] ?? '').length;
    expect(decimals(odds.homeOdds)).toBeLessThanOrEqual(2);
    expect(decimals(odds.drawOdds)).toBeLessThanOrEqual(2);
    expect(decimals(odds.awayOdds)).toBeLessThanOrEqual(2);
  });
});

// ── computeMatchOdds (full pipeline) ────────────────────────────────────────

describe('computeMatchOdds', () => {
  it('produces all three odds fields', () => {
    const odds = computeMatchOdds(team(78), team(74));
    expect(odds).toHaveProperty('homeOdds');
    expect(odds).toHaveProperty('drawOdds');
    expect(odds).toHaveProperty('awayOdds');
  });

  it('favourite has lower odds than underdog', () => {
    const odds = computeMatchOdds(team(85), team(65));
    expect(odds.homeOdds).toBeLessThan(odds.awayOdds);
  });

  it('draw odds are typically between home and away for close matches', () => {
    const odds = computeMatchOdds(team(77), team(75));
    // Draw odds should be moderate — higher than favourite but not extreme.
    expect(odds.drawOdds).toBeGreaterThan(odds.homeOdds);
  });
});

// ── computeAvgRating ────────────────────────────────────────────────────────

describe('computeAvgRating', () => {
  it('returns 70 for empty player array', () => {
    expect(computeAvgRating([])).toBe(70);
  });

  it('computes correct average for uniform stats', () => {
    const players = [
      { attacking: 80, defending: 80, mental: 80, athletic: 80, technical: 80 },
    ];
    expect(computeAvgRating(players)).toBe(80);
  });

  it('averages across categories and players', () => {
    const players = [
      { attacking: 90, defending: 70, mental: 80, athletic: 80, technical: 80 },
      { attacking: 70, defending: 90, mental: 80, athletic: 80, technical: 80 },
    ];
    // Each player avg = 80, team avg = 80.
    expect(computeAvgRating(players)).toBe(80);
  });

  it('handles mixed stat ranges', () => {
    const players = [
      { attacking: 60, defending: 70, mental: 80, athletic: 90, technical: 50 },
    ];
    // avg = (60+70+80+90+50)/5 = 70
    expect(computeAvgRating(players)).toBe(70);
  });
});

// ── computeForm ─────────────────────────────────────────────────────────────

describe('computeForm', () => {
  it('counts wins, draws, and losses', () => {
    expect(computeForm(['W', 'W', 'D', 'L', 'W'])).toEqual({
      wins: 3, draws: 1, losses: 1,
    });
  });

  it('only considers first FORM_WINDOW results', () => {
    const results: Array<'W' | 'D' | 'L'> = ['W', 'W', 'W', 'W', 'W', 'L', 'L', 'L'];
    const form = computeForm(results);
    expect(form.wins).toBe(FORM_WINDOW); // Only first 5.
    expect(form.losses).toBe(0);
  });

  it('handles empty results', () => {
    expect(computeForm([])).toEqual({ wins: 0, draws: 0, losses: 0 });
  });

  it('handles fewer results than FORM_WINDOW', () => {
    expect(computeForm(['W', 'L'])).toEqual({ wins: 1, draws: 0, losses: 1 });
  });
});

// ── Constants ───────────────────────────────────────────────────────────────

describe('constants', () => {
  it('HOUSE_MARGIN is 5%', () => {
    expect(HOUSE_MARGIN).toBe(0.05);
  });

  it('FORM_WINDOW is 5', () => {
    expect(FORM_WINDOW).toBe(5);
  });
});
