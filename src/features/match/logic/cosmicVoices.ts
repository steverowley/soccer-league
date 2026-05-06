// ── features/match/logic/cosmicVoices.ts ─────────────────────────────────────
//
// CosmicVoiceEngine — the Second Voice (Balance) and Third Voice (Chaos).
//
// DESIGN INTENT
// ─────────────
// The Cosmic Architect (First Voice / Fate) already has its own proclamation
// system in CosmicArchitect.ts.  This module adds two additional presences that
// can intrude on any match minute without being triggered by specific events.
//
// Core principle: cosmic horrors do what they want.  Neither voice has an
// event-trigger mask.  Instead, each carries a floating `interestLevel` that
// drifts stochastically each minute.  When the level crosses a threshold AND
// a random roll fires, the voice speaks.  Sometimes it speaks about the goal
// that just happened; sometimes it speaks about a free kick; sometimes it
// speaks about nothing the broadcast was following.  That unpredictability IS
// the horror.
//
// DISTINGUISHING THE VOICES
// ──────────────────────────
// Second Voice (Balance):
//   - Internal state: `equilibriumDebt` — how out-of-balance the match feels
//     to it.  Rises when scores are unequal, when card counts diverge, when
//     one team dominates possession.  Falls after comebacks and equalisers.
//   - Cadence: measured, paired declarative clauses.  Past tense.  Symmetric.
//   - Vocabulary: owed, paid, corrected, ledger, equal, weight, due.
//   - Accent: slate-blue (#64748b).
//
// Third Voice (Chaos):
//   - Internal state: `noveltyHunger` — how starved for disruption it is.
//     Rises every minute nothing surprising happens; drops sharply when an
//     improbable event fires (own goal, Architect interference, big upset).
//   - Cadence: jagged fragments, repetition, present tense, mid-sentence pivots.
//   - Vocabulary: wrong, unexpected, turn, finally, more, good.
//   - Accent: amber (#f59e0b).
//
// TEMPLATE APPROACH
// ──────────────────
// For Phase 1, voices use static hand-written template banks rather than LLM
// generation.  This keeps them fast, deterministic, and voice-consistent.
// Templates are parameterised where useful (player name, score) but most are
// context-free — they work at any moment, which matches the "speaks about
// whatever it notices" design.
//
// LLM generation for cosmic voices is planned for Phase 1.5 once the pattern
// is proven.
//
// ENTITY REFERENCE
// ─────────────────
// Second Voice entity UUID: 50000000-0000-0000-0000-000000000002
// Third Voice entity UUID:  50000000-0000-0000-0000-000000000003
// (seeded in migration 0011_voices.sql)

import type { MatchEvent, CosmicVoiceItem } from '../types';

// ── Entity IDs ────────────────────────────────────────────────────────────────
// Stable UUIDs seeded by migration 0011_voices.sql.
// The First Voice entity ID lives in CosmicArchitect.FIRST_VOICE_ENTITY_ID —
// not here — because CosmicArchitect is its runtime manifestation.
// These IDs are reserved for future Phase 5.1 DB lore hydration so Balance and
// Chaos can accumulate cross-match narrative arcs in the entities table.

/** Entity UUID for the Second Voice (Balance) — seeded in migration 0011. */
export const BALANCE_ENTITY_ID = '50000000-0000-0000-0000-000000000002';

/** Entity UUID for the Third Voice (Chaos) — seeded in migration 0011. */
export const CHAOS_ENTITY_ID = '50000000-0000-0000-0000-000000000003';

// ── Voice accent colours ──────────────────────────────────────────────────────
// Used exclusively for the 2px left border in CosmicVoiceCard.
// Never used as background or header colour — just a whisper of difference.

/** Slate-blue accent for the Second Voice (Balance). */
const BALANCE_COLOR = '#64748b';

/** Amber accent for the Third Voice (Chaos). */
const CHAOS_COLOR = '#f59e0b';

