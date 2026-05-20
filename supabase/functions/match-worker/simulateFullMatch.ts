// ── simulateFullMatch.ts ──────────────────────────────────────────────────
// Pure 90-minute match simulator orchestrating the gameEngine.js event loop.
// Takes two normalized teams and returns a complete match result: events,
// final score, and MVP — all ready for DB persistence.

// @ts-expect-error - gameEngine.js has no TS declarations in this edge context
import { createAIManager, calcMVP, genEvent } from './gameEngine.js';
import type { EngineTeam, SimulationResult } from './gameEngine.types.ts';
import { applyFanBoostToTeam } from './applyFanBoost.ts';

// ── Input types ────────────────────────────────────────────────────────────

/**
 * Fan-boost result shape passed to simulateFullMatch.
 * Indicates which side gets a stat boost and by how many points.
 */
export interface FanBoostInput {
  boostedSide: 'home' | 'away' | 'none';
  boostAmount: number;
}

// ── Simulated match result types ───────────────────────────────────────────

/**
 * A single match event from the 90-minute simulation.
 * Every field is plain JSON-serializable data — ready for match_events INSERT.
 */
export interface SimulatedEvent {
  minute: number;
  subminute: number;
  type: string;
  payload: Record<string, unknown>;
}

/**
 * Complete 90-minute simulation output — events, score, MVP, player stats.
 * All fields are plain data suitable for direct DB insertion.
 */
export interface SimulatedMatchResult {
  /** Every event that occurred during 90 minutes, ordered by (minute, subminute). */
  events: SimulatedEvent[];
  /** Final score as [homeGoals, awayGoals]. */
  finalScore: [number, number];
  /** MVP player name or '—' if no clear MVP. */
  mvp: string;
  /** Per-player stats accumulated during the match. */
  playerStats: Record<string, {
    goals: number;
    assists: number;
    shots: number;
    saves: number;
    tackles: number;
    yellowCard: boolean;
    redCard: boolean;
  }>;
}

// ── Constants ──────────────────────────────────────────────────────────────

/** Regulation minutes simulated: 1–90 (stoppage time deferred). */
const REGULATION_MINUTES = 90;

/** Initial momentum split: 50/50 represents neutral balance. */
const INITIAL_MOMENTUM: [number, number] = [50, 50];

/**
 * Per-side possession percentage seed.  gameEngine.js picks the in-possession
 * side every minute via `Math.random() * 100 < possession[0] ? home : away` —
 * so this MUST be an array where index 0 is the home share.  Passing a scalar
 * makes `possession[0]` undefined, `Math.random() * 100 < undefined` is always
 * false, and the away team gets the ball on every single event — that was the
 * cause of the original "home team never scores" pattern.
 *
 * 50/50 is the kickoff seed; the engine then biases per-minute selection by
 * momentum, fatigue, tactics, etc., so a neutral start is correct here.
 */
const INITIAL_POSSESSION: [number, number] = [50, 50];

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Convert an in-memory MatchEvent from the engine into a persistable
 * SimulatedEvent shape (minute, subminute, type, payload).
 *
 * @param ev        Engine-generated event.
 * @param subminute Deterministic counter assigning order within the same minute.
 * @returns         Persistable event shape.
 */
function toSimulatedEvent(ev: Record<string, any>, subminute: number): SimulatedEvent {
  const { minute, type, ...rest } = ev;
  return {
    minute,
    subminute,
    type,
    payload: rest as Record<string, unknown>,
  };
}

// ── Main entry point ──────────────────────────────────────────────────────

/**
 * Simulate a full 90-minute match between `home` and `away`.
 *
 * Pure function — given the same teams + same Math.random() sequence,
 * the output is byte-identical. Orchestrates genEvent() across 90 minutes,
 * accumulates score + momentum + player stats, derives MVP.
 *
 * @param home      Home team object as produced by normalizeTeamForEngine().
 * @param away      Away team object as produced by normalizeTeamForEngine().
 * @param fanBoost  Optional fan-support boost result. When boostedSide is
 *                  'home' or 'away', that team's players get +boostAmount
 *                  to each stat BEFORE AI manager creation.
 * @param architect Optional CosmicArchitect (see architect.ts).  When
 *                  provided, gameEngine threads `getRelationshipFor`,
 *                  `getFeaturedMortals`, and `getActiveRelationships` into
 *                  contest resolution + commentary, activating rivalry-based
 *                  card-bias multipliers and the weird-pool rate boost.
 * @returns         Events + final score + MVP — ready for DB persistence.
 */
