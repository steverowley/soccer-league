// ── features/match/logic/viewer/replaySchedule.test.ts ──────────────────────
// Slow-motion replay scheduling (docs/match-viewer.md section 5C): which
// moments are replayed, how each is fitted (and trimmed) into the stoppage
// after it, and how a live instant maps to the replayed instant.

import { describe, expect, it } from 'vitest';
import type { ActionTrack, ReplayAction } from '../replay/actions';
import { GOAL_Y_MAX } from '../spatial/types';
import {
  CHANCE_REPLAY,
  GOAL_REPLAY,
  JUST_WIDE_M,
  REPLAY_MARGIN_REAL_SEC,
  REPLAY_MIN_REAL_SEC,
  REPLAY_POST_SEC,
  isJustWide,
  liveRate,
  replayAt,
  scheduleReplays,
} from './replaySchedule';

const DT = 0.1;
const tick = (sec: number): number => Math.round(sec / DT);
function track(...actions: ReplayAction[]): ActionTrack {
  return { dtSec: DT, actions: [...actions].sort((a, b) => a.tick - b.tick) };
}
/** 20-minute matches: 4.5 game seconds per real second. */
const DURATION = 1200;
const RATE = liveRate(DURATION);

/** A goal at `sec` with the kick-off ready `pause` game seconds later. */
function goalAt(sec: number, pause = 60): ReplayAction[] {
  return [
    { kind: 'kick', tick: tick(sec - 1), by: 9, kick: 'shot' },
    { kind: 'goal', tick: tick(sec), by: 9, side: 'home' },
    { kind: 'restart', tick: tick(sec + 0.5), restart: 'kickoff', by: 20, x: 52.5, y: 34, readyTick: tick(sec + pause) },
    { kind: 'kick', tick: tick(sec + pause), by: 20, kick: 'kickoff' },
  ];
}

describe('liveRate', () => {
  it('is 4.5 for a 20-minute match and 1 when unpaced', () => {
    expect(RATE).toBeCloseTo(4.5);
    expect(liveRate(0)).toBe(1);
  });
});

describe('scheduleReplays: goals', () => {
  it('replays the build-up at 0.5x, trimmed to end before the kick-off is ready', () => {
    const [w, ...rest] = scheduleReplays(track(...goalAt(1000)), DURATION);
    expect(rest).toEqual([]);
    expect(w).toBeDefined();
    expect(w!.kind).toBe('goal');
    expect(w!.speed).toBe(GOAL_REPLAY.speed);
    expect(w!.segEnd).toBeCloseTo(1000 + REPLAY_POST_SEC);
    // A 60 s pause at 4.5x cannot hold 8.6 game s at 0.5x (17 s real): trimmed from the start.
    expect(w!.segStart).toBeGreaterThan(1000 - GOAL_REPLAY.lookbackSec);
    expect(w!.segStart).toBeLessThan(1000 - 3);
    // Starts after the goal (a live beat first) and back to live before the kick-off is ready.
    expect(w!.liveStart).toBeGreaterThan(1000);
    expect(w!.liveEnd).toBeCloseTo(1060 - REPLAY_MARGIN_REAL_SEC * RATE);
    // Real lengths agree: what is shown equals the time it takes.
    expect((w!.liveEnd - w!.liveStart) / RATE).toBeCloseTo((w!.segEnd - w!.segStart) / w!.speed);
  });

  it('plays the whole 8 game seconds when the pause allows it (a slower match)', () => {
    const [w] = scheduleReplays(track(...goalAt(1000)), 5400); // 1x
    expect(w!.segStart).toBeCloseTo(1000 - GOAL_REPLAY.lookbackSec);
    expect(w!.liveEnd).toBeCloseTo(w!.liveStart + (GOAL_REPLAY.lookbackSec + REPLAY_POST_SEC) / GOAL_REPLAY.speed);
  });

  it('a goal with the final whistle (no kick-off after it) still replays in full', () => {
    const t = track({ kind: 'kick', tick: tick(5399), by: 9, kick: 'shot' }, { kind: 'goal', tick: tick(5400), by: 9, side: 'away' });
    const [w] = scheduleReplays(t, DURATION);
    expect(w!.segStart).toBeCloseTo(5400 - GOAL_REPLAY.lookbackSec);
  });
});