// ── Speech probability thresholds ────────────────────────────────────────────

/**
 * A voice only rolls for speech when its interestLevel exceeds this threshold.
 * 0.55 was chosen so voices are silent for the majority of minutes but can
 * fire in any phase of the match.  Lower = more frequent; higher = rarer.
 */
const INTEREST_SPEECH_THRESHOLD = 0.55;

/**
 * Given interestLevel > threshold, this is the per-event probability of
 * actually speaking.  0.13 means a voice at full interest (1.0) speaks on
 * ~13% of events.  At threshold (0.55) the effective rate is ~7%.
 * Keeps voices from flooding the feed while still feeling unpredictable.
 */
const SPEECH_ROLL_PROBABILITY = 0.13;

/**
 * Minimum match minutes that must pass between two speeches from the same
 * voice.  Prevents bursts where both voices fire on consecutive events.
 * 6 minutes = roughly one full event cycle at normal simulation speed.
 */
const MIN_MINUTES_BETWEEN_SPEECHES = 6;

/**
 * Maximum number of times a single voice can speak per match.
 * Randomised per voice at construction time in range [MIN_SPEECHES, MAX_SPEECHES].
 */
const MIN_SPEECHES_PER_MATCH = 2;
const MAX_SPEECHES_PER_MATCH = 5;

// ── Interest level drift constants ────────────────────────────────────────────

/**
 * Each tick (event), the voice's interest level drifts by a random amount in
 * [-DRIFT_RANGE, +DRIFT_RANGE].  0.07 produces a slow random walk that can
 * meaningfully shift the voice's mood over a 90-minute match without spiking.
 */
const INTEREST_DRIFT_RANGE = 0.07;

/**
 * When Balance's equilibriumDebt is high (>= this threshold), its interest
 * level receives an additional +0.08 boost per tick — the cosmos is drawn to
 * attend to the imbalance.
 */
const BALANCE_DEBT_ATTENTION_THRESHOLD = 2;

/**
 * When Chaos's noveltyHunger is high (>= this threshold), its interest level
 * receives an additional +0.10 boost — it grows restless with predictability.
 */
const CHAOS_HUNGER_ATTENTION_THRESHOLD = 6;

/**
 * How much equilibriumDebt shifts after an equaliser or a red card that
 * matches card counts.  Negative = debt reduced (balance restored).
 */
const BALANCE_DEBT_RESTORATION = -1.5;

/**
 * How much equilibriumDebt rises each minute the score is unequal.
 * 0.3 means a 3-goal deficit accumulates ~2.7 debt over 9 minutes.
 */
const BALANCE_DEBT_ACCRUAL = 0.3;

/**
 * How much noveltyHunger rises each uneventful minute (no goal, no card,
 * no Architect interference).  1.0 means after ~6 quiet minutes Chaos
 * crosses its attention threshold and starts considering speaking.
 */
const CHAOS_HUNGER_ACCRUAL = 1.0;

/**
 * How much noveltyHunger drops when something genuinely surprising happens.
 * Negative = sated (interest drops after getting what it wanted).
 */
const CHAOS_HUNGER_SATED = -4.0;

// ── Template banks ────────────────────────────────────────────────────────────
//
// Templates are grouped by context category.  When a voice speaks, it picks
// the most fitting category based on the current event and match state.  If
// no specific category fits, it falls back to `generic`.
//
// WRITING GUIDE FOR VOICE AUTHORS:
//   Balance lines must feel like an accounting.  Short.  Paired.  The cosmos
//   noting what is owed and what has been paid.  Past tense preferred.
//   Never excited.  Never horrified.  Just — noting.
//
//   Chaos lines must feel like a predator noticing its prey did something
//   unexpected.  Fragments.  Repetition.  Sometimes a single word.  Present
//   tense.  Gleeful at wrong outcomes; contemptuous of predictable ones.
//   Never sad.  Never measured.
//
// Each array must have at least 4 entries to ensure sufficient variety.

