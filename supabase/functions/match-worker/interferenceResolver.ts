// ── match-worker/interferenceResolver.ts ──────────────────────────────────
//
// Worker-side mirror of `src/features/match/logic/interferenceResolver.ts`.
//
// WHY THIS LIVES HERE
// ───────────────────
// Deno edge functions cannot reach into `src/` (different module-resolution
// graph), so every consumed module is duplicated under
// `supabase/functions/match-worker/`.  This file is a near-byte copy of the
// src/ resolver, kept structurally identical so a future build step can
// collapse them.  See the src/ twin for the full design rationale,
// scope progression (#428 slices 1–5), and per-mechanic prose.
//
// PURPOSE
// ───────
// The Cosmic Architect picks in-match interferences via the LLM call in
// `architectInterference.ts` (#370).  Before this module, those choices
// were narrative-only — an `architect_interference` event appeared in the
// commentary feed but the match outcome was identical with or without it.
// This resolver finally turns those choices into MECHANICAL effects:
//
//   • curse_player    → an active player's goals can be annulled (event
//                       rewritten 'goal'→'shot', isGoal:false).
//   • bless_player    → a player's missed shots can become goals (event
//                       rewritten 'shot'→'goal', isGoal:true).
//   • annul_goal      → a single retrospective goal-rewind (one-shot).
//   • force_red_card  → a single forward-looking card-promotion (one-shot).
//
// All four are PURE POST-PASS — the resolver consumes the already-simulated
// event stream and returns a new (or same) stream with the rewrites applied.
// gameEngine.js is never touched, so the 200-seeded smoke test stays stable.

import type { SimulatedEvent } from './simEvent.ts';

// ── Inputs ────────────────────────────────────────────────────────────────

/**
 * A single curse or bless intent registered against a named player.
 * Mirrors the `ActiveEffect` shape inside src/features/architect/logic/
 * CosmicArchitect.ts — kept structural here so the resolver doesn't
 * import the Architect (which would pull the Anthropic SDK into the
 * resolver's import graph for no reason).
 *
 * @property playerName  Case-insensitive match against `payload.player`.
 * @property magnitude   1–10. Drives the per-event firing probability
 *                       via `magnitude * 0.1` (see FIRE_PROBABILITY...).
 * @property startMin    Match minute the effect was cast. Effects only
 *                       fire on events at or AFTER this minute — a curse
 *                       cast at minute 60 cannot retroactively annul a
 *                       goal scored at minute 30.
 */
export interface InterferenceEffect {
  playerName: string;
  magnitude:  number;
  startMin:   number;
}

/**
 * Bundle of all active curse + bless effects for a single match.
 * Passed verbatim to every `resolveInterference()` call so the resolver
 * is stateless across events.
 */
export interface InterferenceContext {
  curses:  InterferenceEffect[];
  blesses: InterferenceEffect[];
}

/**
 * Stamp written onto `payload.interferenceApplied` when the resolver
 * mutates an event.  Consumers (news feed writer, post-match summary)
 * can filter on this to know "the Architect's hand touched this minute".
 *
 *   curse           — a goal was downgraded by a persistent player curse.
 *   bless           — a missed shot was upgraded by a persistent bless.
 *   annul_goal      — a goal was rewound by a one-shot retrospective intent.
 *   force_red_card  — a foul/tackle was promoted to a red card by a
 *                     forward-looking one-shot intent.
 */
export type InterferenceMark = 'curse' | 'bless' | 'annul_goal' | 'force_red_card';

/**
 * A single annul_goal intent — RETROSPECTIVE one-shot.  The Architect
 * picks a (team, minute, magnitude); on fire, the FIRST matching goal
 * at or after `minute` for the named team is rewound.
 *
 * @property team       Team shortName to match against `payload.team`.
 *                      Callers must map 'home' / 'away' → shortName at
 *                      the partition step since the engine writes the
 *                      home/away team's shortName onto every goal event.
 * @property minute     Earliest match minute the intent will consume.
 *                      Walks forward — a goal at this minute or later
 *                      is eligible.  Set to `architectMinute - K` when
 *                      the intent is reacting to a just-occurred goal.
 * @property magnitude  1–10. Firing probability = magnitude * 0.1.
 */
export interface AnnulGoalIntent {
  team:      string;
  minute:    number;
  magnitude: number;
}

