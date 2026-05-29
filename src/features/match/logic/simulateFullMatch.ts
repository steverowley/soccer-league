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
  resolveInterference,
  type AnnulGoalIntent,
  type InterferenceContext,
} from './interferenceResolver';
import {
  zoneCentre, playerHomeZone, applyZoneDelta, situationZoneDelta,
  getPositionalInstructions,
  PITCH_WIDTH, PITCH_HEIGHT,
  type ActionBias,
} from './zoneMapping';
import type { RelationshipIndex } from './matchRelationships';

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

// ── Position snapshot types ───────────────────────────────────────────────────
//
// The 2D pitch viewer needs continuous positional data to animate 22 player
// dots and a ball between events.  Rather than run a real-time physics sim
// (too complex for a batch engine), we pre-compute positions at regular
// 2-second intervals during batch simulation and store them alongside events.
// The client fetches all snapshots upfront and replays them at 1× speed,
// interpolating between 2-second ticks with CSS transitions.
//
// Architecture note: this is the same approach Football Manager uses — their
// 2D engine is also a replay system, not live physics.

/**
 * Per-player position in a single 2-second snapshot.
 *
 * x/y use FIFA pitch coordinates (metres from top-left corner):
 *   x ∈ [0, 105] — 0 = home goal line, 105 = away goal line
 *   y ∈ [0,  68] — 0 = top touchline, 68 = bottom touchline
 */
export interface SnapshotPlayer {
  /** entity_id from the DB (or player name as a fallback for legacy fixtures). */
  id:      string;
  x:       number;
  y:       number;
  /** True for at most one player per snapshot — the current ball carrier. */
  hasBall: boolean;
}

/**
 * A single 2-second positional snapshot for all 22 active players and the ball.
 * Written to `match_positions` by the worker; read once by the browser upfront.
 *
 * minute + second form the composite PK: minute ∈ [1, 90], second ∈ [0, 58, step 2].
 * 30 snapshots per minute × 90 minutes = 2 700 rows per match (~3.2 MB of JSONB).
 */
export interface PositionSnapshot {
  minute:  number;
  second:  number;
  /** All active player positions for this tick. */
  players: SnapshotPlayer[];
  /** Ball position and the player who owns it (null when ball is loose). */
  ball:    { x: number; y: number; ownerId: string | null };
}

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
  /**
   * 2-second positional snapshots for all 22 active players + ball.
   * ~2 700 entries per match (30/min × 90 min).  Worker batch-inserts these
   * into `match_positions`; the browser fetches them once for the 2D viewer.
   */
  positionSnapshots: PositionSnapshot[];
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

// ── Position snapshot helpers ─────────────────────────────────────────────────
//
// Position snapshots are emitted every SNAPSHOT_INTERVAL_SECONDS of match time.
// Within each minute the engine does not track individual ball movements —
// it only resolves discrete events.  So the snapshot positions are
// zone-centre coordinates (from zoneMapping.ts) plus a small deterministic
// jitter that gives each player a unique "idle" position within their zone.
//
// WHY DETERMINISTIC JITTER (not Math.random())
// ─────────────────────────────────────────────
// Math.random() during snapshot emission would consume RNG calls and shift
// the seed for the next genEvent() call, breaking smoke-test determinism.
// The LCG-hash jitter below is pure arithmetic — no global RNG consumed.

/** Emit one position snapshot every N seconds of match time (0-indexed within minute). */
const SNAPSHOT_INTERVAL_SECONDS = 2;

/**
 * Deterministic jitter for player positions within a zone.
 *
 * Uses a one-round LCG hash of (minute, second, playerIndex, axis) so every
 * snapshot for a given player is unique but reproducible.  Output range: ±3
 * metres — sub-zone variation that keeps the pitch alive without moving
 * players out of their tactical area.
 *
 * @param min   Match minute (1–90).
 * @param sec   Second within the minute (0, 2, 4, … 58).
 * @param idx   Ordinal index of the player across both teams (0–43).
 * @param axis  0 = x-axis, 1 = y-axis.  Using different axis constants
 *              ensures x and y jitter are uncorrelated for the same player.
 * @returns     Signed offset in metres, in the range [−3, +3].
 */
function playerJitter(min: number, sec: number, idx: number, axis: 0 | 1): number {
  // LCG parameters from Numerical Recipes — same family used in the engine's
  // seeded smoke tests so the bit-width arithmetic is familiar.
  const seed = min * 37 + sec * 13 + idx * 7 + axis * 3;
  // Mask to 14 bits (0–16383) then map to [−3, +3].
  return ((seed * 1664525 + 1013904223) & 0x3fff) / 0x3fff * 6 - 3;
}

