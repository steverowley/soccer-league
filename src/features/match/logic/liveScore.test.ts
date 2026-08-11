import { describe, it, expect } from 'vitest';
import { computeLiveScore, isRevealing, type ScorableEvent } from './liveScore';

/** Terse goal-event builder — the only field that matters is payload.side. */
const goal = (side?: string): ScorableEvent => ({
  type: 'goal',
  payload: side ? { side, isGoal: true } : { isGoal: true },
});

describe('computeLiveScore', () => {
  it('returns 0-0 for an empty event list', () => {
    // A match that has kicked off but revealed nothing yet must read 0-0,
    // never the published (final) score.
    expect(computeLiveScore([])).toEqual([0, 0]);
  });

  it('counts goals per side', () => {
    expect(computeLiveScore([goal('home'), goal('away'), goal('home')])).toEqual([2, 1]);
  });

  it('ignores non-goal events even when they carry a side', () => {
    const events: ScorableEvent[] = [
      { type: 'shot',   payload: { side: 'home' } },
      { type: 'save',   payload: { side: 'away' } },
      { type: 'tackle', payload: { side: 'home' } },
      goal('away'),
    ];
    expect(computeLiveScore(events)).toEqual([0, 1]);
  });

  it('skips goals with no side rather than guessing an attribution', () => {
    // Observed in production: {"isGoal":true,"commentary":"A player scores for
    // Away!"} — the display short-name is absent, so the goal is unattributable.
    // Guessing would show a scoreline that never happened.
    expect(computeLiveScore([goal('home'), goal()])).toEqual([1, 0]);
  });

  it('ignores a malformed or non-object payload', () => {
    const events: ScorableEvent[] = [
      { type: 'goal', payload: null },
      { type: 'goal', payload: 'home' },
      { type: 'goal' },
      { type: 'goal', payload: { side: 'sideways' } },
      goal('home'),
    ];
    expect(computeLiveScore(events)).toEqual([1, 0]);
  });

  it('reveals progressively as more events become visible', () => {
    // The scoreboard is fed the output of filterEventsByElapsedMinute, so a
    // growing prefix must produce a monotonically growing scoreline — this is
    // the property that makes the match feel live.
    const full = [goal('home'), goal('away'), goal('home')];
    expect(computeLiveScore(full.slice(0, 0))).toEqual([0, 0]);
    expect(computeLiveScore(full.slice(0, 1))).toEqual([1, 0]);
    expect(computeLiveScore(full.slice(0, 2))).toEqual([1, 1]);
    expect(computeLiveScore(full.slice(0, 3))).toEqual([2, 1]);
  });
});

describe('isRevealing', () => {
  it('treats live and in_progress as still revealing', () => {
    expect(isRevealing('live')).toBe(true);
    expect(isRevealing('in_progress')).toBe(true);
  });

  it('treats published and pre-kickoff states as not revealing', () => {
    // `completed` is the only state where the published score is trustworthy.
    expect(isRevealing('completed')).toBe(false);
    expect(isRevealing('scheduled')).toBe(false);
    expect(isRevealing('cancelled')).toBe(false);
    expect(isRevealing(null)).toBe(false);
    expect(isRevealing(undefined)).toBe(false);
  });
});
