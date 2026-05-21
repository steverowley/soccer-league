// ── decisions.test.ts ──────────────────────────────────────────────────────
// Unit tests for the reflection-tier decision dispatcher + the three
// Phase 6 resolvers (oddsSlant, journalistStoryPick, punditTake).
//
// Each resolver is pure, so tests are direct: build a persona + memories
// fixture, call `runDecision`, assert the typed output is what we expect.
// No mocks, no I/O, no LLM.
//
// What we lock down:
//   1. Dispatcher routes each DecisionKind to the correct resolver and
//      returns the typed result.
//   2. oddsSlant clamps within ±MAX_SLANT_FRACTION, signs respond to mood
//      + grudges as documented, and a neutral persona yields zero slant.
//   3. journalistStoryPick favours beat-matched candidates over recency.
//   4. punditTake favours specialty-matched candidates and penalises
//      repeat takes.

import { describe, expect, it } from 'vitest';

import { runDecision } from './decisions';
import type { MemoryRow, PersonaRow } from '../types';

// ── Fixtures ────────────────────────────────────────────────────────────────

/** Build a PersonaRow with sensible defaults; override only what each test needs. */
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
    fact_kind: 'match_result',
    payload: {},
    salience: 5,
    subjects: [],
    occurred_at: '2026-05-20T00:00:00Z',
    consumed_count: 0,
    ...overrides,
  };
}

/** Fixed wall-clock so recency math is deterministic. */
const NOW = new Date('2026-05-21T12:00:00Z');

// ── Dispatcher ──────────────────────────────────────────────────────────────

describe('runDecision — dispatcher', () => {
  /**
   * Smoke test: dispatching 'odds_slant' returns an OddsSlantResult
   * (we check the shape via key presence, not exact values).
   */
  it('routes odds_slant to the bookie resolver', () => {
    const result = runDecision({
      kind: 'odds_slant',
      persona: makePersona(),
      memories: [],
      context: {
        homeTeamId: 'mars-athletic',
        awayTeamId: 'venus-volcanic',
        canonicalHomeProb: 0.5,
        canonicalDrawProb: 0.25,
        canonicalAwayProb: 0.25,
      },
    });
    expect(result).toHaveProperty('homeProb');
    expect(result).toHaveProperty('homeDelta');
    expect(result).toHaveProperty('reason');
  });

  /** Dispatching 'journalist_story_pick' returns a JournalistStoryPickResult. */
  it('routes journalist_story_pick to the journalist resolver', () => {
    const result = runDecision({
      kind: 'journalist_story_pick',
      persona: makePersona(),
      memories: [],
      context: { candidates: [], now: NOW },
    });
    expect(result.chosen).toBeNull();
    expect(result.reason).toContain('No candidate');
  });

  /** Dispatching 'pundit_take' returns a PunditTakeResult. */
  it('routes pundit_take to the pundit resolver', () => {
    const result = runDecision({
      kind: 'pundit_take',
      persona: makePersona(),
      memories: [],
      context: { candidates: [], now: NOW },
    });
    expect(result.chosen).toBeNull();
  });
});

// ── oddsSlant ──────────────────────────────────────────────────────────────

