import { describe, expect, it } from 'vitest';
import { competitionLabel, roundLabel } from './fixtureLabels';

describe('competitionLabel', () => {
  it('drops the season suffix every row would repeat', () => {
    expect(competitionLabel('Rocky Inner League: Season 1 (2600)')).toBe('Rocky Inner League');
    expect(competitionLabel('Celestial Cup: Season 1 (2600)')).toBe('Celestial Cup');
  });
  it('keeps a name without a suffix and falls back when missing', () => {
    expect(competitionLabel('Solar Shield')).toBe('Solar Shield');
    expect(competitionLabel(null)).toBe('League');
    expect(competitionLabel('')).toBe('League');
  });
});

describe('roundLabel', () => {
  it('never doubles the prefix (the home card said "Matchday Matchday 1")', () => {
    expect(roundLabel('Matchday 1')).toBe('Matchday 1');
    expect(roundLabel('Quarter-final')).toBe('Quarter-final');
  });
  it('prefixes a bare number and leaves empty values empty', () => {
    expect(roundLabel(3)).toBe('Matchday 3');
    expect(roundLabel('3')).toBe('Matchday 3');
    expect(roundLabel(null)).toBe('');
    expect(roundLabel('')).toBe('');
  });
});
