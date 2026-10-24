// ── features/match/logic/spatial/simulateSpatialMatch.ts ─────────────────────
// Orchestrator for the authoritative spatial match engine.  Builds the world
// from two teams, runs the fixed-timestep tick loop for the full match, samples
// position frames for replay, and returns the score + events + frames.
//
// It is pure and deterministic: same teams + same seed gives a byte-identical
// result, so the stored frames, the live viewer, and the final score can never
// disagree.  Each player owns a private imprecision stream derived from the
// match seed and his roster index (rng.streamSeed).

import { type Vec2, dist2, vec } from './vec2.ts';
import { makeRng, streamSeed } from './rng.ts';
import {
  type SimPlayer, type SimPlayerStats, type SimWorld, type SimEvent,
  type TeamSide, type Role, type SimConfig, type SpatialMatchResult,
  type PositionFrame, type FramePlayer, type EngineFlags,
  CENTRE_SPOT,
} from './types.ts';
import {
  type Formation, FORMATION_SLOTS, slotToAbsolute, narrowFormation,
} from './formation.ts';
import { step } from './step.ts';
import { resolveStyle } from './playStyle.ts';
import { personalityWeights, NEUTRAL_WEIGHTS } from './traitModifiers.ts';
import { beginRestart, restartTarget } from './setpiece.ts';

// ── Input shapes ──────────────────────────────────────────────────────────────

/** One player as handed to the spatial engine (the DB adapter builds these). */
export interface SpatialPlayerInput {
  id:    string;
  name:  string;
  role:  Role;
  stats: SimPlayerStats;
  /** Personality archetype (entities layer); omitted means neutral. */
  personality?: string | null;
}

/** One team: a formation key, its starting XI, and an optional bench. */
export interface SpatialTeamInput {
  formation: string;        // free-text from DB; narrowed internally
  players:   SpatialPlayerInput[];
  /** Substitutes available to bring on (up to 5); omitted means no bench. */
  bench?:    SpatialPlayerInput[];
  /** Manager's `managers.style` string; omitted/unknown means Balanced. */
  playStyle?: string;
}

// ── Default config ──────────────────────────────────────────────────────────

/**
 * Default simulation knobs.  10Hz physics; one stored frame every 2 s (the
 * match_positions PK is whole-second).
 */
export const DEFAULT_CONFIG: SimConfig = {
  dtSec:         0.1,        // 10 Hz physics
  matchSeconds:  90 * 60,    // full regulation match
  frameEverySec: 2,          // 1 frame / 2s
  seed:          1,
  stoppage:      true,       // play deterministic added time after regulation
};

/** Every ablation switch on: the full engine. */
export const DEFAULT_FLAGS: EngineFlags = {
  imprecision: true,
  utilitySoftness: true,
  personality: true,
  confidence: true,
  momentum: true,
  scoreClockTerm: true,
};

/** Substitutions each side may make in a match (the standard three changes). */
const MAX_SUBSTITUTIONS = 3;

/** Salt for the per-player imprecision streams. */
const PLAYER_STREAM_SALT = 0x51;

/**
 * Deterministic added-time allowance (s) for a finished regulation period,
 * from goals and bookings on top of a base allowance.
 *
 * @param events  The regulation event stream.
 * @returns       Whole seconds of stoppage time, clamped to 1-6 minutes.
 */
function stoppageSeconds(events: SimEvent[]): number {
  let goals = 0;
  let cards = 0;
  for (const e of events) {
    if (e.type === 'goal') goals += 1;
    else if (e.type === 'foul' && e.card) cards += 1;
  }
  const BASE = 45;
  const PER_GOAL = 25;
  const PER_CARD = 20;
  const sec = BASE + goals * PER_GOAL + cards * PER_CARD;
  return Math.min(360, Math.max(60, Math.round(sec)));
}

// ── World construction ────────────────────────────────────────────────────────

/** Convert a 0-99 speed stat into a top sprint speed in m/s (40 -> 6.4, 95 -> 8.4). */
function speedToMaxMs(speed: number): number {
  return 5.0 + (speed / 100) * 3.6;
}

/**
 * Assign a team's players to its formation's 11 slots, matching by role where
 * possible, falling back to any remaining player when a role bucket runs dry.
 */
function buildTeam(
  players: SpatialPlayerInput[], formation: Formation, side: TeamSide, cfg: SimConfig, flags: EngineFlags, indexBase: number,
): SimPlayer[] {
  const slots = FORMATION_SLOTS[formation];
  const buckets: Record<Role, SpatialPlayerInput[]> = { GK: [], DF: [], MF: [], FW: [] };
  for (const p of players) buckets[p.role].push(p);
  const leftovers: SpatialPlayerInput[] = [];
  const built: SimPlayer[] = [];
  for (const slot of slots) {
    let pick = buckets[slot.role].shift();
    if (!pick) {
      pick = leftovers.shift() ?? buckets.MF.shift() ?? buckets.DF.shift() ?? buckets.FW.shift() ?? buckets.GK.shift();
    }
    const home = slotToAbsolute(slot, side);
    const idx = indexBase + built.length;
    if (pick) {
      built.push(makeSimPlayer(pick, slot.role, side, home, cfg, flags, idx));
    } else {
      built.push(makeSimPlayer(
        { id: `${side}-filler-${built.length}`, name: 'Reserve', role: slot.role, stats: fillerStats() },
        slot.role, side, home, cfg, flags, idx,
      ));
    }
  }
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
  input: SpatialPlayerInput, role: Role, side: TeamSide, home: Vec2, cfg: SimConfig, flags: EngineFlags, index: number,
): SimPlayer {
  return {
    id:       input.id,
    name:     input.name,
    role,
    side,
    stats:    input.stats,
    homePos:  home,
    maxSpeed: speedToMaxMs(input.stats.speed),
    rng:      makeRng(streamSeed(cfg.seed, index, PLAYER_STREAM_SALT)),
    traits:   flags.personality ? personalityWeights(input.personality) : NEUTRAL_WEIGHTS,
    pos:      home,
    vel:      vec(0, 0),
    stamina:  1,
    confidence: flags.confidence ? (side === 'home' ? 0.56 : 0.47) : 0.5,
    yellowCards: 0,
    sentOff:  false,
    job:      'shape',
    jobTarget: home,
    jobRef:   null,
    nextThinkSec: 0,
    noTouchUntil: 0,
    recoverUntil: 0,
    lunge:    null,
    dive:     null,
    reactUntil: 0,
    jobOffset: vec(0, 0),
    holds:    0,
  };
}

