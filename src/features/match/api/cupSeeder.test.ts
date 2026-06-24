// ── cupSeeder scheduling tests (#569) ────────────────────────────────────────
// Cup fixtures used to be stamped with the in-universe calendar date
// (2600-08-04), which the match-worker's `scheduled_at <= now()` claim can never
// reach — so both cups froze at the Round of 16 forever. These tests pin the fix:
// kickoffs are anchored to real wall-clock time and therefore always claimable.

import { describe, it, expect } from 'vitest';

import { cupR1KickoffIso, cupNextRoundKickoffIso } from './cupSeeder';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe('cup fixture scheduling (#569)', () => {
  // A fixed clock so the assertions are deterministic and cannot flake.
  const now = Date.parse('2026-06-24T12:00:00Z');

  it('schedules the Round of 16 in the near future, not the year-2600 calendar', () => {
    const t = Date.parse(cupR1KickoffIso(now));
    expect(t).toBeGreaterThan(now); // reachable: strictly after "now"
    expect(t).toBeLessThanOrEqual(now + 7 * DAY); // inside the worker's claim horizon
    expect(new Date(cupR1KickoffIso(now)).getUTCFullYear()).toBe(2026); // real year, not 2600
  });

  it('schedules each later round within the claim horizon of its completion', () => {
    const t = Date.parse(cupNextRoundKickoffIso(now));
    expect(t).toBeGreaterThan(now);
    expect(t).toBeLessThanOrEqual(now + 7 * DAY);
    expect(new Date(cupNextRoundKickoffIso(now)).getUTCFullYear()).toBe(2026);
  });

  it('is deterministic for a fixed clock (no flake)', () => {
    expect(cupR1KickoffIso(now)).toBe(cupR1KickoffIso(now));
    expect(cupNextRoundKickoffIso(now)).toBe(cupNextRoundKickoffIso(now));
  });
});
