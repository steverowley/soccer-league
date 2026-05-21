// ── commentaryCorpus.test.ts ────────────────────────────────────────────────
// Phase 0 regression guard for the extraction of `gameEngine.js`
// commentary templates into `src/features/agents/logic/commentaryCorpus`.
//
// WHY these specific tests exist:
//   1. The extraction is a pure refactor — we want to prove the new
//      module is structurally identical to the inline pools that lived in
//      `gameEngine.buildCommentary()` for years.  Each test below pins
//      down one aspect of that contract.
//   2. The existing `src/gameEngine.smoke.test.ts` already exercises the
//      full engine end-to-end across 200 simulated matches; if the
//      refactor drifted, that suite would surface the regression.  This
//      file is the *narrow* counterpart: targeted unit coverage of the
//      picker / pool builder / weirdness gate.
//   3. Future phases will reuse `pickCommentary` and `buildCommentaryPools`
//      directly (e.g. when Phase 1 imports these strings as `entity_snippets`
//      seed data).  Those callers depend on the precise behaviour locked
//      in here.
//
// DETERMINISM
//   Tests that need a specific pick monkey-patch `Math.random` via
//   `vi.spyOn(Math, 'random')` and restore in `afterEach`, mirroring the
//   pattern used by `gameEngine.smoke.test.ts`.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildCommentaryPools,
  commentaryFlavourSet,
  commentaryPhase,
  maybePickWeirdness,
  pickCommentary,
} from './commentaryCorpus';
import type { CommentaryContext, CommentaryOutcome, CommentaryType } from '../types';

// ── Test fixtures ───────────────────────────────────────────────────────────
// A canonical actors object and a neutral context used across many tests
// so each test reads as a focused assertion rather than scaffolding noise.

/** Stable name pair used by tests that don't care about identity substitution. */
const ACTORS = { attacker: 'Vex-9', defender: 'Grandma Hilda' };

/** Neutral mid-match context — phase = midgame, no situational flags. */
const NEUTRAL_CTX: CommentaryContext = {
  min: 45,
  scoreDiff: 0,
  playerGoals: 0,
  isArchitectFeatured: false,
};

/** Empty flavour set helper — every flag false. */
const EMPTY_FLAVOUR = commentaryFlavourSet([]);

afterEach(() => {
  // Always restore Math.random spies so test order can't leak state.
  vi.restoreAllMocks();
});

// ── commentaryPhase ─────────────────────────────────────────────────────────

describe('commentaryPhase', () => {
  /**
   * Boundary minutes are part of the contract — these specific thresholds
   * (25, 65, 82) appeared verbatim in the original engine for years and
   * downstream commentary references them.
   */
  it('maps each phase window correctly', () => {
    expect(commentaryPhase(1)).toBe('early');
    expect(commentaryPhase(25)).toBe('early');
    expect(commentaryPhase(26)).toBe('midgame');
    expect(commentaryPhase(65)).toBe('midgame');
    expect(commentaryPhase(66)).toBe('late');
    expect(commentaryPhase(82)).toBe('late');
    expect(commentaryPhase(83)).toBe('dying');
    expect(commentaryPhase(95)).toBe('dying');
  });
});

// ── commentaryFlavourSet ───────────────────────────────────────────────────

describe('commentaryFlavourSet', () => {
  /**
   * Every supported flavour string flips exactly one boolean — verifying
   * the seven-flag struct stays in sync with the engine's `resolveContest`
   * outputs.
   */
  it('recognises every documented flavour tag', () => {
    const set = commentaryFlavourSet([
      'exhausted',
      'clutch',
      'anxious',
      'ecstatic',
      'confident',
      'creative',
      'low_confidence',
    ]);
    expect(set).toEqual({
      exhausted: true,
      clutch: true,
      anxious: true,
      ecstatic: true,
      confident: true,
      creative: true,
      lowConfidence: true,
    });
  });

  /** Unknown tags are silently ignored — engine adds in-logic tags
   *  ('keeper_paralysed', 'architect_tantrum') that don't have commentary. */
  it('ignores unknown flavour tags', () => {
    const set = commentaryFlavourSet(['keeper_paralysed', 'architect_tantrum']);
    expect(set.exhausted).toBe(false);
    expect(set.confident).toBe(false);
  });
});

// ── maybePickWeirdness ─────────────────────────────────────────────────────

