// ── features/match/logic/viewer/trackLookup.ts ──────────────────────────────
// The viewer's side of the action track: finding it on the decoded frames,
// naming its roster indices, and answering the replay questions the
// animation and replay modules ask (where the ball was at a moment, where a
// through ball was met, which side a player is on).
//
// THE ROSTER
//   Actions name players by their index in the replay's UNION roster: every
//   player id that is ever on the pitch, in order of first appearance
//   (logic/replay/replayV3.ts encodeReplayV3).  The decoded frames list each
//   frame's players in that same index order, so walking the frames and
//   collecting ids on first sight rebuilds the roster exactly; it needs
//   nothing beyond the frames the viewer already has.
//
// PURE apart from small memo caches (by game second) that make the lookups
// cheap enough to call every animation frame.

import type { PositionSnapshot } from '../../api/matchPositions';
import type { ActionTrack } from '../replay/actions';
import type { TeamSide } from '../spatial/types';
import type { AnimLookup } from './actionAnim';
import { sampleFrames } from './playback';

/** How far ahead (game s) to look for the player who met a through ball. */
export const RECEPTION_SEARCH_SEC = 6;
/** Step (game s) of that search. */
export const RECEPTION_STEP_SEC = 0.2;

/**
 * The action track shared on the decoded frames, or null for a replay
 * without one (v2 files, older v3 files): no animations, no slow motion,
 * everything else as before.
 */
export function actionTrackOf(frames: readonly PositionSnapshot[]): ActionTrack | null {
  const first = frames[0] as (PositionSnapshot & { actionTrack?: ActionTrack | null }) | undefined;
  const track = first?.actionTrack;
  if (!track || !Array.isArray(track.actions) || !(track.dtSec > 0)) return null;
  return track;
}

/**
 * The replay's union roster rebuilt from the frames: every player id in
 * order of first appearance.
 */
export function rosterFromFrames(frames: readonly PositionSnapshot[]): string[] {
  const seen = new Set<string>();
  const roster: string[] = [];
  for (const f of frames) {
    for (const p of f.snapshots.players) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      roster.push(p.id);
    }
  }
  return roster;
}

/**
 * Where the ball kicked at `sec` was next under control: the first sampled
 * moment (in RECEPTION_STEP_SEC steps) when somebody owns it.
 */
export function findReception(
  frames: PositionSnapshot[],
  sec: number,
): { x: number; y: number; sec: number } | null {
  for (let s = sec + RECEPTION_STEP_SEC; s <= sec + RECEPTION_SEARCH_SEC; s += RECEPTION_STEP_SEC) {
    const ball = sampleFrames(frames, s).ball;
    if (ball?.ownerId != null) return { x: ball.x, y: ball.y, sec: s };
  }
  return null;
}

/**
 * The replay lookups for actionAnim and replaySchedule over one match's
 * frames, memoised by game second (the same few moments are asked about on
 * every animation frame).
 *
 * @param frames  Decoded frames.
 * @param roster  Union roster (rosterFromFrames).
 * @param sideOf  Side of a player id (from the squads), null when unknown.
 */
export function makeTrackLookup(
  frames: PositionSnapshot[],
  roster: readonly string[],
  sideOf: (id: string) => TeamSide | null,
): Required<AnimLookup> {
  const balls = new Map<number, { x: number; y: number; z: number } | null>();
  const meets = new Map<number, { x: number; y: number; sec: number } | null>();
  return {
    ballAt(sec) {
      let b = balls.get(sec);
      if (b === undefined) {
        const s = sampleFrames(frames, sec).ball;
        b = s ? { x: s.x, y: s.y, z: s.z } : null;
        balls.set(sec, b);
      }
      return b;
    },
    receptionAfter(sec) {
      let m = meets.get(sec);
      if (m === undefined) {
        m = findReception(frames, sec);
        meets.set(sec, m);
      }
      return m;
    },
    sideOf(player) {
      const id = roster[player];
      return id == null ? null : sideOf(id);
    },
  };
}
