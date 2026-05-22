// ── supabase/functions/match-worker/cosmicVoices.ts ──────────────────────────
//
// CosmicVoiceEngine — server-side port of the Second Voice (Balance) and
// Third Voice (Chaos) per #371. Mirrors src/features/match/logic/cosmicVoices.ts
// byte-for-byte at the template + state-machine level so the in-match
// commentary feed produced by the worker matches what the client-side
// simulator emits.
//
// WHY THIS PORT EXISTS
// ─────────────────────
// Before #371, the Balance/Chaos voices ran only in the client-side
// simulator (used by the old /admin What-If page and unit tests). In
// production every match was simulated by the Deno match-worker, which
// emitted no cosmic-voice events at all. So Balance and Chaos appeared
// only as 1/day galaxy-tick template picks — repeating verbatim within 2-3
// days. This port emits in-match `balance_whisper` / `chaos_whisper`
// events alongside the existing commentary, giving each match 0–10
// possible voice interruptions tied to its actual events.
//
// DENO-SPECIFIC NOTES
// ────────────────────
// 1. No React imports — the client-side file imports type shapes from
//    src/features/match/types. Here we duck-type incoming events as
//    Record<string, any>, since the engine already produces loose shapes
//    that the worker batches into match_events.
// 2. Returned items use a flat `{ kind, voiceIndex, text, color }` shape
//    convenient for the worker to wrap into SimulatedEvent rows.
// 3. Templates are mirrored exactly; if you edit one bank here, update
//    the matching one in src/features/match/logic/cosmicVoices.ts too.
//    See that file's header for the same warning in the other direction.

// deno-lint-ignore-file no-explicit-any

// ── Entity IDs ────────────────────────────────────────────────────────────────
// Stable UUIDs seeded by migration 0011_voices.sql; exported so the worker
// can populate `entities_involved` on the inserted match_events row.
export const BALANCE_ENTITY_ID = '50000000-0000-0000-0000-000000000002';
export const CHAOS_ENTITY_ID   = '50000000-0000-0000-0000-000000000003';

// ── Voice accent colours ─────────────────────────────────────────────────────
// 2px left-border accent used by MatchDetail's commentary card. Never used
// as background. Kept in sync with the client-side colour table.
const BALANCE_COLOR = '#64748b';
const CHAOS_COLOR   = '#f59e0b';

// ── Speech probability thresholds ────────────────────────────────────────────

/**
 * A voice only rolls for speech when its interestLevel exceeds this
 * threshold. 0.55 was chosen so voices stay silent for the majority of
 * minutes but can fire in any phase. Lower = more frequent.
 */
const INTEREST_SPEECH_THRESHOLD = 0.55;

/**
 * Given interestLevel > threshold, this is the per-event probability of
 * actually speaking. 0.13 means a voice at full interest (1.0) speaks
 * on ~13% of events; at threshold the effective rate is ~7%.
 */
const SPEECH_ROLL_PROBABILITY = 0.13;

/**
 * Minimum match minutes that must pass between two speeches from the
 * SAME voice. Prevents bursts where one voice fires on consecutive events.
 * 6 minutes ≈ one full event cycle at normal simulation speed.
 */
const MIN_MINUTES_BETWEEN_SPEECHES = 6;

/** Per-match speech cap; the actual cap is randomised in [MIN, MAX]. */
const MIN_SPEECHES_PER_MATCH = 2;
const MAX_SPEECHES_PER_MATCH = 5;

// ── Interest level drift constants ────────────────────────────────────────────

/** Stochastic random-walk step applied to interestLevel every tick. */
const INTEREST_DRIFT_RANGE = 0.07;

/** When Balance's equilibriumDebt exceeds this, interest gets a +0.08 boost. */
const BALANCE_DEBT_ATTENTION_THRESHOLD = 2;

/** When Chaos's noveltyHunger exceeds this, interest gets a +0.10 boost. */
const CHAOS_HUNGER_ATTENTION_THRESHOLD = 6;

/** Debt change after an equaliser — negative = balance restored. */
const BALANCE_DEBT_RESTORATION = -1.5;

/** Debt accrual per tick when scoreDiff > 0. 0.3 → 3-goal gap accrues ~2.7 over 9 min. */
const BALANCE_DEBT_ACCRUAL = 0.3;

/** Hunger growth per quiet tick. 1.0 → ~6 quiet minutes crosses the attention floor. */
const CHAOS_HUNGER_ACCRUAL = 1.0;

/** Hunger drop when something surprising happens. Negative = sated. */
const CHAOS_HUNGER_SATED = -4.0;

// ── Template banks ────────────────────────────────────────────────────────────
// Mirror the client-side file. Each pool has ≥ 4 entries to ensure variety.
//
// BALANCE — measured, paired declarative clauses; past tense; symmetric.
// CHAOS  — jagged fragments, repetition, present tense, mid-sentence pivots.

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

