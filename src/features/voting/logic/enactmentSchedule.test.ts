// ── voting/logic/enactmentSchedule.test.ts ───────────────────────────────────
// Tests for the pure "is this season due for enactment?" predicate (#529).

import { describe, it, expect } from 'vitest';
import {
  isSeasonDueForEnactment,
  DEFAULT_ENACTMENT_WINDOW_HOURS,
  type SchedulableSeason,
} from './enactmentSchedule';

const NOW = Date.parse('2026-06-06T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

function season(over: Partial<SchedulableSeason> = {}): SchedulableSeason {
  return { id: 's1', status: 'voting', election_opens_at: null, ended_at: null, ...over };
}

describe('isSeasonDueForEnactment', () => {
  it('is due once the window has fully elapsed', () => {
    expect(isSeasonDueForEnactment(season({ election_opens_at: hoursAgo(49) }), NOW)).toBe(true);
  });

  it('is not due before the window elapses', () => {
    expect(isSeasonDueForEnactment(season({ election_opens_at: hoursAgo(47) }), NOW)).toBe(false);
  });

  it('treats exactly the window boundary as due', () => {
    expect(isSeasonDueForEnactment(season({ election_opens_at: hoursAgo(DEFAULT_ENACTMENT_WINDOW_HOURS) }), NOW)).toBe(true);
  });

  it('only fires for the voting phase', () => {
    expect(isSeasonDueForEnactment(season({ status: 'active', election_opens_at: hoursAgo(99) }), NOW)).toBe(false);
    expect(isSeasonDueForEnactment(season({ status: 'enacted', election_opens_at: hoursAgo(99) }), NOW)).toBe(false);
  });

  it('falls back to ended_at when election_opens_at is null (worker-transitioned seasons)', () => {
    expect(isSeasonDueForEnactment(season({ election_opens_at: null, ended_at: hoursAgo(49) }), NOW)).toBe(true);
    expect(isSeasonDueForEnactment(season({ election_opens_at: null, ended_at: hoursAgo(10) }), NOW)).toBe(false);
  });

  it('prefers election_opens_at over ended_at when both exist', () => {
    // opens 10h ago (not due) but ended 99h ago — anchor is opens → not due.
    expect(isSeasonDueForEnactment(season({ election_opens_at: hoursAgo(10), ended_at: hoursAgo(99) }), NOW)).toBe(false);
  });

  it('is never due with no anchor timestamp or an unparseable one', () => {
    expect(isSeasonDueForEnactment(season({ election_opens_at: null, ended_at: null }), NOW)).toBe(false);
    expect(isSeasonDueForEnactment(season({ election_opens_at: 'not-a-date' }), NOW)).toBe(false);
  });

  it('honours a custom window length', () => {
    expect(isSeasonDueForEnactment(season({ election_opens_at: hoursAgo(5) }), NOW, 4)).toBe(true);
    expect(isSeasonDueForEnactment(season({ election_opens_at: hoursAgo(3) }), NOW, 4)).toBe(false);
  });
});
