// ── features/match/logic/pitch/pitchState.ts ────────────────────────────────
// Pure snapshot of "where are the 22 players and the ball right now" plus
// a single-step animation helper (`idleDriftStep`) that gently pulls
// each player back toward their formation slot when no events are
// driving them anywhere else.
//
// SCOPE
//   This module owns the *kinematic* model only — no rendering, no
//   choreography per archetype.  The render-time choreography (issues
//   3/6 and 5/6) will read these snapshots, apply per-archetype
//   transforms, and pass the result to the SVG layer.
//
// COORDINATE SYSTEM
//   Same normalised [0..1] space as formations.ts:
//     • x = long axis (own goal 0 → opponent goal 1, home perspective)
//     • y = short axis (left touchline 0 → right touchline 1)
//
// IMMUTABILITY
//   Every public function returns a NEW PitchState — never mutates the
//   input.  The renderer can hold a ref to the previous snapshot for
//   interpolation without worrying about it changing under it.

import {
  type FormationKey,
  type PitchPoint,
  type Side,
  getFormationSlots,
} from './formations';

// ── Public types ─────────────────────────────────────────────────────────────

/**
 * One player dot on the pitch.  `slotIndex` is the slot the player
 * "belongs to" within their team's formation, used by the idle drift
 * step to recall players home when no event is steering them.
 *
 * `side` is the team they play for so the drift target can be
 * resolved via `getFormationSlots(formation, side)[slotIndex]`.
 */
export interface PlayerDot {
  /** Stable id (typically `players.id`). */
  id:         string;
  /** Which team this dot belongs to. */
  side:       Side;
  /** Index into the team's formation slot table (0..10). */
  slotIndex:  number;
  /** Current x position in [0..1]. */
  x:          number;
  /** Current y position in [0..1]. */
  y:          number;
}

/**
 * Position of the ball.  Carries the SAME normalised coords as
 * players; the pitch renderer can use a single coord-space throughout.
 */
export interface BallDot {
  x: number;
  y: number;
}

/**
 * A discrete phase flag that downstream choreography will read.  Kept
 * loosely typed (free-text) so issue 3/6 can extend the vocabulary
 * without a coupled change here.  At minimum the renderer will set it
 * from `eventToArchetype()`, but a debug surface might inject custom
 * phase strings.
 */
export type PitchPhase = string;

/**
 * Complete snapshot.  22 player dots (11 home + 11 away) plus the
 * ball position and a current `phase` flag.
 */
export interface PitchState {
  /** Always 22 players: 11 home (side='home') + 11 away (side='away'). */
  players:        readonly PlayerDot[];
  ball:           BallDot;
  phase:          PitchPhase;
  /** Home team's formation key — used by idle drift to look up slot targets. */
  homeFormation:  FormationKey;
  /** Away team's formation key — used by idle drift to look up slot targets. */
  awayFormation:  FormationKey;
}

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * Per-tick drift strength when no event is steering the players.
 * 0.15 = each tick closes ~15% of the remaining gap between a player's
 * current position and their slot.  Tuned so a player who's wandered
 * to the opposite end of the pitch returns home in ~25 ticks (≈ 0.4 s
 * at 60 fps, slightly slower than instant-snap), matching how real
 * footballers reset between phases of play.
 */
export const IDLE_DRIFT_RATE = 0.15;

/**
 * Below this distance (in normalised units) we treat a player as
 * "home" and stop drifting — avoids float-noise jitter when the
 * target has been reached.  ~0.001 ≈ a sub-pixel offset at any
 * reasonable viewport size.
 */
export const IDLE_DRIFT_EPSILON = 0.001;

// ── Builders ─────────────────────────────────────────────────────────────────

/**
 * Build the initial pitch state from two team formations.  Players
 * are placed at their canonical slot; the ball sits at the centre
 * spot (0.5, 0.5); phase starts as `'kickoff'`.
 *
 * @param opts.homeFormation  Formation key for the home team.
 * @param opts.awayFormation  Formation key for the away team.
 * @param opts.homePlayerIds  11 stable ids for the home starters (slot 0..10).
 * @param opts.awayPlayerIds  11 stable ids for the away starters (slot 0..10).
 * @returns                   Fresh PitchState.
 *
 * @throws  If either id list isn't exactly 11 entries.  We throw rather
 *          than truncate because a shorter list is almost always a bug
 *          and silently truncating would leave invisible dots on the pitch.
 */
