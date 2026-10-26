import { describe, it, expect } from 'vitest';
import { computeLiveScore, isRevealing, liveScoreAt, type ScorableEvent } from './liveScore';

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

describe('liveScoreAt (the scoreboard lists show for a live match)', () => {
  // A 600 s reveal: 90 game minutes over 10 real minutes, so 1 game minute
  // every 6.67 real seconds.
  const KO = '2026-10-26T19:30:00.000Z';
  const at = (realSeconds: number) => new Date(Date.parse(KO) + realSeconds * 1000);
  const goals = [
    { minute: 12, type: 'goal', payload: { side: 'away' } },
    { minute: 40, type: 'goal', payload: { side: 'home' } },
    { minute: 92, type: 'goal', payload: { side: 'away' } }, // stoppage time
    { minute: 30, type: 'shot', payload: { side: 'home' } }, // not a goal
  ];

  it('shows 0-0 at kickoff, before any goal is revealed', () => {
    expect(liveScoreAt(goals, KO, at(0), 600)).toEqual({ score: [0, 0], minute: 0, fullTime: false });
  });

  it('reveals each goal at its minute, not before (the bug: lists showed the row, 0-0 all match)', () => {
    expect(liveScoreAt(goals, KO, at(79), 600).score).toEqual([0, 0]);   // minute 11
    expect(liveScoreAt(goals, KO, at(80), 600)).toEqual({ score: [0, 1], minute: 12, fullTime: false });
    expect(liveScoreAt(goals, KO, at(300), 600)).toEqual({ score: [1, 1], minute: 45, fullTime: false });
  });

  it('agrees with the match page clock (computeElapsedGameMinute) at every second', () => {
    for (let s = 0; s < 600; s += 1) {
      const { minute } = liveScoreAt(goals, KO, at(s), 600);
      expect(minute).toBe(Math.floor((s / 600) * 90));
    }
  });

  it('at full time shows every goal, stoppage time included, even while the row still says live', () => {
    expect(liveScoreAt(goals, KO, at(600), 600)).toEqual({ score: [1, 2], minute: 90, fullTime: true });
    expect(liveScoreAt(goals, KO, at(5000), 600).score).toEqual([1, 2]);
  });

  it('follows the season pacing knob, not a hard-coded 10 minutes', () => {
    // A 20-minute reveal reaches minute 12 at 160 s, not 80 s.
    expect(liveScoreAt(goals, KO, at(80), 1200).score).toEqual([0, 0]);
    expect(liveScoreAt(goals, KO, at(160), 1200).score).toEqual([0, 1]);
  });
});