/**
 * Build a single 2-second position snapshot for all active players and the ball.
 *
 * Player positions come from:
 *   1. Formation home zone (jersey number → zone via FORMATION_ZONES in zoneMapping.ts)
 *   2. Situation delta  (possession + score pushes players toward/away from goal)
 *   3. Deterministic jitter (±3 m to create organic idle motion)
 *
 * Ball position follows the possession team's most advanced active player
 * (highest-row zone = closest to opponent's goal).  When the snapshot has no
 * possession context the ball sits at the pitch centre.
 *
 * @param min               Match minute (1–90).
 * @param sec               Second within the minute (0, 2, 4, … 58).
 * @param home              Home team (with full player list and formation).
 * @param away              Away team.
 * @param activeHome        Names of home players currently on the pitch.
 * @param activeAway        Names of away players currently on the pitch.
 * @param hasPossessionHome True when the home team has the ball this tick.
 * @param score             Running score as [home, away] goals.
 * @returns                 PositionSnapshot ready to push onto the result array.
 */
function emitPositionSnapshot(
  min:               number,
  sec:               number,
  home:              EngineTeam,
  away:              EngineTeam,
  activeHome:        string[],
  activeAway:        string[],
  hasPossessionHome: boolean,
  score:             [number, number],
): PositionSnapshot {
  const players: Array<{ id: string; x: number; y: number; hasBall: boolean }> = [];

  // Track the most advanced player on the possession team for ball placement.
  // "Most advanced" = furthest into the opponent's half = highest x for home,
  // lowest x for away.  We update this as we iterate players.
  let ballOwnerId: string | null = null;
  let ballX = PITCH_WIDTH / 2;  // default: kick-off centre spot
  let ballY = PITCH_HEIGHT / 2;
  let bestAdvanceX = hasPossessionHome ? -1 : PITCH_WIDTH + 1;

  /**
   * Build one player entry and update ball placement candidate.
   * @param p       Engine player.
   * @param pIdx    Index offset (0–21 home, 22–43 away) for deterministic jitter.
   * @param isAway  True for the away team — mirrors the zone coordinate system.
   */
  function addPlayer(p: EnginePlayer, pIdx: number, isAway: boolean): void {
    const activeNames = isAway ? activeAway : activeHome;
    if (!activeNames.includes(p.name)) return;

    // ── Zone calculation ──────────────────────────────────────────────────
    // 1. Start from the player's formation home zone (jersey number → zone).
    //    jersey_number is 1-indexed; playerHomeZone clamps to [1, 22].
    const homeZone = playerHomeZone(p.jersey_number, isAway ? away.tactics : home.tactics);

    // 2. Apply a situation delta: possession pushes attackers forward,
    //    deficit late in the game pushes everyone forward, comfort retreats.
    const teamScoreDiff = isAway ? score[1] - score[0] : score[0] - score[1];
    const hasPossession = isAway ? !hasPossessionHome : hasPossessionHome;
    const delta = situationZoneDelta(
      { hasPossession, scoreDiff: teamScoreDiff, minute: min, chaosLevel: 0 },
      p.position,
    );
    const zone = applyZoneDelta(homeZone, delta);

    // 3. Convert zone to pitch metres, then add deterministic jitter.
    const centre = zoneCentre(zone, isAway);
    const jX = playerJitter(min, sec, pIdx, 0);
    const jY = playerJitter(min, sec, pIdx, 1);
    const x = Math.max(0, Math.min(PITCH_WIDTH,  centre.x + jX));
    const y = Math.max(0, Math.min(PITCH_HEIGHT, centre.y + jY));

    // ── Player ID ─────────────────────────────────────────────────────────
    // Use entity_id (FK into the entities table) when available — the 2D
    // viewer uses it to resolve player name, jersey number, and colour
    // without a separate DB lookup.  Fall back to the name string for legacy
    // fixtures that pre-date the entity system.
    const id = p.entity_id ?? p.name;
    players.push({ id, x, y, hasBall: false });

    // ── Ball candidate ────────────────────────────────────────────────────
    // Only consider players on the possession side.  Among those, pick the
    // one furthest into the opponent's half — typically a forward or advanced
    // midfielder — as the ball carrier.  GKs are excluded because they hold
    // the ball far from the action, which would make the ball appear to
    // teleport backward whenever the home team has a GK distribution.
    if (hasPossession && p.position !== 'GK') {
      const isMoreAdvanced = hasPossessionHome
        ? x > bestAdvanceX     // home attacks right → higher x = more advanced
        : x < bestAdvanceX;    // away attacks left  → lower  x = more advanced
      if (isMoreAdvanced) {
        bestAdvanceX = x;
        ballOwnerId  = id;
        // Ball trails the carrier by a small offset in the direction of attack.
        ballX = hasPossessionHome ? x + 1.5 : x - 1.5;
        ballY = y;
      }
    }
  }

  home.players.forEach((p, i) => addPlayer(p, i,      false));
  away.players.forEach((p, i) => addPlayer(p, i + 22, true));

  // Mark the ball carrier in the player array.
  if (ballOwnerId !== null) {
    const carrier = players.find(pp => pp.id === ballOwnerId);
    if (carrier) carrier.hasBall = true;
  }

  return {
    minute: min,
    second: sec,
    players,
    ball: { x: ballX, y: ballY, ownerId: ballOwnerId },
  };
}