export function simulateFullMatch(
  home: EngineTeam,
  away: EngineTeam,
  fanBoost: FanBoostInput | null = null,
  // Duck-typed Architect bridge.  Required surface: `getRelationshipFor`,
  // `getFeaturedMortals`, `getActiveRelationships`.  When omitted, gameEngine
  // sees a falsy `genCtx.architect` and falls back to its empty-state
  // branches — relationship contests apply no modifier, weird-pool stays at
  // its 3% baseline.  See architect.ts for the canonical implementation.
  // deno-lint-ignore no-explicit-any
  architect: any | null = null,
): SimulatedMatchResult {
  // ── Apply fan-support boost ────────────────────────────────────────────────
  // The team with more logged-in fans gets a small stat boost across every
  // player. Boost is applied BEFORE createAIManager runs — agents cache
  // their stats at construction so a post-construction boost would have no
  // effect.
  const homeBoost = fanBoost?.boostedSide === 'home' ? fanBoost.boostAmount : 0;
  const awayBoost = fanBoost?.boostedSide === 'away' ? fanBoost.boostAmount : 0;
  const boostedHome = applyFanBoostToTeam(home, homeBoost);
  const boostedAway = applyFanBoostToTeam(away, awayBoost);

  // ── Per-match state ────────────────────────────────────────────────────────
  // createAIManager seeds initial agent fatigue/morale and picks weather,
  // referee, and other per-match setup.
  const aim = createAIManager(boostedHome, boostedAway, null);

  const score: [number, number] = [0, 0];
  let momentum: [number, number] = [...INITIAL_MOMENTUM];
  const playerStats: Record<string, any> = {};
  const events: SimulatedEvent[] = [];

  // Active XI = starters at kickoff. No subs simulated in this iteration.
  const activePlayers = {
    home: home.players.filter((p) => p.starter).map((p) => p.name),
    away: away.players.filter((p) => p.starter).map((p) => p.name),
  };
  const substitutionsUsed = { home: 0, away: 0 };

  let lastEventType: string | null = null;

  // ── Per-minute simulation loop ─────────────────────────────────────────────
  // We track an in-minute counter so multiple events within the same minute
  // get distinct subminute values for deterministic ordering.
  //
  // SUBMINUTE ENCODING
  // ──────────────────
  // The DB column has CHECK (subminute < 1).  We encode the per-minute index
  // as `count / 100`, giving 100 slots per minute (0.00 … 0.99) and a hard
  // cap that's safe regardless of how many events the engine emits.  The
  // previous implementation incremented by 0.05 and would overflow to 1.00
  // on the 20th event in a minute, causing the batch INSERT to violate the
  // CHECK constraint and the entire match to revert with partial state.
  // Multi-step narrative sequences (penalty, free-kick, confrontation) can
  // realistically push 15+ events into a single minute, so a 0.05 step was
  // genuinely at risk.
  const SUBMINUTE_DIVISOR = 100;          // CHECK (subminute < 1) → max 99 slots
  const SUBMINUTE_CAP = SUBMINUTE_DIVISOR - 1;
  let currentMinute = 0;
  let withinMinuteCount = 0;

  for (let min = 1; min <= REGULATION_MINUTES; min++) {
    // Call the engine's event generator. 14 positional args:
    // minute, home, away, momentum, possession, playerStats, score,
    // activePlayers, substitutionsUsed, aiInfluence, aim, momentum_magnitude,
    // lastEventType, genCtx (empty).
    // genCtx.architect threading: gameEngine.js reads `genCtx.architect` in
    // resolveContest (relationship modifiers), buildCommentary (weird-pool
    // rate), and _genEventBranches (foul rival-selection bias).  When the
    // bridge is absent (null), every architect lookup falls through to its
    // empty-state branch — no behaviour change vs the pre-Phase-2 worker.
    const ev = genEvent(
      min, home, away, momentum, INITIAL_POSSESSION, playerStats, score,
      activePlayers, substitutionsUsed, null, aim, 0, lastEventType,
      { architect },
    );

    if (!ev) continue;

    // ── subminute assignment ───────────────────────────────────────────────
    // Reset the in-minute index on a new minute, otherwise advance it.  The
    // persistable subminute is `count / 100`, clamped at 0.99 so we can
    // never violate the CHECK (subminute < 1) constraint — any overflow
    // beyond 100 events in a single minute collapses to the same 0.99 slot
    // and still preserves engine-emit ordering (events are inserted in
    // emit order regardless of subminute ties).
    if (min !== currentMinute) {
      currentMinute = min;
      withinMinuteCount = 0;
    } else {
      withinMinuteCount += 1;
    }

    const subminute = Math.min(withinMinuteCount, SUBMINUTE_CAP) / SUBMINUTE_DIVISOR;
    events.push(toSimulatedEvent(ev, subminute));

    // ── Flatten multi-step narrative sequences ─────────────────────────────
    // gameEngine.js returns an event for outcomes like a penalty, free kick,
    // confrontation, near-miss, or counter-attack with the constituent step
    // events attached as a `<type>Sequence` array (e.g. `penaltySequence`,
    // `freekickSequence`).  Each step event is a self-contained MatchEvent
    // describing one beat of the action: the foul, the card, the wall, the
    // run-up, the shot, etc.  Without flattening them into match_events the
    // live feed only ever shows the climactic summary — the "GOAL!" line —
    // and the entire dramatic build-up is invisible to readers.  We persist
    // the summary first (acts as a metadata header carrying outcome fields
    // like cardType, penaltyTaker, foulerTeam) then each beat in emit
    // order, so the live UI can reveal them chronologically.
    const SEQUENCE_FIELDS = [
      'penaltySequence',
      'freekickSequence',
      'confrontationSequence',
      'nearMissSequence',
      'counterSequence',
    ] as const;
    for (const field of SEQUENCE_FIELDS) {
      const seq = (ev as any)[field];
      if (!Array.isArray(seq)) continue;
      for (const sub of seq) {
        withinMinuteCount += 1;
        const subSub = Math.min(withinMinuteCount, SUBMINUTE_CAP) / SUBMINUTE_DIVISOR;
        events.push(toSimulatedEvent(sub, subSub));
      }
    }

    // ── Apply event side-effects ───────────────────────────────────────────
    // Update score, momentum, and player stats as events fire.
    //
    // GOAL ATTRIBUTION
    // ────────────────
    // gameEngine.js stamps every event with `team: posTeam.shortName`, so we
    // must compare against `home.shortName` here — comparing against `home.name`
    // (the full club name) only works by accident when shortName === name and
    // silently misattributes EVERY goal to the away column when they differ,
    // which is the actual bug that produced the 0–N "home never scores"
    // pattern on the first round of completed matches.
    if (ev.isGoal) {
      if (ev.team === home.shortName) score[0]++;
      else score[1]++;
    }

    // Momentum: clamp [0, 100]. The engine's deltas can be any signed integer,
    // but running momentum should stay in the valid display range.
    const dh = ev.momentumChange?.[0] ?? 0;
    const da = ev.momentumChange?.[1] ?? 0;
    momentum = [
      Math.max(0, Math.min(100, momentum[0] + dh)),
      Math.max(0, Math.min(100, momentum[1] + da)),
    ];

    // Player stats accumulation — goals, assists, shots, saves, tackles, cards.
    // The engine writes these when relevant events fire.
    if (ev.player) {
      const slot = playerStats[ev.player] ??= {
        goals: 0, assists: 0, shots: 0, saves: 0, tackles: 0,
        yellowCard: false, redCard: false,
      };
      if (ev.isGoal) slot.goals++;
      if (ev.type === 'shot') slot.shots++;
      if (ev.cardType === 'yellow') slot.yellowCard = true;
      if (ev.cardType === 'red') slot.redCard = true;
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
  // calcMVP selects the best-performing player based on accumulated stats.
  const mvpResult = calcMVP(playerStats, home, away);
  const mvp = mvpResult?.name ?? '—';

  return {
    events,
    finalScore: score,
    mvp,
    playerStats,
  };
}
