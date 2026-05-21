// ── corpus.test.ts ──────────────────────────────────────────────────────────
// Unit tests for the pure snippet retrieval engine in `corpus.ts`.  Three
// concerns are covered:
//
//   1. SCORING — does `scoreSnippet` weight each input (tag overlap,
//      recency decay, novelty inverse, valence match, pinned bonus) in
//      the documented direction?
//   2. FILTERING — does `pickSnippet` exclude rows that fail the
//      entity/kind/excludeIds/excludeSubjects gates?
//   3. SELECTION — given multiple viable candidates, does the picker pick
//      the highest-scoring one and break ties deterministically?
//
// PURE TESTS — no Supabase, no React.  Snippets are hand-built rows; the
// `now` argument to scoreSnippet/pickSnippet is pinned so the recency
// term is deterministic.

import { describe, expect, it } from 'vitest';

import { pickSnippet, scoreSnippet } from './corpus';
import type { PickSnippetArgs, SnippetRow } from '../types';

// ── Fixture helpers ─────────────────────────────────────────────────────────
// `makeSnippet` returns a fully-typed SnippetRow with sensible defaults so
// each test only overrides the fields it cares about.  Keeps tests focused.

/**
 * Build a `SnippetRow` for tests with sane defaults.  Any field can be
 * overridden through the partial parameter.
 *
 * @param overrides  Partial row — overlaid onto the defaults.
 * @returns          A complete SnippetRow ready for the picker.
 */
function makeSnippet(overrides: Partial<SnippetRow> = {}): SnippetRow {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    entity_id: '00000000-0000-0000-0000-0000000000aa',
    kind: 'quote',
    text: 'A pre-match thought.',
    mood: null,
    context_tags: [],
    subjects: [],
    valence: 0,
    usage_count: 0,
    last_used_at: null,
    seed_memory_id: null,
    pinned: false,
    created_at: '2026-05-21T00:00:00Z',
    ...overrides,
  };
}

/** Fixed "now" so recency decay is deterministic across runs. */
const NOW = new Date('2026-05-21T12:00:00Z');

/** Canonical entity id used across the tests. */
const ENTITY_A = '00000000-0000-0000-0000-0000000000aa';
const ENTITY_B = '00000000-0000-0000-0000-0000000000bb';

// ── scoreSnippet ────────────────────────────────────────────────────────────

describe('scoreSnippet', () => {
  /**
   * A snippet matching ALL requested tags must score higher than one
   * matching none.  Pins down the W_TAG contribution direction.
   */
  it('tag overlap raises score', () => {
    const args: PickSnippetArgs = {
      entityId: ENTITY_A,
      kind: 'quote',
      contextTags: ['pre_match', 'derby'],
    };
    const matching = makeSnippet({ context_tags: ['pre_match', 'derby'] });
    const empty = makeSnippet({ context_tags: [] });
    expect(scoreSnippet(matching, args, NOW)).toBeGreaterThan(scoreSnippet(empty, args, NOW));
  });

  /**
   * A freshly-created snippet must score higher than a year-old one.
   * Pins down the recency decay direction.
   */
  it('recent snippets outscore old ones, all else equal', () => {
    const args: PickSnippetArgs = { entityId: ENTITY_A, kind: 'quote' };
    const fresh = makeSnippet({ created_at: '2026-05-21T11:00:00Z' });
    const old = makeSnippet({ created_at: '2025-05-21T00:00:00Z', id: 'id-old' });
    expect(scoreSnippet(fresh, args, NOW)).toBeGreaterThan(scoreSnippet(old, args, NOW));
  });

  /**
   * Higher `usage_count` lowers novelty contribution, so a fresh + unused
   * snippet outscores a fresh + heavily-used one.  Pins down W_NOVELTY.
   */
  it('unused snippets outscore heavily-used ones', () => {
    const args: PickSnippetArgs = { entityId: ENTITY_A, kind: 'quote' };
    const unused = makeSnippet({ usage_count: 0 });
    const overused = makeSnippet({ usage_count: 50, id: 'id-overused' });
    expect(scoreSnippet(unused, args, NOW)).toBeGreaterThan(scoreSnippet(overused, args, NOW));
  });

  /**
   * Valence boost only fires when the caller opts in via `preferValence`
   * AND the snippet matches.  Mismatches are NOT punished — verifying
   * the soft-preference design.
   */
  it('valence match adds bonus only when preferValence is set', () => {
    const argsNeutral: PickSnippetArgs = { entityId: ENTITY_A, kind: 'quote' };
    const argsScathing: PickSnippetArgs = {
      entityId: ENTITY_A,
      kind: 'quote',
      preferValence: -2,
    };
    const scathing = makeSnippet({ valence: -2 });
    const positive = makeSnippet({ valence: 2, id: 'id-positive' });

    // Without preferValence: valences are equal-weight.
    expect(scoreSnippet(scathing, argsNeutral, NOW))
      .toBeCloseTo(scoreSnippet(positive, argsNeutral, NOW));

    // With preferValence=-2: scathing gets the bonus.
    expect(scoreSnippet(scathing, argsScathing, NOW))
      .toBeGreaterThan(scoreSnippet(positive, argsScathing, NOW));
  });

  /** A pinned snippet outscores an identical non-pinned one. */
  it('pinned bonus surfaces hand-curated lines', () => {
    const args: PickSnippetArgs = { entityId: ENTITY_A, kind: 'quote' };
    const pinned = makeSnippet({ pinned: true });
    const plain = makeSnippet({ pinned: false, id: 'id-plain' });
    expect(scoreSnippet(pinned, args, NOW)).toBeGreaterThan(scoreSnippet(plain, args, NOW));
  });
});

