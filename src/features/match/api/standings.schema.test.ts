// ── features/match/api/standings.schema.test.ts ──────────────────────────────
// #386 slice: assert the standings boundary schemas accept well-formed rows
// and reject/drop malformed ones (warn-log, never throw), so league-table
// drift degrades gracefully instead of NaN-ing every table.

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  StandingsMatchRowSchema,
  StandingsTeamRowSchema,
  parseStandingsMatchRows,
  parseStandingsTeamRows,
} from './standings.schema';

/** A valid completed-fixture row as the matches+competitions select returns it. */
function matchRow(overrides: Record<string, unknown> = {}) {
  return {
    home_team_id: 'pluto-frost',
    away_team_id: 'eris-wanderers',
    home_score: 2,
    away_score: 1,
    played_at: '2026-06-01T00:00:00Z',
    competitions: { league_id: 'kuiper-belt', type: 'league' },
    ...overrides,
  };
}

describe('StandingsMatchRowSchema', () => {
  it('accepts a complete row', () => {
    expect(StandingsMatchRowSchema.safeParse(matchRow()).success).toBe(true);
  });

  it('tolerates null scores, null played_at, and a null competitions join', () => {
    const parsed = StandingsMatchRowSchema.safeParse(
      matchRow({ home_score: null, away_score: null, played_at: null, competitions: null }),
    );
    expect(parsed.success).toBe(true);
  });

  it('rejects a row missing a required id or with a wrong-typed score', () => {
    expect(StandingsMatchRowSchema.safeParse(matchRow({ home_team_id: undefined })).success).toBe(false);
    expect(StandingsMatchRowSchema.safeParse(matchRow({ home_score: '2' })).success).toBe(false);
  });
});

describe('StandingsTeamRowSchema', () => {
  it('accepts id + name and rejects a missing name', () => {
    expect(StandingsTeamRowSchema.safeParse({ id: 'pluto-frost', name: 'Pluto Frost' }).success).toBe(true);
    expect(StandingsTeamRowSchema.safeParse({ id: 'pluto-frost' }).success).toBe(false);
  });
});

describe('parse helpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps valid match rows and drops malformed ones with a warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = parseStandingsMatchRows([matchRow(), { home_team_id: 'x' }, matchRow({ home_score: 0, away_score: 0 })], 'test');
    expect(out).toHaveLength(2);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('keeps valid team rows and drops malformed ones', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = parseStandingsTeamRows([{ id: 'a', name: 'A' }, { id: 'b' }], 'test');
    expect(out).toEqual([{ id: 'a', name: 'A' }]);
  });

  it('returns an empty array for an empty input', () => {
    expect(parseStandingsMatchRows([], 'test')).toEqual([]);
    expect(parseStandingsTeamRows([], 'test')).toEqual([]);
  });
});