describe('resolveOddsSlant', () => {
  /**
   * Neutral persona (all axes 0.5) + no grudges → slant is approximately
   * zero.  Pins down the "no signal means no movement" contract.
   */
  it('produces near-zero slant for a neutral persona', () => {
    const result = runDecision({
      kind: 'odds_slant',
      persona: makePersona(),
      memories: [],
      context: {
        homeTeamId: 'mars-athletic',
        awayTeamId: 'venus-volcanic',
        canonicalHomeProb: 0.5,
        canonicalDrawProb: 0.25,
        canonicalAwayProb: 0.25,
      },
    });
    expect(Math.abs(result.homeDelta)).toBeLessThan(0.005);
  });

  /**
   * High openness shifts the home delta NEGATIVE (risk-tolerant bookie
   * lengthens the favourite).  We use a clean 50/25/25 canonical
   * baseline so any negative homeDelta is unambiguous signal.
   */
  it('high openness slants AWAY from the home team', () => {
    const persona = makePersona({
      personality_vec: {
        bigFive: {
          openness: 0.9,
          conscientiousness: 0.5,
          extraversion: 0.5,
          agreeableness: 0.5,
          neuroticism: 0.5,
        },
        cosmic: {},
      },
    });
    const result = runDecision({
      kind: 'odds_slant',
      persona,
      memories: [],
      context: {
        homeTeamId: 'mars-athletic',
        awayTeamId: 'venus-volcanic',
        canonicalHomeProb: 0.5,
        canonicalDrawProb: 0.25,
        canonicalAwayProb: 0.25,
      },
    });
    expect(result.homeDelta).toBeLessThan(0);
  });

  /**
   * Grudges against home (recorded as payload.homeTeamId === target)
   * lengthen home's price further.  Confirms the grudge wiring.
   */
  it('grudges against the home team subtract from home probability', () => {
    const grudgyMemory = makeMemory({
      fact_kind: 'wager_lost_on_them',
      payload: { homeTeamId: 'mars-athletic' },
    });
    const result = runDecision({
      kind: 'odds_slant',
      persona: makePersona(),
      memories: [grudgyMemory, grudgyMemory, grudgyMemory],
      context: {
        homeTeamId: 'mars-athletic',
        awayTeamId: 'venus-volcanic',
        canonicalHomeProb: 0.5,
        canonicalDrawProb: 0.25,
        canonicalAwayProb: 0.25,
      },
    });
    expect(result.homeDelta).toBeLessThan(0);
  });

  /**
   * Even an extreme persona + grudge stack can't move the home delta
   * past the documented clamp of ±0.08.  Guards against runaway slants.
   */
  it('clamps homeDelta to ±MAX_SLANT_FRACTION', () => {
    const extreme = makePersona({
      personality_vec: {
        bigFive: {
          openness: 0,
          conscientiousness: 0.5,
          extraversion: 0.5,
          agreeableness: 0.5,
          neuroticism: 1,
        },
        cosmic: {},
      },
    });
    // Six identical grudges against home — pushes the grudge contribution
    // to its cap; combined with extreme mood the unclamped delta would
    // exceed 0.08.
    const grudges: MemoryRow[] = Array.from({ length: 6 }, () =>
      makeMemory({
        fact_kind: 'inside_money',
        payload: { homeTeamId: 'mars-athletic' },
      }),
    );
    const result = runDecision({
      kind: 'odds_slant',
      persona: extreme,
      memories: grudges,
      context: {
        homeTeamId: 'mars-athletic',
        awayTeamId: 'venus-volcanic',
        canonicalHomeProb: 0.5,
        canonicalDrawProb: 0.25,
        canonicalAwayProb: 0.25,
      },
    });
    expect(Math.abs(result.homeDelta)).toBeLessThanOrEqual(0.08001);
  });
});

// ── journalistStoryPick ────────────────────────────────────────────────────

