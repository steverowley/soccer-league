// ── MatchDetail.scoreboard.test.ts ──────────────────────────────────────────
// Two match-page defects from the owner's 390 px screenshot of a finished
// match: the ground read "Unknown Ground", and a bare "Mvp." line appeared at
// 91'. Both are pure functions over the match row / event payload.

import { describe, expect, it } from 'vitest';
import { eventHeading, eventProse, matchGroundName } from './MatchDetail';
import type { MatchEventRow } from '../features/match';

const ev = (type: string, payload: Record<string, unknown>): MatchEventRow =>
  ({ id: 'e', match_id: 'm', minute: 91, subminute: 0, type, payload, created_at: '' } as unknown as MatchEventRow);

describe('matchGroundName', () => {
  it('prefers matches.stadium when a producer ever sets it', () => {
    expect(matchGroundName({ stadium: 'Neutral Dome', home_team: { home_ground: 'X' } })).toBe('Neutral Dome');
  });

  it("uses the home side's stadium entity (matches.stadium is never written)", () => {
    expect(matchGroundName({
      stadium: null,
      home_team: { stadium: { name: 'Polar Tilt Arena' }, home_ground: 'Polar Tilt Arena "The Tilt"' },
    })).toBe('Polar Tilt Arena');
  });

  it('falls back to teams.home_ground', () => {
    expect(matchGroundName({ home_team: { stadium: null, home_ground: 'Crater Fields' } })).toBe('Crater Fields');
  });

  it('is null (no "Unknown Ground") when nothing is known', () => {
    expect(matchGroundName({ stadium: '  ', home_team: null })).toBeNull();
  });
});

describe('the full-time mvp event', () => {
  it('reads as "Player of the Match" with the player, not "Mvp"', () => {
    const e = ev('mvp', { player: 'Gyro Reyes' });
    expect(eventHeading(e)).toBe('Player of the Match');
    expect(eventProse(e)).toBe('Gyro Reyes');
  });

  it('has no prose when the payload names nobody', () => {
    expect(eventProse(ev('mvp', {}))).toBeNull();
  });
});
