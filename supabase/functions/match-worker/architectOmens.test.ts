// ── match-worker/architectOmens.test.ts ──────────────────────────────────────
// The omen and the match title are part of a fixture's permanent record, so
// the property that matters most is stability: reading a match twice must not
// rename it. The old fallback failed exactly that — it rolled Math.random on
// every call, out of a pool of six.

import { describe, it, expect } from 'vitest';
import { architectMatchTitle, architectOmen, omenVariety } from './architectOmens.ts';

const MATCH = '3f2a91c4-77b8-4e2d-9a10-5c6d8e0f1234';

describe('a fixture keeps its omen and its name', () => {
  it('returns the same omen every time it is asked', () => {
    expect(architectOmen(MATCH, false)).toBe(architectOmen(MATCH, false));
  });

  it('returns the same title every time it is asked', () => {
    expect(architectMatchTitle(MATCH)).toBe(architectMatchTitle(MATCH));
  });

  it('gives different fixtures different omens and names', () => {
    const other = '9b7c1d0e-1111-4222-8333-444455556666';
    expect(architectOmen(other, false)).not.toBe(architectOmen(MATCH, false));
    expect(architectMatchTitle(other)).not.toBe(architectMatchTitle(MATCH));
  });
});

describe('rivalry shifts the register', () => {
  it('acknowledges history when the clubs have met before', () => {
    expect(architectOmen(MATCH, true)).not.toBe(architectOmen(MATCH, false));
  });

  it('reaches for memory language on a rivalry, across a spread of fixtures', () => {
    const rivalryLines = Array.from({ length: 40 }, (_, i) => architectOmen(`r-${i}`, true));
    // Every rivalry template opens from the `memory` pool, so the whole spread
    // should carry that register rather than the generic portents.
    const memoryish = rivalryLines.filter((l) =>
      /met before|thread|not the first|debt|unfinished|last meeting|left behind|rematch/i.test(l),
    );
    expect(memoryish.length).toBe(rivalryLines.length);
  });
});

describe('output quality', () => {
  it('reads as finished prose with no numbers or markup', () => {
    for (let i = 0; i < 200; i++) {
      for (const line of [architectOmen(`q-${i}`, i % 2 === 0), architectMatchTitle(`q-${i}`)]) {
        expect(line).not.toMatch(/[{}<>[\]]/);
        expect(line).not.toMatch(/\d/);
        expect(line).not.toContain('undefined');
      }
    }
  });

  it('keeps titles to a headline length', () => {
    for (let i = 0; i < 100; i++) {
      const words = architectMatchTitle(`t-${i}`).split(' ');
      expect(words.length).toBeGreaterThanOrEqual(3);
      expect(words.length).toBeLessThanOrEqual(5);
    }
  });
});

describe('variety budget', () => {
  it('replaces six omens and eight titles with a real corpus', () => {
    const variety = omenVariety();
    expect(variety['omen'], 'omens').toBeGreaterThan(1_000);
    expect(variety['rivalry'], 'rivalry omens').toBeGreaterThan(1_000);
    // Titles are short by design, so the ceiling is lower — but two orders of
    // magnitude past the eight a whole archive of matches used to share.
    expect(variety['title'], 'titles').toBeGreaterThan(200);
  });
});