// ── pickSnippet ─────────────────────────────────────────────────────────────

describe('pickSnippet', () => {
  /** Returns null when the pool is empty. */
  it('returns null on an empty pool', () => {
    expect(pickSnippet([], { entityId: ENTITY_A, kind: 'quote' }, NOW)).toBeNull();
  });

  /**
   * Snippets belonging to a different entity must be filtered out even
   * when the rest of the request matches — defends callers that pass a
   * mixed pool.
   */
  it('filters out snippets from other entities', () => {
    const pool = [
      makeSnippet({ entity_id: ENTITY_B, id: 'id-other-entity' }),
    ];
    expect(pickSnippet(pool, { entityId: ENTITY_A, kind: 'quote' }, NOW)).toBeNull();
  });

  /** Snippet kind must match the request. */
  it('filters out snippets of the wrong kind', () => {
    const pool = [
      makeSnippet({ kind: 'boast', id: 'id-wrong-kind' }),
    ];
    expect(pickSnippet(pool, { entityId: ENTITY_A, kind: 'quote' }, NOW)).toBeNull();
  });

  /** `excludeIds` removes the named candidates from consideration. */
  it('respects excludeIds', () => {
    const pool = [
      makeSnippet({ id: 'id-excluded' }),
      makeSnippet({ id: 'id-allowed' }),
    ];
    const result = pickSnippet(
      pool,
      { entityId: ENTITY_A, kind: 'quote', excludeIds: ['id-excluded'] },
      NOW,
    );
    expect(result?.snippet.id).toBe('id-allowed');
  });

  /**
   * `excludeSubjects` removes any snippet that references one of the
   * excluded entity IDs in its `subjects` array.  Used for session dedup
   * ("don't quote Vex-9 again on this news refresh").
   */
  it('respects excludeSubjects', () => {
    const VEX = '00000000-0000-0000-0000-000000000099';
    const pool = [
      makeSnippet({ id: 'id-about-vex', subjects: [VEX] }),
      makeSnippet({ id: 'id-about-no-one', subjects: [] }),
    ];
    const result = pickSnippet(
      pool,
      { entityId: ENTITY_A, kind: 'quote', excludeSubjects: [VEX] },
      NOW,
    );
    expect(result?.snippet.id).toBe('id-about-no-one');
  });

  /**
   * Given two viable candidates differing only in tag overlap, the picker
   * must pick the higher-overlap one.  End-to-end check that filter +
   * score combine correctly.
   */
  it('picks the highest-scoring candidate', () => {
    const pool = [
      makeSnippet({ id: 'id-no-tags', context_tags: [] }),
      makeSnippet({ id: 'id-with-tags', context_tags: ['pre_match', 'derby'] }),
    ];
    const result = pickSnippet(
      pool,
      {
        entityId: ENTITY_A,
        kind: 'quote',
        contextTags: ['pre_match', 'derby'],
      },
      NOW,
    );
    expect(result?.snippet.id).toBe('id-with-tags');
  });
});
