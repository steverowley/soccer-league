// ── features/match/logic/simulateFullMatch.ts ────────────────────────────────
// Pure 90-minute match simulator built on top of gameEngine.genEvent().
//
// The PRODUCTION worker now lives in the Deno edge function at
// `supabase/functions/match-worker/simulateFullMatch.ts` (a near-identical
// twin of this file).  This src/ copy is the client-side simulator used by
// in-app preview / debug tooling.  Keep the two in lockstep manually until
// a build step consolidates them.
//
// WHY THIS LIVES IN logic/ (not next to gameEngine.js)
//   gameEngine.js owns *event generation* — given current state, decide what
//   happens this minute.  This module owns *match orchestration* — drive
//   genEvent() across all 90 minutes, accumulate state, derive the final
//   score and MVP.  Keeping orchestration here means the engine stays
//   stateless and the worker stays a thin DB layer.
//
// WHY NO DB / NO I/O
//   simulateFullMatch is fully synchronous and deterministic given a
//   `Math.random()` source.  All persistence is the worker's responsibility.
//   This split lets us unit-test the entire simulation surface against the
//   gameEngine in isolation, without ever touching Supabase.
//
// HOW THE WORKER USES IT
//   const result = simulateFullMatch(home, away);
//   await db.from('match_events').insert(result.events.map(e => ({ ... })));
//   await db.from('matches').update({
//     status: 'completed',
//     home_score: result.finalScore[0],
//     away_score: result.finalScore[1],
//   }).eq('id', match.id);

import {
  createAIManager, calcMVP, genEvent,
} from '../../../gameEngine.js';
import type { RefereeOverride } from '../../../gameEngine';
import type {
  EnginePlayer, EngineTeam, MatchEvent, PlayerStatsMap,
} from '../../../gameEngine.types';
import { applyFanBoostToTeam } from '../../finance/logic/applyFanBoost';
// #428 slice 2: post-resolve every generated event through the curse /
// bless interference resolver before pushing it onto the events list,
// so the Architect's collected interference intents finally have a
// mechanical effect on the match outcome (not just narrative).
import {
  applyAnnulGoals,
  applyForceRedCards,
  resolveInterference,
  type AnnulGoalIntent,
  type ForceRedCardIntent,
  type InterferenceContext,
} from './interferenceResolver';

// ── Public input types ───────────────────────────────────────────────────────

/**
 * Minimum shape this module needs from a `calculateFanBoost` result.
 * Re-declared (rather than imported from `finance/logic/fanBoost`) so the
 * match feature does not take a hard runtime dependency on the finance
 * feature — callers wire the boost in from outside.  Structurally
 * compatible with `FanBoostResult` so a result object passes directly.
 */
export interface FanBoostInput {
  /** Which side gets the boost: 'home', 'away', or 'none'. */
  boostedSide: 'home' | 'away' | 'none';
  /** Stat points added to each of the 5 categories. 0 if no boost. */
  boostAmount: number;
}

// ── Result type ───────────────────────────────────────────────────────────────

/**
 * Output of a single 90-minute simulation.  Every field is plain data —
 * trivially serialisable into the match_events / matches DB rows.
 */
export interface SimulatedMatchResult {
  /**
   * Every event the engine produced, ordered by (minute, subminute).
   * subminute is a deterministic counter [0.000, 0.999) within each minute
   * so two events generated in the same minute keep their original order
   * after a SQL `ORDER BY minute, subminute` round-trip.
   */
  events: SimulatedEvent[];
  /** Final score as [home, away] goals. */
  finalScore: [number, number];
  /**
   * Best-performing player name selected by gameEngine.calcMVP, or '—' when
   * no clear MVP can be identified (e.g. 0–0 with no notable contests).
   */
  mvp: string;
  /**
   * Per-player accumulated stats at full time (goals / assists / cards / …).
   * Worker may persist these to match_player_stats — currently optional.
   */
  playerStats: PlayerStatsMap;
}

/**
 * A single event in a simulated match — the shape persisted to match_events.
 *
 * The `type` is the discriminant (e.g. 'shot', 'goal', 'card', 'kickoff').
 * `payload` is everything else (player names, commentary, momentum delta,
 * card type, …) folded into a jsonb blob so we don't need a wide table
 * with NULL columns per event variant.  See migration 0013 for the schema.
 */
