// ── architect/logic/daybreakDigest.test.ts ───────────────────────────────────
// Unit tests for the Phase 6b morning anchor digest.
//
// COVERAGE INTENT
//   • Template selection priority — triple voice > bigEvent > matches > quiet
//   • Plural-aware {N} substitution
//   • {EVENT} substitution with arbitrary qualitative labels
//   • Deterministic given the same RNG
//   • Daybreak window gate (06:00–10:00 UTC)
//   • All template banks are non-empty, distinct, ≤200 chars

import { describe, expect, it } from 'vitest';
import {
  DAYBREAK_KIND,
  DAYBREAK_WINDOW_START_HOUR_UTC,
  DAYBREAK_WINDOW_END_HOUR_UTC,
  buildDaybreakDigest,
  isDaybreakWindow,
  type DaybreakContext,
} from './daybreakDigest';

const ALL_SILENT = { fate: false, balance: false, chaos: false } as const;

describe('buildDaybreakDigest — selection priority', () => {
  it('uses TRIPLE_VOICE templates when all three voices spoke', () => {
    const ctx: DaybreakContext = {
      matchesPlayed: 5,
      voicesSpoke: { fate: true, balance: true, chaos: true },
      bigEvent: 'an incineration',
    };
    const line = buildDaybreakDigest(ctx, () => 0);
    expect(line).toMatch(/three voices|All three/);
    // Even though bigEvent is set, triple-voice wins so {EVENT} should NOT appear.
    expect(line).not.toContain('an incineration');
  });

  it('uses BIG_EVENT templates when a bigEvent is set and voices were quieter', () => {
    const ctx: DaybreakContext = {
      matchesPlayed: 4,
      voicesSpoke: { fate: true, balance: false, chaos: true }, // not all three
      bigEvent: 'an incineration',
    };
    const line = buildDaybreakDigest(ctx, () => 0);
    expect(line).toContain('an incineration');
    expect(line).not.toMatch(/\{EVENT\}/);
  });

  it('uses MATCH_NIGHT templates when matches played but no bigEvent', () => {
    const ctx: DaybreakContext = {
      matchesPlayed: 3,
      voicesSpoke: ALL_SILENT,
    };
    const line = buildDaybreakDigest(ctx, () => 0);
    expect(line).toContain('3');
    expect(line).not.toMatch(/\{N\}/);
  });

  it('uses QUIET_NIGHT templates when nothing happened', () => {
    const ctx: DaybreakContext = {
      matchesPlayed: 0,
      voicesSpoke: ALL_SILENT,
    };
    const line = buildDaybreakDigest(ctx, () => 0);
    expect(line).toMatch(/Daybreak|Morning|cosmos/);
    expect(line).not.toMatch(/\{N\}|\{EVENT\}/);
  });
});

describe('buildDaybreakDigest — substitution', () => {
  it('substitutes {N} with the matchesPlayed count', () => {
    let lcg = 1;
    const rng = () => { lcg = (lcg * 1664525 + 1013904223) % 4294967296; return lcg / 4294967296; };
    for (const n of [1, 5, 12, 27]) {
      const line = buildDaybreakDigest(
        { matchesPlayed: n, voicesSpoke: ALL_SILENT },
        rng,
      );
      // The count appears verbatim in the rendered line.
      expect(line).toContain(String(n));
      expect(line).not.toMatch(/\{N\}/);
    }
  });

  it('substitutes {EVENT} verbatim — caller is responsible for redaction', () => {
    const events = [
      'an incineration',
      'a late equaliser that felt fated',
      'a cosmic disturbance',
      'an upset in the outer rim',
    ];
    for (const event of events) {
      const line = buildDaybreakDigest({
        matchesPlayed: 0,
        voicesSpoke: ALL_SILENT,
        bigEvent: event,
      }, () => 0);
      expect(line).toContain(event);
    }
  });

  it('still works when bigEvent is empty string (falsy) — falls back to quiet', () => {
    const line = buildDaybreakDigest({
      matchesPlayed: 0,
      voicesSpoke: ALL_SILENT,
      bigEvent: '',
    }, () => 0);
    expect(line).not.toMatch(/\{EVENT\}/);
  });
});

describe('buildDaybreakDigest — determinism + coverage', () => {
  it('is deterministic for the same RNG and context', () => {
    const ctx: DaybreakContext = {
      matchesPlayed: 4,
      voicesSpoke: { fate: true, balance: false, chaos: false },
    };
    const a = buildDaybreakDigest(ctx, () => 0.42);
    const b = buildDaybreakDigest(ctx, () => 0.42);
    expect(a).toBe(b);
  });

  it('produces multiple distinct lines across the RNG range (variety check)', () => {
    let lcg = 7;
    const rng = () => { lcg = (lcg * 1664525 + 1013904223) % 4294967296; return lcg / 4294967296; };
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      seen.add(buildDaybreakDigest(
        { matchesPlayed: 0, voicesSpoke: ALL_SILENT },
        rng,
      ));
    }
    // QUIET_NIGHT_TEMPLATES has 6 entries; sampling 50× should hit at least 4.
    expect(seen.size).toBeGreaterThanOrEqual(4);
  });

  it('never returns an empty string for any input combo', () => {
    const combos: DaybreakContext[] = [
      { matchesPlayed: 0, voicesSpoke: ALL_SILENT },
      { matchesPlayed: 1, voicesSpoke: ALL_SILENT },
      { matchesPlayed: 5, voicesSpoke: { fate: true, balance: true, chaos: true } },
      { matchesPlayed: 0, voicesSpoke: ALL_SILENT, bigEvent: 'a flicker' },
    ];
    for (const ctx of combos) {
      const line = buildDaybreakDigest(ctx, () => 0);
      expect(line.length).toBeGreaterThan(0);
      expect(line.length).toBeLessThanOrEqual(220); // sane upper bound
    }
  });
});

describe('isDaybreakWindow — UTC gating', () => {
  it('returns true inside the configured window', () => {
    const d = new Date('2026-05-13T07:00:00Z');
    expect(isDaybreakWindow(d)).toBe(true);
  });

  it('returns true exactly at the start hour', () => {
    const d = new Date('2026-05-13T06:00:00Z');
    expect(isDaybreakWindow(d)).toBe(true);
  });

  it('returns false at the end hour (exclusive)', () => {
    const d = new Date(`2026-05-13T${String(DAYBREAK_WINDOW_END_HOUR_UTC).padStart(2, '0')}:00:00Z`);
    expect(isDaybreakWindow(d)).toBe(false);
  });

  it('returns false outside the window (midnight)', () => {
    const d = new Date('2026-05-13T00:00:00Z');
    expect(isDaybreakWindow(d)).toBe(false);
  });

  it('returns false outside the window (afternoon)', () => {
    const d = new Date('2026-05-13T15:00:00Z');
    expect(isDaybreakWindow(d)).toBe(false);
  });

  it('window constants are coherent', () => {
    expect(DAYBREAK_WINDOW_START_HOUR_UTC).toBeLessThan(DAYBREAK_WINDOW_END_HOUR_UTC);
    expect(DAYBREAK_WINDOW_START_HOUR_UTC).toBeGreaterThanOrEqual(0);
    expect(DAYBREAK_WINDOW_END_HOUR_UTC).toBeLessThanOrEqual(24);
  });
});

describe('DAYBREAK_KIND constant', () => {
  it('matches the NewsFeedPage filter key', () => {
    expect(DAYBREAK_KIND).toBe('daybreak');
  });
});
