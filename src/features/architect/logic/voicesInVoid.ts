// ── architect/logic/voicesInVoid.ts ──────────────────────────────────────────
//
// Pure template + selection logic for Balance and Chaos proclamations that
// surface in the Galaxy Dispatch feed BETWEEN matches.  The cosmic voices
// shouldn't fall silent the moment a match ends — the world is treated like
// real life, and real life never sleeps.
//
// WHY THIS MODULE EXISTS
//   `cosmicVoices.ts` (features/match/logic) generates Balance/Chaos lines
//   during a live match where each line is anchored to an actual MatchEvent.
//   Out of match there is no event — the voice speaks because the cosmos
//   feels like speaking.  The line bank here is intentionally context-free:
//   short, atmospheric, often unsettling because it refers to NOTHING the
//   fans were following.  That ambient quality IS the design intent.
//
// PURE-LOGIC INVARIANT
//   No Supabase, no fetch, no React, no Deno.  Everything flows in as
//   plain values.  This keeps the module unit-testable from Vitest and
//   leaves the Edge Function free to inline a copy of the same templates
//   in Deno-compatible code without import gymnastics (the established
//   pattern in this codebase — see buildNewsContext.ts ↔ index.ts).

// ── Voice identity constants ─────────────────────────────────────────────────
//
// Stable entity UUIDs seeded in migration 0011_voices.sql.  Re-exported here
// so callers can write `entities_involved: [BALANCE_ENTITY_ID]` on the
// narratives row without round-tripping through the entities table.
// Match the UUIDs in features/match/logic/cosmicVoices.ts byte-for-byte.

/** Entity UUID for the Second Voice (Balance). */
export const BALANCE_ENTITY_ID = '50000000-0000-0000-0000-000000000002';

/** Entity UUID for the Third Voice (Chaos). */
export const CHAOS_ENTITY_ID = '50000000-0000-0000-0000-000000000003';

// ── Narrative kind discriminants ─────────────────────────────────────────────
//
// Distinct from the match-time `architect_whisper` so the NewsFeedPage filter
// strip can show / hide Balance and Chaos independently.  They share the same
// 'narratives' table — no schema change — just a different `kind` value.

/** Kind written for Balance void proclamations. */
export const BALANCE_VOID_KIND = 'balance_whisper';

/** Kind written for Chaos void proclamations. */
export const CHAOS_VOID_KIND = 'chaos_whisper';

// ── Per-day caps ─────────────────────────────────────────────────────────────
//
// Cosmic voices speaking too often loses signal.  One Balance and one Chaos
// per UTC day matches the existing per-entity cap pattern and ensures the
// feed never floods with paired whispers even if the cron fires 12+ times.

/**
 * Maximum Balance whispers per UTC calendar day.  Set low so each one feels
 * weighty rather than chatty.  Edge function counts existing rows with
 * `kind = balance_whisper` since UTC midnight to gate this.
 */
export const MAX_BALANCE_PER_DAY = 1;

/** Same as MAX_BALANCE_PER_DAY but for Chaos. */
export const MAX_CHAOS_PER_DAY = 1;

// ── Speech probabilities per tick ────────────────────────────────────────────
//
// Each tick rolls independently for each voice.  At 0.2 with a 2-hour cron
// cadence, the expected wait between Balance whispers is ~10 hours, but the
// per-day cap clamps that so the longest fan-visible interval matches the
// natural mid-day "voice was silent until dusk" rhythm the plan calls for.

/**
 * Per-tick probability that Balance speaks.  Multiplied against the
 * "has the daily cap room" check — the actual speak rate is lower.
 * 0.18 keeps Balance feeling measured rather than chatty.
 */
export const BALANCE_SPEECH_PROBABILITY = 0.18;

/**
 * Per-tick probability that Chaos speaks.  Slightly higher than Balance
 * because Chaos is restless by design (see cosmicVoices.ts noveltyHunger),
 * but still capped by MAX_CHAOS_PER_DAY so it can't dominate the feed.
 */
export const CHAOS_SPEECH_PROBABILITY = 0.22;

// ── Template banks ───────────────────────────────────────────────────────────
//
// Hand-written line pools.  Each is intentionally short (≤16 words) and
// context-free — the void proclamation must work at 3am with no match
// happening as much as it does at noon during peak action.
//
// AUTHOR'S NOTE for future contributors:
//   Balance: measured, paired, past-tense.  The cosmos accounting for what
//     happened today, framed as a ledger.  Never excited.  Never horrified.
//   Chaos:   jagged, present-tense, repetition.  Sometimes a single word.
//     Often contemptuous of how predictable the day was, sometimes gleeful
//     about something nobody saw.  Never measured.

/**
 * Balance void proclamations.  At least 12 entries so the same line doesn't
 * repeat too quickly across a season.
 */
