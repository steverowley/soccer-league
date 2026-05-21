// ── composerRefereeDemo.test.ts ────────────────────────────────────────────
// Smoke demonstration that `composeNarrative` produces the same shape of
// finished string the existing `refereeNarratives.ts` template bank does.
//
// WHY THIS TEST EXISTS
//   The existing referee narrative system (src/features/entities/logic/
//   refereeNarratives.ts) uses inline `(snap) => string` template functions.
//   Phase 1 of the agent plan introduces `composeNarrative({skeleton, slots})`
//   which expresses the same idea declaratively — skeleton string +
//   pre-computed slot values.  This test proves the composer can replicate
//   the existing referee-style output without claiming feature parity
//   (the existing implementation stays intact for now; full migration is
//   tracked under bd isl-bqx.6 / Phase 5 once snippets are seeded for refs).
//
// SCOPE: a single representative line per pattern (controversial / heavy-
// handed / permissive / unremarkable).  These are the same skeleton strings
// the production templates would migrate to when the referee corpus is
// seeded — proves nothing in the composer prevents that future shift.

import { describe, expect, it } from 'vitest';

import { composeNarrative } from './composer';

// ── Representative skeletons ────────────────────────────────────────────────
// One per officiating pattern, lifted from `refereeNarratives.ts` and
// expressed as composer skeletons.  The slot names match the documented
// fields on `RefereeMatchSnapshot`.

const CONTROVERSIAL_SKELETON =
  '${refereeName} produced ${totalCards} cards in a match that will be argued over for some time. The decisions were the story.';

const HEAVY_HANDED_SKELETON =
  '${refereeName} reminded the field of what their reputation suggested. ${bookings} by the final whistle.';

const PERMISSIVE_SKELETON =
  '${refereeName} let the match breathe. No cards, no fuss — the game was the story.';

const UNREMARKABLE_SKELETON =
  '${refereeName} officiated without controversy. The match decided itself.';

// ── Tests ──────────────────────────────────────────────────────────────────

describe('composeNarrative — referee-style integration smoke', () => {
  /**
   * Controversial: ref name + total card count interpolated.  Confirms
   * the composer's slot mechanic produces the same finished line as the
   * existing template would for a 7-card match.
   */
  it('renders a controversial line with ref + card count', () => {
    const summary = composeNarrative({
      skeleton: CONTROVERSIAL_SKELETON,
      slots: { refereeName: 'Orion Blackwood', totalCards: 7 },
    });
    expect(summary).toBe(
      'Orion Blackwood produced 7 cards in a match that will be argued over for some time. The decisions were the story.',
    );
  });

  /**
   * Heavy-handed: pre-computed pluralised label ("3 bookings" vs "1 booking")
   * is passed as a single slot so the composer doesn't need template-side
   * branching.  Demonstrates the workaround for pluralisation logic that
   * the corpus model leaves outside the skeleton.
   */
  it('renders a heavy-handed line with pre-computed pluralisation', () => {
    const yellowCards: number = 3;
    const bookings = `${yellowCards} booking${yellowCards !== 1 ? 's' : ''}`;
    const summary = composeNarrative({
      skeleton: HEAVY_HANDED_SKELETON,
      slots: { refereeName: 'Vega Castellano', bookings },
    });
    expect(summary).toBe(
      'Vega Castellano reminded the field of what their reputation suggested. 3 bookings by the final whistle.',
    );
  });

  /** Permissive: only the ref name interpolates; no count slot. */
  it('renders a permissive line with no card data', () => {
    const summary = composeNarrative({
      skeleton: PERMISSIVE_SKELETON,
      slots: { refereeName: 'Capella Rivera' },
    });
    expect(summary).toBe(
      'Capella Rivera let the match breathe. No cards, no fuss — the game was the story.',
    );
  });

  /** Unremarkable: ref name only — the default-fallback case. */
  it('renders an unremarkable line', () => {
    const summary = composeNarrative({
      skeleton: UNREMARKABLE_SKELETON,
      slots: { refereeName: 'Polaris Mensah' },
    });
    expect(summary).toBe(
      'Polaris Mensah officiated without controversy. The match decided itself.',
    );
  });
});