export function initPitchState(opts: {
  homeFormation:  FormationKey;
  awayFormation:  FormationKey;
  homePlayerIds:  readonly string[];
  awayPlayerIds:  readonly string[];
}): PitchState {
  const { homeFormation, awayFormation, homePlayerIds, awayPlayerIds } = opts;
  if (homePlayerIds.length !== 11) {
    throw new Error(`initPitchState: homePlayerIds must have exactly 11 entries (got ${homePlayerIds.length})`);
  }
  if (awayPlayerIds.length !== 11) {
    throw new Error(`initPitchState: awayPlayerIds must have exactly 11 entries (got ${awayPlayerIds.length})`);
  }

  const homeSlots = getFormationSlots(homeFormation, 'home');
  const awaySlots = getFormationSlots(awayFormation, 'away');

  const players: PlayerDot[] = [];
  for (let i = 0; i < 11; i++) {
    const slot = homeSlots[i] as PitchPoint;
    players.push({
      id:        homePlayerIds[i]!,
      side:      'home',
      slotIndex: i,
      x:         slot.x,
      y:         slot.y,
    });
  }
  for (let i = 0; i < 11; i++) {
    const slot = awaySlots[i] as PitchPoint;
    players.push({
      id:        awayPlayerIds[i]!,
      side:      'away',
      slotIndex: i,
      x:         slot.x,
      y:         slot.y,
    });
  }

  return {
    players,
    ball:          { x: 0.5, y: 0.5 },
    phase:         'kickoff',
    homeFormation,
    awayFormation,
  };
}

// ── idleDriftStep ────────────────────────────────────────────────────────────

/**
 * Advance the pitch state by one "idle" tick — pulls every player a
 * fixed fraction (`IDLE_DRIFT_RATE`) of the way toward their formation
 * slot.  No-op for any player already within `IDLE_DRIFT_EPSILON` of
 * their slot.
 *
 * Idempotent at convergence — calling it forever on a converged state
 * returns deep-equal snapshots so a renderer that diff-tests its
 * input can safely halt re-paints once `idleDriftStep` produces no
 * change.
 *
 * @param state  Current pitch state.
 * @returns      Fresh PitchState with positions nudged toward their slots.
 */
export function idleDriftStep(state: PitchState): PitchState {
  const homeSlots = getFormationSlots(state.homeFormation, 'home');
  const awaySlots = getFormationSlots(state.awayFormation, 'away');

  const players = state.players.map(p => {
    const target = (p.side === 'home' ? homeSlots : awaySlots)[p.slotIndex];
    if (!target) return p; // slotIndex out of range; leave the dot alone

    const dx = target.x - p.x;
    const dy = target.y - p.y;
    if (Math.abs(dx) < IDLE_DRIFT_EPSILON && Math.abs(dy) < IDLE_DRIFT_EPSILON) {
      // Snap exactly to the slot so we don't accumulate sub-epsilon
      // drift forever — the renderer's diff check becomes cheap.
      return { ...p, x: target.x, y: target.y };
    }
    return {
      ...p,
      x: p.x + dx * IDLE_DRIFT_RATE,
      y: p.y + dy * IDLE_DRIFT_RATE,
    };
  });

  // Ball isn't a player but we treat it as drifting toward the centre
  // spot during idle — mirrors the engine's "play has stopped" beat.
  const ballDx = 0.5 - state.ball.x;
  const ballDy = 0.5 - state.ball.y;
  const ball: BallDot =
    Math.abs(ballDx) < IDLE_DRIFT_EPSILON && Math.abs(ballDy) < IDLE_DRIFT_EPSILON
      ? { x: 0.5, y: 0.5 }
      : {
          x: state.ball.x + ballDx * IDLE_DRIFT_RATE,
          y: state.ball.y + ballDy * IDLE_DRIFT_RATE,
        };

  return {
    ...state,
    players,
    ball,
  };
}