// ── Second Voice (Balance) template banks ─────────────────────────────────────

/**
 * Spoken when the score becomes level — the cosmic ledger has been balanced.
 * Strongest signal; Balance is most interested in these moments.
 */
const BALANCE_LEVEL_SCORE: string[] = [
  'It owed. It paid.',
  'The ledger required this. The ledger is satisfied.',
  'Equal. For now.',
  'The debt was noted. The debt is settled.',
  'An accounting was due. An accounting arrived.',
  'What was taken has been returned.',
  'The scales consider the new weight. They find it acceptable.',
  'Seventeen minutes of imbalance. Corrected.',
];

/**
 * Spoken when a trailing team scores but the game is still unequal —
 * the debt is reducing, but not yet paid.
 */
const BALANCE_PARTIAL_RESTORATION: string[] = [
  'One is owed. One has arrived. More are owed.',
  'The distance narrows. The scales consider.',
  'A first payment. The ledger remains open.',
  'Closer. Not close enough.',
  'The correction has begun. It is not finished.',
  'Something is being returned. Slowly.',
  'The gap shrinks. The debt persists.',
  'Progress toward balance. The cosmos notes it without enthusiasm.',
];

/**
 * Spoken when the score gap is 3 or greater — deep imbalance.
 * Balance may speak here out of distress at the accumulating debt.
 */
const BALANCE_BLOWOUT: string[] = [
  'The weight on one side is becoming difficult to ignore.',
  'Three-nil. The ledger grows heavy.',
  'Imbalance compounds. Something will correct this.',
  'The disparity accumulates interest.',
  'Too much on one side. Too long.',
  'The cosmos does not enjoy this arithmetic.',
  'This is not equilibrium. This is not close to equilibrium.',
  'The scales are strained. They will not remain this way.',
];

/**
 * Spoken after a red card — the playing field has shifted, creating a new
 * imbalance (or restoring one, if cards were unequal before).
 */
const BALANCE_CARD: string[] = [
  'One removed from the scales.',
  'The shape of this match has changed.',
  'Ten against eleven. An asymmetry the cosmos will track.',
  'Removed. The ledger notes the new weight.',
  'The numbers are no longer equal. They rarely stay that way.',
  'Something has been taken from one side. Something may be returned from the other.',
];

/**
 * Fallback for any event when Balance's interest fires but no specific
 * category fits.  These work in any context — a free kick, a corner,
 * a quiet midfield exchange.
 */
const BALANCE_GENERIC: string[] = [
  'A moment of note.',
  'The accounting continues.',
  'Something was owed. We wait.',
  'The scales register.',
  'Observed. Recorded. Pending.',
  'Not yet. But the weight is there.',
  'The cosmos watches the arithmetic.',
  'Nothing has been settled. Much is owed.',
  'The ledger is longer than it appears.',
  'Balance is a direction, not a destination.',
];

// ── Third Voice (Chaos) template banks ───────────────────────────────────────

/**
 * Spoken when an underdog or unexpected team scores.
 * Chaos loves this most — the script has been torn up.
 */
const CHAOS_UPSET: string[] = [
  'Wrong. Wrong. The wrong one scored. Good.',
  'Not the one they expected. Finally.',
  'The wrong team. The wrong player. The wrong minute. Perfect.',
  'Nobody had this. Nobody. Good.',
  'The favorite did not score. The other did. Yes.',
  'Something went wrong. Something went right.',
  'Against the grain. Against all of it. Beautiful.',
  'This was not in anyone\'s plan. Especially not theirs.',
];

/**
 * Spoken when an own goal, Architect-forced event, or other self-inflicted
 * disaster occurs.  Peak Chaos satisfaction.
 */
const CHAOS_OWN_DISASTER: string[] = [
  'The ball found its own net. Perfect.',
  'Not intended. Better.',
  'They did it themselves. The cosmos didn\'t even have to try.',
  'Unwritten. Glorious. Unwritten.',
  'The wrong direction. The best direction.',
  'Against themselves. Against themselves.',
  'Nobody told it to go there. It went anyway.',
  'Their own hands. Their own net. Their own.',
];

