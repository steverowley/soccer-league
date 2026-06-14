// ── features/match/api/matches.schema.test.ts ────────────────────────────────
// #386 slice: assert the match-list boundary schema accepts well-formed list
// rows, tolerates the nullable presentational fields, and drops malformed rows
// (warn-log, never throw) while preserving the original row objects.

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { MatchListRowSchema, dropInvalidMatchListRows } from './matches.schema';

/** A valid live/upcoming list row as the matches+team select returns it. */
function listRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    status: 'scheduled',
    home_team_id: 'pluto-frost',
    away_team_id: 'eris-wanderers',
    scheduled_at: '2026-06-20T18:00:00Z',
    home_score: null,
    away_score: null,
    // Extra `matches` columns the `*` select returns — must not fail validation.
    competition_id: 'comp-1',
    round: null,
    home_team: { id: 'pluto-frost', name: 'Pluto Frost', color: '#fff', location: 'Pluto', home_ground: 'Frost Dome' },
    away_team: { id: 'eris-wanderers', name: 'Eris Wanderers', color: null, location: null, home_ground: null },
    ...overrides,
  };
}

describe('MatchListRowSchema', () => {
  it('accepts a complete row (and ignores extra match columns)', () => {
    expect(MatchListRowSchema.safeParse(listRow()).success).toBe(true);
  });

  it('tolerates null scores and null team presentational fields', () => {
    expect(MatchListRowSchema.safeParse(listRow({ home_score: 0, away_score: 0 })).success).toBe(true);
    expect(MatchListRowSchema.safeParse(listRow({ home_team: null, away_team: null })).success).toBe(true);
  });

  it('rejects a row missing a required id or with a malformed team join', () => {
    expect(MatchListRowSchema.safeParse(listRow({ home_team_id: undefined })).success).toBe(false);
    expect(MatchListRowSchema.safeParse(listRow({ home_team: { id: 'x' } })).success).toBe(false);
  });
});

describe('dropInvalidMatchListRows', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps valid rows (the original objects) and drops malformed ones with a warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const good = listRow();
    const out = dropInvalidMatchListRows([good, { id: 'bad' }, listRow({ id: 'm2' })], 'test');
    expect(out).toHaveLength(2);
    // The surviving entry is the SAME object reference (no transform/strip).
    expect(out[0]).toBe(good);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('returns an empty array unchanged', () => {
    expect(dropInvalidMatchListRows([], 'test')).toEqual([]);
  });
});
