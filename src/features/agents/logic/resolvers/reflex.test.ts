// ── reflex.test.ts ─────────────────────────────────────────────────────────
// Unit tests for the two reflex-tier resolvers shipped in Phase 8:
//   - shootOrPass: striker chooses shoot vs pass, shaded by persona +
//     per-keeper memory tally.
//   - cardSeverity: ref shades the engine's incident severity by
//     conscientiousness + per-player flare-up / goodwill memories.
//
// What we pin down:
//   1. Neutral persona + no memories → ~zero delta (zero contribution
//      from either component).
//   2. Personality axes push in the documented direction.
//   3. Memory tallies push in the documented direction AND only count
//      memories whose subjects include the target entity.
//   4. Hard clamps prevent runaway outputs even on extreme inputs.
//
// PURE TESTS — no Supabase, no engine harness. Both resolvers are pure
// and synchronous so they're trivially testable with hand-built rows.

import { describe, expect, it } from 'vitest';

import { runDecision } from '../decisions';
import type { MemoryRow, PersonaRow } from '../../types';

// ── Fixtures ────────────────────────────────────────────────────────────────

/** Build a PersonaRow with sensible defaults; tests override what they need. */
function makePersona(overrides: Partial<PersonaRow> = {}): PersonaRow {
  return {
    entity_id: 'e-1',
    voice_paragraph: '',
    core_quotes: [],
    lexicon: [],
    taboos: [],
    goals: [],
    last_enriched_at: null,
    updated_at: '2026-05-21T00:00:00Z',
    personality_vec: {
      bigFive: {
        openness: 0.5,
        conscientiousness: 0.5,
        extraversion: 0.5,
        agreeableness: 0.5,
        neuroticism: 0.5,
      },
      cosmic: {},
    },
    ...overrides,
  };
}

/** Build a MemoryRow with sensible defaults. */
function makeMemory(overrides: Partial<MemoryRow> = {}): MemoryRow {
  return {
    id: 'mem-1',
    entity_id: 'e-1',
    fact_kind: 'scored_on',
    payload: {},
    salience: 5,
    subjects: [],
    occurred_at: '2026-05-20T00:00:00Z',
    consumed_count: 0,
    ...overrides,
  };
}

const KEEPER = 'keeper-vex-9';
const PLAYER = 'player-grandma';

// ── shoot_or_pass ──────────────────────────────────────────────────────────

describe('resolveShootOrPass', () => {
  /**
   * A neutral persona with no relevant memories must produce the
   * documented 0.5 anchor.  Pins the "no signal means no movement"
   * contract.
   */
  it('returns the neutral anchor for a blank persona and no memories', () => {
    const r = runDecision({
      kind: 'shoot_or_pass',
      persona: makePersona(),
      memories: [],
      context: { keeperEntityId: KEEPER },
    });
    expect(r.shootWeight).toBeCloseTo(0.5, 5);
    expect(r.personalityDelta).toBeCloseTo(0, 5);
    expect(r.memoryDelta).toBeCloseTo(0, 5);
  });

  /**
   * High extraversion (bold) pushes shootWeight ABOVE the anchor.
   * High conscientiousness (cautious) pushes it BELOW.  Combined high
   * extraversion + low conscientiousness should produce a clear positive
   * delta.
   */
  it('high extraversion + low conscientiousness raises the shoot weight', () => {
    const persona = makePersona({
      personality_vec: {
        bigFive: {
          openness: 0.5,
          conscientiousness: 0.1,
          extraversion: 0.95,
          agreeableness: 0.5,
          neuroticism: 0.5,
        },
        cosmic: {},
      },
    });
    const r = runDecision({
      kind: 'shoot_or_pass',
      persona,
      memories: [],
      context: { keeperEntityId: KEEPER },
    });
    expect(r.shootWeight).toBeGreaterThan(0.5);
    expect(r.personalityDelta).toBeGreaterThan(0);
  });

  /**
   * Positive memories against THIS keeper raise the weight.  Memories
   * against OTHER keepers must not contribute — guards against memory
   * cross-contamination across the season.
   */
  it('positive memories against the keeper raise the weight', () => {
    const memories = [
      makeMemory({ fact_kind: 'scored_on', subjects: [KEEPER] }),
      makeMemory({ id: 'mem-2', fact_kind: 'scored_on', subjects: [KEEPER] }),
      // Should NOT contribute — wrong subject.
      makeMemory({ id: 'mem-3', fact_kind: 'scored_on', subjects: ['other-keeper'] }),
    ];
    const r = runDecision({
      kind: 'shoot_or_pass',
      persona: makePersona(),
      memories,
      context: { keeperEntityId: KEEPER },
    });
    expect(r.memoryDelta).toBeGreaterThan(0);
    expect(r.shootWeight).toBeGreaterThan(0.5);
  });

  /**
   * Negative memories pull the weight DOWN.  Pin direction so the
   * documented hesitation behaviour stays stable.
   */
  it('negative memories against the keeper lower the weight', () => {
    const memories = [
      makeMemory({ fact_kind: 'was_saved', subjects: [KEEPER] }),
      makeMemory({ id: 'mem-2', fact_kind: 'missed_target', subjects: [KEEPER] }),
    ];
    const r = runDecision({
      kind: 'shoot_or_pass',
      persona: makePersona(),
      memories,
      context: { keeperEntityId: KEEPER },
    });
    expect(r.memoryDelta).toBeLessThan(0);
    expect(r.shootWeight).toBeLessThan(0.5);
  });

  /**
   * Extreme combined inputs may not push the weight outside the
   * documented [0.2, 0.8] envelope.  Critical: the resolver must never
   * recommend an absolute decision — even the boldest striker against
   * a familiar keeper still has a non-zero pass chance for the engine
   * to surface.
   */
  it('clamps the shoot weight to the documented envelope', () => {
    const persona = makePersona({
      personality_vec: {
        bigFive: {
          openness: 0.5,
          conscientiousness: 0,
          extraversion: 1,
          agreeableness: 0.5,
          neuroticism: 0.5,
        },
        cosmic: {},
      },
    });
    // 10 positive memories — well past the 5-cap saturation point.
    const memories: MemoryRow[] = Array.from({ length: 10 }, (_, i) =>
      makeMemory({ id: `m-${i}`, fact_kind: 'scored_on', subjects: [KEEPER] }),
    );
    const r = runDecision({
      kind: 'shoot_or_pass',
      persona,
      memories,
      context: { keeperEntityId: KEEPER },
    });
    expect(r.shootWeight).toBeGreaterThanOrEqual(0.2);
    expect(r.shootWeight).toBeLessThanOrEqual(0.8);
  });
});