/**
 * A single force_red_card intent — FORWARD-LOOKING one-shot.  The
 * Architect picks (playerName, minute, magnitude); on fire, the FIRST
 * card-able event by the named player at or after `minute` gets its
 * cardType promoted to 'red' (overwriting yellow if present).
 *
 * @property playerName  Case-insensitive match against `payload.player`.
 * @property minute      Earliest match minute the intent will fire on.
 * @property magnitude   1–10. Firing probability = magnitude * 0.1.
 */
export interface ForceRedCardIntent {
  playerName: string;
  minute:     number;
  magnitude:  number;
}

// ── Constants ─────────────────────────────────────────────────────────────

/**
 * Convert a 1–10 magnitude to a firing probability:
 *   magnitude  1 → 10%   (an Architect mutter — usually fizzles)
 *   magnitude  5 → 50%   (median Architect pick)
 *   magnitude 10 → 100%  (Architect WILL — guaranteed to fire)
 * Linear scaling keeps the calibration predictable and matches the src/ twin.
 */
const FIRE_PROBABILITY_PER_MAGNITUDE_POINT = 0.1;

/**
 * Event types eligible for `force_red_card` promotion.  Conservative on
 * purpose — a shot or goal becoming a red card would be physically absurd,
 * so the resolver fizzles rather than fabricating a foul context out of
 * nowhere.  Limited to physical contact events the engine actually emits.
 */
const CARDABLE_EVENT_TYPES: ReadonlySet<string> = new Set(['foul', 'tackle', 'dive']);

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Find the strongest active effect matching the named player at or before
 * the given minute.  Strongest = highest magnitude; ties broken by most
 * recent startMin (the Architect's freshest decision wins).
 *
 * @param effects  All registered effects of one kind (curse OR bless).
 * @param player   Case-insensitive player name to match.
 * @param minute   The event's match minute (effects with startMin > minute
 *                 are filtered out — a curse cast in the future doesn't
 *                 fire on a past event).
 * @returns        The strongest applicable effect, or null.
 */
function strongestActiveEffect(
  effects: InterferenceEffect[],
  player:  string,
  minute:  number,
): InterferenceEffect | null {
  const target = player.toLowerCase();
  let best: InterferenceEffect | null = null;
  for (const e of effects) {
    if (e.playerName.toLowerCase() !== target) continue;
    if (e.startMin > minute) continue;
    if (!best
        || e.magnitude > best.magnitude
        || (e.magnitude === best.magnitude && e.startMin > best.startMin)) {
      best = e;
    }
  }
  return best;
}

/**
 * Read the actor / shooter name out of a SimulatedEvent payload.  Engine
 * events stash the player under `payload.player`.  Returns null when no
 * player is associated with the event (kickoff, halftime, voice items,
 * architect_interference narrative rows, etc.).
 */
function eventPlayer(event: SimulatedEvent): string | null {
  const p = (event.payload as Record<string, unknown>)['player'];
  return typeof p === 'string' && p.length > 0 ? p : null;
}

// ── Curse / bless resolver ────────────────────────────────────────────────

/**
 * Apply curse + bless effects to a single SimulatedEvent.  Pure — returns
 * the original event when nothing fires, OR a new event object with the
 * mutation applied.  Never mutates input.
 *
 * MECHANIC
 *   curse_player — Event is a goal by a cursed player → roll random();
 *     if it falls under `magnitude * 0.1`, the goal is annulled:
 *     type:'goal'→'shot', payload.isGoal:false, interferenceApplied:'curse'.
 *   bless_player — Event is a missed shot by a blessed player → roll
 *     random(); if it falls under `magnitude * 0.1`, the miss is
 *     upgraded:
 *     type:'shot'→'goal', payload.isGoal:true, interferenceApplied:'bless'.
 *
 * Curse takes precedence over bless when both apply to the same player
 * (they wouldn't normally co-exist — the Architect picks one or the other
 * — but the tie-break keeps the resolver deterministic).
 *
 * @param event   The engine-generated event (treated as read-only).
 * @param ctx     Active curse + bless effects for the match.
 * @param random  Injected RNG ∈ [0, 1).  Tests inject a seeded LCG;
 *                production passes Math.random.
 * @returns       Original event (no fire) OR a new event with the mutation.
 */
