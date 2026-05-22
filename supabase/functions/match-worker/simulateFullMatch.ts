// ── simulateFullMatch.ts ──────────────────────────────────────────────────
// Pure 90-minute match simulator orchestrating the gameEngine.js event loop.
// Takes two normalized teams and returns a complete match result: events,
// final score, and MVP — all ready for DB persistence.

// @ts-expect-error - gameEngine.js has no TS declarations in this edge context
import { createAIManager, calcMVP, genEvent } from './gameEngine.js';
import type { EngineTeam, SimulationResult } from './gameEngine.types.ts';
import { applyFanBoostToTeam } from './applyFanBoost.ts';
import { CosmicVoiceEngine } from './cosmicVoices.ts';

// ── Input types ────────────────────────────────────────────────────────────

/**
 * Fan-boost result shape passed to simulateFullMatch.
 * Indicates which side gets a stat boost and by how many points.
 */
export interface FanBoostInput {
  boostedSide: 'home' | 'away' | 'none';
  boostAmount: number;
}

/**
 * Entity-graph referee assignment threaded through to createAIManager so
 * the engine reads the correct officiating identity AND so the Phase 8
 * card_severity reflex resolver can find the referee's persona/memories
 * via `entity_id`.
 *
 * Built from `match_referee_v` by the worker before simulation: the
 * view exposes the referee's name + display_name + the raw 1–10
 * strictness trait, which the caller multiplies by 10 to land on the
 * engine's 0–100 strictness scale (matching the src/ helper contract
 * documented in src/features/match/logic/simulateFullMatch.ts).
 */
export interface RefereeOverride {
  /** Display name shown in commentary lines (preferred over `name`). */
  name: string;
  /** Engine-scale strictness 0–100 (raw trait × 10). */
  strictness: number;
  /**
   * Universal Agent System entity id.  When present, the engine forwards
   * it through `aim.referee.entity_id` so the `card_severity` resolver
   * can hydrate the referee's persona + per-player memory grudges.
   * Null = legacy strictness-only path (no resolver lookup).
   */
  entity_id: string | null;
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
 * @param fanBoost    Optional fan-support boost result. When boostedSide is
 *                    'home' or 'away', that team's players get +boostAmount
 *                    to each stat BEFORE AI manager creation.
 * @param architect   Optional CosmicArchitect (see architect.ts).  When
 *                    provided, gameEngine threads `getRelationshipFor`,
 *                    `getFeaturedMortals`, and `getActiveRelationships` into
 *                    contest resolution + commentary, activating rivalry-based
 *                    card-bias multipliers and the weird-pool rate boost.
 * @param reflexHooks Optional Phase 8 reflex-tier hooks — corpus + dispatcher
 *                    for `shoot_or_pass` and `card_severity` decisions.
 * @param refOverride Optional entity-graph referee assignment built from
 *                    `match_referee_v`.  Threaded into createAIManager so
 *                    the engine reads the correct officiating identity AND
 *                    so `card_severity` can resolve the referee's persona
 *                    via `entity_id`.  When omitted, gameEngine fabricates
 *                    a random referee with `entity_id: null` — preserving
 *                    determinism for callers (smoke tests) that don't yet
 *                    plumb entity refs through.
 * @returns           Events + final score + MVP — ready for DB persistence.
 */
/**
 * Optional Phase 8 reflex-tier hooks.  Mirrors the src/ side's
 * `AgentReflexHooks`.  When provided, the engine's shoot_or_pass +
 * card_severity sites consult the resolvers via runDecision with
 * matching persona + memories looked up out of agentCorpus.  When
 * omitted, the engine falls back to legacy stat-driven behaviour.
 */
// deno-lint-ignore no-explicit-any
export interface AgentReflexHooks {
  // deno-lint-ignore no-explicit-any
  agentCorpus: any;
  // deno-lint-ignore no-explicit-any
  runDecision: (req: any) => any;
}

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
  reflexHooks: AgentReflexHooks | null = null,
  refOverride: RefereeOverride | null = null,
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
  // referee, and other per-match setup.  When `refOverride` is supplied
  // (post-isl-84e wiring) the engine uses the named referee + persona
  // entity_id; null falls back to the legacy random fabricated referee.
  const aim = createAIManager(boostedHome, boostedAway, refOverride);

