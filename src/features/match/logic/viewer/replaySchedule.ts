// ── features/match/logic/viewer/replaySchedule.ts ───────────────────────────
// Slow-motion replays (docs/match-viewer.md section 5C): which moments are
// replayed, when, and how a live instant maps to the replayed instant.
//
// THE RULES
//   - A GOAL replays the last GOAL_REPLAY.lookbackSec game seconds before
//     the ball crossed the line at GOAL_REPLAY.speed (0.5x).
//   - A SAVE (a dive that saved or caught a shot), a shot off the WOODWORK
//     and a shot JUST WIDE (out for a goal kick or corner within JUST_WIDE_M
//     of a post) replay the last CHANCE_REPLAY.lookbackSec game seconds at
//     CHANCE_REPLAY.speed (0.75x).
//   - A replay only runs inside the STOPPAGE that follows its moment: it
//     starts a short live beat after it (the GOAL label, the celebration)
//     and ends a margin before the next restart's ready tick, so it never
//     runs into live play.  When the stoppage is shorter than the replay,
//     the replay is TRIMMED from its start (the moment itself always shows);
//     when even that leaves under REPLAY_MIN_REAL_SEC, there is no replay.
//     A moment with no stoppage after it (the ball stayed in play) is not
//     replayed.
//   - One replay per stoppage (goal before woodwork before save before
//     wide), and replays never overlap one another.
//
// TIME
//   `rate` is how many game seconds pass per real second live (4.5 for a
//   20-minute match).  A window is shown while the live game clock is in
//   [liveStart, liveEnd); in it, the picture shows game second
//   segStart + (live - liveStart) / rate * speed.
//
// PURE: the caller passes where the ball was (for "just wide") as a lookup.

import { type ActionTrack, type ReplayAction } from '../replay/actions';
import { GOAL_Y_MAX, GOAL_Y_MIN, PITCH_LENGTH } from '../spatial/types';
import { TOTAL_GAME_SECONDS } from './playback';

/** What a replay is of. */
export type ReplayKind = 'goal' | 'woodwork' | 'save' | 'wide';

/** A goal: the last 8 game seconds at half speed. */
export const GOAL_REPLAY = { lookbackSec: 8, speed: 0.5, leadRealSec: 1.6 } as const;
/** A save, woodwork or near miss: the last 5 game seconds at three-quarter speed. */
export const CHANCE_REPLAY = { lookbackSec: 5, speed: 0.75, leadRealSec: 0.8 } as const;
/** The replay carries on this far past the moment (game s): the ball in the net, the parry. */
export const REPLAY_POST_SEC = 0.6;
/** Back to live this long (real s) before the restart may be taken. */
export const REPLAY_MARGIN_REAL_SEC = 0.5;
/** A replay shorter than this (real s) is not worth cutting to. */
export const REPLAY_MIN_REAL_SEC = 2.5;
/** How far outside a post (m) a shot out of play still counts as just wide. */
export const JUST_WIDE_M = 3;
/** A stoppage must begin within this many game seconds of the moment. */
export const STOPPAGE_WITHIN_SEC = 8;
/** A dive is a save of a shot struck at most this long before it (game s). */
const SHOT_BEFORE_DIVE_SEC = 3;
/** A miss goes out at most this long after the shot (game s). */
const WIDE_WITHIN_SEC = 4;
/** Touches this soon after the moment are part of it (a parry, a deflection off the frame). */
const PART_OF_MOMENT_SEC = 1;

/** Preference when two moments share one stoppage. */
const KIND_RANK: Readonly<Record<ReplayKind, number>> = { goal: 4, woodwork: 3, save: 2, wide: 1 };

/** One scheduled replay. */
export interface ReplayWindow {
  kind: ReplayKind;
  /** Game second of the moment (the ball over the line, the dive, the frame struck). */
  eventSec: number;
  /** Live game seconds during which the replay is shown: [liveStart, liveEnd). */
  liveStart: number;
  liveEnd: number;
  /** The replayed stretch of the match, in game seconds. */
  segStart: number;
  segEnd: number;
  /** Replay speed: game seconds shown per real second. */
  speed: number;
  /** Live game seconds per real second when it was scheduled. */
  rate: number;
}

