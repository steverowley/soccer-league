// ── features/match/logic/simulateFullMatch.ts ────────────────────────────────
// Pure 90-minute match simulator built on top of gameEngine.genEvent().  The
// match worker (scripts/match-worker.ts) calls this once per due fixture at
// its kickoff_at instant, then persists the returned event array to
// match_events for the live viewer to reveal in elapsed real-time.
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
import type {
  EnginePlayer, EngineTeam, MatchEvent, PlayerStatsMap,
} from '../../../gameEngine.types';

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
 * Possession is a coarse 0–100 home-bias percentage threaded into genEvent.
 * The engine recomputes it implicitly via momentum, so we feed a constant 50
 * here and let momentum carry the bias.
 */
const INITIAL_POSSESSION = 50;

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
 * @param home   Home team object as produced by getTeamForEngine().
 * @param away   Away team object as produced by getTeamForEngine().
 * @returns      Events + final score + MVP — ready for DB persistence.
 */
export function simulateFullMatch(
  home: EngineTeam,
  away: EngineTeam,
): SimulatedMatchResult {
  // ── Per-match state ────────────────────────────────────────────────────────
  // createAIManager seeds initial agent fatigue/morale and picks weather,
  // referee, and flashpoint caps.  Same RNG sequence → same AIManager.
  const aim = createAIManager(home, away);

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
    // The 14th arg (genCtx) is empty — no Architect features active.
    const ev = genEvent(
      min, home, away, momentum, INITIAL_POSSESSION, playerStats, score,
      activePlayers, substitutionsUsed, null, aim, 0, lastEventType, {},
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

    events.push(toSimulatedEvent(ev, withinMinute));

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
