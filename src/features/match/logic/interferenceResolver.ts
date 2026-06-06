// ── features/match/logic/interferenceResolver.ts ─────────────────────────
// First slice of #428 ("engine-side resolver for in-match interferences").
//
// PURPOSE
// ───────
// The Architect already collects curse_player and bless_player intents
// (with magnitudes 1–10) into activeCurses / activeBlesses on the
// CosmicArchitect instance, exposed via getCursesFor / getBlessesFor.
// Until now those accessors had ZERO consumers — the interference
// was narrative-only.  This module is the pure, deterministic
// post-pass that finally turns those intents into mechanical effects
// on match events.
//
// DESIGN: PURE POST-PASS, NOT GENGINE.JS PATCH
// ────────────────────────────────────────────
// The issue (#428) offered two paths:
//   1. Move pickInterferenceSlots into a pre-event module
//   2. Run a second pass after simulation that re-writes affected events
//
// Path 2 is what's here: it requires zero gameEngine.js touches,
// keeps the engine pure, and lets the resolver evolve independently
// of the 2748-LOC engine module.  A wrapper in simulateFullMatch
// (next slice) walks each event through this resolver before
// pushing it onto the events list.
//
// SCOPE OF THIS SLICE
// ───────────────────
// curse_player + bless_player only.  These are per-event mutations
// on the targeted player.  force_red_card / annul_goal /
// goalkeeper_swap follow in later slices once the wiring is proven
// on this pair.

import type { SimulatedEvent } from './simulateFullMatch';

// ── Inputs ────────────────────────────────────────────────────────────────

/**
 * A single curse or bless intent the Architect has registered. Mirrors
 * the `ActiveEffect` shape inside CosmicArchitect.ts (kept structural
 * here so the resolver doesn't import the Architect; the caller maps
 * Architect-side data into this shape at the boundary).
 *
 *   playerName  Name of the targeted player (case-insensitive match).
 *   magnitude   1–10. Drives the probability that the resolver fires
 *               on a given event involving that player.
 *   startMin    The match minute when the effect was cast. Effects
 *               only fire on events at or AFTER this minute.
 */
export interface InterferenceEffect {
  playerName: string;
  magnitude:  number;
  startMin:   number;
}

/**
 * Bundle of all active curses + blesses for the match. Passed
 * verbatim to every resolveInterference() call so the resolver is
 * stateless across events.
 */
export interface InterferenceContext {
  curses:  InterferenceEffect[];
  blesses: InterferenceEffect[];
}

/**
 * Marker we stamp onto the event payload when the resolver mutates
 * an event. Consumers (newsfeed writer, post-match summary) can
 * filter on this to know "the Architect touched this minute".
 *
 * The flavours mirror the effect kinds:
 *   curse           — a success (goal) was downgraded to a miss/shot.
 *   bless           — a miss/shot was upgraded to a goal.
 *   annul_goal      — a goal was rewound by a one-shot Architect
 *                     intent (#428 slice 3) rather than a persistent
 *                     curse. Distinct from `curse` so post-match
 *                     summaries can narrate the two flavours
 *                     differently.
 *   force_red_card  — a foul / tackle was promoted to a red-card
 *                     dismissal (#428 slice 5). Distinct from a
 *                     regular red so post-match summaries can call
 *                     out the Architect's hand.
 */
export type InterferenceMark = 'curse' | 'bless' | 'annul_goal' | 'force_red_card';

// ── One-shot intents ──────────────────────────────────────────────────────

/**
 * A single annul_goal intent emitted by the Architect for a single
 * match. Unlike curse / bless, annul_goal is RETROSPECTIVE — the
 * Architect picks a specific (team, minute) and the resolver finds
 * the first matching goal and rewinds it.
 *
 *   team       Which side scored the goal to annul ('home' | 'away').
 *              Matched against the event's payload.team field via the
 *              caller-supplied team-shortName map (the resolver itself
 *              stays pure — it just compares strings).
 *   minute     The minute the Architect specified. The resolver looks
 *              for a goal at or AFTER this minute (so a late-arriving
 *              intent can still consume a goal in the next few
 *              minutes; the Architect's minute pick is approximate).
 *   magnitude  Probability of firing, same scale as curse/bless
 *              (magnitude * 0.1 per point). 10 → 100% fires.
 */
