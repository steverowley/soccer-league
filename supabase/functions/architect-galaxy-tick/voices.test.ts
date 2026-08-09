// ── architect-galaxy-tick/voices.test.ts ─────────────────────────────────────
// These voices replaced LLM calls, so the tests have to cover what the model
// used to be trusted to do: stay in character, stay off the numbers, and not
// repeat itself. Variety floors are asserted explicitly — if someone trims a
// pool and the corpus quietly shrinks to a handful of lines, this fails.

import { describe, it, expect } from 'vitest';
import {
  architectWhisper,
  entityNarrative,
  focusReaction,
  mediaBuzz,
  politicalDecree,
  voiceVariety,
} from './voices.ts';

/** Every voice, wrapped to a single (key) → line signature for shared checks. */
const VOICES: ReadonlyArray<{ name: string; render: (key: string) => string }> = [
  { name: 'architectWhisper', render: (k) => architectWhisper(k) },
  { name: 'focusReaction',    render: (k) => focusReaction(k, 'Earth United FC', 'Sign a Star Player') },
  { name: 'politicalDecree',  render: (k) => politicalDecree(k, 'Mars') },
  { name: 'mediaBuzz',        render: (k) => mediaBuzz(k) },
  { name: 'entityNarrative',  render: (k) => entityNarrative(k, 'pundit') },
];

describe.each(VOICES)('$name', ({ render }) => {
  it('returns the same line for the same key', () => {
    expect(render('2600-08-09:alpha')).toBe(render('2600-08-09:alpha'));
  });

  it('returns a different line for a different key', () => {
    const lines = new Set(Array.from({ length: 25 }, (_, i) => render(`key-${i}`)));
    expect(lines.size).toBeGreaterThan(15);
  });

  it('never leaves an unresolved slot or placeholder', () => {
    for (let i = 0; i < 200; i++) {
      const line = render(`scan-${i}`);
      expect(line).not.toMatch(/[{}<>[\]]/);
      expect(line).not.toContain('undefined');
    }
  });

  it('never leaks a number — the world is treated like real life', () => {
    for (let i = 0; i < 200; i++) {
      expect(render(`digits-${i}`)).not.toMatch(/\d/);
    }
  });

  it('reads as finished prose', () => {
    for (let i = 0; i < 100; i++) {
      const line = render(`prose-${i}`);
      expect(line.length).toBeGreaterThan(20);
      expect(line).toMatch(/[.!?]$/);
      // No doubled spaces or space-before-punctuation left by dropped sections.
      expect(line).not.toMatch(/ {2}| [,.;:]/);
    }
  });
});

describe('context threading', () => {
  it('names the club and the focus the fans actually voted for', () => {
    for (let i = 0; i < 50; i++) {
      const line = focusReaction(`t-${i}`, 'Pluto FC Wanderers', 'Promote Youth');
      expect(line).toContain('Pluto FC Wanderers');
      expect(line.toLowerCase()).toContain('promote youth');
    }
  });

  it('threads the official’s homeworld into their rhetoric', () => {
    // Only some templates reach for the homeworld, so assert across a spread.
    const lines = Array.from({ length: 40 }, (_, i) => politicalDecree(`p-${i}`, 'Ceres'));
    expect(lines.some((l) => l.includes('Ceres'))).toBe(true);
  });

  it('shifts register with the entity kind', () => {
    const key = 'same-key-different-voice';
    const pundit = entityNarrative(key, 'pundit');
    const bookie = entityNarrative(key, 'bookie');
    expect(pundit).not.toBe(bookie);
  });

  it('falls back to the pundit register for an unknown entity kind', () => {
    expect(entityNarrative('k', 'astrologer')).toBe(entityNarrative('k', 'pundit'));
  });
});

describe('variety budget', () => {
  it('gives every voice thousands of distinct lines', () => {
    const variety = voiceVariety();
    for (const [voice, count] of Object.entries(variety)) {
      // The old LLM fallbacks were three-line arrays. The floor here is what
      // makes the deterministic layer indistinguishable from improvisation.
      expect(count, `${voice} has only ${count} variants`).toBeGreaterThan(5_000);
    }
  });

  it('produces almost no collisions across a season-sized sample', () => {
    // The claim that matters to a reader: a season of daily Dispatch entries
    // should not visibly repeat. 500 draws is a couple of seasons of whispers;
    // against a corpus this size the birthday-paradox collision rate is a few
    // per thousand, so >96% distinct is the honest bar.
    const sample = 500;
    const seen = new Set(Array.from({ length: sample }, (_, i) => architectWhisper(`s-${i}`)));
    expect(seen.size).toBeGreaterThan(sample * 0.96);
  });
});