/** Where the ball was at a game second, for the "just wide" test. */
export interface ReplayLookup {
  ballAt?(sec: number): { x: number; y: number; z: number } | null;
}

/** Live game seconds per real second for a season's match duration (1 when unpaced). */
export function liveRate(durationSeconds: number): number {
  return durationSeconds > 0 ? TOTAL_GAME_SECONDS / durationSeconds : 1;
}

const isShotKick = (a: ReplayAction): boolean => a.kind === 'kick' && (a.kick === 'shot' || a.kick === 'penalty' || a.kick === 'header');

/** True for an action that means play is live again (not a part of the moment's own touches). */
function resumesPlay(a: ReplayAction): boolean {
  if (a.kind === 'kick') return a.kick !== 'parry' && a.kick !== 'deflection' && a.kick !== 'dribble';
  return a.kind === 'tackle' || a.kind === 'interception' || a.kind === 'foul';
}

/**
 * The stoppage after the action at `index`: the first restart within
 * STOPPAGE_WITHIN_SEC with no live touch before it, and the game second its
 * pause ends (the restart's ready tick, or its kick when that comes first).
 * Null when play carried on.
 */
function stoppageAfter(track: ActionTrack, index: number): { restartIndex: number; endSec: number } | null {
  const dt = track.dtSec;
  const from = track.actions[index]!.tick * dt;
  for (let i = index + 1; i < track.actions.length; i++) {
    const a = track.actions[i]!;
    const sec = a.tick * dt;
    if (sec - from > STOPPAGE_WITHIN_SEC) return null;
    if (a.kind === 'restart') {
      let endSec = a.readyTick * dt;
      for (let j = i + 1; j < track.actions.length; j++) {
        const b = track.actions[j]!;
        if (b.tick * dt >= endSec) break;
        if (resumesPlay(b)) {
          endSec = b.tick * dt;
          break;
        }
      }
      return { restartIndex: i, endSec };
    }
    if (sec - from > PART_OF_MOMENT_SEC && resumesPlay(a)) return null;
  }
  return null;
}

/** A goal's stoppage: its kick-off, or (the last kick of the match) the end of the track. */
function goalStoppage(track: ActionTrack, index: number): { restartIndex: number; endSec: number } {
  const s = stoppageAfter(track, index);
  if (s) return s;
  const dt = track.dtSec;
  for (let i = index + 1; i < track.actions.length; i++) {
    const a = track.actions[i]!;
    if (resumesPlay(a)) return { restartIndex: -1, endSec: a.tick * dt };
  }
  return { restartIndex: -1, endSec: Number.POSITIVE_INFINITY };
}

/** True when a ball leaving at (x, y) crossed the goal line within JUST_WIDE_M of a post. */
export function isJustWide(ball: { x: number; y: number; z: number }): boolean {
  const onGoalLine = ball.x <= 1.5 || ball.x >= PITCH_LENGTH - 1.5;
  const nearPost = ball.y >= GOAL_Y_MIN - JUST_WIDE_M && ball.y <= GOAL_Y_MAX + JUST_WIDE_M;
  return onGoalLine && nearPost && ball.z < 4;
}

/**
 * Every slow-motion replay in a match.
 *
 * @param track            The decoded action track (null: no replays).
 * @param durationSeconds  The season's match duration (real seconds for 90 minutes).
 * @param lookup           Where the ball was (needed for "just wide"; without
 *                         it, near misses are not replayed).
 * @returns                Non-overlapping windows in live order.
 */