export interface AnnulGoalIntent {
  team:      string;
  minute:    number;
  magnitude: number;
}

/**
 * A single force_red_card intent emitted by the Architect for a
 * single match. Unlike curse / bless, force_red_card is one-shot:
 * the resolver finds the first card-able event by the target
 * player and rewrites it as a red-card dismissal.
 *
 *   playerName  Case-insensitive match against payload.player.
 *   minute      The minute the Architect specified. The resolver
 *               only fires on events at or AFTER this minute.
 *   magnitude   Probability of firing (magnitude * 0.1 per point).
 *               10 → 100% fires.
 */
export interface ForceRedCardIntent {
  playerName: string;
  minute:     number;
  magnitude:  number;
}

// ── Constants ─────────────────────────────────────────────────────────────

/**
 * Convert a magnitude (1–10) to the resolver's firing probability.
 * Linear scaling keeps it predictable:
 *   magnitude  1 → 10% chance to fire
 *   magnitude  5 → 50% chance to fire (median Architect call)
 *   magnitude 10 → 100% chance to fire (rarely chosen; reserved
 *                   for "the Architect WILL"-flavoured proclamations)
 */
const FIRE_PROBABILITY_PER_MAGNITUDE_POINT = 0.1;

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Find the strongest active effect matching the named player at or
 * before the given minute. Strongest = highest magnitude (ties
 * broken by most recent startMin since the Architect's later
 * decisions reflect the freshest state).
 *
 * @param effects  All registered effects of one kind.
 * @param player   The case-insensitive player name to match.
 * @param minute   The event's match minute.
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
 * Read the player name out of a SimulatedEvent payload. Engine events
 * keep the shooter / actor under the `player` key. Returns null when
 * the event has no player or the value isn't a string.
 */
function eventPlayer(event: SimulatedEvent): string | null {
  const p = event.payload['player'];
  return typeof p === 'string' && p.length > 0 ? p : null;
}

// ── Resolver ──────────────────────────────────────────────────────────────

/**
 * Apply curse/bless effects to a single SimulatedEvent. Returns either
 * the same event (when nothing fires) or a NEW event object with the
 * mutated payload — never mutates in place.
 *
 * MECHANIC
 * ────────
 * curse_player — Event is a goal by a cursed player → roll random();
 *   if it falls under `magnitude * 0.1`, the goal is annulled. The
 *   event keeps minute/subminute but is rewritten:
 *     type: 'shot' (was 'goal'), payload.isGoal: false,
 *     payload.interferenceApplied: 'curse'.
 *   The team's score does NOT increment downstream because the
 *   simulateFullMatch score-derivation step reads payload.isGoal.
 *
 * bless_player — Event is a missed shot by a blessed player → roll
 *   random(); if it falls under `magnitude * 0.1`, the miss is
 *   upgraded to a goal. The event becomes:
 *     type: 'goal' (was 'shot'), payload.isGoal: true,
 *     payload.interferenceApplied: 'bless'.
 *   The downstream score-derivation picks up the upgrade for free.
 *
 * Curse takes precedence over bless when both apply to the same
 * player (they wouldn't normally — the Architect chooses one or the
 * other — but the tie-break makes the resolver deterministic).
 *
 * @param event   The engine-generated SimulatedEvent (read-only).
 * @param ctx     Active curse + bless effects.
 * @param random  Injected RNG ∈ [0, 1). Tests inject a seeded LCG;
 *                production passes Math.random.
 * @returns       The original event (no fire) OR a new event with
 *                the mutation applied.
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
  if (curse && event.payload['isGoal'] === true) {
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

  // Bless — a blessed player's missed shot can become a goal.
  const bless = strongestActiveEffect(ctx.blesses, player, event.minute);
  if (bless && event.type === 'shot' && event.payload['isGoal'] !== true) {
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
 * Convenience: run resolveInterference across an entire event stream
 * (the post-simulation walk that simulateFullMatch will use in the
 * follow-up slice). Order is preserved; events with no applicable
 * effect pass through unchanged.
 *
 * @param events  The full event stream from a simulated match.
 * @param ctx     Active curse + bless effects.
 * @param random  Injected RNG; same call-once-per-event semantics.
 */