export const BALANCE_VOID_TEMPLATES: readonly string[] = [
  'A day has passed. The ledger remains open.',
  'Something was owed. Something arrived. The scales rebalance.',
  'Quiet now. The accounting continues.',
  'No goals to weigh today. The cosmos notes the absence.',
  'The week thus far: balanced. For now.',
  'Equal weights on equal sides. The cosmos approves, briefly.',
  'A correction is due. The cosmos waits to see what form it takes.',
  'Yesterday\'s imbalance is today\'s debt. Today\'s debt is tomorrow\'s payment.',
  'The standings have shifted. The scales notice.',
  'One league trends. Another stagnates. This too will correct.',
  'The cosmos counts. Nothing is missed.',
  'A name rises. Another falls. The ledger keeps balance.',
  'No match runs. The accounting continues without one.',
  'Order, briefly. Order is always brief.',
] as const;

/**
 * Chaos void proclamations.  At least 12 entries, same rationale as Balance.
 */
export const CHAOS_VOID_TEMPLATES: readonly string[] = [
  'Nothing happened today. Disappointing.',
  'The expected. Again. The expected.',
  'Wrong. Somewhere. Wrong.',
  'The favorite is winning. The cosmos is bored.',
  'A team I cannot name did something nobody noticed. Good.',
  'No upsets today. Tedious. Tedious.',
  'Something is about to turn. I can taste it.',
  'The schedule predicts. The cosmos rolls its eyes.',
  'A blowout. Then another. Then another. This is not interesting.',
  'Quiet. Too quiet. Something is winding up.',
  'The pundits agree. The pundits are wrong. Good.',
  'Two days without surprise. The cosmos hungers.',
  'A name. A name. Always names. The cosmos notes none of them.',
  'Predictable. Predictable. Predictable. Soon.',
] as const;

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Pick a random element from a non-empty pool with the supplied RNG.
 * Inline implementation rather than imported so this module stays a
 * single-file copy-paste boundary with the Edge Function.
 */
function pick<T>(pool: readonly T[], rng: () => number): T {
  // pool guaranteed non-empty at every callsite below — the non-null
  // assertion documents the invariant for noUncheckedIndexedAccess.
  return pool[Math.floor(rng() * pool.length)]!;
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Discriminant for which voice is being asked to speak. */
export type VoidVoice = 'balance' | 'chaos';

/**
 * Decide whether a voice should speak this tick.
 *
 * Two independent gates must both pass:
 *   1. The per-tick probability roll fires.
 *   2. The voice has not yet hit its UTC-day cap.
 *
 * Both gates are deterministic given the same RNG sequence and the same
 * counts, so unit tests can pin the behaviour exactly.
 *
 * @param voice          Which cosmic voice is rolling.
 * @param postsTodayCount  How many of this voice's whispers have already
 *                         been written today (UTC).  Edge function counts
 *                         from the narratives table.
 * @param rng            Random source (default Math.random).
 * @returns              true iff the voice should speak this tick.
 */
export function shouldVoidVoiceSpeak(
  voice: VoidVoice,
  postsTodayCount: number,
  rng: () => number = Math.random,
): boolean {
  const cap   = voice === 'balance' ? MAX_BALANCE_PER_DAY      : MAX_CHAOS_PER_DAY;
  const prob  = voice === 'balance' ? BALANCE_SPEECH_PROBABILITY : CHAOS_SPEECH_PROBABILITY;
  if (postsTodayCount >= cap) return false;
  return rng() < prob;
}

/**
 * Produce one void proclamation for the given voice.  The line is sampled
 * uniformly from the relevant template bank — there is no LLM call here
 * because the void lines deliberately avoid match context.
 *
 * @param voice  Which voice is speaking.
 * @param rng    Random source (default Math.random).
 * @returns      A single proclamation string ready for the narratives.summary column.
 */
export function buildVoidLine(voice: VoidVoice, rng: () => number = Math.random): string {
  const pool = voice === 'balance' ? BALANCE_VOID_TEMPLATES : CHAOS_VOID_TEMPLATES;
  return pick(pool, rng);
}

/**
 * Convenience pairing of voice + entity_id + kind so the Edge Function (or
 * any future caller) doesn't have to keep its own mapping table.
 *
 * Returns the discriminants needed to construct an `INSERT INTO narratives`
 * row.  Pure data — no I/O.
 */
export function voidNarrativeShape(voice: VoidVoice): {
  kind:              string;
  entityId:          string;
} {
  if (voice === 'balance') {
    return { kind: BALANCE_VOID_KIND, entityId: BALANCE_ENTITY_ID };
  }
  return { kind: CHAOS_VOID_KIND, entityId: CHAOS_ENTITY_ID };
}