export function scheduleReplays(
  track: ActionTrack | null | undefined,
  durationSeconds: number,
  lookup: ReplayLookup = {},
): ReplayWindow[] {
  if (!track || track.actions.length === 0) return [];
  const rate = liveRate(durationSeconds);
  const dt = track.dtSec;
  const acts = track.actions;

  // Candidates, one per stoppage (keyed by its restart), the best kind kept.
  const byStoppage = new Map<number, { kind: ReplayKind; eventSec: number; endSec: number }>();
  const offer = (key: number, kind: ReplayKind, eventSec: number, endSec: number): void => {
    const prev = byStoppage.get(key);
    if (prev && KIND_RANK[prev.kind] >= KIND_RANK[kind]) return;
    byStoppage.set(key, { kind, eventSec, endSec });
  };

  acts.forEach((a, i) => {
    const sec = a.tick * dt;
    if (a.kind === 'goal') {
      const s = goalStoppage(track, i);
      offer(s.restartIndex >= 0 ? s.restartIndex : -1 - i, 'goal', sec, s.endSec);
      return;
    }
    if (a.kind === 'woodwork') {
      const s = stoppageAfter(track, i);
      if (s) offer(s.restartIndex, 'woodwork', sec, s.endSec);
      return;
    }
    if (a.kind === 'dive' && (a.outcome === 'save' || a.outcome === 'catch')) {
      let shot = false;
      for (let j = i - 1; j >= 0 && sec - acts[j]!.tick * dt <= SHOT_BEFORE_DIVE_SEC; j--) {
        if (isShotKick(acts[j]!)) {
          shot = true;
          break;
        }
      }
      if (!shot) return;
      const s = stoppageAfter(track, i);
      if (s) offer(s.restartIndex, 'save', sec, s.endSec);
      return;
    }
    if (isShotKick(a) && lookup.ballAt) {
      const s = stoppageAfter(track, i);
      if (!s) return;
      const r = acts[s.restartIndex]!;
      if (r.kind !== 'restart' || (r.restart !== 'goalkick' && r.restart !== 'corner')) return;
      const outSec = r.tick * dt;
      if (outSec - sec > WIDE_WITHIN_SEC) return;
      const ball = lookup.ballAt(outSec);
      if (ball && isJustWide(ball)) offer(s.restartIndex, 'wide', outSec, s.endSec);
    }
  });

  // Fit each candidate into its stoppage.
  const windows: ReplayWindow[] = [];
  for (const c of byStoppage.values()) {
    const spec = c.kind === 'goal' ? GOAL_REPLAY : CHANCE_REPLAY;
    const segEnd = c.eventSec + REPLAY_POST_SEC;
    const idealStart = Math.max(0, c.eventSec - spec.lookbackSec);
    const liveStart = c.eventSec + spec.leadRealSec * rate;
    const liveLimit = c.endSec - REPLAY_MARGIN_REAL_SEC * rate;
    const availableReal = (liveLimit - liveStart) / rate;
    const neededReal = (segEnd - idealStart) / spec.speed;
    const realLen = Math.min(neededReal, availableReal);
    if (!(realLen >= REPLAY_MIN_REAL_SEC)) continue;
    windows.push({
      kind: c.kind,
      eventSec: c.eventSec,
      liveStart,
      liveEnd: liveStart + realLen * rate,
      segStart: segEnd - realLen * spec.speed,
      segEnd,
      speed: spec.speed,
      rate,
    });
  }
  windows.sort((x, y) => x.liveStart - y.liveStart);
  const kept: ReplayWindow[] = [];
  for (const w of windows) {
    const last = kept[kept.length - 1];
    if (last && w.liveStart < last.liveEnd) continue;
    kept.push(w);
  }
  return kept;
}

/** The replay showing at a live game second, and the game second it shows. */
export interface ReplayMoment {
  window: ReplayWindow;
  /** The game second drawn instead of the live one. */
  replaySec: number;
}

/**
 * The replay on screen at a live game second, if any.
 *
 * @param windows  From scheduleReplays.
 * @param liveSec  The live game clock.
 * @returns        The window and the replayed game second, or null (live).
 */
export function replayAt(windows: readonly ReplayWindow[], liveSec: number): ReplayMoment | null {
  for (const w of windows) {
    if (liveSec < w.liveStart) return null;
    if (liveSec < w.liveEnd) {
      return { window: w, replaySec: w.segStart + ((liveSec - w.liveStart) / w.rate) * w.speed };
    }
  }
  return null;
}