describe('maybePickWeirdness', () => {
  /**
   * Goals never trigger weirdness regardless of Math.random — the UI
   * scoring code parses commentary for `⚽` and would break if a goal
   * returned an alien line.
   */
  it('never triggers on goal outcomes', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(maybePickWeirdness(ACTORS, 'goal', false)).toBeNull();
    expect(maybePickWeirdness(ACTORS, 'goal', true)).toBeNull();
  });

  /** Rate 3% in the base case — 0.05 random returns null, 0.01 fires. */
  it('uses 3% base rate for non-Architect-featured events', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.05);
    expect(maybePickWeirdness(ACTORS, 'saved', false)).toBeNull();

    vi.spyOn(Math, 'random').mockReturnValue(0.01);
    expect(maybePickWeirdness(ACTORS, 'saved', false)).not.toBeNull();
  });

  /** Rate 8% when Architect-featured — 0.05 random NOW fires. */
  it('elevates to 8% when Architect-featured', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.05);
    expect(maybePickWeirdness(ACTORS, 'saved', true)).not.toBeNull();
  });

  /** Returned line must reference the actor names — proves interpolation. */
  it('interpolates attacker name into the picked line', () => {
    // First Math.random() < rate (gate fires); second selects index 0 in pick().
    vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0);
    const line = maybePickWeirdness(ACTORS, 'saved', false);
    expect(line).toContain('Vex-9');
  });
});

// ── buildCommentaryPools ───────────────────────────────────────────────────

describe('buildCommentaryPools', () => {
  /**
   * Sanity: every (type, outcome) pair the engine uses must return at
   * least one line under neutral conditions.  Catches accidental deletion
   * of the generic fallback lines during future edits.
   */
  it('every documented (type, outcome) pair has at least one neutral line', () => {
    const cases: Array<[CommentaryType, CommentaryOutcome]> = [
      ['shot', 'goal'],
      ['shot', 'saved'],
      ['shot', 'miss'],
      ['shot', 'post'],
      ['freekick', 'goal'],
      ['freekick', 'saved'],
      ['freekick', 'miss'],
      ['freekick', 'post'],
      ['penalty', 'goal'],
      ['penalty', 'saved'],
      ['penalty', 'miss'],
      ['header', 'goal'],
      ['header', 'saved'],
      ['header', 'miss'],
      ['tackle', 'won'],
      ['tackle', 'contested'],
      ['tackle', 'lost'],
    ];
    const pools = buildCommentaryPools(ACTORS, EMPTY_FLAVOUR, NEUTRAL_CTX);
    for (const [type, outcome] of cases) {
      const pool = pools[type]?.[outcome];
      expect(pool, `${type}.${outcome} pool`).toBeTruthy();
      expect(pool!.length).toBeGreaterThan(0);
    }
  });

  /**
   * Conditional lines must drop out cleanly when their guard is false.
   * Comparing pool length under "all flags off" vs "clutch flag on"
   * exposes flag-gated lines without depending on exact counts.
   */
  it('phase-specific lines only appear in the matching phase', () => {
    const earlyPools = buildCommentaryPools(ACTORS, EMPTY_FLAVOUR, { ...NEUTRAL_CTX, min: 10 });
    const dyingPools = buildCommentaryPools(ACTORS, EMPTY_FLAVOUR, { ...NEUTRAL_CTX, min: 90 });

    // Dying-time has at least one bespoke shot.goal line beyond the
    // generic pool; early phase has its own bespoke line; lengths differ.
    const earlyGoals = earlyPools.shot.goal ?? [];
    const dyingGoals = dyingPools.shot.goal ?? [];
    expect(dyingGoals.some((l) => l.includes('AT THE DEATH'))).toBe(true);
    expect(earlyGoals.some((l) => l.includes('AT THE DEATH'))).toBe(false);
    expect(earlyGoals.some((l) => l.includes('EARLY GOAL'))).toBe(true);
  });

  /**
   * Hat-trick line only appears when `playerGoals >= 2` — proves the
   * `hatTrick` derived flag is wired into the pool.
   */
  it('hat-trick line appears only when playerGoals >= 2', () => {
    const noTrick = buildCommentaryPools(ACTORS, EMPTY_FLAVOUR, { ...NEUTRAL_CTX, playerGoals: 1 });
    const hatTrick = buildCommentaryPools(ACTORS, EMPTY_FLAVOUR, { ...NEUTRAL_CTX, playerGoals: 2 });

    const trickLine = 'HAT TRICK HUNT';
    expect((noTrick.shot.goal ?? []).some((l) => l.includes(trickLine))).toBe(false);
    expect((hatTrick.shot.goal ?? []).some((l) => l.includes(trickLine))).toBe(true);
  });

  /**
   * `creative` flag is unique to freekick goals — confirms the corpus
   * preserves the engine's mapping of flavour flags to pool branches.
   */
  it('creative flavour unlocks the bend-around-the-wall freekick line', () => {
    const plain = commentaryFlavourSet([]);
    const creative = commentaryFlavourSet(['creative']);
    const plainPool = buildCommentaryPools(ACTORS, plain, NEUTRAL_CTX).freekick.goal ?? [];
    const creativePool = buildCommentaryPools(ACTORS, creative, NEUTRAL_CTX).freekick.goal ?? [];

    expect(creativePool.some((l) => l.includes('bends it around the wall'))).toBe(true);
    expect(plainPool.some((l) => l.includes('bends it around the wall'))).toBe(false);
  });

  /**
   * `desperate` only fires when trailing by >= 2 AFTER the 65th minute —
   * `chasing` covers the same score gap before that boundary.  Single
   * test pins both derived flags down.
   */
  it('desperate vs chasing diverge across the 65th minute boundary', () => {
    const earlyTrailing = buildCommentaryPools(ACTORS, EMPTY_FLAVOUR, {
      ...NEUTRAL_CTX,
      min: 50,
      scoreDiff: -2,
    });
    const lateTrailing = buildCommentaryPools(ACTORS, EMPTY_FLAVOUR, {
      ...NEUTRAL_CTX,
      min: 75,
      scoreDiff: -2,
    });

    const desperateMarker = 'DRAGS THEM BACK';
    const chasingMarker = 'tries to spark something';

    expect((earlyTrailing.shot.goal ?? []).some((l) => l.includes(desperateMarker))).toBe(false);
    expect((lateTrailing.shot.goal ?? []).some((l) => l.includes(desperateMarker))).toBe(true);
    expect((earlyTrailing.shot.saved ?? []).some((l) => l.includes(chasingMarker))).toBe(true);
  });
});