export interface SimulatedEvent {
  minute:    number;
  subminute: number;
  type:      string;
  payload:   Record<string, unknown>;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Number of regulation minutes simulated per match.  Stoppage time + extra
 * time are NOT simulated by this function today — that level of fidelity is
 * deferred until the live viewer demands it.  Worker handles 1..90 only.
 */
const REGULATION_MINUTES = 90;

/**
 * Initial momentum split per side.  50/50 is the engine's documented neutral
 * starting point; deviating biases the early-minute event probability roll.
 */
const INITIAL_MOMENTUM: [number, number] = [50, 50];

/**
 * Per-side possession percentage seed.  gameEngine picks the in-possession
 * side every minute via `Math.random() * 100 < possession[0] ? home : away`
 * — so this MUST be a tuple where index 0 is the home share.  Passing a
 * scalar makes `possession[0]` undefined, `Math.random() * 100 < undefined`
 * is always false, and the away team gets the ball on every single event,
 * producing the "home team never scores" pattern.  This was a real bug in
 * production (see worker `simulateFullMatch.ts`) before being fixed; this
 * UI-side simulator had the same drift until now.
 *
 * 50/50 is the kickoff seed; the engine biases per-minute selection by
 * momentum, fatigue, tactics, etc., so a neutral start is correct here.
 */
const INITIAL_POSSESSION: [number, number] = [50, 50];

// ── Internal helper: extract a SimulatedEvent from a MatchEvent ───────────────

/**
 * Convert an in-memory MatchEvent into the persistable {minute, subminute,
 * type, payload} shape.  All fields other than minute/subminute/type land in
 * the payload jsonb verbatim — readers reconstruct the full MatchEvent by
 * spreading the payload back out.
 *
 * @param ev          The engine-generated event.
 * @param subminute   Deterministic counter assigning a unique sub-position
 *                    within the same minute for ordering.
 */
function toSimulatedEvent(ev: MatchEvent, subminute: number): SimulatedEvent {
  // Pull minute/type out; everything else goes into payload.
  const { minute, type, ...rest } = ev;
  return {
    minute,
    subminute,
    type,
    // Cast to Record for jsonb safety — MatchEvent has a typed shape but
    // jsonb is loose; the read path re-narrows via the MatchEvent type.
    payload: rest as Record<string, unknown>,
  };
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Simulate a full 90-minute match between `home` and `away`.
 *
 * Pure function — given the same teams + same Math.random() sequence, the
 * output is byte-identical.  Tests that need determinism should
 * `vi.spyOn(Math, 'random')` with a seeded LCG before calling this function.
 *
 * The simulation harness mirrors App.jsx::simulateMinute() but trimmed to
 * the parts the worker actually needs:
 *   • genEvent() per minute 1..90
 *   • running score / momentum / playerStats accumulation
 *   • lastEventType chained back into the next genEvent call
 *
 * Notably skipped (deferred to a future iteration):
 *   • halftime / stoppage-time logic (App.jsx handles minute-45 + minute-90)
 *   • late-game manager interventions (applyLateGameLogic in simulateHelpers)
 *   • Architect interference flags
 *
 * Those features add narrative colour but are not required for a basic
 * end-to-end runnable season.  Adding them in a follow-up will be additive.
 *
 * @param home        Home team object as produced by getTeamForEngine().
 * @param away        Away team object as produced by getTeamForEngine().
 * @param refOverride Optional entity-graph referee — `{ name, strictness }`
 *                    on the engine's 0–100 strictness scale.  Pass through
 *                    from `match_referee_v` after multiplying the 1–10
 *                    entity_traits value by 10.  When omitted, the engine
 *                    fabricates a random referee — preserving determinism
 *                    for callers (smoke tests, tests, App.jsx) that don't
 *                    yet plumb entity refs through.
 * @param fanBoost    Optional fan-support boost result — `{ boostedSide,
 *                    boostAmount }` from `calculateFanBoost`.  When the
 *                    boosted side is 'home' or 'away', that team's player
 *                    stats are bumped by `boostAmount` BEFORE
 *                    createAIManager runs (the only window where the bump
 *                    propagates through createAgent and every downstream
 *                    contest).  Defaults to no boost — keeps smoke tests
 *                    and callers that don't yet plumb attendance through
 *                    fully deterministic.
 * @returns           Events + final score + MVP — ready for DB persistence.
 */
/**
 * Optional Universal Agent System hooks for the reflex-tier resolvers.
 * When provided, the engine consults `runDecision` at the `shoot_or_pass`
 * and `card_severity` decision sites with the matching persona + memories
 * looked up out of `agentCorpus`.  When omitted, the engine falls back to
 * its legacy stat-driven behaviour with zero overhead.
 *
 * Callers hydrate `agentCorpus` once before kickoff via
 * `prepareCorpusForMatch(db, entityIds)` from `@features/agents`.
 */
export interface AgentReflexHooks {
  /** Pre-hydrated persona + memory snapshot keyed by entity_id. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agentCorpus: any;
  /** The runDecision dispatcher from features/agents. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  runDecision: (req: any) => any;
}

/**
 * Optional Architect interferences to apply to the simulated event
 * stream. When omitted entirely, simulateFullMatch's behaviour is
 * identical to before (#428 slice 2).
 *
 * Three distinct interference flavours live here, applied at different
 * phases of the simulator:
 *
 *   curses / blesses  — persistent per-player effects. Applied INLINE
 *                       in the per-minute loop via resolveInterference
 *                       so the score / playerStats blocks downstream
 *                       see the resolved isGoal value.
 *
 *   annulGoals        — one-shot retrospective intents. Applied as a
 *                       POST-PASS after the loop finishes, via
 *                       applyAnnulGoals (#428 slice 4 wiring). After
 *                       the post-pass, finalScore is re-derived from
 *                       the mutated events stream so the annulled
 *                       goals are removed from the scoreline.
 *
 *   forceRedCards     — one-shot retrospective intents promoting an
 *                       existing foul / tackle / dive event by the
 *                       target player into a red-card dismissal.
 *                       Applied as a POST-PASS via applyForceRedCards
 *                       (#428 slice 5 wiring) AFTER applyAnnulGoals
 *                       so a goal-turned-shot can't be picked up by
 *                       the red-card scanner (only the whitelisted
 *                       card-able event types qualify anyway).
 *                       finalScore is unaffected — card promotions
 *                       never change the scoreline.
 *
 * The caller maps `architect.activeCurses` / `activeBlesses` /
 * `pickedAnnulIntents` / `pickedForceRedIntents` into these fields,
 * then passes a deterministic RNG for reproducibility (seeded LCG
 * in tests, Math.random in prod).
 */
export interface InterferenceWiring {
  /** Active curse + bless effects keyed by player name. */
  ctx: InterferenceContext;
  /**
   * Optional one-shot annul-goal intents (#428 slice 4). Each intent
   * consumes at most one matching goal in the post-simulation pass.
   * Omit / pass [] to disable the annul mechanic.
   */
  annulGoals?: AnnulGoalIntent[];
  /**
   * Optional one-shot force-red-card intents (#428 slice 5). Each
   * intent consumes at most one matching foul / tackle / dive event
   * by the target player in the post-simulation pass and rewrites
   * its cardType to 'red'. Intents fizzle silently when no matching
   * card-able event exists — we never fabricate a synthetic foul.
   * Omit / pass [] to disable the force-red mechanic.
   */
  forceRedCards?: ForceRedCardIntent[];
  /**
   * Injected RNG ∈ [0, 1). Called at most once per applicable
   * event/intent; pure pass-through otherwise. Defaults to
   * Math.random when the caller omits it. The same RNG is shared
   * across all post-passes (annulGoals, forceRedCards) so a single
   * seeded LCG drives the entire Architect resolution phase.
   */
  random?: () => number;
}

export function simulateFullMatch(
  home: EngineTeam,
  away: EngineTeam,
  refOverride: RefereeOverride | null = null,
  fanBoost: FanBoostInput | null = null,
  reflexHooks: AgentReflexHooks | null = null,
  // #428 slice 2: opt-in Architect interference post-pass. Callers
  // that don't pass anything get the legacy behaviour — same event
  // stream, same final score, byte-identical for the 200-seeded
  // smoke test.
  interferences: InterferenceWiring | null = null,
): SimulatedMatchResult {
  // ── Apply fan-support boost (Phase 6+) ─────────────────────────────────
  // The team with more logged-in fans gets a small stat bump across every
  // player.  Boost is applied BEFORE createAIManager runs — agents cache
  // their stats at construction so a post-construction bump would have no
  // effect.  Zero-boost / no-boost callers get the original teams back by
  // reference (no allocation).
  const homeBoost = fanBoost?.boostedSide === 'home' ? fanBoost.boostAmount : 0;
  const awayBoost = fanBoost?.boostedSide === 'away' ? fanBoost.boostAmount : 0;
  const boostedHome = applyFanBoostToTeam(home, homeBoost);
  const boostedAway = applyFanBoostToTeam(away, awayBoost);

  // ── Per-match state ────────────────────────────────────────────────────────
  // createAIManager seeds initial agent fatigue/morale and picks weather,
  // referee, and flashpoint caps.  Same RNG sequence + same refOverride
  // + same fanBoost → same AIManager.
  const aim = createAIManager(boostedHome, boostedAway, refOverride);

  const score:    [number, number] = [0, 0];
  let   momentum: [number, number] = [...INITIAL_MOMENTUM];
  const playerStats: PlayerStatsMap = {};
  const events: SimulatedEvent[] = [];

  // Active XI = starters at kickoff.  No subs simulated in this iteration.
  const activePlayers = {
    home: home.players.filter((p: EnginePlayer) => p.starter).map((p) => p.name),
    away: away.players.filter((p: EnginePlayer) => p.starter).map((p) => p.name),
  };
  const substitutionsUsed = { home: 0, away: 0 };

  let lastEventType: string | null = null;

  // ── Per-minute simulation loop ─────────────────────────────────────────────
  // We track an in-minute counter so multiple events fired at the same minute
  // get distinct subminute values.  Reset on minute change.
  let currentMinute = 0;
  let withinMinute  = 0;

  for (let min = 1; min <= REGULATION_MINUTES; min++) {
    // The 10th positional arg (aiInfluence) is the SHOOT/ATTACK bias bag —
    // null in the worker since we're not modelling manager AI here.
    // The 14th arg (genCtx) carries Phase 8 reflex hooks when the caller
    // supplied them.  Empty object preserves the legacy behaviour when no
    // hooks are passed.
    const genCtx = reflexHooks
      ? { agentCorpus: reflexHooks.agentCorpus, runDecision: reflexHooks.runDecision }
      : {};
    const ev = genEvent(
      min, home, away, momentum, INITIAL_POSSESSION, playerStats, score,
      activePlayers, substitutionsUsed, null, aim, 0, lastEventType, genCtx,
    );

    if (!ev) continue;

    // ── subminute assignment ────────────────────────────────────────────────
    // Reset counter on a new minute, increment within a minute.  Step of
    // 0.05 lets us pack up to 19 events into a single minute before
    // colliding with subminute=1.0 (which the schema disallows).  In practice
    // we see 1–3 events per minute so this is generous headroom.
    if (min !== currentMinute) {
      currentMinute = min;
      withinMinute  = 0;
    } else {
      withinMinute += 0.05;
    }

    // ── Architect interference post-pass (#428 slice 2) ────────────────────
    // When the caller wires curses / blesses, every generated event walks
    // through resolveInterference BEFORE we run the score / stats /
    // momentum side-effects.  The resolver may rewrite the event (curse
    // annuls a goal → 'shot' + isGoal:false; bless upgrades a miss →
    // 'goal' + isGoal:true) — we mirror those two fields back onto the
    // raw MatchEvent so the existing side-effect blocks below pick up
    // the mutation without further changes.
    //
    // When no interferences are wired, the inner branch is skipped and
    // behaviour is byte-identical to the legacy path.
    let simulated = toSimulatedEvent(ev, withinMinute);
    if (interferences) {
      const random   = interferences.random ?? Math.random;
      const resolved = resolveInterference(simulated, interferences.ctx, random);
      if (resolved !== simulated) {
        simulated = resolved;
        // Mirror the resolver's mutation back to the raw MatchEvent so
        // the score / stats blocks below read the resolved state.
        // Only `type` and `isGoal` flip in slice 1's curse/bless
        // mechanic — later slices (force_red_card, annul_goal,
        // goalkeeper_swap) will widen this mirror.
        ev.type   = resolved.type;
        ev.isGoal = resolved.payload['isGoal'] === true;
      }
    }
    events.push(simulated);

    // ── Apply event side-effects ────────────────────────────────────────────
    // Score: increment home/away based on the team that scored.
    if (ev.isGoal) {
      if (ev.team === home.shortName) score[0]++;
      else                            score[1]++;
    }

    // Momentum: clamp [0, 100].  The engine's momentumChange deltas can be
    // any signed integer, but the running value should never escape the
    // valid display range used by MomentumBar.
    const dh = ev.momentumChange?.[0] ?? 0;
    const da = ev.momentumChange?.[1] ?? 0;
    momentum = [
      Math.max(0, Math.min(100, momentum[0] + dh)),
      Math.max(0, Math.min(100, momentum[1] + da)),
    ];

    // Stats accumulation — minimal subset the engine consults itself
    // (calcMVP reads goals + assists + saves + tackles).  Engine writes
    // these slots when relevant events fire; this block keeps them in sync
    // for the running playerStats map passed back to genEvent.
    if (ev.player) {
      const slot = playerStats[ev.player] ??= {
        goals: 0, assists: 0, shots: 0, saves: 0, tackles: 0,
        yellowCard: false, redCard: false,
      };
      if (ev.isGoal)              slot.goals++;
      if (ev.type === 'shot')     slot.shots++;
      if (ev.cardType === 'yellow') slot.yellowCard = true;
      if (ev.cardType === 'red')    slot.redCard    = true;
    }
    if (ev.assister) {
      const slot = playerStats[ev.assister] ??= {
        goals: 0, assists: 0, shots: 0, saves: 0, tackles: 0,
        yellowCard: false, redCard: false,
      };
      slot.assists++;
    }

    lastEventType = ev.type;
  }

  // ── Architect annul_goal post-pass (#428 slice 4) ─────────────────────────
  // After the loop has produced the full event stream, run any one-shot
  // annul_goal intents the Architect picked.  Each fires with probability
  // magnitude*0.1; on fire, the FIRST matching goal at/after the intent's
  // minute is rewritten in place (type:'goal'→'shot', isGoal:false,
  // interferenceApplied:'annul_goal').
  //
  // We then re-derive `finalScore` from the post-pass events list so the
  // scoreline reflects the annulled goals.  PlayerStats is intentionally
  // NOT recomputed in this slice — playerStats reflects engine-output
  // (the goal happened from the engine's POV) and MVP narrative reads
  // accordingly.  A follow-up slice can sweep playerStats post-annul if
  // the asymmetry shows up in UX.
  let finalEvents = events;
  let finalScore: [number, number] = score;
  if (interferences?.annulGoals && interferences.annulGoals.length > 0) {
    const random = interferences.random ?? Math.random;
    finalEvents = applyAnnulGoals(events, interferences.annulGoals, random);

    // Re-derive the scoreline from the resolved stream so annulled goals
    // are removed.  Same team-shortName comparison the inline loop uses.
    const rederived: [number, number] = [0, 0];
    for (const ev of finalEvents) {
      if (ev.payload['isGoal'] !== true) continue;
      const team = ev.payload['team'];
      if (team === home.shortName)      rederived[0]++;
      else if (team === away.shortName) rederived[1]++;
    }
    finalScore = rederived;
  }

  // ── Architect force_red_card post-pass (#428 slice 5) ─────────────────────
  // Sequenced AFTER applyAnnulGoals so the two passes can't fight over the
  // same event.  In practice they target disjoint event kinds (goal vs.
  // foul / tackle / dive — see CARDABLE_EVENT_TYPES in
  // interferenceResolver.ts), but ordering them explicitly keeps the
  // pipeline predictable as we add more interference kinds.
  //
  // Each intent fires with probability magnitude*0.1; on fire, the FIRST
  // card-able event by the target player at/after intent.minute that
  // doesn't already carry a red card is rewritten in place:
  //   payload.cardType: 'red' (overwrites yellow if present)
  //   payload.interferenceApplied: 'force_red_card'
  //   payload.interferenceMagnitude: <intent magnitude>
  // The event's type / isGoal stay unchanged — a foul stays a foul.
  //
  // ASYMMETRY WITH PLAYERSTATS
  //   playerStats was accumulated during the per-minute loop based on
  //   the engine's original cardType output, so a promoted red here
  //   does NOT retro-fill the targeted player's `redCard` flag.  Same
  //   trade-off as the annul_goal pass: the engine's bias bag for the
  //   remainder of the match was computed against the un-promoted card,
  //   so retro-filling stats would no longer match the simulated
  //   gameplay.  A follow-up slice can sweep playerStats across all
  //   post-passes if the asymmetry shows up in UX.
  //
  // ALSO NOTABLY ABSENT
  //   finalScore is NOT touched here — card promotions never change the
  //   scoreline, so there is no equivalent of the annul re-derivation.
  if (interferences?.forceRedCards && interferences.forceRedCards.length > 0) {
    const random = interferences.random ?? Math.random;
    finalEvents = applyForceRedCards(finalEvents, interferences.forceRedCards, random);
  }

  // ── Final-time derivations ─────────────────────────────────────────────────
  // calcMVP returns the full enriched player object (EnginePlayer + team +
  // teamColor + stats) or null when no player scored enough MVP points.
  // SimulatedMatchResult.mvp is a plain string so the worker can persist it
  // to the matches row without embedding a nested object in a text column.
  const mvpResult = calcMVP(playerStats, home, away);
  const mvp = mvpResult?.name ?? '—';

  return {
    events: finalEvents,
    finalScore,
    mvp,
    playerStats,
  };
}
