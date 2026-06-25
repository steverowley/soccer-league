// ── oddsRepo.schema.test.ts ───────────────────────────────────────────────────
// #386: the match_odds boundary schema must accept a well-formed row and reject
// the drift shapes it exists to catch (renamed/missing column, wrong type, an
// impossible <= 1.0 decimal odd), returning the documented null fallback.

import { describe, it, expect, vi } from 'vitest';

import { MatchOddsSchema, parseMatchOddsRow } from './oddsRepo.schema';

const VALID = {
  match_id:    'm-1',
  home_odds:   2.10,
  draw_odds:   3.40,
  away_odds:   3.05,
  computed_at: '2026-06-25T10:00:00.000Z',
};

describe('MatchOddsSchema (#386)', () => {
  it('accepts a well-formed match_odds row', () => {
    expect(MatchOddsSchema.safeParse(VALID).success).toBe(true);
    expect(parseMatchOddsRow(VALID, 'test')).toEqual(VALID);
  });

  it('returns null (not a throw) for a null/absent row', () => {
    expect(parseMatchOddsRow(null, 'test')).toBeNull();
    expect(parseMatchOddsRow(undefined, 'test')).toBeNull();
  });

  it('rejects a renamed/missing odds column (the drift case)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { home_odds: _drop, ...renamed } = VALID;
    expect(parseMatchOddsRow({ ...renamed, homeOdds: 2.1 }, 'test')).toBeNull();
    warn.mockRestore();
  });

  it('rejects a wrong-typed column (odds as a string)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseMatchOddsRow({ ...VALID, draw_odds: '3.40' }, 'test')).toBeNull();
    warn.mockRestore();
  });

  it('rejects an impossible decimal odd (<= 1.0)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseMatchOddsRow({ ...VALID, away_odds: 1.0 }, 'test')).toBeNull();
    warn.mockRestore();
  });
});