/** Assemble the initial world, set up for the opening kickoff. */
function buildWorld(home: SpatialTeamInput, away: SpatialTeamInput, cfg: SimConfig, flags: EngineFlags): SimWorld {
  const homePlayers = buildTeam(home.players, narrowFormation(home.formation), 'home', cfg, flags, 0);
  const awayPlayers = buildTeam(away.players, narrowFormation(away.formation), 'away', cfg, flags, 11);
  const homeBench = (home.bench ?? []).map((p, i) => makeSimPlayer(p, p.role, 'home', CENTRE_SPOT, cfg, flags, 22 + i));
  const awayBench = (away.bench ?? []).map((p, i) => makeSimPlayer(p, p.role, 'away', CENTRE_SPOT, cfg, flags, 32 + i));

  // Kickoff taker: the home outfielder nearest the centre spot.
  let taker = homePlayers[0];
  let bestD2 = Infinity;
  for (const p of homePlayers) {
    if (p.role === 'GK') continue;
    const d2 = dist2(p.pos, CENTRE_SPOT);
    if (d2 < bestD2) { bestD2 = d2; taker = p; }
  }

  const world: SimWorld = {
    home: homePlayers,
    away: awayPlayers,
    homeBench,
    awayBench,
    homeSubsLeft: MAX_SUBSTITUTIONS,
    awaySubsLeft: MAX_SUBSTITUTIONS,
    homeStyle: resolveStyle(home.playStyle),
    awayStyle: resolveStyle(away.playStyle),
    ball: {
      pos: CENTRE_SPOT, vel: vec(0, 0), z: 0, vz: 0,
      ownerId: null, lastTouchId: null, lastTouchSide: null, lastTouchSec: -1, controlSec: -1,
      kick: null, offsideFor: null,
    },
    score: [0, 0],
    clockSec: 0,
    phase: 'open_play',
    restart: null,
    matchSeconds: cfg.matchSeconds,
    momentum: [0, 0],
    lastShot: null,
    flags,
    trace: cfg.trace ?? null,
    dtSec: cfg.dtSec,
  };
  // The opening kickoff: everyone starts in their kickoff position.
  beginRestart(world, 'kickoff', 'home', CENTRE_SPOT, -1000, false, taker?.id);
  for (const p of [...homePlayers, ...awayPlayers]) p.pos = restartTarget(p, world);
  return world;
}

// ── Frame sampling ────────────────────────────────────────────────────────────

/** Capture the current world as a compact, JSON-friendly replay frame. */
function sampleFrame(world: SimWorld): PositionFrame {
  const players: FramePlayer[] = [];
  for (const p of [...world.home, ...world.away]) {
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
 * @param config  Optional overrides (seed, timestep, length, frame rate, ablation flags, trace).
 * @returns       Final score, the emergent event stream, and replay frames.
 */
export function simulateSpatialMatch(
  home: SpatialTeamInput,
  away: SpatialTeamInput,
  config: Partial<SimConfig> = {},
): SpatialMatchResult {
  const cfg: SimConfig = { ...DEFAULT_CONFIG, ...config };
  const flags: EngineFlags = { ...DEFAULT_FLAGS, ...(cfg.flags ?? {}) };
  const world = buildWorld(home, away, cfg, flags);

  const events: SimEvent[] = [];
  const frames: PositionFrame[] = [];
  events.push({ tSec: 0, minute: 1, type: 'kickoff' });

  let nextFrameAt = 0;
  const runTick = (): void => {
    if (world.clockSec >= nextFrameAt) {
      frames.push(sampleFrame(world));
      nextFrameAt += cfg.frameEverySec;
    }
    const tickEvents = step(world, cfg.dtSec);
    if (tickEvents.length > 0) events.push(...tickEvents);
  };

  const regulationTicks = Math.round(cfg.matchSeconds / cfg.dtSec);
  for (let i = 0; i < regulationTicks; i++) runTick();

  if (cfg.stoppage) {
    const stoppageTicks = Math.round(stoppageSeconds(events) / cfg.dtSec);
    for (let i = 0; i < stoppageTicks; i++) runTick();
  }

  world.phase = 'finished';
  frames.push(sampleFrame(world));

  return {
    finalScore: [world.score[0], world.score[1]],
    events,
    frames,
  };
}
