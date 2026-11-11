// ── features/match/logic/viewer/eventLog.ts ──────────────────────────────────
// The EVENT STRIP under the pitch (docs/match-viewer.md section 7): which
// notable moments of the match have happened by a game second, as rows of
// clock, label and who.  Words belong under the pitch, not on it.
//
// WHICH ACTIONS GET A ROW (notable only)
//   GOAL / OWN GOAL     the scorer.
//   SAVE / PARRY / CATCH a keeper's dive that answered a shot (shots.ts):
//                       the keeper and the shooter.  Dropped when the ball
//                       goes in straight after (the GOAL row covers it).
//   WOODWORK            the shooter, when the ball met the frame.
//   WIDE                a shot that went out for a goal kick, the shooter.
//   TACKLE              the winner wins it from the loser.
//   INTERCEPTION        who.
//   FOUL                the offender on the victim; a YELLOW CARD or RED
//                       CARD row for the offender follows at the same clock.
//   OFFSIDE             who.
//   FREE KICK, PENALTY, CORNER, THROW-IN, GOAL KICK: the taker, when the
//                       ball goes dead.  KICK-OFF: the taker, when it is
//                       TAKEN (logged when the restart began, it would push
//                       the GOAL row down the moment the goal went in).
//   SUBSTITUTION        on, off.
//   Passes are not logged: the "On the ball" line under the strip already
//   follows possession, and a row per pass would churn the strip.
//
// ORDER
//   By game second; within one tick, the action track's own order (sub,
//   foul, tackle, interception, offside, dive, kick, woodwork, goal,
//   restart), with a card straight after its foul and a WIDE before the
//   goal kick it caused.  The strip shows the newest first.
//
// PURE: no React, no canvas.  The few questions that need the frames (which
// side a player is on, where the ball met the frame) come through the
// optional lookup, exactly as for actionAnim.

import type { ActionTrack, ReplayAction } from '../replay/actions';
import type { TeamSide } from '../spatial/types';
import { isShotKick, shotBefore } from './shots';

/** How many rows the strip shows (its height is fixed at this many). */
export const EVENT_STRIP_ROWS = 3;

/** A save is not logged when the ball is in the net this soon after the dive (game s). */
export const SAVE_THEN_GOAL_SEC = 2;
/** A parry by the keeper this soon after his dive makes the save a PARRY (game s). */
export const PARRY_AFTER_DIVE_SEC = 1.5;
/** A shot out for a goal kick within this long (game s) is logged as WIDE. */
export const WIDE_WITHIN_SEC = 4;

/** Every kind of row the strip shows. */
export type EventRowKind =
  | 'goal'
  | 'ownGoal'
  | 'save'
  | 'parry'
  | 'catch'
  | 'woodwork'
  | 'wide'
  | 'tackle'
  | 'interception'
  | 'foul'
  | 'yellow'
  | 'red'
  | 'offside'
  | 'freekick'
  | 'penalty'
  | 'corner'
  | 'throw'
  | 'goalkick'
  | 'kickoff'
  | 'sub';

/** The label each row carries, in the design system's label style (upper case). */
export const EVENT_LABEL: Readonly<Record<EventRowKind, string>> = {
  goal: 'GOAL',
  ownGoal: 'OWN GOAL',
  save: 'SAVE',
  parry: 'PARRY',
  catch: 'CATCH',
  woodwork: 'WOODWORK',
  wide: 'WIDE',
  tackle: 'TACKLE',
  interception: 'INTERCEPTION',
  foul: 'FOUL',
  yellow: 'YELLOW CARD',
  red: 'RED CARD',
  offside: 'OFFSIDE',
  freekick: 'FREE KICK',
  penalty: 'PENALTY',
  corner: 'CORNER',
  throw: 'THROW-IN',
  goalkick: 'GOAL KICK',
  kickoff: 'KICK-OFF',
  sub: 'SUBSTITUTION',
};

/** One row of the strip. */
export interface EventRow {
  /** Stable identity (React key; changes only when the row is a new one). */
  key: string;
  /** Game second the row appears at. */
  sec: number;
  kind: EventRowKind;
  /**
   * The main player, by roster index: the scorer, the keeper, the shooter
   * (woodwork, wide), the tackle winner, the offender, the taker, the
   * player coming on.
   */
  who: number;
  /** The other player, by roster index: the shooter a keeper saved from, the tackle loser, the victim, the player going off. */
  other: number | null;
}

