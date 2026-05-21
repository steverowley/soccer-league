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
  // bd's built-in statuses per `bd update --help`:
  //   open, in_progress, blocked, deferred, closed, pinned, hooked.
  // pinned + hooked map to the dashboard's "Planned" column by convention
  // (pin a bd issue when it's groomed and ready to claim).
  it.each([
    ['open',        'idea'],
    ['blocked',     'idea'],
    ['deferred',    'idea'],
    ['pinned',      'planned'],
    ['hooked',      'planned'],
    ['in_progress', 'in_progress'],
    ['closed',      'shipped'],
  ])('bd status %s → kanban %s', (bd, kanban) => {
    expect(mapBdStatus(bd)).toBe(kanban);
  });

  it('falls back to "idea" for unknown statuses so the card never disappears', () => {
    expect(mapBdStatus('weird-future-status')).toBe('idea');
    expect(mapBdStatus('')).toBe('idea');
    // Custom statuses configured via `bd config set status.custom` also
    // fall through to idea — they shouldn't drop off the dashboard just
    // because we haven't taught the mapping about them.
    expect(mapBdStatus('triage')).toBe('idea');
  });
});

// ── mapBdPriority ──────────────────────────────────────────────────────────

describe('mapBdPriority', () => {
  // bd's accepted priority range is 0..4 (validated at `bd import` time
  // with "priority must be between 0 and 4").  Each anchor lands inside
  // a different P0..P3 bucket on the dashboard card chip.
  it.each([
    [0, 5],
    [1, 20],
    [2, 45],
    [3, 70],
    [4, 85],
  ])('bd priority %i → kanban %i', (bd, kanban) => {
    expect(mapBdPriority(bd)).toBe(kanban);
  });

  it('clamps bd priority > 4 to the low-priority anchor (85)', () => {
    // Out-of-range inputs should never happen in practice — bd rejects
    // them at import — but if bd's priority schema ever grows, we don't
    // want a P5 item to silently float to the top.
    expect(mapBdPriority(5)).toBe(85);
    expect(mapBdPriority(99)).toBe(85);
  });

  it('falls back to 50 (mid) for null / undefined / NaN / negative inputs', () => {
    expect(mapBdPriority(null)).toBe(50);
    expect(mapBdPriority(undefined)).toBe(50);
    expect(mapBdPriority(Number.NaN)).toBe(50);
    expect(mapBdPriority(-3)).toBe(50);
  });

  it('preserves the lower-is-higher ordering invariant across the bd range', () => {
    // The whole point of the mapping is that bd 0 < bd 4 in urgency
    // remains true after translation: kanban(bd 0) < kanban(bd 4).
    for (let a = 0; a <= 3; a += 1) {
      expect(mapBdPriority(a)).toBeLessThan(mapBdPriority(a + 1));
    }
  });
});
