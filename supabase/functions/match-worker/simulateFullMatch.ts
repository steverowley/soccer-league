// ── simulateFullMatch.ts ──────────────────────────────────────────────────────
// Pure 90-minute match simulator built on top of gameEngine.genEvent().  The
// match worker (index.ts) calls this once per due fixture at its scheduled_at
// instant, then persists the returned event array to match_events for the live
// viewer to reveal in elapsed real-time.
//
// WHY THIS LIVES IN THE WORKER BUNDLE (not imported from src/)
//   gameEngine.js uses bare-specifier imports (`./constants.js`,
//   `./shared/utils/random`) that are resolved by the Vite/Node module graph
//   in the browser build.  Deno requires explicit file extensions on all
//   local imports and cannot resolve path aliases (@/, @shared/).  Rather than
//   patching the engine for both environments, the worker carries its own
//   copies of the files it needs with Deno-compatible import paths.
//
// WHY NO DB / NO I/O
//   simulateFullMatch is fully synchronous and deterministic given a
//   `Math.random()` source.  All persistence is index.ts's responsibility.
//   This split lets us unit-test the entire simulation surface in isolation,
//   without ever touching Supabase.
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
} from './gameEngine.js';
import type {
  EnginePlayer, EngineTeam, MatchEvent, PlayerStatsMap,
} from './gameEngine.types.ts';
import { applyFanBoostToTeam } from './applyFanBoost.ts';

// ── Public input types ────────────────────────────────────────────────────────

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

// ── Result types ──────────────────────────────────────────────────────────────

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
 * Possession is a coarse 0–100 home-bias percentage threaded into genEvent.
 * The engine recomputes it implicitly via momentum, so we feed a constant 50
 * here and let momentum carry the bias.
 */
const INITIAL_POSSESSION = 50;

/**
 * Step size between events generated within the same minute.
 * 0.05 allows up to 19 events per minute before reaching subminute=1.0
 * (which the schema disallows).  In practice 1–3 events fire per minute,
 * so this is generous headroom.
 */
const SUBMINUTE_STEP = 0.05;

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Convert an in-memory MatchEvent into the persistable
 * {minute, subminute, type, payload} shape.
 *
 * All fields other than minute/subminute/type land in the payload jsonb
 * verbatim — readers reconstruct the full MatchEvent by spreading the
 * payload back out.
 *
 * @param ev         The engine-generated event.
 * @param subminute  Deterministic counter assigning a unique sub-position
 *                   within the same minute for stable SQL ordering.
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
 * @param home        Home team object as produced by normalizeTeamForEngine().
 * @param away        Away team object as produced by normalizeTeamForEngine().
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
export function simulateFullMatch(
  home: EngineTeam,
  away: EngineTeam,
  refOverride: { name: string; strictness: number } | null = null,
  fanBoost: FanBoostInput | null = null,
): SimulatedMatchResult {
  // ── Apply fan-support boost ────────────────────────────────────────────────
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

  // Active XI = starters at kickoff.  Substitutions are not simulated in
  // this iteration — the engine still models fatigue and injury internally,
  // but the worker does not process makeSub() calls.
  const activePlayers = {
    home: home.players.filter((p: EnginePlayer) => p.starter).map((p) => p.name),
    away: away.players.filter((p: EnginePlayer) => p.starter).map((p) => p.name),
  };
  const substitutionsUsed = { home: 0, away: 0 };

  let lastEventType: string | null = null;

  // ── subminute tracking ─────────────────────────────────────────────────────
  // Multiple events can fire in the same minute (e.g. a foul followed by a
  // free kick sequence).  We assign each event a unique subminute value so
  // ORDER BY minute, subminute in SQL preserves their generation order.
  // Reset to 0 on every new minute; increment by SUBMINUTE_STEP within one.
  let currentMinute = 0;
  let withinMinute  = 0;

  // ── Per-minute simulation loop ─────────────────────────────────────────────
  for (let min = 1; min <= REGULATION_MINUTES; min++) {
    // The 10th positional arg (aiInfluence) is the SHOOT/ATTACK bias bag —
    // null in the worker since we're not modelling manager AI here.
    // The 14th arg (genCtx) is empty — no Architect features active.
    const ev = genEvent(
      min, home, away, momentum, INITIAL_POSSESSION, playerStats, score,
      activePlayers, substitutionsUsed, null, aim, 0, lastEventType, {},
    );

    if (!ev) continue;

    // ── Subminute assignment ────────────────────────────────────────────────
    if (min !== currentMinute) {
      currentMinute = min;
      withinMinute  = 0;
    } else {
      withinMinute += SUBMINUTE_STEP;
    }

    events.push(toSimulatedEvent(ev, withinMinute));

    // ── Score accumulation ─────────────────────────────────────────────────
    // The engine sets ev.isGoal = true and ev.team = the scoring team's
    // shortName.  We compare against home.shortName (not boostedHome) because
    // normalizeTeamForEngine produces shortName from the DB row, and
    // applyFanBoostToTeam preserves non-player fields by reference.
    if (ev.isGoal) {
      if (ev.team === home.shortName) score[0]++;
      else                            score[1]++;
    }

    // ── Momentum accumulation ──────────────────────────────────────────────
    // Clamp [0, 100].  The engine's momentumChange deltas can be any signed
    // integer, but the running value should never escape the valid display
    // range used by MomentumBar.
    const dh = ev.momentumChange?.[0] ?? 0;
    const da = ev.momentumChange?.[1] ?? 0;
    momentum = [
      Math.max(0, Math.min(100, momentum[0] + dh)),
      Math.max(0, Math.min(100, momentum[1] + da)),
    ];

    // ── Player stats accumulation ──────────────────────────────────────────
    // Minimal subset the engine consults itself (calcMVP reads goals +
    // assists + saves + tackles).  Engine writes these slots when relevant
    // events fire; this block keeps them in sync for the running playerStats
    // map passed back to genEvent on the next tick.
    if (ev.player) {
      const slot = playerStats[ev.player] ??= {
        goals: 0, assists: 0, shots: 0, saves: 0, tackles: 0,
        yellowCard: false, redCard: false,
      };
      if (ev.isGoal)                slot.goals++;
      if (ev.type === 'shot')       slot.shots++;
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

  // ── Final-time derivations ─────────────────────────────────────────────────
  // calcMVP returns the full enriched player object (EnginePlayer + team +
  // teamColor + stats) or null when no player scored enough MVP points.
  // SimulatedMatchResult.mvp is a plain string so the worker can persist it
  // to the matches row without embedding a nested object in a text column.
  const mvpResult = calcMVP(playerStats, home, away);
  const mvp = mvpResult?.name ?? '—';

  return {
    events,
    finalScore: score,
    mvp,
    playerStats,
  };
}
