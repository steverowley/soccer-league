// ── features/match/logic/replay/actions.ts ──────────────────────────────────
// The replay's ACTION TRACK: every on-ball and set-piece action the engine
// performed, at its exact tick, so the viewer can animate passes, tackles,
// fouls, shots, keeper dives and restarts (docs/match-viewer.md section 5).
//
// WHY IN THE REPLAY, NOT match_events
//   match_events keeps only the notable events (about 60 a match, timed to
//   the minute; no passes, throw-ins or goal kicks).  The engine emits every
//   action and knows each kick's kind and each keeper's dive, so the
//   recorder (on Vercel, beside the ball keyframes) writes them here.
//
// THIS FILE IS THE CONTRACT between the recorder (writes) and the viewer
// (reads).  Change it in one PR for both sides.  Players are named by their
// ROSTER INDEX (the replay's union roster), like the ball's owner.
//
// PURE: types and a lookup helper only.

import type { KickKind, RestartKind, TeamSide } from '../spatial/types';

/** A card shown for a foul. */
export type CardKind = 'none' | 'yellow' | 'red';

/** How a keeper's dive ended. */
export type DiveOutcome = 'save' | 'catch' | 'beaten';

/** Fields every action carries. */
interface ActionBase {
  /** Engine tick (tick * dtSec = game seconds since kickoff). */
  tick: number;
}

/** A kick of any kind: pass, cross, shot, throw, set-piece delivery... */
export interface KickAction extends ActionBase {
  kind: 'kick';
  /** Kicker (or thrower). */
  by: number;
  kick: KickKind;
}

/** A challenge that won the ball cleanly from the carrier. */
export interface TackleAction extends ActionBase {
  kind: 'tackle';
  /** The tackler. */
  by: number;
  /** The player who lost the ball. */
  from: number;
}

/** A pass cut out by an opponent. */
export interface InterceptionAction extends ActionBase {
  kind: 'interception';
  by: number;
}

/** A challenge that met the man, not the ball. */
export interface FoulAction extends ActionBase {
  kind: 'foul';
  /** The offender. */
  by: number;
  /** The player fouled. */
  on: number;
  card: CardKind;
}

/** A keeper committing to a dive (or a catch at his body). */
export interface DiveAction extends ActionBase {
  kind: 'dive';
  by: number;
  /** Where the keeper commits to (metres) and the height of the ball there. */
  x: number;
  y: number;
  z: number;
  outcome: DiveOutcome;
}

/** A stoppage being set up: the ball placed, the taker walking to it. */
export interface RestartAction extends ActionBase {
  kind: 'restart';
  restart: RestartKind;
  /** The taker. */
  by: number;
  /** Where the ball is placed. */
  x: number;
  y: number;
  /** The tick the restart may be taken (the end of the pause). */
  readyTick: number;
}

/** A goal (the ball over the line). */
export interface GoalAction extends ActionBase {
  kind: 'goal';
  /** The scorer. */
  by: number;
  /** The side credited with the goal (an own goal credits the other side). */
  side: TeamSide;
}

/** A shot striking the frame. */
export interface WoodworkAction extends ActionBase {
  kind: 'woodwork';
  by: number;
}

/** An attacker flagged offside where he played the ball. */
export interface OffsideAction extends ActionBase {
  kind: 'offside';
  by: number;
  x: number;
  y: number;
}

/** A substitution. */
export interface SubAction extends ActionBase {
  kind: 'sub';
  /** Player coming on. */
  on: number;
  /** Player going off. */
  off: number;
}

/** Every action the replay records. */
export type ReplayAction =
  | KickAction
  | TackleAction
  | InterceptionAction
  | FoulAction
  | DiveAction
  | RestartAction
  | GoalAction
  | WoodworkAction
  | OffsideAction
  | SubAction;

/** The decoded action track: actions sorted by tick, plus the step length. */
export interface ActionTrack {
  /** Engine step in seconds (0.1). */
  dtSec: number;
  /** Every action, ascending by tick (stable for equal ticks). */
  actions: readonly ReplayAction[];
}

/**
 * Index of the first action at or after `tick` (actions.length if none).
 * Binary search; the track is sorted by tick.
 */
export function firstActionAtOrAfter(track: ActionTrack, tick: number): number {
  let lo = 0;
  let hi = track.actions.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (track.actions[mid]!.tick < tick) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The actions whose tick lies in [fromSec, toSec] (game seconds), in order.
 * The viewer asks for a short window behind the playhead to know which
 * animations are still playing.
 */
export function actionsBetween(track: ActionTrack, fromSec: number, toSec: number): ReplayAction[] {
  if (toSec < fromSec) return [];
  const fromTick = Math.ceil(fromSec / track.dtSec - 1e-9);
  const toTick = Math.floor(toSec / track.dtSec + 1e-9);
  const out: ReplayAction[] = [];
  for (let i = firstActionAtOrAfter(track, fromTick); i < track.actions.length; i++) {
    const a = track.actions[i]!;
    if (a.tick > toTick) break;
    out.push(a);
  }
  return out;
}