export function resolveInterference(
  event:  SimulatedEvent,
  ctx:    InterferenceContext,
  random: () => number,
): SimulatedEvent {
  const player = eventPlayer(event);
  if (!player) return event;

  // Curse first — a cursed scorer's goal can be annulled.
  const curse = strongestActiveEffect(ctx.curses, player, event.minute);
  if (curse && (event.payload as Record<string, unknown>)['isGoal'] === true) {
    if (random() < curse.magnitude * FIRE_PROBABILITY_PER_MAGNITUDE_POINT) {
      return {
        ...event,
        type: 'shot',
        payload: {
          ...event.payload,
          isGoal:                false,
          interferenceApplied:   'curse' satisfies InterferenceMark,
          interferenceMagnitude: curse.magnitude,
        },
      };
    }
  }

  // Bless — a blessed player's miss can become a goal.
  const bless = strongestActiveEffect(ctx.blesses, player, event.minute);
  if (bless && event.type === 'shot' && (event.payload as Record<string, unknown>)['isGoal'] !== true) {
    if (random() < bless.magnitude * FIRE_PROBABILITY_PER_MAGNITUDE_POINT) {
      return {
        ...event,
        type: 'goal',
        payload: {
          ...event.payload,
          isGoal:                true,
          interferenceApplied:   'bless' satisfies InterferenceMark,
          interferenceMagnitude: bless.magnitude,
        },
      };
    }
  }

  return event;
}

/**
 * Walk an entire event stream applying curse/bless effects.  Order is
 * preserved; events with no applicable effect pass through unchanged.
 *
 * @param events  Full event stream from a simulated match.
 * @param ctx     Active curse + bless effects.
 * @param random  Injected RNG; same call-once-per-event semantics.
 * @returns       A new array with the mutations applied (input untouched).
 */
export function resolveInterferenceStream(
  events: SimulatedEvent[],
  ctx:    InterferenceContext,
  random: () => number,
): SimulatedEvent[] {
  return events.map(ev => resolveInterference(ev, ctx, random));
}

// ── annul_goal: retrospective one-shot ────────────────────────────────────

/**
 * Apply one or more annul_goal intents to an event stream.
 *
 * MECHANIC
 *   For each intent (processed in input order), the resolver rolls
 *   `magnitude * 0.1`; on fire, walks the stream finding the FIRST goal
 *   at or after `intent.minute` whose team matches `intent.team`.  That
 *   goal is rewound in place:
 *     type:'goal' → 'shot'
 *     payload.isGoal: false
 *     payload.interferenceApplied: 'annul_goal'
 *     payload.interferenceMagnitude: <intent magnitude>
 *
 * Each intent consumes at most ONE goal; a goal already consumed by an
 * earlier intent (or already annulled by the curse mechanic) is skipped.
 *
 * @param events   Full event stream from a simulated match.
 * @param intents  Annul intents from the Architect (input order honoured).
 * @param random   Injected RNG ∈ [0, 1).
 * @returns        A new array with annulled goals downgraded.
 */
export function applyAnnulGoals(
  events:  SimulatedEvent[],
  intents: AnnulGoalIntent[],
  random:  () => number,
): SimulatedEvent[] {
  if (intents.length === 0) return events;
  const out: SimulatedEvent[] = events.slice();
  const consumedIdx = new Set<number>();

  for (const intent of intents) {
    // Probability gate first — skip the stream walk on non-firing rolls.
    if (random() >= intent.magnitude * FIRE_PROBABILITY_PER_MAGNITUDE_POINT) continue;
    for (let i = 0; i < out.length; i++) {
      if (consumedIdx.has(i)) continue;
      const ev = out[i];
      if (!ev) continue;
      if (ev.minute < intent.minute) continue;
      const pl = ev.payload as Record<string, unknown>;
      if (pl['isGoal'] !== true) continue;
      if (pl['team'] !== intent.team) continue;
      out[i] = {
        ...ev,
        type: 'shot',
        payload: {
          ...ev.payload,
          isGoal:                false,
          interferenceApplied:   'annul_goal' satisfies InterferenceMark,
          interferenceMagnitude: intent.magnitude,
        },
      };
      consumedIdx.add(i);
      break;     // single-shot per intent
    }
  }
  return out;
}

// ── force_red_card: forward-looking one-shot ──────────────────────────────

