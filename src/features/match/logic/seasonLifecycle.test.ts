// ── seasonLifecycle.test.ts ──────────────────────────────────────────────────
// Unit tests for the pure season-lifecycle helpers in seasonLifecycle.ts.
// These pin (a) the season-completion rule and (b) the legal status
// transitions so the worker and admin tooling agree on the same flow.

import { describe, it, expect } from 'vitest';
import {
  isSeasonComplete,
  nextStatus,
  type LeagueFixtureCounts,
} from './seasonLifecycle';

// ── Helper ───────────────────────────────────────────────────────────────────

/**
 * Small constructor so each test can build a partial fixture-count tally
 * without restating zeros for every status.
 */
function counts(overrides: Partial<LeagueFixtureCounts>): LeagueFixtureCounts {
  return {
    scheduled:  0,
    inProgress: 0,
    completed:  0,
    cancelled:  0,
    ...overrides,
  };
}

// ── isSeasonComplete ─────────────────────────────────────────────────────────

describe('isSeasonComplete', () => {
  it('returns true when every league fixture has finished', () => {
    // 224 = full Season 1 league fixture count (4 leagues × 56 fixtures).
    expect(isSeasonComplete(counts({ completed: 224 }))).toBe(true);
  });

  it('returns true when some fixtures were cancelled but none remain pending', () => {
    // Cancelled matches are terminal — they don't block the transition.
    expect(isSeasonComplete(counts({ completed: 222, cancelled: 2 }))).toBe(true);
  });

  it('returns false while any fixtures are still scheduled', () => {
    expect(isSeasonComplete(counts({ scheduled: 1, completed: 223 }))).toBe(false);
  });

  it('returns false while any fixtures are mid-simulation', () => {
    expect(isSeasonComplete(counts({ inProgress: 1, completed: 223 }))).toBe(false);
  });

  it('returns false for an empty season (no fixtures at all)', () => {
    // The empty case almost certainly means the worker query is filtering
    // wrongly — we'd rather no-op than auto-transition an unseeded row.
    expect(isSeasonComplete(counts({}))).toBe(false);
  });

  it('returns false when both scheduled and inProgress have rows', () => {
    expect(isSeasonComplete(counts({ scheduled: 5, inProgress: 2 }))).toBe(false);
  });
});

// ── nextStatus ───────────────────────────────────────────────────────────────

describe('nextStatus', () => {
  it('advances active → voting', () => {
    expect(nextStatus('active')).toBe('voting');
  });

  it('advances voting → enacted', () => {
    expect(nextStatus('voting')).toBe('enacted');
  });

  it('advances enacted → archived', () => {
    expect(nextStatus('enacted')).toBe('archived');
  });

  it('returns null from the terminal archived state', () => {
    // archived is the sink; there is no further transition.
    expect(nextStatus('archived')).toBeNull();
  });
});