/**
 * Compute a team-level action-bias for this minute's genCtx.
 *
 * Used by gameEngine.js to shade the event-selection roll toward shooting,
 * passing, or tackling based on the manager's playstyle, the team's stats,
 * and the live match situation.  Called once per minute per team, then
 * cached in genCtx for the duration of that minute's genEvent() call.
 *
 * @param team      The engine team to compute bias for.
 * @param scoreDiff Goal difference from this team's perspective (positive = winning).
 * @param minute    Current match minute.
 * @returns         ActionBias with all weights ≥ 0.01.
 */
function computeTeamBias(
  team:      EngineTeam,
  scoreDiff: number,
  minute:    number,
): ActionBias {
  // Use the first active outfield player's position as the "representative"
  // position for this team.  The bias is primarily driven by the manager's
  // style, not by individual player positions, so this is a reasonable proxy
  // for the team's collective tendency this minute.
  //
  // We prefer 'MF' as the default because midfielders mediate between attack
  // and defence, making MF the closest approximation of a "team average".
  const firstOutfield = team.players.find(p => p.starter && p.position !== 'GK');
  const position = firstOutfield?.position ?? 'MF';

  // Manager stats are normalised to 70 by normalizeTeamForEngine when absent,
  // so this cast is safe — the engine contract guarantees the fields exist.
  const mgr = team.manager as {
    personality?: string;
    attacking?:   number;
    defending?:   number;
    mental?:      number;
    athletic?:    number;
    technical?:   number;
  };

  return getPositionalInstructions(
    position,
    mgr.personality,
    {
      attacking:  mgr.attacking  ?? 70,
      defending:  mgr.defending  ?? 70,
      mental:     mgr.mental     ?? 70,
      athletic:   mgr.athletic   ?? 70,
      technical:  mgr.technical  ?? 70,
    },
    scoreDiff,
    minute,
  );
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
 * Two distinct interference flavours live here, applied at different
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
 * The caller maps `architect.activeCurses` / `activeBlesses` /
 * `pickedAnnulIntents` into these fields, then passes a deterministic
 * RNG for reproducibility (seeded LCG in tests, Math.random in prod).
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
   * Injected RNG ∈ [0, 1). Called at most once per applicable
   * event/intent; pure pass-through otherwise. Defaults to
   * Math.random when the caller omits it.
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
  /**
   * Pre-loaded entity relationship graph for the 22+22 match participants.
   * Call `preloadMatchRelationships(db, participantIds)` before kickoff and
   * pass the result here so the engine can resolve partnership/rivalry
   * modifiers inside `resolveContest()` without any async I/O in the hot path.
   *
   * When omitted (smoke tests, legacy callers, preview simulations), the
   * engine falls back to zero-modifier behaviour — all relationship bonuses
   * are treated as absent.  The match result is still fully deterministic;
   * relationships just don't shade contest outcomes.
   */
  relationshipIndex?: RelationshipIndex,
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
  const positionSnapshots: PositionSnapshot[] = [];

  // Active XI = starters at kickoff.  No subs simulated in this iteration.
  const activePlayers = {
    home: home.players.filter((p: EnginePlayer) => p.starter).map((p) => p.name),
    away: away.players.filter((p: EnginePlayer) => p.starter).map((p) => p.name),
  };
  const substitutionsUsed = { home: 0, away: 0 };

  let lastEventType: string | null = null;

  // ── Possession tracking for position snapshots ─────────────────────────────
  // The engine stamps every event with `team: posTeam.shortName` (the team
  // that had the ball this minute).  We mirror that here so the snapshot
  // emitter knows which team to position near the opponent's goal and which
  // team to group in their own half.
  //
  // Default: home team kicks off → home starts with possession.
  let hasPossessionHome = true;

  // ── Per-minute simulation loop ─────────────────────────────────────────────
  // We track an in-minute counter so multiple events fired at the same minute
  // get distinct subminute values.  Reset on minute change.
  let currentMinute = 0;
  let withinMinute  = 0;

  for (let min = 1; min <= REGULATION_MINUTES; min++) {
    // ── Decision blender: per-minute team biases ───────────────────────────
    // Compute each team's action-bias vector (shoot / pass / dribble / tackle /
    // press weights) once per minute and thread them into genCtx so
    // gameEngine.js can shade the event-selection roll toward or away from
    // the shot branch.  This activates the previously dead-code path that
    // reads manager playstyle, manager stats, and match situation inside
    // the roll modifier block at genEvent line ~1370.
    //
    // WHY PER-MINUTE (not per-event): biases change with the scoreline and
    // minute, but the engine only has one event per minute on average.
    // Recomputing per-minute keeps the bias current without the overhead of
    // recomputing 30× per minute for the snapshot ticks.
    const homeScoreDiff = score[0] - score[1];
    const awayScoreDiff = score[1] - score[0];
    const homeTeamBias  = computeTeamBias(home, homeScoreDiff, min);
    const awayTeamBias  = computeTeamBias(away, awayScoreDiff, min);

    // The 10th positional arg (aiInfluence) is the SHOOT/ATTACK bias bag —
    // null in the worker since we're not modelling manager AI here.
    // The 14th arg (genCtx) carries Phase 8 reflex hooks when the caller
    // supplied them.  Empty object preserves the legacy behaviour when no
    // hooks are passed.
    const genCtx = {
      ...(reflexHooks
        ? { agentCorpus: reflexHooks.agentCorpus, runDecision: reflexHooks.runDecision }
        : {}),
      // Decision blender biases (Phase 2 decision core).
      // gameEngine.js reads these from genCtx and applies a shoot-bias roll
      // modifier after the base roll is computed (see genEvent ~line 1370).
      homeTeamBias,
      awayTeamBias,
      // Relationship index for resolveContest (Phase 2 wiring).
      // When present, the engine populates the `relationship` parameter of
      // resolveContest() for partnership/rivalry modifiers — currently a
      // no-op hook that is populated here and consumed in Phase 2B once the
      // engine-side resolver is wired.
      ...(relationshipIndex ? { relationshipIndex } : {}),
    };
    const ev = genEvent(
      min, home, away, momentum, INITIAL_POSSESSION, playerStats, score,
      activePlayers, substitutionsUsed, null, aim, 0, lastEventType, genCtx,
    );

    // ── Event processing (skipped for quiet minutes) ──────────────────────
    if (ev) {
      // Update possession state from the event's `team` tag.
      // genEvent always stamps events with `team: posTeam.shortName`
      // (the team that had the ball), so this is a reliable possession
      // signal that feeds the snapshot emitter for the next tick.
      hasPossessionHome = ev.team === home.shortName;

      // ── subminute assignment ──────────────────────────────────────────────
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

      // ── Architect interference post-pass (#428 slice 2) ──────────────────
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

      // ── Apply event side-effects ──────────────────────────────────────────
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
    } // end if (ev)

    // ── Position snapshots (emitted every minute, event or not) ───────────
    // The 2D pitch viewer needs continuous positional data even during quiet
    // minutes where genEvent() fires no event.  We emit SNAPSHOT_INTERVAL_SECONDS
    // ticks per minute regardless of whether an event occurred so the
    // client-side animation loop never stalls waiting for the next snapshot.
    //
    // Player positions within a minute vary only by deterministic jitter —
    // the tactical zone stays constant.  The subtle idle motion (±3 m) makes
    // the pitch feel alive without simulating physics between events.
    for (let sec = 0; sec < 60; sec += SNAPSHOT_INTERVAL_SECONDS) {
      positionSnapshots.push(emitPositionSnapshot(
        min, sec,
        home, away,
        activePlayers.home, activePlayers.away,
        hasPossessionHome,
        score,
      ));
    }
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
    positionSnapshots,
  };
}