describe('resolveJournalistStoryPick', () => {
  /** Empty candidates → null chosen + zero score + clear reason. */
  it('returns null when there are no candidates', () => {
    const result = runDecision({
      kind: 'journalist_story_pick',
      persona: makePersona(),
      memories: [],
      context: { candidates: [], now: NOW },
    });
    expect(result.chosen).toBeNull();
    expect(result.score).toBe(0);
  });

  /**
   * Beat match dominates: a 5-day-old story on the journalist's beat
   * beats a fresh story off-beat.  Demonstrates BEAT_BONUS > recency.
   */
  it('prefers on-beat stories over fresher off-beat ones', () => {
    const persona = makePersona({
      goals: [{ kind: 'beat:rocky-inner', target: 'self' }],
    });
    const result = runDecision({
      kind: 'journalist_story_pick',
      persona,
      memories: [],
      context: {
        candidates: [
          {
            id: 'on-beat',
            beat: 'rocky-inner',
            occurredAt: '2026-05-16T00:00:00Z',
            involvedEntityIds: [],
          },
          {
            id: 'off-beat',
            beat: 'transfers',
            occurredAt: '2026-05-21T11:00:00Z',
            involvedEntityIds: [],
          },
        ],
        now: NOW,
      },
    });
    expect(result.chosen?.id).toBe('on-beat');
  });

  /**
   * Source overlap (memories referencing the candidate's involved
   * entities) lifts the score independent of beat.  Equal-beat
   * candidates differentiate via source count.
   */
  it('source overlap promotes the better-sourced candidate', () => {
    const persona = makePersona();
    const trackedEntity = 'tracked-entity';
    const memories: MemoryRow[] = [
      makeMemory({ subjects: [trackedEntity] }),
      makeMemory({ id: 'mem-2', subjects: [trackedEntity] }),
    ];
    const result = runDecision({
      kind: 'journalist_story_pick',
      persona,
      memories,
      context: {
        candidates: [
          {
            id: 'with-source',
            beat: 'general',
            occurredAt: '2026-05-21T11:00:00Z',
            involvedEntityIds: [trackedEntity],
          },
          {
            id: 'no-source',
            beat: 'general',
            occurredAt: '2026-05-21T11:00:00Z',
            involvedEntityIds: ['unknown-entity'],
          },
        ],
        now: NOW,
      },
    });
    expect(result.chosen?.id).toBe('with-source');
  });
});

// ── punditTake ─────────────────────────────────────────────────────────────

describe('resolvePunditTake', () => {
  /** Empty candidates → null chosen. */
  it('returns null when there are no candidates', () => {
    const result = runDecision({
      kind: 'pundit_take',
      persona: makePersona(),
      memories: [],
      context: { candidates: [], now: NOW },
    });
    expect(result.chosen).toBeNull();
  });

  /**
   * Specialty match dominates over recency, mirroring the journalist
   * beat-bonus behaviour.
   */
  it('prefers on-specialty subjects', () => {
    const persona = makePersona({
      goals: [{ kind: 'specialty:tactics', target: 'self' }],
    });
    const result = runDecision({
      kind: 'pundit_take',
      persona,
      memories: [],
      context: {
        candidates: [
          {
            id: 'tactics',
            specialty: 'tactics',
            occurredAt: '2026-05-16T00:00:00Z',
            involvedEntityIds: [],
          },
          {
            id: 'goalkeeping',
            specialty: 'goalkeeping',
            occurredAt: '2026-05-21T11:00:00Z',
            involvedEntityIds: [],
          },
        ],
        now: NOW,
      },
    });
    expect(result.chosen?.id).toBe('tactics');
  });

  /**
   * Repetition penalty: a subject the pundit has opined on twice gets a
   * 16-point reduction, enough to override a specialty bonus.  Confirms
   * the anti-repetition mechanism is wired through and weighted
   * appropriately.
   */
  it('penalises subjects the pundit has already opined on', () => {
    const persona = makePersona({
      goals: [{ kind: 'specialty:tactics', target: 'self' }],
    });
    const repeatedSubject = 'subject-x';
    const memories: MemoryRow[] = [
      makeMemory({ fact_kind: 'gave_take_on', subjects: [repeatedSubject] }),
      makeMemory({ id: 'mem-2', fact_kind: 'gave_take_on', subjects: [repeatedSubject] }),
      makeMemory({ id: 'mem-3', fact_kind: 'gave_take_on', subjects: [repeatedSubject] }),
    ];
    const result = runDecision({
      kind: 'pundit_take',
      persona,
      memories,
      context: {
        candidates: [
          {
            id: 'repeated',
            specialty: 'tactics',
            occurredAt: '2026-05-21T11:00:00Z',
            involvedEntityIds: [repeatedSubject],
          },
          {
            id: 'fresh',
            specialty: 'goalkeeping', // wrong specialty but no repetition
            occurredAt: '2026-05-21T11:00:00Z',
            involvedEntityIds: ['other-subject'],
          },
        ],
        now: NOW,
      },
    });
    expect(result.chosen?.id).toBe('fresh');
  });
});