/**
 * Spoken when VAR overturns a decision — the certainty evaporates.
 * Chaos appreciates the sudden reversal of what everyone thought they knew.
 */
const CHAOS_VAR: string[] = [
  'It counted. Then it didn\'t. Good.',
  'The certainty evaporated. Good.',
  'Rules applied. Then different rules. Yes.',
  'What was a goal is not a goal. What is reality.',
  'They celebrated. Now they don\'t. Chaos finds this acceptable.',
  'The screen says otherwise. The screen.',
  'Wrong. Then right. Then wrong. The correct sequence.',
  'Nobody knows what the correct thing is. This is progress.',
];

/**
 * Spoken when the predictable thing happens — the expected team scores,
 * the obvious result unfolds.  Chaos is contemptuous of predictability.
 */
const CHAOS_TEDIUM: string[] = [
  'The obvious thing happened. Tedious.',
  'Again. The same result. Again.',
  'Predictable. Disappointing. Predictable.',
  'Everyone knew. Everyone was right. How dull.',
  'The favorite scored. The script holds. Chaos is bored.',
  'Nothing wrong happened. Nothing.',
  'The expected. The expected. More of the expected.',
  'They got what they were supposed to get. How utterly without interest.',
];

/**
 * Fallback for any event when Chaos's interest fires but no specific
 * category fits.  These work in any context — and often feel stranger
 * for having no obvious connection to what just happened.
 */
const CHAOS_GENERIC: string[] = [
  'Wrong.',
  'More.',
  'Unexpected. Finally.',
  'Something turned.',
  'Not what was written.',
  'Good. More of this.',
  'The wrong way. The interesting way.',
  'Again. But different. Good.',
  'Against the grain. Yes.',
  'The prediction failed. The cosmos is briefly interested.',
  'Turns. More turns. Always more turns.',
  'The shape of this is now wrong. Correct.',
];

// ── Helper ───────────────────────────────────────────────────────────────────

/**
 * Picks a random element from an array of strings.
 * Inline here to avoid importing from shared utils and keep this module
 * self-contained — it is called in the hot match-simulation path.
 */
