// ── features/match/logic/replay/replayV3.ts ──────────────────────────────────
// The v3 replay file: encode a recorded ReplayTrack into the JSON that is
// gzipped into Storage, and decode it back (docs/match-viewer.md, 2B).
//
// WHO WRITES IT
//   The remote simulation function on Vercel (api/simulate.mjs, built from
//   src/features/match/api/simulateFunction.ts) records the track while it
//   simulates, encodes and gzips it here, and returns the bytes alongside the
//   result; the match worker uploads them unchanged
//   (supabase/functions/match-worker/replayFile.ts uploadReplayBody).  The
//   worker cannot build it itself within the edge's ~2 s CPU budget: see the
//   measurements in docs/match-viewer.md section 2B.
//
// THE FILE (JSON, then gzip)
//   {
//     format: 'isl-replay', v: 3, matchId,
//     roster:  every player id that is ever on the pitch (first appearance order),
//     dt:      the engine step (s), 0.1;  every: seconds between player frames, 0.5,
//     frames:  number of player frames (frame i is at i * every seconds),
//     end:     the last engine tick,
//     players: one entry per roster index:
//                { s: [[firstFrame, count], ...],   the runs of frames he is on in
//                  x: [...], y: [...] }             decimetres, each run delta coded
//                                                   (first value absolute, then
//                                                   the change from the frame before)
//     ball:    columns, one entry per keyframe:
//                t  tick (first absolute, then the gap from the previous key),
//                x, y  centimetres (delta coded like the players),
//                z  centimetres; vx, vy, vz  centimetres per second,
//                o  roster index of the owner, -1 when loose
//     actions: (optional, since the action track) every kick, dive, restart,
//              tackle, interception, foul, goal, woodwork, offside and
//              substitution at its exact tick, as columns per kind
//              (actionTrack.ts has the layout).  Files written before it
//              have none and decode without an action track.
//   }
//   The roster also holds any player named only by an action (an empty run
//   list), so every action's player has an index.
//   Columns of small deltas are what gzip compresses well: a full match is
//   about 0.33 MB gzipped against 0.2 to 0.32 MB for v2's 2 s frames.
//
// PURE: no I/O.  The v2 file (2 s frames) is still read by matchPositions.ts;
// Season 1's replays are never regenerated.

import { BALL_SCALE, type BallKey } from './ballTrack';
import type { ReplayTrack, TrackPlayer } from './recorder';
import {
  type ReplayV3Actions, decodeActions, encodeActions, replayRoster, toActionTrack,
} from './actionTrack';

/** Format tag shared with every replay file. */
export const REPLAY_FORMAT = 'isl-replay';

/** Player coordinates are stored in decimetres (0.1 m, as in v2). */
export const PLAYER_SCALE = 10;

/** One roster member's runs of frames on the pitch and his delta-coded path. */
export interface ReplayV3Player {
  s: Array<[number, number]>;
  x: number[];
  y: number[];
}

/** The ball keyframes, one column per field (see the file header). */
export interface ReplayV3Ball {
  t: number[];
  x: number[];
  y: number[];
  z: number[];
  vx: number[];
  vy: number[];
  vz: number[];
  o: number[];
}

/** The whole v3 file, before JSON encoding and gzip. */
export interface ReplayFileV3 {
  format: typeof REPLAY_FORMAT;
  v: 3;
  matchId: string;
  roster: string[];
  dt: number;
  every: number;
  frames: number;
  end: number;
  players: ReplayV3Player[];
  ball: ReplayV3Ball;
  /** The action track (absent in files written before it was recorded). */
  actions?: ReplayV3Actions;
}

/** Delta-code a run: the first value as is, then each change. */
function deltas(values: readonly number[]): number[] {
  const out: number[] = new Array<number>(values.length);
  for (let i = 0; i < values.length; i++) out[i] = i === 0 ? values[i]! : values[i]! - values[i - 1]!;
  return out;
}

/** Undo {@link deltas} in place over [from, from + count). */
function undelta(values: number[], from: number, count: number): void {
  for (let i = from + 1; i < from + count; i++) values[i] = values[i]! + values[i - 1]!;
}

/** Round to the stored integer at `scale` (and never -0). */
function q(n: number, scale: number): number {
  return Math.round(n * scale) + 0;
}

/**
 * Encode a recorded track as a v3 replay file.
 *
 * @param matchId  The match it belongs to (recorded in the file).
 * @param track    What the recorder captured.
 * @returns        The payload to JSON-encode and gzip.
 */
