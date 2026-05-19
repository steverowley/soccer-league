// ── entities/logic/refereeNarratives.ts ───────────────────────────────────────
// Phase 5a: Pure logic for post-match officiating narratives.
//
// DESIGN INTENT
// ─────────────
// After every match completion we want a single, named, opinionated line in
// the Galaxy Dispatch news feed that references the assigned referee BY
// NAME and notes the officiating tone of the match.  This is the entry point
// that wakes the entity graph for fans — Orion Blackwood becomes a recurring
// character whose strictness reputation accumulates across matches.
//
// PATTERNS DETECTED (priority order, highest drama wins):
//
//   1. controversial      — strict ref + many cards (≥ HEAVY_CARD_THRESHOLD)
//      OR a red card was issued.  Most narratively charged.
//   2. heavy_handed       — strict referee (strictness ≥ STRICT_THRESHOLD)
//                           and at least one yellow card.
//   3. permissive         — lenient ref + zero cards across both teams.
//                           "Letting them play" energy.
//   4. unremarkable       — anything else; a quiet officiating performance.
//
// VOICE TAGS
// ──────────
// Each pattern picks a voice that "noted" the line.  Following the existing
// cosmic-voice convention (Balance=2, Chaos=3) plus a new fourth slot for
// the journalism corps (4) since these narratives are press-room observations
// rather than cosmic pronouncements:
//
//   controversial → 3 (Chaos)        — drama is Chaos's domain.
//   heavy_handed  → 4 (Press)        — pundit-style noting.
//   permissive    → 4 (Press)        — pundit observing flow.
//   unremarkable  → 4 (Press)        — boilerplate match-report tone.
//
// We use voice 4 for press because that's where journalist entities will
// later author their own attributed lines.  Until then "Press" is an
// unattributed collective register.
//
// Purity: zero I/O.  Caller fetches the cards and the referee context, then
// calls buildRefereeNarrative() and writes the result to `narratives`.
// ──────────────────────────────────────────────────────────────────────────────

// ── Pattern thresholds ────────────────────────────────────────────────────────

/**
 * Minimum strictness value (1-10 scale, see migration 0002) that qualifies a
 * referee as "strict" for narrative purposes.  At 7 we capture the top ~30%
 * of the corps — strict enough to be unusual without being a daily occurrence.
 */
export const STRICT_THRESHOLD = 7;

/**
 * Maximum strictness value that qualifies as "lenient".  At 4 we capture the
 * bottom ~30% of the corps.  Mirrors STRICT_THRESHOLD symmetrically so the
 * "permissive" and "heavy_handed" patterns roughly balance in long-run output.
 */
export const LENIENT_THRESHOLD = 4;

/**
 * Number of total cards (yellow + red, both teams combined) above which the
 * match counts as a "card-heavy" affair worth controversial framing.  Five
 * matches mean either both teams got booked twice and one player walked, or
 * a single ill-tempered cluster of fouls forced the referee's hand.
 */
export const HEAVY_CARD_THRESHOLD = 5;

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * Officiating snapshot for one match.  All fields aggregate counts; no
 * player or user identifiers.  This shape matches what the post-match
 * narrative listener can derive from `match_player_stats` joined with the
 * match_referee_v view in a single query.
 */
export interface RefereeMatchSnapshot {
  /** Display-friendly name to mention in the line (e.g. "Orion Blackwood"). */
  refereeName: string;
  /** 1=lenient … 10=strict.  Drives pattern detection. */
  refereeStrictness: number;
  /** Total yellow cards across both teams. */
  yellowCards: number;
  /** Total red cards across both teams. */
  redCards: number;
  /** Optional friendly home-team label for narrative interpolation. */
  homeTeamName?: string;
  /** Optional friendly away-team label for narrative interpolation. */
  awayTeamName?: string;
}

/** Officiating-pattern union used for pattern → voice → template routing. */
export type RefereePattern =
  | 'controversial'
  | 'heavy_handed'
  | 'permissive'
  | 'unremarkable';

/**
 * Voice index that authored the narrative.
 *   2 = Balance, 3 = Chaos (existing cosmic voices)
 *   4 = Press (collective journalism corps; will become attributed in Phase 5b)
 */
export type RefereeNarrativeVoice = 3 | 4;

// ── Pattern detection ─────────────────────────────────────────────────────────

/**
 * Detect the most dramatic officiating pattern in a match snapshot.
 *
 * Priority order (highest drama first):
 *   1. controversial — any red card OR a strict ref + heavy card count.
 *      Red cards are always controversial regardless of strictness, because
 *      a sending-off is the sharpest single officiating decision in the game.
 *   2. heavy_handed  — strict ref AND at least one yellow card.  The ref's
 *      reputation showed up; cards back it.
 *   3. permissive    — lenient ref AND zero cards.  Game flowed.
 *   4. unremarkable  — fallback.
 *
 * @param snap  Aggregate match officiating snapshot.
 * @returns     The single most-dramatic applicable pattern.
 */
