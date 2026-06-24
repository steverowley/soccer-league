// ── features/match/logic/spatial/simulateSpatialMatch.ts ─────────────────────
// Orchestrator for the authoritative spatial match engine.  Builds the world
// from two teams, runs the fixed-timestep tick loop for the full match, samples
// position frames for replay, and returns the score + events + frames.
//
// This is the spatial analogue of the legacy simulateFullMatch.ts.  It is pure
// and deterministic: same teams + same seed ⇒ byte-identical result, so the
// stored frames, the live viewer, and the final score can never disagree.

import { type Vec2, dist2 } from './vec2';
import { makeRng } from './rng';
import {
  type SimPlayer, type SimPlayerStats, type SimWorld, type SimEvent,
  type TeamSide, type Role, type SimConfig, type SpatialMatchResult,
  type PositionFrame, type FramePlayer,
  CENTRE_SPOT,
} from './types';
import {
  type Formation, FORMATION_SLOTS, slotToAbsolute, narrowFormation,
} from './formation';
import { step } from './step';
import { resolveStyle } from './playStyle';

// ── Input shapes ──────────────────────────────────────────────────────────────

/** One player as handed to the spatial engine (the DB adapter builds these). */
export interface SpatialPlayerInput {
  id:    string;
  name:  string;
  role:  Role;
  stats: SimPlayerStats;
}

/** One team: a formation key, its starting XI, and an optional bench. */
export interface SpatialTeamInput {
  formation: string;        // free-text from DB; narrowed internally
  players:   SpatialPlayerInput[];
  /** Substitutes available to bring on (up to 5); omitted ⇒ no bench. */
  bench?:    SpatialPlayerInput[];
  /** Manager's `managers.style` string; omitted/unknown ⇒ Balanced (no effect). */
  playStyle?: string;
}

// ── Default config ──────────────────────────────────────────────────────────

/**
 * Default simulation knobs.  10Hz physics is smooth enough for believable
 * steering while keeping the full match well under a second of compute; 0.5s
 * frame sampling interpolates cleanly on the client via CSS transitions.
 */
export const DEFAULT_CONFIG: SimConfig = {
  dtSec:         0.1,        // 10 Hz physics
  matchSeconds:  90 * 60,    // full regulation match
  frameEverySec: 2,          // 1 frame / 2s — match_positions PK is whole-second (match_id,minute,second)
  seed:          1,
  stoppage:      true,       // play deterministic added time after regulation
};

/** Substitutions each side may make in a match (the standard three changes). */
const MAX_SUBSTITUTIONS = 3;

/**
 * Deterministic added-time allowance (in seconds) for a finished regulation
 * period.  Real added time accrues mostly from goal celebrations and bookings
 * on top of a base allowance for subs, knocks and ball retrieval; we mirror that
 * from the regulation event stream so the same fixture always adds the same
 * minutes.  No half-time split is modelled, so this single block stands in for
 * the match's total added time.
 *
 * @param events  The regulation event stream (goals + carded fouls are counted).
 * @returns       Whole seconds of stoppage time, clamped to a believable 1–6 min.
 */
function stoppageSeconds(events: SimEvent[]): number {
  let goals = 0;
  let cards = 0;
  for (const e of events) {
    if (e.type === 'goal') goals += 1;
    else if (e.type === 'foul' && e.card) cards += 1;
  }
  const BASE = 45;      // baseline allowance (s)
  const PER_GOAL = 25;  // celebration + restart per goal (s)
  const PER_CARD = 20;  // booking admin per card (s)
  const sec = BASE + goals * PER_GOAL + cards * PER_CARD;
  return Math.min(360, Math.max(60, Math.round(sec))); // clamp to 1–6 minutes
}

// ── World construction ────────────────────────────────────────────────────────

/**
 * Convert a 0–99 speed stat into a top sprint speed in m/s.
 * Maps roughly: 40 → 6.4 m/s (pedestrian), 95 → 8.4 m/s (elite sprinter).
 * Real top speeds sit ~7–9 m/s, so this keeps the band believable.
 */
function speedToMaxMs(speed: number): number {
  return 5.0 + (speed / 100) * 3.6;
}

