// ── composer.test.ts ────────────────────────────────────────────────────────
// Unit tests for the pure narrative composer in `composer.ts`.  The
// composer is the second leg of the voice-corpus pipeline (after
// `pickSnippet`); these tests pin down its placeholder substitution
// contract so future callers can rely on the same guarantees the existing
// referee-narrative template bank does.
//
// Test focus areas:
//   1. Substitution — `${name}` placeholders are replaced from `slots`.
//   2. Safety — missing / null / undefined slots collapse to empty string
//      instead of emitting literal "${undefined}" into user-facing text.
//   3. Utility — `slotNames` extracts exactly the placeholders the
//      skeleton references.

import { describe, expect, it, vi } from 'vitest';

import { composeNarrative, slotNames } from './composer';

// ── composeNarrative ────────────────────────────────────────────────────────

describe('composeNarrative', () => {
  /** A skeleton with no placeholders passes through untouched. */
  it('returns the skeleton verbatim when there are no placeholders', () => {
    const result = composeNarrative({
      skeleton: 'A quiet match. No cards, no complaints.',
      slots: {},
    });
    expect(result).toBe('A quiet match. No cards, no complaints.');
  });

  /**
   * Single string slot substitution — verifies the happy path and that
   * the literal `${ref}` syntax is matched correctly.
   */
  it('substitutes a single string slot', () => {
    const result = composeNarrative({
      skeleton: '${ref} produced 4 cards.',
      slots: { ref: 'Orion Blackwood' },
    });
    expect(result).toBe('Orion Blackwood produced 4 cards.');
  });

  /**
   * Numeric slots are coerced to string so authors can pass card counts
   * without manual `.toString()` boilerplate.
   */
  it('coerces number slots to string', () => {
    const result = composeNarrative({
      skeleton: '${ref} produced ${cards} cards.',
      slots: { ref: 'Orion Blackwood', cards: 4 },
    });
    expect(result).toBe('Orion Blackwood produced 4 cards.');
  });

  /**
   * The same placeholder repeated must substitute every occurrence —
   * proves the regex's /g flag is wired correctly.
   */
  it('replaces every occurrence of a repeated placeholder', () => {
    const result = composeNarrative({
      skeleton: '${ref} arrived. ${ref} left. ${ref} returned.',
      slots: { ref: 'Vega Castellano' },
    });
    expect(result).toBe('Vega Castellano arrived. Vega Castellano left. Vega Castellano returned.');
  });

  /**
   * SAFETY — a missing slot must collapse to empty, never render
   * "${undefined}" or "${slot-name}" into the published narrative.  Also
   * verifies the console.warn signal is emitted so callers can spot the
   * bug in dev.
   */
  it('collapses missing slots to empty + warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = composeNarrative({
      skeleton: '${ref} produced ${cards} cards.',
      slots: { ref: 'Orion Blackwood' }, // cards missing
    });
    expect(result).toBe('Orion Blackwood produced  cards.');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  /** Explicit null slot collapses identically to missing slot. */
  it('collapses null slots to empty', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = composeNarrative({
      skeleton: '${ref} stepped onto the pitch.',
      slots: { ref: null },
    });
    expect(result).toBe(' stepped onto the pitch.');
    warn.mockRestore();
  });

  /** Empty skeleton returns empty string (defensive, no crash). */
  it('returns empty string for an empty skeleton', () => {
    expect(composeNarrative({ skeleton: '', slots: { ref: 'X' } })).toBe('');
  });
});

// ── slotNames ───────────────────────────────────────────────────────────────

describe('slotNames', () => {
  /** Skeleton with no placeholders yields an empty list. */
  it('returns empty array for a placeholder-free skeleton', () => {
    expect(slotNames('A quiet line.')).toEqual([]);
  });

  /** Standard case — collects placeholders in first-appearance order. */
  it('extracts placeholders in first-appearance order', () => {
    expect(slotNames('${ref} produced ${cards} cards. ${ref} departed.'))
      .toEqual(['ref', 'cards']);
  });

  /** Duplicates are returned only once — useful for slot-map validation. */
  it('deduplicates repeated placeholders', () => {
    expect(slotNames('${a} ${a} ${b} ${a} ${b}')).toEqual(['a', 'b']);
  });
});