export function detectRefereePattern(snap: RefereeMatchSnapshot): RefereePattern {
  const totalCards = snap.yellowCards + snap.redCards;

  // Red card OR (strict + heavy card count) → controversial.
  if (snap.redCards > 0) return 'controversial';
  if (snap.refereeStrictness >= STRICT_THRESHOLD && totalCards >= HEAVY_CARD_THRESHOLD) {
    return 'controversial';
  }
  // Strict ref + at least one booking → heavy-handed.
  if (snap.refereeStrictness >= STRICT_THRESHOLD && snap.yellowCards >= 1) {
    return 'heavy_handed';
  }
  // Lenient ref + zero cards → permissive.
  if (snap.refereeStrictness <= LENIENT_THRESHOLD && totalCards === 0) {
    return 'permissive';
  }
  return 'unremarkable';
}

// ── Voice assignment ──────────────────────────────────────────────────────────

/**
 * Map an officiating pattern to the cosmic / press voice that "noted" it.
 *
 * Chaos covers controversial only — drama is Chaos's territory.  Everything
 * else routes to the Press collective (voice 4) which is a placeholder for
 * the journalist roster's eventual attributed bylines (Phase 5b).
 *
 * @param pattern  The detected officiating pattern.
 * @returns        Voice index — 3 (Chaos) or 4 (Press).
 */
export function pickRefereeNarrativeVoice(
  pattern: RefereePattern,
): RefereeNarrativeVoice {
  if (pattern === 'controversial') return 3;
  return 4;
}

// ── Template banks ────────────────────────────────────────────────────────────
//
// Each pattern has 3-5 templates.  Random pick at generation time.
// Template signature: (snap) => string.  Where a template doesn't reference
// snapshot fields, the parameter is prefixed `_snap` to satisfy lint.

type RefereeTemplate = (s: RefereeMatchSnapshot) => string;

const REFEREE_TEMPLATES: Record<RefereePattern, RefereeTemplate[]> = {

  // ── Controversial ──────────────────────────────────────────────────────────
  // Red cards or strict-ref + heavy-cards combos.  Allowed to name the ref.
  controversial: [
    s => `${s.refereeName} produced ${s.yellowCards + s.redCards} cards in a match that will be argued over for some time. The decisions were the story.`,
    s => `An officiating performance from ${s.refereeName} that the broadcast found increasingly difficult to ignore. ${s.redCards} sent off${s.redCards === 1 ? '' : ''}; the rest of the match played out around the gap.`,
    s => `${s.refereeName} took out the cards early and never put them away. Players, managers, and crowds all had something to say. The referee did not.`,
    s => `A loaded officiating ledger: ${s.yellowCards} yellow${s.yellowCards !== 1 ? 's' : ''}, ${s.redCards} red${s.redCards !== 1 ? 's' : ''}, and ${s.refereeName}'s name in the final report several times more than usual.`,
  ],

  // ── Heavy-handed ───────────────────────────────────────────────────────────
  // Strict ref + at least one card.  Press-tone observation, not cosmic drama.
  heavy_handed: [
    s => `${s.refereeName} reminded the field of what their reputation suggested. ${s.yellowCards} booking${s.yellowCards !== 1 ? 's' : ''} by the final whistle.`,
    s => `A tight officiating performance from ${s.refereeName}. Players adjusted; some of them too late.`,
    s => `${s.refereeName} did not let small things slide today. Whistle was busy throughout.`,
    s => `${s.refereeName}'s strictness was on display. ${s.yellowCards + s.redCards} cards to confirm the prior.`,
  ],

  // ── Permissive ─────────────────────────────────────────────────────────────
  // Lenient ref + zero cards.  Game-flowed energy.
  permissive: [
    s => `${s.refereeName} let the match breathe. No cards, no fuss — the game was the story.`,
    s => `An almost invisible officiating performance from ${s.refereeName}. The whistle stayed quiet; the players stayed up.`,
    s => `${s.refereeName} kept the cards in the pocket. Both sides played to it.`,
    s => `Free-flowing 90 minutes under ${s.refereeName}. The referee will not be quoted in tomorrow's papers.`,
  ],

  // ── Unremarkable ───────────────────────────────────────────────────────────
  // Default fallback — quiet competent shift.  Press tone.
  unremarkable: [
    s => `${s.refereeName} officiated without controversy. The match decided itself.`,
    s => `A standard performance from ${s.refereeName}. ${s.yellowCards + s.redCards} card${s.yellowCards + s.redCards !== 1 ? 's' : ''} issued; nothing of note.`,
    s => `${s.refereeName} called the match without drawing the broadcast's attention. As intended.`,
  ],
};

// ── Public assembly ──────────────────────────────────────────────────────────

/**
 * Build the final 1-2 sentence officiating narrative line.
 *
 * Picks the most dramatic applicable pattern, selects a random template from
 * that pattern's bank, and interpolates the snapshot fields.  Returns the
 * generated string — caller is responsible for writing to the `narratives`
 * table.
 *
 * @param snap  Match officiating snapshot.
 * @param rng   Optional deterministic RNG for tests; defaults to Math.random.
 * @returns     A complete narrative summary line, ready to insert.
 */
export function buildRefereeNarrative(
  snap: RefereeMatchSnapshot,
  rng: () => number = Math.random,
): string {
  const pattern = detectRefereePattern(snap);
  const bank    = REFEREE_TEMPLATES[pattern] ?? REFEREE_TEMPLATES.unremarkable;
  // Defensive fallback to bank[0] guarantees a defined template under
  // noUncheckedIndexedAccess; bank is always non-empty by construction.
  const template = bank[Math.floor(rng() * bank.length)] ?? bank[0];
  if (!template) return '';
  return template(snap);
}