/**
 * Assign a team's players to its formation's 11 slots, matching by role where
 * possible.  Players are bucketed by role; each slot pulls a player of its own
 * role, falling back to any remaining player when a role bucket runs dry (so a
 * short or oddly-shaped squad still fields a full XI rather than gaps).
 *
 * @param players    The team's players (ideally the 11 starters).
 * @param formation  The resolved formation key.
 * @param side       Which side — sets the absolute home positions.
 * @returns          11 fully-built SimPlayers in slot order (GK first).
 */
function buildTeam(
  players: SpatialPlayerInput[],
  formation: Formation,
  side: TeamSide,
): SimPlayer[] {
  const slots = FORMATION_SLOTS[formation];

  // Bucket available players by role; we pop from these as slots demand.
  const buckets: Record<Role, SpatialPlayerInput[]> = { GK: [], DF: [], MF: [], FW: [] };
  for (const p of players) buckets[p.role].push(p);
  const leftovers: SpatialPlayerInput[] = [];

  const built: SimPlayer[] = [];
  for (const slot of slots) {
    // Prefer a player whose role matches the slot; else borrow from leftovers
    // or any non-empty bucket so we always fill all 11 slots.
    let pick = buckets[slot.role].shift();
    if (!pick) {
      pick =
        leftovers.shift() ??
        buckets.MF.shift() ?? buckets.DF.shift() ??
        buckets.FW.shift() ?? buckets.GK.shift();
    }
    const home = slotToAbsolute(slot, side);
    if (pick) {
      built.push(makeSimPlayer(pick, slot.role, side, home));
    } else {
      // Genuinely no players supplied for this slot — synthesise a filler so
      // the match still runs (defensive; real fixtures always have 11).
      built.push(makeSimPlayer(
        { id: `${side}-filler-${built.length}`, name: 'Reserve', role: slot.role, stats: fillerStats() },
        slot.role, side, home,
      ));
    }
  }

  // Any unused players land in `leftovers` for the fallback above; collect the
  // surplus after role buckets so the borrow order is deterministic.
  for (const role of ['GK', 'DF', 'MF', 'FW'] as const) leftovers.push(...buckets[role]);

  return built;
}

/** Neutral 60-rated stat line for a synthesised filler player. */
function fillerStats(): SimPlayerStats {
  return {
    shooting: 60, passing: 60, dribbling: 60, speed: 60, stamina: 60,
    tackling: 60, positioning: 60, goalkeeping: 60, vision: 60,
  };
}

/** Build one live SimPlayer from static input + a resolved home position. */
function makeSimPlayer(
  input: SpatialPlayerInput,
  role: Role,
  side: TeamSide,
  home: Vec2,
): SimPlayer {
  return {
    id:       input.id,
    name:     input.name,
    role,
    side,
    stats:    input.stats,
    homePos:  home,
    maxSpeed: speedToMaxMs(input.stats.speed),
    pos:      home,
    vel:      { x: 0, y: 0 },
    stamina:  1,
    yellowCards: 0,
    sentOff:  false,
  };
}

/**
 * Assemble the initial world: both teams in formation, ball on the centre spot
 * owned by the home side's most central midfielder (the kickoff taker).
 */