const BALANCE_CARD: string[] = [
  'One removed from the scales.',
  'The shape of this match has changed.',
  'Ten against eleven. An asymmetry the cosmos will track.',
  'Removed. The ledger notes the new weight.',
  'The numbers are no longer equal. They rarely stay that way.',
  'Something has been taken from one side. Something may be returned from the other.',
];

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

const CHAOS_UPSET: string[] = [
  'Wrong. Wrong. The wrong one scored. Good.',
  'Not the one they expected. Finally.',
  'The wrong team. The wrong player. The wrong minute. Perfect.',
  'Nobody had this. Nobody. Good.',
  'The favorite did not score. The other did. Yes.',
  'Something went wrong. Something went right.',
  'Against the grain. Against all of it. Beautiful.',
  "This was not in anyone's plan. Especially not theirs.",
];

const CHAOS_OWN_DISASTER: string[] = [
  'The ball found its own net. Perfect.',
  'Not intended. Better.',
  "They did it themselves. The cosmos didn't even have to try.",
  'Unwritten. Glorious. Unwritten.',
  'The wrong direction. The best direction.',
  'Against themselves. Against themselves.',
  'Nobody told it to go there. It went anyway.',
  'Their own hands. Their own net. Their own.',
];

const CHAOS_VAR: string[] = [
  "It counted. Then it didn't. Good.",
  'The certainty evaporated. Good.',
  'Rules applied. Then different rules. Yes.',
  'What was a goal is not a goal. What is reality.',
  "They celebrated. Now they don't. Chaos finds this acceptable.",
  'The screen says otherwise. The screen.',
  'Wrong. Then right. Then wrong. The correct sequence.',
  'Nobody knows what the correct thing is. This is progress.',
];

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

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Random pick. Inline to keep the module self-contained on the hot path. */
function pick(pool: string[]): string {
  return pool[Math.floor(Math.random() * pool.length)] ?? pool[0] ?? '';
}

// ── State shapes ─────────────────────────────────────────────────────────────

interface CosmicVoiceState {
  interestLevel:        number;
  lastSpokeMinute:      number;
  timesSpokenThisMatch: number;
  maxSpeechesThisMatch: number;
}

interface BalanceState extends CosmicVoiceState { equilibriumDebt: number; }
interface ChaosState   extends CosmicVoiceState { noveltyHunger:    number; }

/**
 * Item returned by `maybeInterrupt`. Flat shape so the worker can wrap
 * each one into a SimulatedEvent row with `type: 'balance_whisper'` or
 * `type: 'chaos_whisper'` and payload `{ text, voice, color, entityId }`.
 */
export interface CosmicVoiceItem {
  voice:    'balance' | 'chaos';
  /** 2 = Balance (Second Voice), 3 = Chaos (Third Voice). */
  voiceIndex: 2 | 3;
  text:     string;
  /** Match minute the speech occurred in. */
  minute:   number;
  color:    string;
  /** Stable entity UUID seeded in migration 0011 for `entities_involved`. */
  entityId: string;
}

// ── CosmicVoiceEngine ─────────────────────────────────────────────────────────

/**
 * One instance per match. simulateFullMatch.ts constructs it once per call,
 * then invokes `maybeInterrupt(event, minute, homeScore, awayScore)` after
 * every persisted event. Returned items get persisted as match_events rows.
 *
 * Synchronous + fast — no I/O, no awaits.
 */
export class CosmicVoiceEngine {
  private readonly balance: BalanceState;
  private readonly chaos:   ChaosState;

  constructor() {
    this.balance = {
      interestLevel:          0.2 + Math.random() * 0.5,
      lastSpokeMinute:        -10,
      timesSpokenThisMatch:   0,
      maxSpeechesThisMatch:   MIN_SPEECHES_PER_MATCH + Math.floor(Math.random() * (MAX_SPEECHES_PER_MATCH - MIN_SPEECHES_PER_MATCH + 1)),
      equilibriumDebt:        0,
    };
    this.chaos = {
      interestLevel:          0.1 + Math.random() * 0.5,
      lastSpokeMinute:        -10,
      timesSpokenThisMatch:   0,
      maxSpeechesThisMatch:   MIN_SPEECHES_PER_MATCH + Math.floor(Math.random() * (MAX_SPEECHES_PER_MATCH - MIN_SPEECHES_PER_MATCH + 1)),
      noveltyHunger:          0,
    };
  }