/** What the log needs to know beyond the track. */
export interface EventLogLookup {
  /** Which side a roster index plays for (an own goal is credited to the other side). */
  sideOf?(player: number): TeamSide | null;
  /** Where and when the ball met a goal frame before a woodwork action (emitted later, when the shot is resolved). */
  frameHitBefore?(sec: number): { sec: number } | null;
}

/** Restart kinds that get a row ('keeper', his own release, does not). */
const RESTART_ROW: Readonly<Record<string, EventRowKind | undefined>> = {
  freekick: 'freekick',
  penalty: 'penalty',
  corner: 'corner',
  throw: 'throw',
  goalkick: 'goalkick',
  kickoff: 'kickoff',
};

/**
 * Every row of a match, in the order they appear (oldest first).
 *
 * @param track   The decoded action track (null: an old replay, no rows).
 * @param lookup  Side and frame-hit lookups (optional: without a side every
 *                goal is a GOAL; without the frame hit a WOODWORK row is at
 *                its action).
 * @returns       Rows sorted by game second, ties in the track's own order.
 */
export function buildEventLog(track: ActionTrack | null | undefined, lookup: EventLogLookup = {}): EventRow[] {
  if (!track || track.actions.length === 0) return [];
  const acts = track.actions;
  const dt = track.dtSec;
  // Each row carries a sort key: its game second, then (index of the action
  // that times it) x 3 + slot, so a WIDE (slot 0) sits before the goal kick
  // it caused (slot 1) and a card (slot 2) right after its foul (slot 1).
  const rows: Array<EventRow & { order: number }> = [];
  const add = (kind: EventRowKind, sec: number, index: number, slot: number, who: number, other: number | null): void => {
    rows.push({ key: `${kind}:${index}`, sec, kind, who, other, order: index * 3 + slot });
  };

  acts.forEach((a, i) => {
    const sec = a.tick * dt;
    switch (a.kind) {
      case 'goal': {
        const side = lookup.sideOf?.(a.by) ?? null;
        add(side != null && side !== a.side ? 'ownGoal' : 'goal', sec, i, 1, a.by, null);
        break;
      }
      case 'dive': {
        if (a.outcome === 'beaten') break;
        const shot = shotBefore(track, i);
        if (!shot) break;
        if (goalWithin(acts, i, sec, dt, SAVE_THEN_GOAL_SEC)) break;
        const kind = a.outcome === 'catch' ? 'catch' : parriedBy(acts, i, sec, dt, a.by) ? 'parry' : 'save';
        add(kind, sec, i, 1, a.by, shot.by);
        break;
      }
      case 'woodwork': {
        const hit = lookup.frameHitBefore?.(sec) ?? null;
        add('woodwork', hit ? hit.sec : sec, i, 1, a.by, null);
        break;
      }
      case 'kick': {
        if (!isShotKick(a)) break;
        const out = wideAfter(acts, i, sec, dt);
        if (out != null) add('wide', acts[out]!.tick * dt, out, 0, a.by, null);
        break;
      }
      case 'tackle':
        add('tackle', sec, i, 1, a.by, a.from);
        break;
      case 'interception':
        add('interception', sec, i, 1, a.by, null);
        break;
      case 'foul':
        add('foul', sec, i, 1, a.by, a.on);
        if (a.card !== 'none') add(a.card, sec, i, 2, a.by, null);
        break;
      case 'offside':
        add('offside', sec, i, 1, a.by, null);
        break;
      case 'sub':
        add('sub', sec, i, 1, a.on, a.off);
        break;
      case 'restart': {
        const kind = RESTART_ROW[a.restart];
        if (!kind) break;
        if (kind === 'kickoff') {
          const taken = takenAt(acts, i);
          if (taken != null) add('kickoff', acts[taken]!.tick * dt, taken, 0, a.by, null);
          else add('kickoff', a.readyTick * dt, i, 1, a.by, null);
        } else {
          add(kind, sec, i, 1, a.by, null);
        }
        break;
      }
    }
  });

  rows.sort((x, y) => x.sec - y.sec || x.order - y.order);
  return rows.map((r) => ({ key: r.key, sec: r.sec, kind: r.kind, who: r.who, other: r.other }));
}