function buildWorld(
  home: SpatialTeamInput,
  away: SpatialTeamInput,
  dtSec: number,
): SimWorld {
  const homePlayers = buildTeam(home.players, narrowFormation(home.formation), 'home');
  const awayPlayers = buildTeam(away.players, narrowFormation(away.formation), 'away');

  // Bench players are built but kept off the pitch (not in frames) until a
  // substitution brings one on; their home position is a placeholder — a sub
  // inherits the formation slot of the player they replace.
  const homeBench = (home.bench ?? []).map((p) => makeSimPlayer(p, p.role, 'home', CENTRE_SPOT));
  const awayBench = (away.bench ?? []).map((p) => makeSimPlayer(p, p.role, 'away', CENTRE_SPOT));

  // Kickoff taker: the home player nearest the centre spot (a central MF).
  let taker = homePlayers[0];
  let bestD2 = Infinity;
  for (const p of homePlayers) {
    if (p.role === 'GK') continue;
    const d2 = dist2(p.pos, CENTRE_SPOT);
    if (d2 < bestD2) { bestD2 = d2; taker = p; }
  }

  return {
    home: homePlayers,
    away: awayPlayers,
    homeBench,
    awayBench,
    homeSubsLeft: MAX_SUBSTITUTIONS,
    awaySubsLeft: MAX_SUBSTITUTIONS,
    homeStyle: resolveStyle(home.playStyle),
    awayStyle: resolveStyle(away.playStyle),
    ball: {
      pos: CENTRE_SPOT,
      vel: { x: 0, y: 0 },
      ownerId: taker ? taker.id : null,
      loosePopCooldown: 0,
      heldSec: 0,
      lastTouch: null,
      offsideFor: null,
    },
    score: [0, 0],
    clockSec: 0,
    phase: 'open_play',
    deadBallTicks: 0,
    dtSec,
  };
}

// ── Frame sampling ────────────────────────────────────────────────────────────

/** Capture the current world as a compact, JSON-friendly replay frame. */
function sampleFrame(world: SimWorld): PositionFrame {
  const players: FramePlayer[] = [];
  for (const p of [...world.home, ...world.away]) {
    // Round to 0.1m — invisible on screen, but shrinks stored frame JSON.
    players.push({ id: p.id, x: Math.round(p.pos.x * 10) / 10, y: Math.round(p.pos.y * 10) / 10 });
  }
  return {
    tSec: Math.round(world.clockSec * 10) / 10,
    players,
    ball: {
      x: Math.round(world.ball.pos.x * 10) / 10,
      y: Math.round(world.ball.pos.y * 10) / 10,
      ownerId: world.ball.ownerId,
    },
  };
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Simulate a full spatial match.
 *
 * @param home    Home team (formation + starting XI).
 * @param away    Away team (formation + starting XI).
 * @param config  Optional overrides (seed, timestep, length, frame rate).
 * @returns       Final score, the emergent event stream, and replay frames.
 */
export function simulateSpatialMatch(
  home: SpatialTeamInput,
  away: SpatialTeamInput,
  config: Partial<SimConfig> = {},
): SpatialMatchResult {
  const cfg: SimConfig = { ...DEFAULT_CONFIG, ...config };
  const rng = makeRng(cfg.seed);
  const world = buildWorld(home, away, cfg.dtSec);

  const events: SimEvent[] = [];
  const frames: PositionFrame[] = [];

  // Kickoff marker at t=0 so consumers have a clean "match started" beat.
  events.push({ tSec: 0, minute: 1, type: 'kickoff' });

  let nextFrameAt = 0;
  // One physics tick: sample a frame on cadence (before stepping, so the first
  // frame is the kickoff arrangement at t=0), then advance the world.  Shared by
  // the regulation loop and the stoppage-time loop so they stay byte-identical.
  const runTick = (): void => {
    if (world.clockSec >= nextFrameAt) {
      frames.push(sampleFrame(world));
      nextFrameAt += cfg.frameEverySec;
    }
    const tickEvents = step(world, rng, cfg.dtSec);
    if (tickEvents.length > 0) events.push(...tickEvents);
  };

  // ── Regulation ──────────────────────────────────────────────────────────────
  const regulationTicks = Math.round(cfg.matchSeconds / cfg.dtSec);
  for (let i = 0; i < regulationTicks; i++) runTick();

  // ── Stoppage (added) time ─────────────────────────────────────────────────
  // Play on past regulation for a deterministic allowance derived from the match
  // so far.  Events here carry minute > 90 (the engine no longer clamps), which
  // the DB and viewer already accommodate (match_events/positions allow 0–120).
  if (cfg.stoppage) {
    const stoppageTicks = Math.round(stoppageSeconds(events) / cfg.dtSec);
    for (let i = 0; i < stoppageTicks; i++) runTick();
  }

  world.phase = 'finished';
  // Always capture a final frame so the replay ends on the true full-time state.
  frames.push(sampleFrame(world));

  return {
    finalScore: [world.score[0], world.score[1]],
    events,
    frames,
  };
}
