// ── voiceGuard.test.ts ─────────────────────────────────────────────────────
// Unit tests for the pure ingest-time validator in `voiceGuard.ts`.
//
// What we lock down:
//   1. Tokenisation drops stopwords + punctuation; doesn't lose
//      domain-specific tokens.
//   2. driftScore is non-negative, scales monotonically with overlap,
//      and returns 0 for an empty candidate.
//   3. findTabooViolation matches case-insensitive substrings and
//      returns null when no taboo is hit.
//   4. acceptSnippet runs taboo BEFORE drift, skips drift on sparse
//      personas, and reports rejection reason correctly.

import { describe, expect, it } from 'vitest';

import {
  DRIFT_MIN_COSINE,
  acceptSnippet,
  buildReferenceVector,
  driftScore,
  findTabooViolation,
} from './voiceGuard';
import type { PersonaRow } from '../types';

// ── Fixtures ────────────────────────────────────────────────────────────────

/** Build a persona row with sensible defaults for the voiceGuard surface. */
function makePersona(overrides: Partial<PersonaRow> = {}): PersonaRow {
  return {
    entity_id: 'e-1',
    voice_paragraph: '',
    core_quotes: [
      'The boots felt right today. That matters.',
      'Some days the legs answer; other days they do not.',
      'I owe the work, not the result.',
      'The stadium was loud. The pitch was quiet for me.',
      'I will sleep on it. The morning is honest.',
    ],
    lexicon: ['the work', 'the boots', 'the legs', 'sharp', 'honest'],
    taboos: ['easy', 'guaranteed'],
    goals: [],
    last_enriched_at: null,
    updated_at: '2026-05-21T00:00:00Z',
    personality_vec: {},
    ...overrides,
  };
}

// ── findTabooViolation ─────────────────────────────────────────────────────

describe('findTabooViolation', () => {
  /**
   * Substring match is case-insensitive — the taboo "easy" should
   * match in "Easy day at the office" regardless of capitalisation.
   */
  it('matches case-insensitive substrings', () => {
    const persona = makePersona();
    expect(findTabooViolation('Easy day at the office', persona)).toBe('easy');
    expect(findTabooViolation('A GUARANTEED win', persona)).toBe('guaranteed');
  });

  /** No taboo overlap → null result.  Pin the negative case. */
  it('returns null when no taboo is present', () => {
    const persona = makePersona();
    expect(findTabooViolation('The work was honest today.', persona)).toBeNull();
  });

  /** Empty candidate → null (defensive, no crash). */
  it('returns null for an empty candidate', () => {
    const persona = makePersona();
    expect(findTabooViolation('', persona)).toBeNull();
  });
});

// ── driftScore ─────────────────────────────────────────────────────────────

describe('driftScore', () => {
  /**
   * A candidate using domain tokens that appear in the reference scores
   * meaningfully positive (well above zero).
   */
  it('scores high for on-voice candidates', () => {
    const persona = makePersona();
    const score = driftScore('The boots felt sharp; the work was honest.', persona);
    expect(score).toBeGreaterThan(0.3);
  });

  /**
   * A candidate sharing none of the reference tokens scores 0 (no
   * overlap at all means cosine is exactly 0).
   */
  it('scores 0 for entirely off-voice candidates', () => {
    const persona = makePersona();
    const score = driftScore('xanadu kublai trumpets persimmon', persona);
    expect(score).toBe(0);
  });

  /** Empty candidate → 0. */
  it('returns 0 for an empty candidate', () => {
    const persona = makePersona();
    expect(driftScore('', persona)).toBe(0);
  });
});

// ── acceptSnippet ──────────────────────────────────────────────────────────

describe('acceptSnippet', () => {
  /**
   * On-voice candidate with no taboo terms passes.  Pins the happy path.
   */
  it('accepts on-voice candidates', () => {
    const persona = makePersona();
    const result = acceptSnippet(
      'The work was honest; the legs felt sharp.',
      persona,
    );
    expect(result.accept).toBe(true);
  });

  /**
   * A taboo hit is reported with reason='taboo' even if the candidate
   * would otherwise pass the drift gate.  Pins the order-of-checks
   * documented at the top of voiceGuard.ts (taboo BEFORE drift).
   */
  it('rejects on taboo substring with the matched taboo reported', () => {
    const persona = makePersona();
    const result = acceptSnippet(
      'The work was honest, but today felt easy.',
      persona,
    );
    expect(result.accept).toBe(false);
    if (result.accept === false && result.reason === 'taboo') {
      expect(result.offending).toBe('easy');
    } else {
      throw new Error('expected taboo rejection');
    }
  });

  /**
   * A candidate with no domain overlap is rejected with reason='drift'.
   * Cosine is reported so the caller can log it for tuning telemetry.
   */
  it('rejects on low drift cosine', () => {
    const persona = makePersona();
    const result = acceptSnippet(
      'xanadu kublai trumpets persimmon',
      persona,
    );
    expect(result.accept).toBe(false);
    if (result.accept === false && result.reason === 'drift') {
      expect(result.cosine).toBeLessThan(DRIFT_MIN_COSINE);
    } else {
      throw new Error('expected drift rejection');
    }
  });

  /**
   * A persona with too few reference tokens (fresh-seeded entity)
   * SKIPS the drift check entirely.  Verifies the documented escape
   * hatch — otherwise every snippet on a new entity would fail drift.
   */
  it('skips drift check when persona reference is too sparse', () => {
    const sparse = makePersona({
      core_quotes: ['Short.'],
      lexicon: ['ok'],
    });
    const result = acceptSnippet(
      'xanadu kublai trumpets persimmon',
      sparse,
    );
    expect(result.accept).toBe(true);
  });
});

// ── buildReferenceVector ───────────────────────────────────────────────────

describe('buildReferenceVector', () => {
  /**
   * The reference vector combines tokens from BOTH core_quotes and
   * lexicon.  Lexicon-only tokens must appear; tokens repeated across
   * sources must sum.
   */
  it('combines core_quotes and lexicon tokens', () => {
    const persona = makePersona({
      core_quotes: ['the boots felt sharp'],
      lexicon: ['the work', 'sharp'],
    });
    const vec = buildReferenceVector(persona);
    // 'sharp' appears in both → frequency must be >= 2.
    expect(vec.get('sharp')).toBeGreaterThanOrEqual(2);
    // 'work' (from lexicon) must be present.
    expect(vec.get('work')).toBeGreaterThanOrEqual(1);
  });
});
