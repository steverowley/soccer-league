// ── features/match/api/players.schema.test.ts ────────────────────────────────
// #386 slice: assert the player-detail boundary schemas. The key guard is
// Critical Invariant #1 — a player row missing one of the composite stat
// columns must fail validation so the drift is loud.

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { PlayerRowSchema, checkPlayerRow, parsePlayerStatRows } from './players.schema';

/** A valid player row as `getPlayer`'s `*, teams(id, name)` select returns it. */
function playerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    name: 'Nova Kael',
    team_id: 'pluto-frost',
    attacking: 70,
    defending: 55,
    mental: 62,
    athletic: 68,
    technical: 71,
    position: 'FW',
    jersey_number: 9,
    starter: true,
    is_active: true,
    // Extra `players` columns the `*` select returns — must not fail validation.
    overall_rating: 74,
    personality: 'mercurial',
    teams: { id: 'pluto-frost', name: 'Pluto Frost' },
    ...overrides,
  };
}

describe('PlayerRowSchema (Critical Invariant #1)', () => {
  it('accepts a complete row and tolerates null stats / null team', () => {
    expect(PlayerRowSchema.safeParse(playerRow()).success).toBe(true);
    expect(PlayerRowSchema.safeParse(playerRow({ attacking: null, defending: null })).success).toBe(true);
    expect(PlayerRowSchema.safeParse(playerRow({ team_id: null, teams: null })).success).toBe(true);
  });

  it('FAILS when a composite stat column is missing (the invariant guard)', () => {
    expect(PlayerRowSchema.safeParse(playerRow({ attacking: undefined })).success).toBe(false);
    expect(PlayerRowSchema.safeParse(playerRow({ technical: undefined })).success).toBe(false);
  });

  it('fails on a wrong-typed lineup column', () => {
    expect(PlayerRowSchema.safeParse(playerRow({ starter: 'yes' })).success).toBe(false);
  });
});

describe('checkPlayerRow', () => {
  it('mirrors PlayerRowSchema.safeParse', () => {
    expect(checkPlayerRow(playerRow()).success).toBe(true);
    expect(checkPlayerRow({ id: 'x' }).success).toBe(false);
  });
});

describe('parsePlayerStatRows', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps valid stat rows and drops malformed ones with a warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const valid = { goals: 1, assists: 0, yellow_cards: 0, red_cards: 0, minutes_played: 90, rating: 7.2 };
    const out = parsePlayerStatRows([valid, { goals: 'oops' }, { ...valid, rating: null }], 'test');
    expect(out).toHaveLength(2);
    expect(out[1]!.rating).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('returns an empty array for empty input', () => {
    expect(parsePlayerStatRows([], 'test')).toEqual([]);
  });
});
