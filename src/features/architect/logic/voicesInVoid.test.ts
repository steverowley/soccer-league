// ── architect/logic/voicesInVoid.test.ts ─────────────────────────────────────
// Unit tests for the between-match cosmic voice proclamation logic.

import { describe, expect, it } from 'vitest';
import {
  BALANCE_VOID_KIND,
  BALANCE_VOID_TEMPLATES,
  CHAOS_VOID_KIND,
  CHAOS_VOID_TEMPLATES,
  BALANCE_ENTITY_ID,
  CHAOS_ENTITY_ID,
  MAX_BALANCE_PER_DAY,
  MAX_CHAOS_PER_DAY,
  BALANCE_SPEECH_PROBABILITY,
  CHAOS_SPEECH_PROBABILITY,
  buildVoidLine,
  shouldVoidVoiceSpeak,
  voidNarrativeShape,
} from './voicesInVoid';

describe('voicesInVoid — template banks', () => {
  it('Balance bank has at least 12 distinct entries so repeats are rare', () => {
    expect(BALANCE_VOID_TEMPLATES.length).toBeGreaterThanOrEqual(12);
    expect(new Set(BALANCE_VOID_TEMPLATES).size).toBe(BALANCE_VOID_TEMPLATES.length);
  });

  it('Chaos bank has at least 12 distinct entries', () => {
    expect(CHAOS_VOID_TEMPLATES.length).toBeGreaterThanOrEqual(12);
    expect(new Set(CHAOS_VOID_TEMPLATES).size).toBe(CHAOS_VOID_TEMPLATES.length);
  });

  it('all template lines are non-empty and ≤ 200 chars', () => {
    for (const line of [...BALANCE_VOID_TEMPLATES, ...CHAOS_VOID_TEMPLATES]) {
      expect(line.length).toBeGreaterThan(0);
      expect(line.length).toBeLessThanOrEqual(200);
    }
  });
});

describe('shouldVoidVoiceSpeak — daily cap gate', () => {
  // A predictable RNG that always fires the probability roll (returns 0).
  const ALWAYS_FIRE = () => 0;
  // A predictable RNG that always misses the probability roll (returns 1).
  const NEVER_FIRE = () => 0.9999;

  it('returns true when below cap and probability roll succeeds (balance)', () => {
    expect(shouldVoidVoiceSpeak('balance', 0, ALWAYS_FIRE)).toBe(true);
  });

  it('returns true when below cap and probability roll succeeds (chaos)', () => {
    expect(shouldVoidVoiceSpeak('chaos', 0, ALWAYS_FIRE)).toBe(true);
  });

  it('returns false when at cap, regardless of probability roll', () => {
    expect(shouldVoidVoiceSpeak('balance', MAX_BALANCE_PER_DAY, ALWAYS_FIRE)).toBe(false);
    expect(shouldVoidVoiceSpeak('chaos',   MAX_CHAOS_PER_DAY,   ALWAYS_FIRE)).toBe(false);
  });

  it('returns false when over cap', () => {
    expect(shouldVoidVoiceSpeak('balance', MAX_BALANCE_PER_DAY + 5, ALWAYS_FIRE)).toBe(false);
  });

  it('returns false when probability roll fails even though below cap', () => {
    expect(shouldVoidVoiceSpeak('balance', 0, NEVER_FIRE)).toBe(false);
    expect(shouldVoidVoiceSpeak('chaos',   0, NEVER_FIRE)).toBe(false);
  });

  it('probability constants stay between 0 and 1', () => {
    // Defensive: an out-of-range constant would silently break the gate.
    expect(BALANCE_SPEECH_PROBABILITY).toBeGreaterThan(0);
    expect(BALANCE_SPEECH_PROBABILITY).toBeLessThan(1);
    expect(CHAOS_SPEECH_PROBABILITY).toBeGreaterThan(0);
    expect(CHAOS_SPEECH_PROBABILITY).toBeLessThan(1);
  });
});

describe('buildVoidLine — template sampling', () => {
  it('returns a Balance template when voice=balance', () => {
    const line = buildVoidLine('balance', () => 0);
    expect(BALANCE_VOID_TEMPLATES).toContain(line);
  });

  it('returns a Chaos template when voice=chaos', () => {
    const line = buildVoidLine('chaos', () => 0);
    expect(CHAOS_VOID_TEMPLATES).toContain(line);
  });

  it('is deterministic for a given RNG', () => {
    const a = buildVoidLine('balance', () => 0.5);
    const b = buildVoidLine('balance', () => 0.5);
    expect(a).toBe(b);
  });

  it('samples across the full Balance bank over many RNG values', () => {
    // 100 RNG samples should cover most of the bank.  Confirms we hit at
    // least 4 distinct lines so the bank is actually being drawn from.
    let lcg = 1;
    const rng = () => { lcg = (lcg * 1664525 + 1013904223) % 4294967296; return lcg / 4294967296; };
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) seen.add(buildVoidLine('balance', rng));
    expect(seen.size).toBeGreaterThanOrEqual(4);
  });
});

describe('voidNarrativeShape — kind + entity id mapping', () => {
  it('maps balance → balance_whisper + BALANCE_ENTITY_ID', () => {
    expect(voidNarrativeShape('balance')).toEqual({
      kind:     BALANCE_VOID_KIND,
      entityId: BALANCE_ENTITY_ID,
    });
  });

  it('maps chaos → chaos_whisper + CHAOS_ENTITY_ID', () => {
    expect(voidNarrativeShape('chaos')).toEqual({
      kind:     CHAOS_VOID_KIND,
      entityId: CHAOS_ENTITY_ID,
    });
  });

  it('kind constants match the NewsFeedPage filter keys', () => {
    expect(BALANCE_VOID_KIND).toBe('balance_whisper');
    expect(CHAOS_VOID_KIND).toBe('chaos_whisper');
  });

  it('entity UUIDs match the cosmic_voice rows seeded in migration 0011', () => {
    expect(BALANCE_ENTITY_ID).toBe('50000000-0000-0000-0000-000000000002');
    expect(CHAOS_ENTITY_ID).toBe('50000000-0000-0000-0000-000000000003');
  });
});
