// ── betting/api/wagers.schema.test.ts ────────────────────────────────────
// Smoke tests for the Zod boundary parser (#386 slice 1). Locks down
// the drift-detection contract: malformed rows are rejected with a
// warn-log, well-formed rows pass cleanly.

import { describe, expect, it, vi } from 'vitest';
import {
  WagerSchema,
  parseWagerRow,
  parseWagerRows,
} from './wagers.schema';

/**
 * Canonical valid wager row used by the happy-path tests. Mirrors what
 * PostgREST would return from `wagers.select('*')` on a fresh insert.
 */
const goodRow = {
  id:            '11111111-1111-1111-1111-111111111111',
  user_id:       '22222222-2222-2222-2222-222222222222',
  match_id:      '33333333-3333-3333-3333-333333333333',
  team_choice:   'home' as const,
  stake:         50,
  odds_snapshot: 2.5,
  status:        'open' as const,
  payout:        null,
  created_at:    '2026-05-24T12:00:00Z',
};

describe('WagerSchema', () => {
  it('accepts a canonical row', () => {
    const result = WagerSchema.safeParse(goodRow);
    expect(result.success).toBe(true);
  });

  it('accepts a row with user_id=null (post-#415 anonymisation)', () => {
    const result = WagerSchema.safeParse({ ...goodRow, user_id: null });
    expect(result.success).toBe(true);
  });

  it('rejects a stake below MIN_BET (10)', () => {
    const result = WagerSchema.safeParse({ ...goodRow, stake: 5 });
    expect(result.success).toBe(false);
  });

  it('rejects odds <= 1.0', () => {
    expect(WagerSchema.safeParse({ ...goodRow, odds_snapshot: 1.0 }).success).toBe(false);
    expect(WagerSchema.safeParse({ ...goodRow, odds_snapshot: 0.5 }).success).toBe(false);
  });

  it('rejects unknown team_choice / status enum values', () => {
    expect(WagerSchema.safeParse({ ...goodRow, team_choice: 'tied' }).success).toBe(false);
    expect(WagerSchema.safeParse({ ...goodRow, status: 'paid' }).success).toBe(false);
  });
});

describe('parseWagerRows', () => {
  it('returns every row that parses', () => {
    const out = parseWagerRows([goodRow, goodRow], 'test');
    expect(out).toHaveLength(2);
  });

  it('drops malformed rows but keeps the good ones, warn-logging the bad', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bad = { ...goodRow, stake: 'oops' };
    const out = parseWagerRows([goodRow, bad, goodRow], 'test');
    expect(out).toHaveLength(2);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('parseWagerRow', () => {
  it('returns the row when valid', () => {
    const out = parseWagerRow(goodRow, 'test');
    expect(out).not.toBeNull();
    expect(out?.stake).toBe(50);
  });

  it('returns null on null input without warn-logging', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseWagerRow(null, 'test')).toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('returns null + warn-logs on malformed row', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseWagerRow({ ...goodRow, stake: 'oops' }, 'test')).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