  const score: [number, number] = [0, 0];
  let momentum: [number, number] = [...INITIAL_MOMENTUM];
  const playerStats: Record<string, any> = {};
  const events: SimulatedEvent[] = [];

  // ── Cosmic voices (#371) ──────────────────────────────────────────────────
  // One engine per match. Drifts Balance + Chaos interest levels per event;
  // returns 0-2 voice items per call. Items get persisted alongside engine
  // events as `balance_whisper` / `chaos_whisper` rows in match_events,
  // letting the live commentary surface in-match cosmic interruptions
  // (previously only emitted client-side, not by the production worker).
  const voiceEngine = new CosmicVoiceEngine();

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
    // genCtx threading.  gameEngine.js reads four cosmic fields:
    //   • architect            — feeds getRelationshipFor / getFeaturedMortals
    //                            / getActiveRelationships in contest +
    //                            commentary + foul-bias paths.
    //   • architectIntentions  — pre-decided narrative pulls; filtered to
    //                            the current minute so windows close cleanly.
    //   • architectEdictFn     — closure (isHome) → resolved edict modifiers
    //                            for the requested side, or {} when no edict.
    //   • architectFate        — sealed-fate decree (or null) the engine may
    //                            force-fire inside its window.
    //   • consumeFate          — callback gameEngine fires the moment it
    //                            executes the fated event so it can't double-fire.
    //
    // When `architect` is absent every accessor short-circuits to `null`/`[]`
    // / `{}` and gameEngine runs the empty-state branches — no behaviour
    // change vs the pre-Slice-6 worker.
    const architectIntentions = architect?.getIntentions?.(min) ?? [];
    const architectEdictFn    = architect
      ? (isHome: boolean) => architect.getEdictModifiers(isHome)
      : null;
    const architectFate       = architect?.getFate?.(min) ?? null;
    const consumeFate         = architect ? () => architect.consumeFate() : null;

    // Phase 8 reflex-tier hooks ride alongside the architect bag.  Both are
    // optional; the engine bails to legacy behaviour when either piece is
    // missing on a given decision call.
    const ev = genEvent(
      min, home, away, momentum, INITIAL_POSSESSION, playerStats, score,
      activePlayers, substitutionsUsed, null, aim, 0, lastEventType,
      {
        architect, architectIntentions, architectEdictFn, architectFate, consumeFate,
        agentCorpus: reflexHooks?.agentCorpus ?? null,
        runDecision: reflexHooks?.runDecision ?? null,
      },
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

    // ── Cosmic voices may speak in reaction to this event ──────────────────
    // Called AFTER the score update so Balance sees the just-updated state
    // (matters for "equaliser → BALANCE_LEVEL_SCORE" branch). Each returned
    // item gets its own subminute slot so the live UI reveals them
    // immediately after the engine event they reacted to.
    const voiceItems = voiceEngine.maybeInterrupt(ev as Record<string, any>, min, score[0], score[1]);
    for (const item of voiceItems) {
      withinMinuteCount += 1;
      const voiceSub = Math.min(withinMinuteCount, SUBMINUTE_CAP) / SUBMINUTE_DIVISOR;
      events.push({
        minute: item.minute,
        subminute: voiceSub,
        type: item.voice === 'balance' ? 'balance_whisper' : 'chaos_whisper',
        payload: {
          text:       item.text,
          voiceIndex: item.voiceIndex,
          color:      item.color,
          entityId:   item.entityId,
        },
      });
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
