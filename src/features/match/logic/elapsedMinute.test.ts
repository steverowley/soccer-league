// ── elapsedMinute.test.ts ────────────────────────────────────────────────────
// Pure-logic tests for the live viewer's wall-clock → game-minute helper.

import { describe, it, expect } from 'vitest';
import { computeElapsedGameMinute, filterEventsByElapsedMinute } from './elapsedMinute';

describe('computeElapsedGameMinute', () => {
  it('returns 0 when now equals kickoff', () => {
    const t = '2026-04-01T12:00:00Z';
    expect(computeElapsedGameMinute(t, new Date(t), 600)).toBe(0);
  });

  it('returns 0 when now is before kickoff', () => {
    expect(
      computeElapsedGameMinute(
        '2026-04-01T12:00:00Z',
        new Date('2026-04-01T11:59:00Z'),
        600,
      ),
    ).toBe(0);
  });

  it('scales 60s elapsed @ 600s duration → minute 9', () => {
    // 60s of 600s = 10% of match → 0.10 × 90 = 9
    expect(
      computeElapsedGameMinute(
        '2026-04-01T12:00:00Z',
        new Date('2026-04-01T12:01:00Z'),
        600,
      ),
    ).toBe(9);
  });

  it('scales halfway through (300s of 600s) → minute 45', () => {
    expect(
      computeElapsedGameMinute(
        '2026-04-01T12:00:00Z',
        new Date('2026-04-01T12:05:00Z'),
        600,
      ),
    ).toBe(45);
  });

  it('returns 90 once full duration elapsed', () => {
    expect(
      computeElapsedGameMinute(
        '2026-04-01T12:00:00Z',
        new Date('2026-04-01T12:10:00Z'),
        600,
      ),
    ).toBe(90);
  });

  it('exceeds 90 after duration when caller does not cap', () => {
    // 11 minutes elapsed, 10-min duration: 1.1 × 90 = 99
    expect(
      computeElapsedGameMinute(
        '2026-04-01T12:00:00Z',
        new Date('2026-04-01T12:11:00Z'),
        600,
      ),
    ).toBe(99);
  });

  it('uses floor — half-minute progress does not advance the integer', () => {
    // 65s elapsed @ 600s duration → 9.75 → floor 9
    expect(
      computeElapsedGameMinute(
        '2026-04-01T12:00:00Z',
        new Date('2026-04-01T12:01:05Z'),
        600,
      ),
    ).toBe(9);
  });

  it('returns 0 for non-positive duration', () => {
    expect(
      computeElapsedGameMinute(
        '2026-04-01T12:00:00Z',
        new Date('2026-04-01T12:05:00Z'),
        0,
      ),
    ).toBe(0);
    expect(
      computeElapsedGameMinute(
        '2026-04-01T12:00:00Z',
        new Date('2026-04-01T12:05:00Z'),
        -1,
      ),
    ).toBe(0);
  });

  it('handles a fast test season (180s duration → 30s = 15 minutes)', () => {
    expect(
      computeElapsedGameMinute(
        '2026-04-01T12:00:00Z',
        new Date('2026-04-01T12:00:30Z'),
        180,
      ),
    ).toBe(15);
  });
});

describe('filterEventsByElapsedMinute', () => {
  const events = [
    { minute: 1,  type: 'kickoff' },
    { minute: 12, type: 'shot' },
    { minute: 45, type: 'goal' },
    { minute: 60, type: 'card' },
    { minute: 90, type: 'fulltime' },
  ];

  it('returns empty array when elapsed is 0 (no events at minute 0 in this set)', () => {
    expect(filterEventsByElapsedMinute(events, 0)).toEqual([]);
  });

  it('includes events at minute boundary equal to elapsed', () => {
    expect(filterEventsByElapsedMinute(events, 12)).toEqual([
      { minute: 1,  type: 'kickoff' },
      { minute: 12, type: 'shot' },
    ]);
  });

  it('returns all events when elapsed >= max minute', () => {
    expect(filterEventsByElapsedMinute(events, 90)).toEqual(events);
    expect(filterEventsByElapsedMinute(events, 9999)).toEqual(events);
  });

  it('preserves input order', () => {
    const out = filterEventsByElapsedMinute(events, 60);
    expect(out.map((e) => e.minute)).toEqual([1, 12, 45, 60]);
  });
});