/** True when a goal follows the action at `index` within `withinSec`. */
function goalWithin(acts: readonly ReplayAction[], index: number, sec: number, dt: number, withinSec: number): boolean {
  for (let j = index + 1; j < acts.length && acts[j]!.tick * dt - sec <= withinSec; j++) {
    if (acts[j]!.kind === 'goal') return true;
  }
  return false;
}

/** True when the keeper's own next touch after his dive is a parry. */
function parriedBy(acts: readonly ReplayAction[], index: number, sec: number, dt: number, keeper: number): boolean {
  for (let j = index + 1; j < acts.length && acts[j]!.tick * dt - sec <= PARRY_AFTER_DIVE_SEC; j++) {
    const b = acts[j]!;
    if (b.kind === 'kick' && b.by === keeper) return b.kick === 'parry';
  }
  return false;
}

/**
 * The goal kick a shot went out for: the first restart after it, within
 * WIDE_WITHIN_SEC, with nobody playing the ball in between (a keeper's
 * dive that never touched it does not count).  Null otherwise.
 */
function wideAfter(acts: readonly ReplayAction[], index: number, sec: number, dt: number): number | null {
  for (let j = index + 1; j < acts.length; j++) {
    const b = acts[j]!;
    if (b.tick * dt - sec > WIDE_WITHIN_SEC) return null;
    if (b.kind === 'dive' && b.outcome === 'beaten') continue;
    if (b.kind === 'restart') return b.restart === 'goalkick' ? j : null;
    return null;
  }
  return null;
}

/** The kick that took the restart at `index` (the first kick after it), or null. */
function takenAt(acts: readonly ReplayAction[], index: number): number | null {
  const tick = acts[index]!.tick;
  for (let j = index + 1; j < acts.length; j++) {
    const b = acts[j]!;
    if (b.kind === 'kick' && b.tick > tick) return j;
    if (b.kind === 'restart') return null;
  }
  return null;
}

/**
 * The rows on show at a game second: the newest `n`, newest first.
 *
 * @param log      From buildEventLog (oldest first).
 * @param gameSec  The LIVE game clock (a slow-motion replay does not re-log).
 * @param n        How many rows (EVENT_STRIP_ROWS).
 */
export function eventRowsAt(log: readonly EventRow[], gameSec: number, n: number = EVENT_STRIP_ROWS): EventRow[] {
  // Binary search for the first row after gameSec.
  let lo = 0;
  let hi = log.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (log[mid]!.sec <= gameSec) lo = mid + 1;
    else hi = mid;
  }
  const out: EventRow[] = [];
  for (let i = lo - 1; i >= 0 && out.length < n; i--) out.push(log[i]!);
  return out;
}

/**
 * The replay's own clock for a game second: minute'second", the minute
 * counted from 1 like the replay frames (logic/replay/snapshots.ts), so
 * game second 1294 (21:34 played) is 22'34".
 */
export function replayClock(gameSec: number): string {
  const second = Math.floor(Math.max(0, gameSec) % 60);
  return `${replayMinute(gameSec)}'${second < 10 ? '0' : ''}${second}"`;
}

/** The replay's minute for a game second: counted from 1, at most 120 (as the frames). */
export function replayMinute(gameSec: number): number {
  return Math.min(120, Math.max(1, Math.floor(Math.max(0, gameSec) / 60) + 1));
}

/**
 * The who-text of a row: names with shirt numbers, e.g. "17 Talus wins it
 * from 10 Cruz", "4 Kovacs on 11 Osei", "9 Gush Li".
 *
 * @param row     The row.
 * @param nameOf  A roster index as the strip names him ("17 Talus", or "Number 7").
 * @param clubOf  His club's name, for a substitution (optional).
 */
export function eventRowText(row: EventRow, nameOf: (player: number) => string, clubOf?: (player: number) => string | null | undefined): string {
  const who = nameOf(row.who);
  const other = row.other != null ? nameOf(row.other) : null;
  switch (row.kind) {
    case 'tackle':
      return other ? `${who} wins it from ${other}` : who;
    case 'foul':
      return other ? `${who} on ${other}` : who;
    case 'save':
    case 'parry':
    case 'catch':
      return other ? `${who} from ${other}` : who;
    case 'sub': {
      const club = clubOf?.(row.who) ?? null;
      const pair = other ? `${who} on, ${other} off` : `${who} on`;
      return club ? `${pair}, ${club}` : pair;
    }
    default:
      return who;
  }
}