// ── pickCommentary (top-level entry point) ─────────────────────────────────

describe('pickCommentary', () => {
  /**
   * Default-args path — no flavour, no context — should still return a
   * non-empty string for every event type.  This mirrors how the engine
   * calls into the corpus when no extra context is available.
   */
  it('returns a non-empty line for the default-args path', () => {
    // Force weirdness gate to miss (random >= 0.08 covers both rates).
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    const line = pickCommentary('shot', ACTORS, 'goal');
    expect(line.length).toBeGreaterThan(0);
  });

  /**
   * The fallback path is triggered when a (type, outcome) combo has no
   * pool entry — defensive only; not exercised by the live engine.
   * Pinning down the exact format prevents future "improvements" from
   * silently changing the engine's emergency fallback string.
   */
  it('falls back to "${atk} — ${outcome}." for an unknown outcome', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    // Cast through an explicit local — typed outcome union doesn't allow
    // a synthetic value, but the runtime branch must still be tested.
    const synthetic = 'never_existed' as CommentaryOutcome;
    const line = pickCommentary('shot', ACTORS, synthetic);
    expect(line).toBe('Vex-9 — never_existed.');
  });

  /**
   * Weirdness gate sits in front of the pool pick — when it fires, the
   * normal pool is skipped entirely.  Verifies the gating order matches
   * the pre-refactor engine.
   */
  it('weirdness gate short-circuits the normal pool when it fires', () => {
    // First random < 0.03 fires the gate; second picks an index in the
    // 10-line weirdness pool.
    vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0);
    const line = pickCommentary('shot', ACTORS, 'saved');
    // Pool-borne saved lines all contain Grandma Hilda or "SAVE"; the
    // weirdness pool's first entry is the "holds the ball" line.
    expect(line).toContain('holds the ball for slightly too long');
  });

  /**
   * Goal outcomes ignore the weirdness gate even if random < 0.03 —
   * required so the UI's `⚽` parser never sees a weirdness line on a
   * goal event.
   */
  it('goal outcomes always use the goal pool, never weirdness', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const line = pickCommentary('shot', ACTORS, 'goal');
    expect(line.startsWith('⚽')).toBe(true);
  });
});