export function resolveInterferenceStream(
  events: SimulatedEvent[],
  ctx:    InterferenceContext,
  random: () => number,
): SimulatedEvent[] {
  return events.map(ev => resolveInterference(ev, ctx, random));
}

// ── annul_goal: one-shot stream pass (#428 slice 3) ───────────────────────

/**
 * Apply one or more annul_goal intents to an entire event stream.
 *
 * MECHANIC
 *   For each intent (processed in input order — the Architect's
 *   decision sequence is preserved), the resolver walks the event
 *   stream and finds the FIRST goal at or after the intent's minute
 *   whose team matches the intent's team. With probability
 *   `magnitude * 0.1`, that goal is rewound:
 *     type: 'goal' → 'shot'
 *     payload.isGoal: false
 *     payload.interferenceApplied: 'annul_goal'
 *     payload.interferenceMagnitude: <intent magnitude>
 *
 *   A goal already consumed by a previous intent (or already
 *   annulled by an earlier resolver pass via the curse mechanic)
 *   is skipped — each intent consumes at most one goal, and each
 *   goal can only be annulled once.
 *
 * ORDER GUARANTEE
 *   The returned array has the same length and the same per-index
 *   identity for non-annulled events. Annulled events are new
 *   objects (we never mutate the inputs).
 *
 * @param events   The full event stream from a simulated match.
 * @param intents  Annul intents from the Architect, processed in
 *                 input order.
 * @param random   Injected RNG ∈ [0, 1). Tests pass a seeded LCG;
 *                 production passes Math.random.
 * @returns        A new event stream with annulled goals downgraded.
 */
