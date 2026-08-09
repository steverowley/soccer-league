// ── shared/narrative/grammar.test.ts ─────────────────────────────────────────
// The grammar engine is what replaced the LLM voices, so these tests pin the
// two properties the replacement rests on: every line is reproducible from its
// seed, and the space of possible lines is large enough that a reader never
// notices the world is running off templates.

import { describe, it, expect } from 'vitest';
import {
  expand,
  rngFor,
  seedFromString,
  totalVariants,
  variantCount,
  type Lexicon,
} from './grammar';

const LEXICON: Lexicon = {
  opener: ['The cosmos stirs', 'Something turned over', 'A seam opened'],
  mood: ['quietly', 'without warning', 'again'],
  coda: ['{mood}, and no one looked up', 'and the hour went unrecorded'],
};

describe('seedFromString', () => {
  it('is stable for the same input', () => {
    expect(seedFromString('match-42:17')).toBe(seedFromString('match-42:17'));
  });

  it('separates keys that differ by one character', () => {
    expect(seedFromString('match-42:17')).not.toBe(seedFromString('match-42:18'));
  });

  it('stays inside the unsigned 32-bit range', () => {
    for (const key of ['', 'a', 'Great Red FC', '💫', 'x'.repeat(500)]) {
      const seed = seedFromString(key);
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe('expand', () => {
  it('produces the same line for the same key', () => {
    const line = () => expand('{opener} {mood}.', LEXICON, rngFor('seed-a'));
    expect(line()).toBe(line());
  });

  it('produces different lines for different keys', () => {
    const lines = new Set(
      Array.from({ length: 30 }, (_, i) =>
        expand('{opener} {mood}.', LEXICON, rngFor(`seed-${i}`)),
      ),
    );
    // 3 openers x 3 moods = 9 possible; 30 draws should find most of them.
    expect(lines.size).toBeGreaterThan(4);
  });

  it('resolves slots nested inside pool fragments', () => {
    // `coda` contains `{mood}`, which must itself expand.
    const line = expand('{coda}.', LEXICON, rngFor('nested'));
    expect(line).not.toMatch(/[{}]/);
  });

  it('substitutes <vars> and never rescans their content as grammar', () => {
    // A club whose name contains grammar punctuation must survive verbatim.
    const line = expand('<team> {mood}.', LEXICON, rngFor('vars'), {
      team: 'Great {Red} FC',
    });
    expect(line).toContain('Great {Red} FC');
  });

  it('leaves an unknown slot in place rather than emitting undefined', () => {
    const line = expand('{nope} {mood}.', LEXICON, rngFor('unknown'));
    expect(line).toContain('{nope}');
    expect(line).not.toContain('undefined');
  });

  it('includes and drops [optional] sections, cleaning up the punctuation', () => {
    const seen = new Set(
      Array.from({ length: 40 }, (_, i) =>
        expand('The hour turned[, {mood}].', LEXICON, rngFor(`opt-${i}`)),
      ),
    );
    expect([...seen].some((l) => l === 'The hour turned.')).toBe(true);
    expect([...seen].some((l) => l.includes(','))).toBe(true);
    // No stranded space before the full stop when the section is dropped.
    expect([...seen].every((l) => !l.includes(' .'))).toBe(true);
  });

  it('capitalises a lower-cased fragment that lands after a full stop', () => {
    // `{mood}` is lower-cased for mid-clause use; here it opens a sentence.
    const line = expand('The hour turned. {mood} it went.', LEXICON, rngFor('case'));
    expect(line).toMatch(/\. [A-Z]/);
  });

  it('leaves a lower-cased fragment alone mid-sentence', () => {
    const line = expand('It turned, {mood}.', LEXICON, rngFor('midcase'));
    expect(line).toMatch(/, [a-z]/);
  });

  it('terminates on a self-referential lexicon instead of hanging', () => {
    const cyclic: Lexicon = { a: ['{b}'], b: ['{a}'] };
    const line = expand('{a}', cyclic, rngFor('cycle'));
    expect(typeof line).toBe('string');
  });
});

describe('variantCount', () => {
  it('multiplies independent slots', () => {
    // opener (3) x mood (3) = 9.
    expect(variantCount('{opener} {mood}', LEXICON)).toBe(9);
  });

  it('counts nested pools through their fragments', () => {
    // coda = one fragment carrying {mood} (3) + one plain fragment (1) = 4.
    expect(variantCount('{coda}', LEXICON)).toBe(4);
  });

  it('treats an [optional] section as an extra branch', () => {
    // present (3 moods) + absent (1) = 4.
    expect(variantCount('[{mood}]', LEXICON)).toBe(4);
  });

  it('sums alternatives in a {a|b} slot', () => {
    expect(variantCount('{opener|mood}', LEXICON)).toBe(6);
  });

  it('sums across a template set', () => {
    expect(totalVariants(['{opener}', '{mood}'], LEXICON)).toBe(6);
  });
});