describe('scheduleReplays: chances', () => {
  const corner = (sec: number, ready: number): ReplayAction => ({
    kind: 'restart', tick: tick(sec), restart: 'corner', by: 7, x: 105, y: 0, readyTick: tick(ready),
  });

  it('a save that goes out for a corner replays at 0.75x within the corner pause', () => {
    const t = track(
      { kind: 'kick', tick: tick(2000), by: 9, kick: 'shot' },
      { kind: 'dive', tick: tick(2000.6), by: 0, x: 104.5, y: 30, z: 0.8, outcome: 'save' },
      { kind: 'kick', tick: tick(2000.8), by: 0, kick: 'parry' },
      corner(2002, 2030),
      { kind: 'kick', tick: tick(2030), by: 7, kick: 'corner' },
    );
    const [w] = scheduleReplays(t, DURATION);
    expect(w!.kind).toBe('save');
    expect(w!.speed).toBe(CHANCE_REPLAY.speed);
    expect(w!.liveEnd).toBeLessThanOrEqual(2030 - REPLAY_MARGIN_REAL_SEC * RATE + 1e-9);
    expect(w!.segEnd).toBeCloseTo(2000.6 + REPLAY_POST_SEC);
  });

  it('a dive with no shot before it (a cross claimed) is not a save to replay', () => {
    const t = track(
      { kind: 'kick', tick: tick(2000), by: 9, kick: 'cross' },
      { kind: 'dive', tick: tick(2001), by: 0, x: 104, y: 30, z: 2, outcome: 'catch' },
      { kind: 'restart', tick: tick(2002), restart: 'keeper', by: 0, x: 100, y: 34, readyTick: tick(2030) },
    );
    expect(scheduleReplays(t, DURATION)).toEqual([]);
  });

  it('woodwork replays when the ball goes out, not when play carries on', () => {
    const out = track(
      { kind: 'kick', tick: tick(3000), by: 9, kick: 'shot' },
      { kind: 'woodwork', tick: tick(3000.5), by: 9 },
      { kind: 'restart', tick: tick(3002), restart: 'goalkick', by: 0, x: 100, y: 30, readyTick: tick(3030) },
    );
    expect(scheduleReplays(out, DURATION)[0]?.kind).toBe('woodwork');
    const live = track(
      { kind: 'kick', tick: tick(3000), by: 9, kick: 'shot' },
      { kind: 'woodwork', tick: tick(3000.5), by: 9 },
      { kind: 'kick', tick: tick(3003), by: 14, kick: 'clear' },
      { kind: 'restart', tick: tick(3006), restart: 'throw', by: 3, x: 60, y: 0, readyTick: tick(3020) },
    );
    expect(scheduleReplays(live, DURATION)).toEqual([]);
  });

  it('a shot just wide replays; a shot well wide or without a ball lookup does not', () => {
    const shotOut = track(
      { kind: 'kick', tick: tick(4000), by: 9, kick: 'shot' },
      { kind: 'restart', tick: tick(4001.5), restart: 'goalkick', by: 0, x: 99.5, y: 30, readyTick: tick(4030) },
    );
    const near = { ballAt: () => ({ x: 105, y: GOAL_Y_MAX + JUST_WIDE_M - 0.5, z: 0.5 }) };
    const far = { ballAt: () => ({ x: 105, y: GOAL_Y_MAX + JUST_WIDE_M + 4, z: 0.5 }) };
    expect(scheduleReplays(shotOut, DURATION, near)[0]?.kind).toBe('wide');
    expect(scheduleReplays(shotOut, DURATION, far)).toEqual([]);
    expect(scheduleReplays(shotOut, DURATION)).toEqual([]);
  });

  it('isJustWide needs the goal line, near a post, below bar height plus a bit', () => {
    expect(isJustWide({ x: 105, y: GOAL_Y_MAX + 1, z: 1 })).toBe(true);
    expect(isJustWide({ x: 60, y: GOAL_Y_MAX + 1, z: 1 })).toBe(false);
    expect(isJustWide({ x: 0, y: GOAL_Y_MAX + 1, z: 9 })).toBe(false);
  });

  it('a stoppage too short to hold a replay worth cutting to has none', () => {
    const t = track(
      { kind: 'kick', tick: tick(2000), by: 9, kick: 'shot' },
      { kind: 'dive', tick: tick(2000.6), by: 0, x: 104.5, y: 30, z: 0.8, outcome: 'save' },
      corner(2002, 2000.6 + (REPLAY_MIN_REAL_SEC + 0.5) * RATE),
    );
    expect(scheduleReplays(t, DURATION)).toEqual([]);
  });
});

describe('scheduleReplays: one per stoppage, never overlapping', () => {
  it('a goal off the woodwork is one goal replay', () => {
    const t = track(
      { kind: 'kick', tick: tick(999), by: 9, kick: 'shot' },
      { kind: 'woodwork', tick: tick(999.5), by: 9 },
      ...goalAt(1000).slice(1),
    );
    const ws = scheduleReplays(t, DURATION);
    expect(ws.map((w) => w.kind)).toEqual(['goal']);
  });

  it('windows come back in live order and never overlap', () => {
    const t = track(...goalAt(1000), ...goalAt(3000), ...goalAt(2000));
    const ws = scheduleReplays(t, DURATION);
    expect(ws.map((w) => Math.round(w.eventSec))).toEqual([1000, 2000, 3000]);
    for (let i = 1; i < ws.length; i++) expect(ws[i]!.liveStart).toBeGreaterThanOrEqual(ws[i - 1]!.liveEnd);
  });

  it('no track, no replays', () => {
    expect(scheduleReplays(null, DURATION)).toEqual([]);
  });
});

describe('replayAt', () => {
  it('maps live time to replay time at the replay speed, and is null outside the window', () => {
    const ws = scheduleReplays(track(...goalAt(1000)), DURATION);
    const w = ws[0]!;
    expect(replayAt(ws, w.liveStart - 0.01)).toBeNull();
    expect(replayAt(ws, w.liveStart)?.replaySec).toBeCloseTo(w.segStart);
    // One real second of live play (4.5 game s) shows 0.5 game s of the replay.
    expect(replayAt(ws, w.liveStart + RATE)?.replaySec).toBeCloseTo(w.segStart + GOAL_REPLAY.speed);
    expect(replayAt(ws, w.liveEnd - 1e-6)?.replaySec).toBeCloseTo(w.segEnd);
    expect(replayAt(ws, w.liveEnd)).toBeNull();
  });
});
