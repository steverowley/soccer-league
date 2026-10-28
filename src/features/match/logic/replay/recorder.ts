// ── features/match/logic/replay/recorder.ts ──────────────────────────────────
// Records a v3 replay track while the engine runs (docs/match-viewer.md, 2B):
// every player every `everySec` (0.5 s) and the ball as keyframes at each
// discontinuity in its motion.
//
// HOW IT HOOKS IN
//   `simulateSpatialMatch(home, away, { onTick: recorder.onTick })`.  The
//   engine calls `onTick` with the world once it is set up and after every
//   physics step; the recorder only reads.  Recording never alters a match:
//   the engine fingerprint is unchanged with or without a recorder attached
//   (replayRecorder.test.ts).
//
// BALL KEYFRAMES
//   The recorder keeps its own replay of the ball: the latest keyframe,
//   quantised exactly as it will be stored, advanced with the engine's
//   `stepBall` once per tick, the same calls the viewer makes
//   (ballTrack.ts).  After every tick it compares that replay with the real
//   ball.  When they part (a kick, a touch, a deflection, a header, a parry,
//   a stop, the ball going out, a restart placing it), or the owner changes,
//   it writes the real state as a new keyframe.  Bounces, drag and rolling
//   are physics the replay reproduces, so they need no keyframe of their own;
//   a bounce the quantised replay does not reproduce to within KEY_POS_EPS
//   gets one like any other discontinuity.
//
// PLAYERS
//   Every `everySec` the position of every player on the pitch (both XIs as
//   the engine holds them, so a substitute appears from the frame he comes
//   on and a sent-off man is parked on his touchline as in the engine).
//
// ACTIONS
//   Every kick (with its kind), keeper dive, restart, tackle, interception,
//   foul, goal, woodwork, offside and substitution at its exact tick
//   (actionRecorder.ts).  Kicks and dives can begin and end inside one tick,
//   so they come from the engine's read-only `SimConfig.observer`; pass
//   `recorder.observer` alongside `onTick`, and the match's events to
//   `track(events)` once it ends.

import type { SimEvent, SimObserver, SimWorld } from '../spatial/types';
import { stepBall, type BallBody } from '../spatial/ball';
import {
  type BallKey, type BallTrack, KEY_POS_EPS, KEY_VEL_EPS, bodyAt, quantise,
} from './ballTrack';
import { createActionRecorder } from './actionRecorder';
import type { RecordedAction } from './actionTrack';

/** Default seconds between recorded player frames in a v3 replay. */
export const REPLAY_PLAYER_EVERY_SEC = 0.5;

/** One recorded player position (full precision; the encoder rounds). */
export interface TrackPlayer {
  id: string;
  x: number;
  y: number;
}

/** Everything a v3 replay holds, before encoding. */
export interface ReplayTrack {
  /** The engine's physics step (s). */
  dtSec: number;
  /** Seconds between player frames; frame i is at i * everySec. */
  everySec: number;
  /** Player frames in time order. */
  frames: TrackPlayer[][];
  /** The ball: keyframes replayed with the engine's physics. */
  ball: BallTrack;
  /**
   * The action track, players by id, sorted (actionTrack.ts).  Absent when
   * the match's events were not handed to `track`, and in a decoded file
   * written before actions were recorded.
   */
  actions?: RecordedAction[];
  /**
   * The union roster, when decoded from a file (the one its indices used).
   * A live recording has none; `replayRoster` derives it.
   */
  roster?: string[];
}

/** A recorder: hand `onTick` and `observer` to the engine, then read `track(events)`. */
export interface ReplayRecorder {
  onTick: (world: Readonly<SimWorld>) => void;
  /** Read-only kick and dive observer (SimConfig.observer). */
  observer: SimObserver;
  /**
   * The recorded track.
   *
   * @param events  The match's SimEvent list; with it the track carries its
   *                actions, without it only players and ball.
   */
  track: (events?: readonly SimEvent[]) => ReplayTrack;
}

/**
 * Create a recorder for one match.
 *
 * @param everySec  Seconds between player frames (a whole number of ticks).
 * @returns         The tick observer and an accessor for the finished track.
 */
export function createReplayRecorder(everySec: number = REPLAY_PLAYER_EVERY_SEC): ReplayRecorder {
  const frames: TrackPlayer[][] = [];
  const keys: BallKey[] = [];
  let tick = -1;
  let dtSec = 0;
  let ticksPerFrame = 0;
  let pred: BallBody | null = null;
  let predOwner: string | null = null;
  const acts = createActionRecorder();

  const onTick = (world: Readonly<SimWorld>): void => {
    acts.onTick(world);
    tick += 1;
    if (tick === 0) {
      dtSec = world.dtSec;
      ticksPerFrame = Math.round(everySec / dtSec);
      if (ticksPerFrame < 1 || Math.abs(ticksPerFrame * dtSec - everySec) > 1e-9) {
        throw new Error(`replay frame interval ${everySec} s is not a whole number of ${dtSec} s ticks`);
      }
    }

    if (tick % ticksPerFrame === 0) {
      const ps: TrackPlayer[] = [];
      for (const p of world.home) ps.push({ id: p.id, x: p.pos.x, y: p.pos.y });
      for (const p of world.away) ps.push({ id: p.id, x: p.pos.x, y: p.pos.y });
      frames.push(ps);
    }

    const b = world.ball;
    let key = pred === null || b.ownerId !== predOwner;
    if (pred && !key) {
      stepBall(pred, dtSec);
      key = Math.abs(pred.pos.x - b.pos.x) > KEY_POS_EPS
        || Math.abs(pred.pos.y - b.pos.y) > KEY_POS_EPS
        || Math.abs(pred.z - b.z) > KEY_POS_EPS
        || Math.abs(pred.vel.x - b.vel.x) > KEY_VEL_EPS
        || Math.abs(pred.vel.y - b.vel.y) > KEY_VEL_EPS
        || Math.abs(pred.vz - b.vz) > KEY_VEL_EPS;
    }
    if (key) {
      const k: BallKey = {
        tick,
        x: quantise(b.pos.x), y: quantise(b.pos.y), z: quantise(b.z),
        vx: quantise(b.vel.x), vy: quantise(b.vel.y), vz: quantise(b.vz),
        ownerId: b.ownerId,
      };
      keys.push(k);
      pred = bodyAt(k);
      predOwner = b.ownerId;
    }
  };

  const track = (events?: readonly SimEvent[]): ReplayTrack => ({
    dtSec,
    everySec,
    frames,
    ball: { dtSec, keys, endTick: Math.max(0, tick) },
    ...(events ? { actions: acts.actions(events) } : {}),
  });

  return { onTick, observer: acts.observer, track };
}
