// ── refereeSelection.test.ts ──────────────────────────────────────────────────
// Pure-logic tests for deterministic referee assignment.  The hash function
// MUST agree with the SQL backfill in 0015_match_referee.sql; if these tests
// drift the migration's deterministic backfill produces different results
// from the runtime picker.

import { describe, it, expect } from 'vitest';
import {
  hashUuidPrefix,
  pickRefereeForMatch,
  sortRefereesById,
} from './refereeSelection';
import type { RefereeWithStrictness } from '../api/referees';

// ── Test fixtures ─────────────────────────────────────────────────────────────

/** A canonical UUID whose first 8 hex chars (`12345678`) parse to 305419896. */
const KNOWN_UUID = '12345678-0000-0000-0000-000000000000';

/** Produces a deterministic referee fixture sorted by id. */
function makeCorps(count: number): RefereeWithStrictness[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
    name: `Ref ${i}`,
    display_name: `R. ${i}`,
    strictness: 5,
  }));
}

describe('hashUuidPrefix', () => {
  it('matches the SQL backfill output for a known UUID', () => {
    // The SQL backfill computes:
    //   ('x' || '12345678')::bit(32)::int & 2147483647
    // The bit(32) cast produces signed int 305419896 (0x12345678).
    // The mask & 2147483647 leaves the value unchanged because the high bit
    // is 0 here.  This test pins the JS implementation to the same number.
    expect(hashUuidPrefix(KNOWN_UUID)).toBe(0x12345678);
  });

  it('handles UUIDs with the high bit set', () => {
    // 0xffffffff & 0x7fffffff = 0x7fffffff
    expect(hashUuidPrefix('ffffffff-0000-0000-0000-000000000000')).toBe(0x7fffffff);
  });

  it('returns 0 for a non-hex input rather than throwing', () => {
    expect(hashUuidPrefix('zzzzzzzz-0000-0000-0000-000000000000')).toBe(0);
  });

  it('is dash-insensitive', () => {
    expect(hashUuidPrefix('12345678-aaaa-bbbb-cccc-dddddddddddd'))
      .toBe(hashUuidPrefix('12345678aaaabbbbccccdddddddddddd'));
  });
});

describe('pickRefereeForMatch', () => {
  it('returns null for an empty corps', () => {
    expect(pickRefereeForMatch(KNOWN_UUID, [])).toBeNull();
  });

  it('returns the only referee when corps size is 1', () => {
    const corps = makeCorps(1);
    expect(pickRefereeForMatch(KNOWN_UUID, corps)?.id).toBe(corps[0]!.id);
  });

  it('is deterministic — same matchId yields same referee across calls', () => {
    const corps = makeCorps(31);
    const a = pickRefereeForMatch(KNOWN_UUID, corps);
    const b = pickRefereeForMatch(KNOWN_UUID, corps);
    expect(a).toEqual(b);
  });

  it('picks idx (hash mod size) — verifies SQL parity', () => {
    const corps = makeCorps(10);
    // hash = 0x12345678 = 305419896.  305419896 % 10 = 6.
    expect(pickRefereeForMatch(KNOWN_UUID, corps)?.id).toBe(corps[6]!.id);
  });
});

describe('sortRefereesById', () => {
  it('returns a new sorted array without mutating the input', () => {
    const input: RefereeWithStrictness[] = [
      { id: 'b', name: 'B', display_name: 'B', strictness: 5 },
      { id: 'a', name: 'A', display_name: 'A', strictness: 5 },
    ];
    const out = sortRefereesById(input);
    expect(out.map(r => r.id)).toEqual(['a', 'b']);
    expect(input.map(r => r.id)).toEqual(['b', 'a']); // original untouched
  });
});