  /**
   * Called once per match event from the simulator. Updates internal
   * state, drifts interest, rolls for speech, and returns 0–2 items.
   */
  maybeInterrupt(event: Record<string, any>, minute: number, homeScore: number, awayScore: number): CosmicVoiceItem[] {
    this._updateBalanceState(event, homeScore, awayScore);
    this._updateChaosState(event);

    this._driftInterest(this.balance, this.balance.equilibriumDebt >= BALANCE_DEBT_ATTENTION_THRESHOLD ? 0.08 : 0);
    this._driftInterest(this.chaos,   this.chaos.noveltyHunger    >= CHAOS_HUNGER_ATTENTION_THRESHOLD  ? 0.10 : 0);

    const items: CosmicVoiceItem[] = [];

    if (this._trySpeak(this.balance, minute)) {
      items.push(this._buildBalanceLine(event, homeScore, awayScore, minute));
    }
    if (this._trySpeak(this.chaos, minute)) {
      items.push(this._buildChaosLine(event, minute));
    }

    return items;
  }

  // ── State updaters ──────────────────────────────────────────────────────────

  private _updateBalanceState(event: Record<string, any>, homeScore: number, awayScore: number): void {
    const scoreDiff = Math.abs(homeScore - awayScore);
    this.balance.equilibriumDebt += scoreDiff * BALANCE_DEBT_ACCRUAL;
    if (event.isGoal && homeScore === awayScore) {
      this.balance.equilibriumDebt = Math.max(0, this.balance.equilibriumDebt + BALANCE_DEBT_RESTORATION);
    }
    this.balance.equilibriumDebt = Math.min(this.balance.equilibriumDebt, 10);
  }

  private _updateChaosState(event: Record<string, any>): void {
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
      this.chaos.noveltyHunger = Math.max(0, this.chaos.noveltyHunger + CHAOS_HUNGER_SATED);
    } else {
      this.chaos.noveltyHunger += CHAOS_HUNGER_ACCRUAL;
    }
    this.chaos.noveltyHunger = Math.min(this.chaos.noveltyHunger, 12);
  }

  private _driftInterest(state: CosmicVoiceState, extraBoost: number): void {
    const drift = (Math.random() - 0.5) * 2 * INTEREST_DRIFT_RANGE;
    state.interestLevel = Math.max(0, Math.min(1, state.interestLevel + drift + extraBoost));
  }

  private _trySpeak(state: CosmicVoiceState, minute: number): boolean {
    if (state.interestLevel < INTEREST_SPEECH_THRESHOLD)              return false;
    if (Math.random() >= SPEECH_ROLL_PROBABILITY)                      return false;
    if (minute - state.lastSpokeMinute < MIN_MINUTES_BETWEEN_SPEECHES) return false;
    if (state.timesSpokenThisMatch >= state.maxSpeechesThisMatch)       return false;
    state.lastSpokeMinute       = minute;
    state.timesSpokenThisMatch += 1;
    return true;
  }

  private _buildBalanceLine(event: Record<string, any>, homeScore: number, awayScore: number, minute: number): CosmicVoiceItem {
    const scoreDiff = Math.abs(homeScore - awayScore);
    let pool: string[];
    if (event.isGoal && homeScore === awayScore)   pool = BALANCE_LEVEL_SCORE;
    else if (event.isGoal && scoreDiff === 1)      pool = BALANCE_PARTIAL_RESTORATION;
    else if (scoreDiff >= 3)                       pool = BALANCE_BLOWOUT;
    else if (event.cardType === 'red')             pool = BALANCE_CARD;
    else                                           pool = BALANCE_GENERIC;
    return { voice: 'balance', voiceIndex: 2, text: pick(pool), minute, color: BALANCE_COLOR, entityId: BALANCE_ENTITY_ID };
  }

  private _buildChaosLine(event: Record<string, any>, minute: number): CosmicVoiceItem {
    let pool: string[];
    if (event.isVAROverturned || event.isControversial) {
      pool = CHAOS_VAR;
    } else if (
      event.architectAnnulled  ||
      event.architectForced    ||
      event.architectConjured  ||
      event.architectStolen    ||
      event.architectEcho      ||
      event.type === 'dimension_shift'
    ) {
      pool = CHAOS_OWN_DISASTER;
    } else if (event.isGoal && (Boolean(event.isOwnGoal) || event.type === 'own_goal')) {
      pool = CHAOS_OWN_DISASTER;
    } else if (event.isGoal) {
      pool = this.chaos.noveltyHunger >= 3 ? CHAOS_UPSET : CHAOS_TEDIUM;
    } else if (!event.isGoal && !event.cardType && this.chaos.noveltyHunger >= CHAOS_HUNGER_ATTENTION_THRESHOLD) {
      pool = CHAOS_TEDIUM;
    } else {
      pool = CHAOS_GENERIC;
    }
    return { voice: 'chaos', voiceIndex: 3, text: pick(pool), minute, color: CHAOS_COLOR, entityId: CHAOS_ENTITY_ID };
  }
}
