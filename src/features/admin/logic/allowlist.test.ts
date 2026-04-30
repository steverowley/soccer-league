// ── allowlist.test.ts ───────────────────────────────────────────────────────
// Pure unit tests for the admin allowlist helpers.  These pin the parser
// edge cases (whitespace, empty strings, trailing commas) and the membership
// predicate's anonymous-user safety branch.

import { describe, it, expect } from 'vitest';
import { parseAllowlist, isAdminUser } from './allowlist';

// ── parseAllowlist ──────────────────────────────────────────────────────────

describe('parseAllowlist', () => {
  it('returns an empty set for null/undefined input (fail-closed default)', () => {
    // Both null and undefined come up in env reads — covered explicitly so
    // the fail-closed posture is regression-tested.
    expect(parseAllowlist(null).size).toBe(0);
    expect(parseAllowlist(undefined).size).toBe(0);
    expect(parseAllowlist('').size).toBe(0);
  });

  it('splits a comma-separated list into a Set', () => {
    const set = parseAllowlist('a,b,c');
    expect(set.size).toBe(3);
    expect(set.has('a')).toBe(true);
    expect(set.has('b')).toBe(true);
    expect(set.has('c')).toBe(true);
  });

  it('trims surrounding whitespace from each entry', () => {
    // Operators copy-pasting from spreadsheets often introduce stray spaces.
    const set = parseAllowlist(' a , b ,c  ');
    expect(set).toEqual(new Set(['a', 'b', 'c']));
  });

  it('drops empty entries from trailing or duplicate commas', () => {
    expect(parseAllowlist('a,,b,').size).toBe(2);
  });

  it('preserves case (UUIDs are case-sensitive at the API level)', () => {
    const set = parseAllowlist('AbC');
    expect(set.has('AbC')).toBe(true);
    expect(set.has('abc')).toBe(false);
  });

  it('deduplicates repeated entries via the Set semantic', () => {
    expect(parseAllowlist('a,a,a').size).toBe(1);
  });
});

// ── isAdminUser ─────────────────────────────────────────────────────────────

describe('isAdminUser', () => {
  it('returns true when the user is in the allowlist', () => {
    expect(isAdminUser('u1', new Set(['u1', 'u2']))).toBe(true);
  });

  it('returns false when the user is not in the allowlist', () => {
    expect(isAdminUser('u3', new Set(['u1', 'u2']))).toBe(false);
  });

  it('returns false for anonymous users even if the allowlist is empty', () => {
    // Two paths verified together: (1) empty allowlist + (2) null user must
    // both deny.  The safety property is "no user → no access, ever".
    expect(isAdminUser(null,      new Set())).toBe(false);
    expect(isAdminUser(undefined, new Set())).toBe(false);
    expect(isAdminUser(null,      new Set(['u1']))).toBe(false);
  });

  it('returns false for an empty-string user id (defensive)', () => {
    // An empty string is falsy via the !userId guard — confirms we don't
    // accidentally let a stub user_id slip past.
    expect(isAdminUser('', new Set([''])))
      .toBe(false);
  });
});