export function applyAnnulGoals(
  events:  SimulatedEvent[],
  intents: AnnulGoalIntent[],
  random:  () => number,
): SimulatedEvent[] {
  if (intents.length === 0) return events;

  // Work on a shallow copy so we can replace elements in place
  // without mutating the caller's array. The events themselves
  // remain untouched — annulled ones become NEW objects.
  const out: SimulatedEvent[] = events.slice();

  // Track which indices have been annulled so a second intent
  // doesn't double-consume the same goal.
  const consumedIdx = new Set<number>();

  for (const intent of intents) {
    // Skip non-firing rolls early — no point scanning the stream.
    if (random() >= intent.magnitude * FIRE_PROBABILITY_PER_MAGNITUDE_POINT) {
      continue;
    }

    // Find the first matching goal at or after intent.minute that
    // hasn't been consumed.
    for (let i = 0; i < out.length; i++) {
      if (consumedIdx.has(i)) continue;
      const ev = out[i];
      if (!ev) continue;
      if (ev.minute < intent.minute) continue;
      if (ev.payload['isGoal'] !== true) continue;
      if (ev.payload['team'] !== intent.team) continue;

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

// ── force_red_card: one-shot stream pass (#428 slice 5) ───────────────────

/**
 * Card-able event types that the force_red_card resolver will
 * upgrade. We restrict to foul / tackle / dive because those are
 * the only event kinds where a red card makes physical sense
 * (a missed shot or a goal becoming a red card would be absurd).
 *
 * Conservative on purpose — if the Architect's target player never
 * gets in a card-able situation, the intent fizzles rather than
 * fabricating a red card out of nowhere. Better than a phantom
 * dismissal.
 */
const CARDABLE_EVENT_TYPES: ReadonlySet<string> = new Set([
  'foul',
  'tackle',
  'dive',
]);

/**
 * Apply one or more force_red_card intents to an event stream.
 *
 * MECHANIC
 *   For each intent (processed in input order), the resolver rolls
 *   `magnitude * 0.1`; on fire, walks the stream finding the FIRST
 *   card-able event by the target player at or after intent.minute
 *   that hasn't already been consumed. That event is rewritten to
 *   carry a red card:
 *     payload.cardType: 'red' (overwrites yellow if present)
 *     payload.interferenceApplied: 'force_red_card'
 *     payload.interferenceMagnitude: <intent magnitude>
 *
 *   Type / isGoal stay unchanged — a foul stays a foul, just with
 *   a card flag. The engine's downstream stats accumulator reads
 *   `cardType === 'red'` and updates redCard accordingly.
 *
 *   `payload.commentary` is overwritten with a sending-off line so the
 *   live feed reads as a dismissal — without it a promoted spatial
 *   tackle would still narrate "wins the ball with a clean tackle"
 *   while carrying a red card, which reads as a bug to players.
 *
 * FIZZLE BEHAVIOUR
 *   If the target player never has a card-able event in the
 *   remaining match, the intent silently fizzles. We intentionally
 *   do NOT inject a synthetic red-card event — fabricating one
 *   would require manufacturing a foul context (defender, location,
 *   commentary) that the engine alone is qualified to produce.
 *
 * @param events   The full event stream from a simulated match.
 * @param intents  Force-red-card intents from the Architect,
 *                 processed in input order.
 * @param random   Injected RNG ∈ [0, 1). Tests pass a seeded LCG;
 *                 production passes Math.random.
 * @returns        A new event stream with promoted red cards.
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
    if (random() >= intent.magnitude * FIRE_PROBABILITY_PER_MAGNITUDE_POINT) {
      continue;
    }

    const target = intent.playerName.toLowerCase();
    for (let i = 0; i < out.length; i++) {
      if (consumedIdx.has(i)) continue;
      const ev = out[i];
      if (!ev) continue;
      if (ev.minute < intent.minute) continue;
      if (!CARDABLE_EVENT_TYPES.has(ev.type)) continue;
      const player = ev.payload['player'];
      if (typeof player !== 'string' || player.toLowerCase() !== target) continue;
      // Already a red card from the engine — leave it alone; the
      // intent has nothing to add. (Pursue the next card-able event
      // instead.)
      if (ev.payload['cardType'] === 'red') continue;

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
 * event stream.
 *
 * The engine (and the spatial adapter) accumulate player stats from the
 * ORIGINAL stream, before the curse / annul / bless / force_red_card
 * post-passes run.  The worker re-derives the scoreline from the mutated
 * stream afterwards — but the per-player counters still describe the
 * pre-interference match, so an annulled goal stays on its scorer's tally and
 * a forced red card never reaches `match_player_stats` / the idol leaderboard.
 * This recomputes each known player's `goals` from the mutated stream's
 * `isGoal===true` events and ORs in `redCard` for any `force_red_card` stamp,
 * keeping the persisted stats consistent with the re-derived scoreline.
 *
 * Pure — returns a new map, never mutates input.  Keyed by player name (the
 * engine / adapter convention).  Only players already present in
 * `playerStats` are returned: interference can only touch a player who already
 * produced a stat event (a cursed scorer, a blessed shooter, a red-carded
 * tackler), so the keyset never grows.
 *
 * KNOWN LIMITATION: goals the engine left unattributed (deflections / own
 * goals carry no `payload.player` — see #533) sit in neither the re-derived
 * scoreline nor these stats, so an unattributed goal simply cannot be cursed
 * or annulled.  Both stay self-consistent.
 *
 * @param playerStats  Per-player counters keyed by name (from the adapter).
 * @param events       The mutated (post-interference) event stream.
 * @returns            A new counters map reconciled with the mutated stream.
 */
export function reconcileStatsAfterInterference<T extends ReconcilableStats>(
  playerStats: Record<string, T>,
  events:      SimulatedEvent[],
): Record<string, T> {
  const goalsByPlayer = new Map<string, number>();
  const sentOff       = new Set<string>();

  for (const ev of events) {
    const player = ev.payload['player'];
    if (typeof player !== 'string' || player.length === 0) continue;
    if (ev.payload['isGoal'] === true) {
      goalsByPlayer.set(player, (goalsByPlayer.get(player) ?? 0) + 1);
    }
    if (ev.payload['interferenceApplied'] === 'force_red_card') {
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
