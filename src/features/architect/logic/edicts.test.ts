// ── edicts.test.ts ──────────────────────────────────────────────────────────
// WHY: The edict validator is the last guard between "cosmic chaos" and
// "unbounded DB corruption". Every rule it enforces is load-bearing —
// these tests exist so nobody can weaken the guard without a red CI.

import { describe, it, expect } from 'vitest';
import {
  ALLOWED_REWRITE_TABLES,
  MAX_REASON_LENGTH,
  MIN_REASON_LENGTH,
  InvalidEdictError,
  validateEdict,
  shallowEqual,
  interventionToRow,
} from './edicts';
import type { InterventionRequest } from '../types';

// ── Helper ──────────────────────────────────────────────────────────────────

function req(
  overrides: Partial<InterventionRequest> = {},
): InterventionRequest {
  return {
    targetTable: 'matches',
    targetId: '00000000-0000-0000-0000-000000000001',
    field: 'home_score',
    oldValue: 1,
    newValue: 2,
    reason: 'The cosmos demanded a different outcome for Mars vs Venus.',
    meta: {},
    ...overrides,
  };
}

// ── ALLOWED_REWRITE_TABLES sanity ───────────────────────────────────────────

describe('ALLOWED_REWRITE_TABLES', () => {
  it('contains the three expected tables', () => {
    expect(ALLOWED_REWRITE_TABLES.has('matches')).toBe(true);
    expect(ALLOWED_REWRITE_TABLES.has('match_player_stats')).toBe(true);
    expect(ALLOWED_REWRITE_TABLES.has('narratives')).toBe(true);
  });

  it('does NOT contain user-facing tables', () => {
    // These would be catastrophic to allow.
    expect(ALLOWED_REWRITE_TABLES.has('profiles')).toBe(false);
    expect(ALLOWED_REWRITE_TABLES.has('wagers')).toBe(false);
    expect(ALLOWED_REWRITE_TABLES.has('focus_votes')).toBe(false);
    expect(ALLOWED_REWRITE_TABLES.has('player_training_log')).toBe(false);
  });
});

// ── validateEdict ───────────────────────────────────────────────────────────

describe('validateEdict', () => {
  it('accepts a well-formed request', () => {
    expect(() => validateEdict(req())).not.toThrow();
    expect(validateEdict(req())).toMatchObject({ targetTable: 'matches' });
  });

  it('rejects a table outside the whitelist', () => {
    expect(() => validateEdict(req({ targetTable: 'profiles' }))).toThrow(
      InvalidEdictError,
    );
    try {
      validateEdict(req({ targetTable: 'profiles' }));
    } catch (e) {
      expect((e as InvalidEdictError).code).toBe('table_not_allowed');
    }
  });

  it('rejects a reason shorter than MIN_REASON_LENGTH', () => {
    expect(() => validateEdict(req({ reason: 'too short' }))).toThrow(
      InvalidEdictError,
    );
  });

  it('counts trimmed length, not raw length, for the reason', () => {
    const padded = '   short   '; // 5 real chars
    expect(() => validateEdict(req({ reason: padded }))).toThrow(
      /reason_too_short|at least/,
    );
  });

  it('accepts a reason exactly at MIN_REASON_LENGTH', () => {
    const minReason = 'a'.repeat(MIN_REASON_LENGTH);
    expect(() => validateEdict(req({ reason: minReason }))).not.toThrow();
  });

  it('rejects a reason longer than MAX_REASON_LENGTH', () => {
    const huge = 'x'.repeat(MAX_REASON_LENGTH + 1);
    expect(() => validateEdict(req({ reason: huge }))).toThrow(
      InvalidEdictError,
    );
  });

  it('rejects undefined oldValue', () => {
    // Cast through unknown since TS (correctly) forbids undefined here.
    const bad = req({ oldValue: undefined as unknown as null });
    expect(() => validateEdict(bad)).toThrow(/missing_snapshot|oldValue/);
  });

  it('accepts null oldValue (previously-null is a real state)', () => {
    expect(() => validateEdict(req({ oldValue: null, newValue: 5 }))).not.toThrow();
  });

  it('rejects undefined newValue', () => {
    const bad = req({ newValue: undefined as unknown as null });
    expect(() => validateEdict(bad)).toThrow(/newValue/);
  });

  it('rejects a no-op (deeply equal old and new)', () => {
    try {
      validateEdict(req({ oldValue: { a: 1 }, newValue: { a: 1 } }));
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidEdictError);
      expect((e as InvalidEdictError).code).toBe('no_op');
    }
  });

  it('accepts a null field (multi-column rewrite)', () => {
    expect(() =>
      validateEdict(req({ field: null, oldValue: { x: 1 }, newValue: { x: 2 } })),
    ).not.toThrow();
  });

  it('rejects an empty-string field', () => {
    try {
      validateEdict(req({ field: '' }));
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidEdictError);
      expect((e as InvalidEdictError).code).toBe('missing_field');
    }
  });
});

// ── shallowEqual ────────────────────────────────────────────────────────────

describe('shallowEqual (deep JSON equality)', () => {
  it('handles primitives', () => {
    expect(shallowEqual(1, 1)).toBe(true);
    expect(shallowEqual('a', 'a')).toBe(true);
    expect(shallowEqual(true, true)).toBe(true);
    expect(shallowEqual(null, null)).toBe(true);
    expect(shallowEqual(1, 2)).toBe(false);
    expect(shallowEqual('a', 'b')).toBe(false);
  });

  it('distinguishes null from object', () => {
    expect(shallowEqual(null, {})).toBe(false);
    expect(shallowEqual({}, null)).toBe(false);
  });

  it('compares arrays index-wise', () => {
    expect(shallowEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(shallowEqual([1, 2, 3], [1, 2])).toBe(false);
    expect(shallowEqual([1, 2, 3], [3, 2, 1])).toBe(false);
  });

  it('distinguishes arrays from objects', () => {
    expect(shallowEqual([1, 2], { 0: 1, 1: 2 })).toBe(false);
  });

  it('compares plain objects key-wise', () => {
    expect(shallowEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
    expect(shallowEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false);
    expect(shallowEqual({ a: 1 }, { a: 2 })).toBe(false);
  });

  it('recurses into nested structures', () => {
    const a = { score: [1, 2], meta: { venue: 'Mars' } };
    const b = { score: [1, 2], meta: { venue: 'Mars' } };
    expect(shallowEqual(a, b)).toBe(true);

    const c = { score: [1, 2], meta: { venue: 'Venus' } };
    expect(shallowEqual(a, c)).toBe(false);
  });
});

// ── interventionToRow ──────────────────────────────────────────────────────

describe('interventionToRow', () => {
  it('trims the reason before storing', () => {
    const row = interventionToRow(
      req({ reason: '   This is the reason for the rewrite.   ' }),
    );
    expect(row.reason).toBe('This is the reason for the rewrite.');
  });

  it('defaults meta to an empty object when omitted', () => {
    const r = req();
    delete (r as { meta?: unknown }).meta;
    const row = interventionToRow(r);
    expect(row.meta).toEqual({});
  });

  it('preserves all pass-through fields', () => {
    const input = req({
      targetTable: 'narratives',
      targetId: 'abc',
      field: 'summary',
      oldValue: 'old text',
      newValue: 'new text',
      meta: { narrative_id: 'xyz' },
    });
    const row = interventionToRow(input);
    expect(row).toEqual({
      target_table: 'narratives',
      target_id: 'abc',
      field: 'summary',
      old_value: 'old text',
      new_value: 'new text',
      reason: input.reason.trim(),
      meta: { narrative_id: 'xyz' },
    });
  });
});
