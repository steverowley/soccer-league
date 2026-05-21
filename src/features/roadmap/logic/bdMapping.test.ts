// ── roadmap/logic/bdMapping.test.ts ─────────────────────────────────────────
// Unit tests for the bd ↔ kanban translation layer.
//
// These guard the only place where bd vocabulary meets dashboard
// vocabulary — getting the mapping wrong would silently bucket items
// into the wrong column or invert the priority order, both of which
// would make the dashboard untrustworthy as a project view.

import { describe, it, expect } from 'vitest';
import { mapBdStatus, mapBdPriority } from './bdMapping';

// ── mapBdStatus ────────────────────────────────────────────────────────────

describe('mapBdStatus', () => {
  it.each([
    ['open',        'idea'],
    ['blocked',     'idea'],
    ['ready',       'planned'],
    ['in_progress', 'in_progress'],
    ['closed',      'shipped'],
  ])('bd status %s → kanban %s', (bd, kanban) => {
    expect(mapBdStatus(bd)).toBe(kanban);
  });

  it('falls back to "idea" for unknown statuses so the card never disappears', () => {
    expect(mapBdStatus('weird-future-status')).toBe('idea');
    expect(mapBdStatus('')).toBe('idea');
  });
});

// ── mapBdPriority ──────────────────────────────────────────────────────────

describe('mapBdPriority', () => {
  it.each([
    [0, 5],
    [1, 20],
    [2, 45],
    [3, 70],
    [4, 85],
    [5, 95],
  ])('bd priority %i → kanban %i', (bd, kanban) => {
    expect(mapBdPriority(bd)).toBe(kanban);
  });

  it('clamps bd priority > 5 to the low-priority anchor (95)', () => {
    expect(mapBdPriority(6)).toBe(95);
    expect(mapBdPriority(99)).toBe(95);
  });

  it('falls back to 50 (mid) for null / undefined / NaN / negative inputs', () => {
    expect(mapBdPriority(null)).toBe(50);
    expect(mapBdPriority(undefined)).toBe(50);
    expect(mapBdPriority(Number.NaN)).toBe(50);
    expect(mapBdPriority(-3)).toBe(50);
  });

  it('preserves the lower-is-higher ordering invariant across the scale', () => {
    // The whole point of the mapping is that bd 0 < bd 5 in urgency
    // remains true after translation: kanban(bd 0) < kanban(bd 5).
    for (let a = 0; a <= 4; a += 1) {
      expect(mapBdPriority(a)).toBeLessThan(mapBdPriority(a + 1));
    }
  });
});