// ── card_severity ──────────────────────────────────────────────────────────

describe('resolveCardSeverity', () => {
  /**
   * A neutral ref with no memories must pass the base severity through
   * untouched — zero contribution from either component.
   */
  it('returns the base severity for a neutral ref with no memories', () => {
    const r = runDecision({
      kind: 'card_severity',
      persona: makePersona(),
      memories: [],
      context: { playerEntityId: PLAYER, baseSeverity: 0.6 },
    });
    expect(r.shadedSeverity).toBeCloseTo(0.6, 5);
    expect(r.strictnessDelta).toBeCloseTo(0, 5);
    expect(r.memoryDelta).toBeCloseTo(0, 5);
  });

  /**
   * High conscientiousness raises the effective severity — the stricter
   * ref reaches for the card more quickly on the same incident.
   */
  it('high conscientiousness raises the effective severity', () => {
    const persona = makePersona({
      personality_vec: {
        bigFive: {
          openness: 0.5,
          conscientiousness: 0.95,
          extraversion: 0.5,
          agreeableness: 0.5,
          neuroticism: 0.5,
        },
        cosmic: {},
      },
    });
    const r = runDecision({
      kind: 'card_severity',
      persona,
      memories: [],
      context: { playerEntityId: PLAYER, baseSeverity: 0.5 },
    });
    expect(r.shadedSeverity).toBeGreaterThan(0.5);
    expect(r.strictnessDelta).toBeGreaterThan(0);
  });

  /**
   * Flare-up memories against THIS player raise severity; goodwill
   * memories lower it.  Verify both directions land where documented.
   */
  it('flare-up memories raise severity; goodwill lowers it', () => {
    const flareups = [
      makeMemory({ fact_kind: 'argued_with_ref', subjects: [PLAYER] }),
      makeMemory({ id: 'm-2', fact_kind: 'dive_simulated', subjects: [PLAYER] }),
    ];
    const flareR = runDecision({
      kind: 'card_severity',
      persona: makePersona(),
      memories: flareups,
      context: { playerEntityId: PLAYER, baseSeverity: 0.5 },
    });
    expect(flareR.memoryDelta).toBeGreaterThan(0);
    expect(flareR.shadedSeverity).toBeGreaterThan(0.5);

    const goodwill = [
      makeMemory({ fact_kind: 'clean_match_with', subjects: [PLAYER] }),
      makeMemory({ id: 'm-2', fact_kind: 'clean_match_with', subjects: [PLAYER] }),
    ];
    const goodR = runDecision({
      kind: 'card_severity',
      persona: makePersona(),
      memories: goodwill,
      context: { playerEntityId: PLAYER, baseSeverity: 0.5 },
    });
    expect(goodR.memoryDelta).toBeLessThan(0);
    expect(goodR.shadedSeverity).toBeLessThan(0.5);
  });

  /**
   * CRITICAL INVARIANT — final severity must clamp to [0,1].  The
   * resolver should never fabricate cards from negative inputs, and
   * extreme grudge stacks should still produce a valid severity.
   */
  it('clamps the shaded severity to [0,1] regardless of inputs', () => {
    const persona = makePersona({
      personality_vec: {
        bigFive: {
          openness: 0.5,
          conscientiousness: 1,
          extraversion: 0.5,
          agreeableness: 0.5,
          neuroticism: 0.5,
        },
        cosmic: {},
      },
    });
    const grudges: MemoryRow[] = Array.from({ length: 10 }, (_, i) =>
      makeMemory({ id: `g-${i}`, fact_kind: 'argued_with_ref', subjects: [PLAYER] }),
    );
    // Even with extreme inputs and baseSeverity at the ceiling, the
    // result must not exceed 1.
    const r = runDecision({
      kind: 'card_severity',
      persona,
      memories: grudges,
      context: { playerEntityId: PLAYER, baseSeverity: 0.95 },
    });
    expect(r.shadedSeverity).toBeLessThanOrEqual(1);
    expect(r.shadedSeverity).toBeGreaterThanOrEqual(0);
  });

  /**
   * Memories about OTHER players don't contribute — guards against the
   * memory tally over-counting league-wide history into one specific
   * incident.
   */
  it('ignores memories about other players', () => {
    const otherMemories = [
      makeMemory({ fact_kind: 'argued_with_ref', subjects: ['other-player'] }),
      makeMemory({ id: 'm-2', fact_kind: 'dive_simulated', subjects: ['other-player'] }),
    ];
    const r = runDecision({
      kind: 'card_severity',
      persona: makePersona(),
      memories: otherMemories,
      context: { playerEntityId: PLAYER, baseSeverity: 0.5 },
    });
    expect(r.memoryDelta).toBeCloseTo(0, 5);
    expect(r.shadedSeverity).toBeCloseTo(0.5, 5);
  });
});