/**
 * Apply one or more force_red_card intents to an event stream.
 *
 * MECHANIC
 *   For each intent (processed in input order), the resolver rolls
 *   `magnitude * 0.1`; on fire, walks the stream finding the FIRST
 *   card-able event by the target player at or after `intent.minute`
 *   that hasn't already been consumed or already carries a red.  That
 *   event's payload is rewritten:
 *     payload.cardType: 'red' (overwrites yellow if present)
 *     payload.interferenceApplied: 'force_red_card'
 *     payload.interferenceMagnitude: <intent magnitude>
 *
 * Type / isGoal stay unchanged — a foul stays a foul, just with a red
 * card flag.  The engine's downstream stats accumulator reads
 * `cardType === 'red'` and updates redCard accordingly.  `payload.commentary`
 * is overwritten with a sending-off line so the live feed reads as a
 * dismissal — without it a promoted spatial tackle would still narrate "wins
 * the ball with a clean tackle" while carrying a red card.
 *
 * FIZZLE BEHAVIOUR
 *   If the target player never has a card-able event in the remaining
 *   match, the intent silently fizzles.  We do NOT inject a synthetic
 *   red — fabricating one would require manufacturing a foul context
 *   (defender, location, commentary) that the engine alone is qualified
 *   to produce.
 *
 * @param events   Full event stream from a simulated match.
 * @param intents  Force-red-card intents from the Architect.
 * @param random   Injected RNG ∈ [0, 1).
 * @returns        A new array with promoted red cards.
 */
export function applyForceRedCards(
  events:  SimulatedEvent[],
  intents: ForceRedCardIntent[],
  random:  () => number,
): SimulatedEvent[] {
  if (intents.length === 0) return events;
  const out: SimulatedEvent[] = events.slice();
  const consumedIdx = new Set<number>();

  for (const intent of intents) {
    if (random() >= intent.magnitude * FIRE_PROBABILITY_PER_MAGNITUDE_POINT) continue;
    const target = intent.playerName.toLowerCase();
    for (let i = 0; i < out.length; i++) {
      if (consumedIdx.has(i)) continue;
      const ev = out[i];
      if (!ev) continue;
      if (ev.minute < intent.minute) continue;
      if (!CARDABLE_EVENT_TYPES.has(ev.type)) continue;
      const pl = ev.payload as Record<string, unknown>;
      const player = pl['player'];
      if (typeof player !== 'string' || player.toLowerCase() !== target) continue;
      // Already a red from the engine — pursue the next card-able event
      // instead of double-stamping.
      if (pl['cardType'] === 'red') continue;
      out[i] = {
        ...ev,
        payload: {
          ...ev.payload,
          cardType:              'red',
          interferenceApplied:   'force_red_card' satisfies InterferenceMark,
          interferenceMagnitude: intent.magnitude,
          commentary:            `${player} is shown a straight red card.`,
        },
      };
      consumedIdx.add(i);
      break;     // single-shot per intent
    }
  }
  return out;
}

// ── Post-interference stat reconciliation (#530) ──────────────────────────

/**
 * The minimal per-player counters the reconciler reads and rewrites — a
 * structural subset of the spatial adapter's `PlayerStatsEntry` and the
 * dice-roller's stat slot.  Only the two fields the Architect's post-passes
 * can change.
 */
export interface ReconcilableStats {
  goals:   number;
  redCard: boolean;
}

/**
 * Reconcile per-player goal + red-card counters against a POST-interference
 * event stream.  Mirror of the src/ twin — see it for the full rationale.
 *
 * The adapter accumulates player stats from the ORIGINAL stream, before the
 * curse / annul / bless / force_red_card post-passes run.  This worker
 * re-derives the scoreline from the mutated stream but leaves the per-player
 * counters describing the pre-interference match, so an annulled goal stays on
 * its scorer's tally and a forced red card never reaches match_player_stats /
 * the idol leaderboard.  This recomputes each known player's `goals` from the
 * mutated stream's `isGoal===true` events and ORs in `redCard` for any
 * `force_red_card` stamp, keeping persisted stats consistent with the
 * re-derived scoreline.
 *
 * Pure — returns a new map, never mutates input.  Keyed by player name; only
 * players already present in `playerStats` are returned (interference can only
 * touch a player who already produced a stat event).
 */
export function reconcileStatsAfterInterference<T extends ReconcilableStats>(
  playerStats: Record<string, T>,
  events:      SimulatedEvent[],
): Record<string, T> {
  const goalsByPlayer = new Map<string, number>();
  const sentOff       = new Set<string>();

  for (const ev of events) {
    const pl = ev.payload as Record<string, unknown>;
    const player = pl['player'];
    if (typeof player !== 'string' || player.length === 0) continue;
    if (pl['isGoal'] === true) {
      goalsByPlayer.set(player, (goalsByPlayer.get(player) ?? 0) + 1);
    }
    if (pl['interferenceApplied'] === 'force_red_card') {
      sentOff.add(player);
    }
  }

  const out: Record<string, T> = {};
  for (const [name, stats] of Object.entries(playerStats)) {
    out[name] = {
      ...stats,
      goals:   goalsByPlayer.get(name) ?? 0,
      redCard: stats.redCard || sentOff.has(name),
    } as T;
  }
  return out;
}
