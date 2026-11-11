// ── features/match/logic/viewer/shots.ts ─────────────────────────────────────
// What counts as a shot, and which shot a keeper's dive answered, read off
// the replay's action track.  One rule shared by the slow-motion replays
// (replaySchedule.ts), the hairline ring on a save (actionAnim.ts) and the
// SAVE / PARRY / CATCH rows of the event strip (eventLog.ts), so the three
// always agree about what a save is.
//
// PURE: no React, no canvas.

import type { ActionTrack, KickAction, ReplayAction } from '../replay/actions';
import type { KickKind } from '../spatial/types';

/** A dive is a save of a shot struck at most this long before it (game s). */
export const SHOT_BEFORE_DIVE_SEC = 3;

/** A shot at goal: a shot, a penalty, a header, or a set piece delivered as a shot. */
export function isShotKick(a: ReplayAction): a is KickAction {
  if (a.kind !== 'kick') return false;
  const k: KickKind = a.delivery ?? a.kick;
  return k === 'shot' || k === 'penalty' || k === 'header';
}

/**
 * The shot a keeper's dive answered: the latest shot kick in the
 * SHOT_BEFORE_DIVE_SEC before the action at `index`, or null (a claimed
 * cross, a back pass).
 *
 * @param track  The decoded action track.
 * @param index  Index of the dive in `track.actions`.
 */
export function shotBefore(track: ActionTrack, index: number): KickAction | null {
  const acts = track.actions;
  const sec = acts[index]!.tick * track.dtSec;
  for (let j = index - 1; j >= 0 && sec - acts[j]!.tick * track.dtSec <= SHOT_BEFORE_DIVE_SEC; j--) {
    const a = acts[j]!;
    if (isShotKick(a)) return a;
  }
  return null;
}
