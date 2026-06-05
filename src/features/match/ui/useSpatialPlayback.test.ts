// ── useSpatialPlayback tests ──────────────────────────────────────────────────
// WHY: the hook is the sync contract between the 2D pitch and the commentary
// feed.  Both must reveal the SAME game-minute at the same wall-clock instant,
// which means the pitch has to compress real time into game time using the
// season's match_duration_seconds — exactly like computeElapsedGameMinute does
// for the feed.  These tests pin that compression, the pre-kickoff / no-frames
// inactive states, the divide-by-zero guard, and live frame advancement.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { useSpatialPlayback } from './useSpatialPlayback';
import type { PositionSnapshot } from '../api/matchPositions';

const KICKOFF = '2026-06-04T12:00:00.000Z';
const KICKOFF_MS = new Date(KICKOFF).getTime();
const DURATION = 600; // production default: 90 game-minutes revealed over 10 real minutes
const PITCH_LENGTH_M = 105; // ball.x is normalised by this in the hook

/**
 * Build one snapshot at a given game minute/second.  `ballX` (in metres) is a
 * unique marker so a test can tell which frame the hook selected by reading the
 * returned (normalised) ballOverride.x back out.
 */
function frame(minute: number, second: number, ballX: number): PositionSnapshot {
  return {
    minute,
    second,
    snapshots: {
      players: [{ id: 'p1', x: ballX, y: 34, hasBall: true }],
      ball: { x: ballX, y: 34, ownerId: 'p1' },
    },
  };
}

// Three frames spanning the match: kickoff (gameSec 0), minute 45 (gameSec
// 2640), and minute 90 (gameSec 5340).  Distinct ball.x per frame.
const FRAMES: PositionSnapshot[] = [
  frame(1, 0, 10),
  frame(45, 0, 50),
  frame(90, 0, 90),
];

/** Move the fake wall-clock to `realElapsedSec` seconds past kickoff. */
function setNow(realElapsedSec: number): void {
  vi.setSystemTime(new Date(KICKOFF_MS + realElapsedSec * 1000));
}

/** The normalised ball.x the hook should return for a given marker metre value. */
function normX(ballXMetres: number): number {
  return ballXMetres / PITCH_LENGTH_M;
}

describe('useSpatialPlayback', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('is inactive before kickoff', () => {
    setNow(-30);
    const { result } = renderHook(() => useSpatialPlayback(FRAMES, KICKOFF, DURATION));
    expect(result.current.active).toBe(false);
    expect(result.current.ballOverride).toBeNull();
    expect(result.current.playerOverrides.size).toBe(0);
  });

  it('is inactive when no frames are loaded (legacy match)', () => {
    setNow(120);
    const { result } = renderHook(() => useSpatialPlayback([], KICKOFF, DURATION));
    expect(result.current.active).toBe(false);
  });

  it('is inactive when scheduledAt is null (match row not loaded yet)', () => {
    setNow(120);
    const { result } = renderHook(() => useSpatialPlayback(FRAMES, null, DURATION));
    expect(result.current.active).toBe(false);
  });

  it('shows the kickoff frame at the start of the window', () => {
    setNow(0);
    const { result } = renderHook(() => useSpatialPlayback(FRAMES, KICKOFF, DURATION));
    expect(result.current.active).toBe(true);
    expect(result.current.ballOverride!.x).toBeCloseTo(normX(10), 5);
  });

  it('compresses real time into game time, in sync with the commentary mapping', () => {
    // Half-way through the 600s window → game-minute 45 → the minute-45 frame.
    // (computeElapsedGameMinute(kickoff, +300s, 600) = floor(300/600*90) = 45.)
    setNow(300);
    const { result } = renderHook(() => useSpatialPlayback(FRAMES, KICKOFF, DURATION));
    expect(result.current.active).toBe(true);
    expect(result.current.ballOverride!.x).toBeCloseTo(normX(50), 5);
  });

  it('reaches the final frame by the close of the window', () => {
    setNow(600);
    const { result } = renderHook(() => useSpatialPlayback(FRAMES, KICKOFF, DURATION));
    expect(result.current.ballOverride!.x).toBeCloseTo(normX(90), 5);
  });

  it('advances to a later frame as wall-clock time passes', () => {
    setNow(0);
    const { result } = renderHook(() => useSpatialPlayback(FRAMES, KICKOFF, DURATION));
    expect(result.current.ballOverride!.x).toBeCloseTo(normX(10), 5); // kickoff frame

    act(() => {
      setNow(300);                  // jump to the half-window mark
      vi.advanceTimersByTime(500);  // fire one TICK_MS interval
    });
    expect(result.current.ballOverride!.x).toBeCloseTo(normX(50), 5); // minute-45 frame
  });

  it('falls back to a 1x mapping (no divide-by-zero) when duration is 0', () => {
    // gameSec = realElapsedSec = 100 → last frame ≤ 100s is the kickoff frame.
    setNow(100);
    const { result } = renderHook(() => useSpatialPlayback(FRAMES, KICKOFF, 0));
    expect(result.current.active).toBe(true);
    expect(result.current.ballOverride!.x).toBeCloseTo(normX(10), 5);
  });
});
