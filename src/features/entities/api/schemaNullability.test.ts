// ── schemaNullability.test.ts ────────────────────────────────────────────────
// Guards a bug class, not a single bug.
//
// Every api-boundary Zod parser in this repo discards a non-conforming row with
// nothing louder than a `console.warn`. So a schema that is stricter than its
// column does not raise an error — it silently removes data, and the app merely
// looks quiet. That is how `match_events.subminute` came to drop nearly every
// event while every type check and happy-path test stayed green.
//
// Found by comparing each schema against the GENERATED database types, which
// are ground truth for nullability:
//
//   focus_votes.user_id       nullable since 0059, validated non-null
//   narratives.entities_involved   JSONB DEFAULT '[]', validated non-null
//   narratives.acknowledged_by     JSONB DEFAULT '[]', validated non-null
//
// `focus_votes` is the one that mattered. Migration 0059 deliberately dropped
// its NOT NULL and set ON DELETE SET NULL so a deleted account's votes survive
// for the season tally — exactly the rows this parser was throwing away.
// `wagers.user_id` got the same migration treatment and WAS updated (#415), so
// the two schemas disagreed about the same migration.

import { describe, it, expect, vi } from 'vitest';
import { FocusVoteSchema } from '../../voting/api/focuses.schema';
import { NarrativeSchema } from './entities.schema';

describe('focus_votes.user_id survives account deletion', () => {
  const base = {
    id: 'v1',
    focus_option_id: 'fo1',
    credits_spent: 50,
    created_at: '2026-01-01T00:00:00Z',
  };

  it('accepts a vote whose owner deleted their account', () => {
    const parsed = FocusVoteSchema.safeParse({ ...base, user_id: null });
    expect(parsed.success).toBe(true);
  });

  it('still accepts a normal vote', () => {
    expect(FocusVoteSchema.safeParse({ ...base, user_id: 'u1' }).success).toBe(true);
  });

  it('still rejects a genuinely malformed vote', () => {
    // The fix widens to the column's truth, not to anything.
    expect(FocusVoteSchema.safeParse({ ...base, user_id: 42 }).success).toBe(false);
    expect(FocusVoteSchema.safeParse({ ...base, user_id: 'u1', credits_spent: 0 }).success).toBe(false);
    expect(FocusVoteSchema.safeParse({ ...base, user_id: 'u1', credits_spent: 1.5 }).success).toBe(false);
  });
});

describe('narratives array columns tolerate NULL', () => {
  const base = {
    id: 'n1',
    kind: 'architect_whisper',
    summary: 'The void stirs.',
    source: 'architect',
    created_at: '2026-01-01T00:00:00Z',
  };

  it('coerces a NULL entities_involved to an empty array', () => {
    const parsed = NarrativeSchema.safeParse({
      ...base,
      entities_involved: null,
      acknowledged_by: null,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      // Coerced rather than left null, so consumers can iterate unguarded.
      expect(parsed.data.entities_involved).toEqual([]);
      expect(parsed.data.acknowledged_by).toEqual([]);
    }
  });

  it('passes a populated array through unchanged', () => {
    const parsed = NarrativeSchema.safeParse({
      ...base,
      entities_involved: ['e1', 'e2'],
      acknowledged_by: ['u1'],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.entities_involved).toEqual(['e1', 'e2']);
      expect(parsed.data.acknowledged_by).toEqual(['u1']);
    }
  });

  it('still rejects a wrong element type', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(
      NarrativeSchema.safeParse({ ...base, entities_involved: [1, 2], acknowledged_by: [] }).success,
    ).toBe(false);
    warn.mockRestore();
  });
});