export function encodeReplayV3(matchId: string, track: ReplayTrack): ReplayFileV3 {
  const roster = replayRoster(track);
  const index = new Map<string, number>();
  roster.forEach((id, i) => index.set(id, i));

  // Per roster member: the frames he is on, his coordinates in them.
  const runs: Array<Array<[number, number]>> = roster.map(() => []);
  const xs: number[][] = roster.map(() => []);
  const ys: number[][] = roster.map(() => []);
  const last: number[] = roster.map(() => -2);
  track.frames.forEach((frame, fi) => {
    for (const p of frame) {
      const j = index.get(p.id)!;
      const r = runs[j]!;
      if (last[j] === fi - 1 && r.length > 0) r[r.length - 1]![1] += 1;
      else r.push([fi, 1]);
      last[j] = fi;
      xs[j]!.push(q(p.x, PLAYER_SCALE));
      ys[j]!.push(q(p.y, PLAYER_SCALE));
    }
  });
  const players: ReplayV3Player[] = roster.map((_, j) => {
    const x: number[] = [];
    const y: number[] = [];
    let at = 0;
    for (const [, count] of runs[j]!) {
      x.push(...deltas(xs[j]!.slice(at, at + count)));
      y.push(...deltas(ys[j]!.slice(at, at + count)));
      at += count;
    }
    return { s: runs[j]!, x, y };
  });

  const keys = track.ball.keys;
  const owner = (k: BallKey): number => (k.ownerId === null ? -1 : (index.get(k.ownerId) ?? -1));
  const ball: ReplayV3Ball = {
    t: deltas(keys.map((k) => k.tick)),
    x: deltas(keys.map((k) => q(k.x, BALL_SCALE))),
    y: deltas(keys.map((k) => q(k.y, BALL_SCALE))),
    z: keys.map((k) => q(k.z, BALL_SCALE)),
    vx: keys.map((k) => q(k.vx, BALL_SCALE)),
    vy: keys.map((k) => q(k.vy, BALL_SCALE)),
    vz: keys.map((k) => q(k.vz, BALL_SCALE)),
    o: keys.map(owner),
  };

  return {
    format: REPLAY_FORMAT,
    v: 3,
    matchId,
    roster,
    dt: track.dtSec,
    every: track.everySec,
    frames: track.frames.length,
    end: track.ball.endTick,
    players,
    ball,
    ...(track.actions ? { actions: encodeActions(toActionTrack(track.actions, roster, track.dtSec)) } : {}),
  };
}

/**
 * Decode a v3 file back into the track the recorder produced (players at
 * 0.1 m, the ball keyframes exactly as recorded).
 *
 * @param file  A parsed v3 file (shape already validated by the caller).
 * @returns     The track, or null when the file is internally inconsistent.
 */
export function decodeReplayV3(file: ReplayFileV3): ReplayTrack | null {
  const { roster, players, ball } = file;
  if (players.length !== roster.length) return null;
  if (!(file.dt > 0) || !(file.every > 0) || !Number.isInteger(file.frames) || file.frames < 0) return null;

  const frames: TrackPlayer[][] = Array.from({ length: file.frames }, () => []);
  for (let j = 0; j < roster.length; j++) {
    const pl = players[j]!;
    const x = pl.x.slice();
    const y = pl.y.slice();
    let at = 0;
    for (const [first, count] of pl.s) {
      if (first < 0 || count < 0 || first + count > file.frames || at + count > x.length || at + count > y.length) return null;
      undelta(x, at, count);
      undelta(y, at, count);
      for (let i = 0; i < count; i++) {
        frames[first + i]!.push({ id: roster[j]!, x: x[at + i]! / PLAYER_SCALE, y: y[at + i]! / PLAYER_SCALE });
      }
      at += count;
    }
  }

  const n = ball.t.length;
  for (const col of [ball.x, ball.y, ball.z, ball.vx, ball.vy, ball.vz, ball.o]) if (col.length !== n) return null;
  const t = ball.t.slice();
  const bx = ball.x.slice();
  const by = ball.y.slice();
  undelta(t, 0, n);
  undelta(bx, 0, n);
  undelta(by, 0, n);
  const keys: BallKey[] = new Array<BallKey>(n);
  for (let i = 0; i < n; i++) {
    const o = ball.o[i]!;
    keys[i] = {
      tick: t[i]!,
      x: bx[i]! / BALL_SCALE,
      y: by[i]! / BALL_SCALE,
      z: ball.z[i]! / BALL_SCALE,
      vx: ball.vx[i]! / BALL_SCALE,
      vy: ball.vy[i]! / BALL_SCALE,
      vz: ball.vz[i]! / BALL_SCALE,
      ownerId: o >= 0 ? (roster[o] ?? null) : null,
    };
  }
  if (n === 0) return null;

  // The action track is cosmetic: a malformed one is dropped, not fatal.
  const actions = file.actions === undefined ? null : decodeActions(file.actions, roster);

  return {
    dtSec: file.dt,
    everySec: file.every,
    frames,
    ball: { dtSec: file.dt, keys, endTick: file.end },
    roster: roster.slice(),
    ...(actions ? { actions } : {}),
  };
}