function pick(pool: string[]): string {
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── Internal state shapes ─────────────────────────────────────────────────────

/** Runtime state for a single cosmic voice across one match. */
interface CosmicVoiceState {
  /** Floating 0–1 attention/interest level.  Drifts stochastically each tick. */
  interestLevel: number;
  /** Match minute of the voice's most recent speech.  -10 at kickoff so early speech is possible. */
  lastSpokeMinute: number;
  /** Running count of speeches this match. */
  timesSpokenThisMatch: number;
  /** Per-match cap; randomised at construction so each match feels different. */
  maxSpeechesThisMatch: number;
}

/** Runtime state specific to Balance (Second Voice). */
interface BalanceState extends CosmicVoiceState {
  /**
   * Accumulated score-and-card imbalance the voice is tracking.
   * Rises when the match is lopsided; falls when parity is restored.
   * Drives additional attention-level boosts when high.
   */
  equilibriumDebt: number;
}

/** Runtime state specific to Chaos (Third Voice). */
interface ChaosState extends CosmicVoiceState {
  /**
   * How starved for disruption Chaos currently is.
   * Rises every quiet minute; drops sharply when something surprising fires.
   * Drives additional attention-level boosts when high.
   */
  noveltyHunger: number;
}

// ── CosmicVoiceEngine ─────────────────────────────────────────────────────────

/**
 * CosmicVoiceEngine — manages the Second Voice (Balance) and Third Voice
 * (Chaos) for a single match.
 *
 * One instance is created inside AgentSystem's constructor and lives for the
 * duration of the match.  On each call to `maybeInterrupt()`, the engine:
 *
 *   1. Updates both voices' internal state based on the incoming event.
 *   2. Drifts each voice's interest level stochastically.
 *   3. Rolls for speech on each voice independently.
 *   4. Returns 0, 1, or 2 CosmicVoiceItem feed items.
 *
 * The engine never writes to Supabase — persistence of cosmic voice speech
 * to the `narratives` table is handled by the caller (AgentSystem) in Phase 6
 * when the voices-in-the-void Edge Function is built.
 *
 * IMPORTANT: `maybeInterrupt()` is synchronous and fast (no await, no I/O).
 * It must remain so — it is called inside `_processEventDirect()` which runs
 * in the commentary hot-path alongside async LLM calls.
 */
export class CosmicVoiceEngine {
  private readonly balance: BalanceState;
  private readonly chaos: ChaosState;

  /**
   * Creates a new engine for one match.
   * Both voices start at a randomised interest level so no two matches open
   * the same way.  The per-match speech cap is also randomised to prevent
   * fans from predicting "the voices always speak exactly N times."
   */
  constructor() {
    // ── Initialise Balance (Second Voice) ──────────────────────────────────
    // interestLevel starts in [0.2, 0.7] — not silent, not fully engaged.
    // The match is too young for imbalance to have accumulated.
    this.balance = {
      interestLevel:          0.2 + Math.random() * 0.5,
      lastSpokeMinute:        -10,  // allows speech as early as minute 1
      timesSpokenThisMatch:   0,
      maxSpeechesThisMatch:   MIN_SPEECHES_PER_MATCH + Math.floor(Math.random() * (MAX_SPEECHES_PER_MATCH - MIN_SPEECHES_PER_MATCH + 1)),
      equilibriumDebt:        0,
    };

    // ── Initialise Chaos (Third Voice) ─────────────────────────────────────
    // interestLevel starts in [0.1, 0.6] — slightly less engaged than Balance
    // because the match has not yet had a chance to be boring.
    this.chaos = {
      interestLevel:          0.1 + Math.random() * 0.5,
      lastSpokeMinute:        -10,
      timesSpokenThisMatch:   0,
      maxSpeechesThisMatch:   MIN_SPEECHES_PER_MATCH + Math.floor(Math.random() * (MAX_SPEECHES_PER_MATCH - MIN_SPEECHES_PER_MATCH + 1)),
      noveltyHunger:          0,
    };
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Called once per match event (from AgentSystem._processEventDirect).
   * Updates internal state, drifts interest levels, and maybe returns feed
   * items for one or both voices.
   *
   * @param event     - The MatchEvent that just occurred.
   * @param minute    - Current match minute (0–90+).
   * @param homeScore - Current home team goal count.
   * @param awayScore - Current away team goal count.
   * @returns Array of 0–2 CosmicVoiceItem objects.  Empty array is the common case.
   */
  maybeInterrupt(
    event: MatchEvent,
    minute: number,
    homeScore: number,
    awayScore: number,
  ): CosmicVoiceItem[] {
    // ── Step 1: Update domain-specific internal state ──────────────────────
    this._updateBalanceState(event, homeScore, awayScore);
    this._updateChaosState(event);

    // ── Step 2: Drift both voices' interest levels ─────────────────────────
    this._driftInterest(this.balance, this.balance.equilibriumDebt >= BALANCE_DEBT_ATTENTION_THRESHOLD ? 0.08 : 0);
    this._driftInterest(this.chaos,   this.chaos.noveltyHunger    >= CHAOS_HUNGER_ATTENTION_THRESHOLD  ? 0.10 : 0);

    // ── Step 3: Roll for speech on each voice ─────────────────────────────
    const items: CosmicVoiceItem[] = [];

    const balanceLine = this._trySpeak(this.balance, minute)
      ? this._buildBalanceLine(event, homeScore, awayScore, minute)
      : null;
    if (balanceLine) items.push(balanceLine);

    const chaosLine = this._trySpeak(this.chaos, minute)
      ? this._buildChaosLine(event, homeScore, awayScore, minute)
      : null;
    if (chaosLine) items.push(chaosLine);

    return items;
  }

  // ── Private: state updaters ────────────────────────────────────────────────

  /**
   * Updates Balance's equilibriumDebt based on the current event and score gap.
   *
   * Debt accrues every tick based on score difference; equalisers and
   * matched-card events reduce it.  The debt does not directly trigger speech —
   * it only boosts interestLevel drift when high (see BALANCE_DEBT_ATTENTION_THRESHOLD).
   */
  private _updateBalanceState(
    event: MatchEvent,
    homeScore: number,
    awayScore: number,
  ): void {
    const scoreDiff = Math.abs(homeScore - awayScore);

    // Accrue debt proportional to score gap each tick.
    this.balance.equilibriumDebt += scoreDiff * BALANCE_DEBT_ACCRUAL;

    // Restore debt when the score becomes level.
    if (event.isGoal && homeScore === awayScore) {
      this.balance.equilibriumDebt = Math.max(0, this.balance.equilibriumDebt + BALANCE_DEBT_RESTORATION);
    }

    // Clamp — prevent runaway accumulation in very lopsided matches.
    this.balance.equilibriumDebt = Math.min(this.balance.equilibriumDebt, 10);
  }

  /**
   * Updates Chaos's noveltyHunger based on the current event.
   *
   * Hunger rises every quiet tick; surprising events (goals, Architect flags,
   * VAR reversals, cards) sate it temporarily.
   */
  private _updateChaosState(event: MatchEvent): void {
    const isSurprising =
      event.isGoal             ||
      event.cardType           ||
      event.isControversial    ||
      event.isVAROverturned    ||
      event.architectAnnulled  ||
      event.architectForced    ||
      event.architectConjured  ||
      event.architectStolen    ||
      event.architectEcho;

    if (isSurprising) {
      // Sate the hunger — Chaos got what it wanted (or at least something interesting).
      this.chaos.noveltyHunger = Math.max(0, this.chaos.noveltyHunger + CHAOS_HUNGER_SATED);
    } else {
      // Another quiet minute.  The hunger grows.
      this.chaos.noveltyHunger += CHAOS_HUNGER_ACCRUAL;
    }

    this.chaos.noveltyHunger = Math.min(this.chaos.noveltyHunger, 12);
  }

  // ── Private: interest drift ────────────────────────────────────────────────

  /**
   * Applies a stochastic random walk to a voice's interestLevel, plus an
   * optional domain-specific boost when the voice's signature condition is met.
   *
   * @param state - Mutable voice state to update in-place.
   * @param extraBoost - Additional positive drift to apply this tick (0 if not triggered).
   */
  private _driftInterest(state: CosmicVoiceState, extraBoost: number): void {
    const drift = (Math.random() - 0.5) * 2 * INTEREST_DRIFT_RANGE;
    state.interestLevel = Math.max(0, Math.min(1, state.interestLevel + drift + extraBoost));
  }

  // ── Private: speech gate ────────────────────────────────────────────────────

  /**
   * Determines whether a voice should speak this tick.
   * Returns true if all conditions are met:
   *   - interestLevel exceeds the threshold
   *   - random roll fires at SPEECH_ROLL_PROBABILITY
   *   - enough minutes have passed since last speech
   *   - per-match cap not exceeded
   *
   * Side effect: increments timesSpokenThisMatch and sets lastSpokeMinute
   * when returning true.
   */
  private _trySpeak(state: CosmicVoiceState, minute: number): boolean {
    if (state.interestLevel < INTEREST_SPEECH_THRESHOLD)               return false;
    if (Math.random() >= SPEECH_ROLL_PROBABILITY)                       return false;
    if (minute - state.lastSpokeMinute < MIN_MINUTES_BETWEEN_SPEECHES)  return false;
    if (state.timesSpokenThisMatch >= state.maxSpeechesThisMatch)        return false;

    state.lastSpokeMinute       = minute;
    state.timesSpokenThisMatch += 1;
    return true;
  }

  // ── Private: line builders ─────────────────────────────────────────────────

  /**
   * Picks the most contextually fitting Balance template and returns a
   * CosmicVoiceItem.  Falls back to BALANCE_GENERIC when no specific
   * category matches.
   */
  private _buildBalanceLine(
    event: MatchEvent,
    homeScore: number,
    awayScore: number,
    minute: number,
  ): CosmicVoiceItem {
    const scoreDiff = Math.abs(homeScore - awayScore);
    let pool: string[];

    if (event.isGoal && homeScore === awayScore) {
      // Equaliser — the ledger has been balanced.
      pool = BALANCE_LEVEL_SCORE;
    } else if (event.isGoal && scoreDiff === 1) {
      // Goal that made it closer but not level — partial restoration.
      pool = BALANCE_PARTIAL_RESTORATION;
    } else if (scoreDiff >= 3) {
      // Deep imbalance — Balance is distressed.
      pool = BALANCE_BLOWOUT;
    } else if (event.cardType === 'red') {
      // Red card changes the numerical balance of the match.
      pool = BALANCE_CARD;
    } else {
      pool = BALANCE_GENERIC;
    }

    return {
      type:       'cosmic_voice',
      voiceIndex: 2,
      text:       pick(pool),
      minute,
      color:      BALANCE_COLOR,
    };
  }

  /**
   * Picks the most contextually fitting Chaos template and returns a
   * CosmicVoiceItem.  Falls back to CHAOS_GENERIC when no specific
   * category matches.
   */
  private _buildChaosLine(
    event: MatchEvent,
    homeScore: number,
    awayScore: number,
    minute: number,
  ): CosmicVoiceItem {
    // Suppress unused-variable warning — homeScore/awayScore reserved for
    // future upset-detection logic (underdog identification requires team
    // pre-match ratings, not available in this module yet).
    void homeScore; void awayScore;

    let pool: string[];

    if (event.isVAROverturned || event.isControversial) {
      // VAR reversals and controversy — reality became uncertain.
      pool = CHAOS_VAR;
    } else if (
      event.architectAnnulled  ||
      event.architectForced    ||
      event.architectConjured  ||
      event.architectStolen    ||
      event.architectEcho      ||
      event.type === 'dimension_shift'
    ) {
      // Architect interference — the cosmos already tore the script.
      // Chaos reacts with recognition rather than surprise.
      pool = CHAOS_OWN_DISASTER;
    } else if (event.isGoal && (Boolean(event.isOwnGoal) || event.type === 'own_goal')) {
      // Own goal — self-inflicted disaster.  Peak Chaos satisfaction.
      // event.isOwnGoal comes via the [key: string]: unknown index signature,
      // so we coerce with Boolean() rather than relying on implicit truthiness.
      pool = CHAOS_OWN_DISASTER;
    } else if (event.isGoal) {
      // A goal — either an upset (Chaos interested) or the expected (Chaos bored).
      // Without access to pre-match odds here, we use noveltyHunger as a proxy:
      // if hunger was high before this tick, the goal will seem like a welcome
      // disruption regardless of which team scored.
      pool = this.chaos.noveltyHunger >= 3 ? CHAOS_UPSET : CHAOS_TEDIUM;
    } else if (!event.isGoal && !event.cardType && this.chaos.noveltyHunger >= CHAOS_HUNGER_ATTENTION_THRESHOLD) {
      // Nothing interesting happened and Chaos is very hungry — contempt.
      pool = CHAOS_TEDIUM;
    } else {
      pool = CHAOS_GENERIC;
    }

    return {
      type:       'cosmic_voice',
      voiceIndex: 3,
      text:       pick(pool),
      minute,
      color:      CHAOS_COLOR,
    };
  }
}
