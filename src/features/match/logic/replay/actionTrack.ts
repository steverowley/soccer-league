// ── features/match/logic/replay/actionTrack.ts ───────────────────────────────
// The action track between the recorder, the v3 replay file and the viewer
// (docs/match-viewer.md section 5).  The recorder names players by id; the
// file and the viewer name them by roster index (the contract in
// actions.ts).  This module puts actions in their canonical order, maps ids
// to roster indices, and encodes and decodes the file's `actions` field.
//
// THE `actions` FIELD (format v3, additive: older v3 files have none)
//   One object of columns per kind.  Entry i of every column of a kind
//   belongs to the same action; `t` is delta coded (the first tick as is,
//   then the gap from the previous action of that kind).  Players are
//   roster indices (-1 when unknown); spots are centimetres.
//     kick:          t, p kicker, k KickKind, d the engine's own kind when k
//                    is the restart it takes ('' otherwise)
//     tackle:        t, p winner, q loser
//     interception:  t, p
//     foul:          t, p offender, q fouled, c card ('none' | 'yellow' | 'red')
//     dive:          t, p keeper, x y z target (cm), o outcome
//     restart:       t, p taker, k RestartKind, x y spot (cm), r ready tick minus tick
//     goal:          t, p scorer, s side credited
//     woodwork:      t, p
//     offside:       t, p, x y (cm)
//     sub:           t, p on, q off
//   Columns of small integers and repeated short words are what gzip
//   compresses well: about 2,000 actions a match cost a few KB.
//
// ORDER
//   Ascending tick; within a tick a fixed order of kinds (ACTION_ORDER),
//   then the order they were recorded in.  The recorder, the encoder and
//   the decoder all sort this way, so a decoded track is the one the local
//   demo builds straight from the recorder.
//
// PURE: no I/O.

import type { KickKind, RestartKind, TeamSide } from '../spatial/types';
import type { ActionTrack, CardKind, DiveOutcome, ReplayAction } from './actions';

/** Spots (dive targets, restart and offside spots) are stored in centimetres. */
export const ACTION_SPOT_SCALE = 100;

/** The fields of an action that name a player. */
type PlayerField = 'by' | 'from' | 'on' | 'off';

/** One action shape with its players named by id (null when unknown). */
type WithIds<A> = { [K in keyof A]: K extends PlayerField ? string | null : A[K] };

/** Map each member of the union separately (a distributive conditional). */
type Distribute<A> = A extends ReplayAction ? WithIds<A> : never;

/** An action as the recorder captures it: a ReplayAction with player ids. */
export type RecordedAction = Distribute<ReplayAction>;

/** Every action kind. */
export type ActionKind = ReplayAction['kind'];

/**
 * The order of kinds within one tick: what led to the moment first (a
 * substitution, a challenge), then the keeper and the ball, then what the
 * moment led to (woodwork, a goal, the restart it set up).
 */
export const ACTION_ORDER: Readonly<Record<ActionKind, number>> = {
  sub: 0,
  foul: 1,
  tackle: 2,
  interception: 3,
  offside: 4,
  dive: 5,
  kick: 6,
  woodwork: 7,
  goal: 8,
  restart: 9,
};

/** Every KickKind, for validating a decoded file. */
const KICK_KINDS: ReadonlySet<string> = new Set<KickKind>([
  'pass', 'through', 'cross', 'long', 'clear', 'shot', 'throw', 'goalkick', 'corner',
  'freekick', 'penalty', 'kickoff', 'dribble', 'header', 'parry', 'deflection', 'poke',
]);

/** Every RestartKind. */
const RESTART_KINDS: ReadonlySet<string> = new Set<RestartKind>([
  'kickoff', 'throw', 'corner', 'goalkick', 'freekick', 'penalty', 'keeper',
]);

const CARDS: ReadonlySet<string> = new Set<CardKind>(['none', 'yellow', 'red']);
const OUTCOMES: ReadonlySet<string> = new Set<DiveOutcome>(['save', 'catch', 'beaten']);
const SIDES: ReadonlySet<string> = new Set<TeamSide>(['home', 'away']);

/**
 * Sort actions into the canonical order (see the file header).  Returns a
 * new array; Array.prototype.sort is stable, so equal keys keep the order
 * they were recorded in.
 */
export function sortActions<A extends { kind: ActionKind; tick: number }>(actions: readonly A[]): A[] {
  return actions.slice().sort((a, b) => a.tick - b.tick || ACTION_ORDER[a.kind] - ACTION_ORDER[b.kind]);
}

/** The players an action names, in field order (nulls skipped). */
function playersOf(a: RecordedAction): Array<string | null> {
  switch (a.kind) {
    case 'tackle': return [a.by, a.from];
    case 'foul': return [a.by, a.on];
    case 'sub': return [a.on, a.off];
    default: return [a.by];
  }
}

/**
 * The replay's union roster: every player in the frames in order of first
 * appearance, then any player named only by an action (in action order).
 * The encoder writes this roster into the file, so roster indices in the
 * file, the decoded track and the demo's track agree.
 */
export function unionRoster(
  frames: ReadonlyArray<ReadonlyArray<{ id: string }>>,
  actions: readonly RecordedAction[] = [],
): string[] {
  const roster: string[] = [];
  const seen = new Set<string>();
  const add = (id: string | null): void => {
    if (id !== null && !seen.has(id)) {
      seen.add(id);
      roster.push(id);
    }
  };
  for (const frame of frames) for (const p of frame) add(p.id);
  for (const a of actions) for (const id of playersOf(a)) add(id);
  return roster;
}

/**
 * The roster a track's player indices refer to: the decoded file's own, or
 * for a live recording the union roster the encoder will write.
 */
export function replayRoster(track: {
  frames: ReadonlyArray<ReadonlyArray<{ id: string }>>;
  actions?: readonly RecordedAction[];
  roster?: readonly string[];
}): string[] {
  return track.roster ? track.roster.slice() : unionRoster(track.frames, track.actions);
}

/**
 * Convert recorded actions (ids) into the viewer's action track (roster
 * indices), sorted.
 *
 * @param actions  Recorded actions.
 * @param roster   The union roster the indices refer to.
 * @param dtSec    The engine step.
 */
export function toActionTrack(actions: readonly RecordedAction[], roster: readonly string[], dtSec: number): ActionTrack {
  const index = new Map<string, number>();
  roster.forEach((id, i) => index.set(id, i));
  const ix = (id: string | null): number => (id === null ? -1 : (index.get(id) ?? -1));
  const out: ReplayAction[] = actions.map((a): ReplayAction => {
    switch (a.kind) {
      case 'tackle': return { ...a, by: ix(a.by), from: ix(a.from) };
      case 'foul': return { ...a, by: ix(a.by), on: ix(a.on) };
      case 'sub': return { ...a, on: ix(a.on), off: ix(a.off) };
      default: return { ...a, by: ix(a.by) };
    }
  });
  return { dtSec, actions: sortActions(out), roster };
}

/** The file's `actions` field (see the file header). */
export interface ReplayV3Actions {
  kick: { t: number[]; p: number[]; k: string[]; d: string[] };
  tackle: { t: number[]; p: number[]; q: number[] };
  interception: { t: number[]; p: number[] };
  foul: { t: number[]; p: number[]; q: number[]; c: string[] };
  dive: { t: number[]; p: number[]; x: number[]; y: number[]; z: number[]; o: string[] };
  restart: { t: number[]; p: number[]; k: string[]; x: number[]; y: number[]; r: number[] };
  goal: { t: number[]; p: number[]; s: string[] };
  woodwork: { t: number[]; p: number[] };
  offside: { t: number[]; p: number[]; x: number[]; y: number[] };
  sub: { t: number[]; p: number[]; q: number[] };
}

/** A spot coordinate as stored (centimetres, never -0). */
function cm(n: number): number {
  return Math.round(n * ACTION_SPOT_SCALE) + 0;
}

/** Delta-code a tick column in place. */
function deltaTicks(t: number[]): void {
  for (let i = t.length - 1; i > 0; i--) t[i] = t[i]! - t[i - 1]!;
}

/**
 * Encode an action track as the file's `actions` columns.
 *
 * @param track  A sorted action track (roster indices).
 * @returns      The columns to store.
 */
export function encodeActions(track: ActionTrack): ReplayV3Actions {
  const f: ReplayV3Actions = {
    kick: { t: [], p: [], k: [], d: [] },
    tackle: { t: [], p: [], q: [] },
    interception: { t: [], p: [] },
    foul: { t: [], p: [], q: [], c: [] },
    dive: { t: [], p: [], x: [], y: [], z: [], o: [] },
    restart: { t: [], p: [], k: [], x: [], y: [], r: [] },
    goal: { t: [], p: [], s: [] },
    woodwork: { t: [], p: [] },
    offside: { t: [], p: [], x: [], y: [] },
    sub: { t: [], p: [], q: [] },
  };
  for (const a of track.actions) {
    switch (a.kind) {
      case 'kick':
        f.kick.t.push(a.tick); f.kick.p.push(a.by); f.kick.k.push(a.kick); f.kick.d.push(a.delivery ?? '');
        break;
      case 'tackle':
        f.tackle.t.push(a.tick); f.tackle.p.push(a.by); f.tackle.q.push(a.from);
        break;
      case 'interception':
        f.interception.t.push(a.tick); f.interception.p.push(a.by);
        break;
      case 'foul':
        f.foul.t.push(a.tick); f.foul.p.push(a.by); f.foul.q.push(a.on); f.foul.c.push(a.card);
        break;
      case 'dive':
        f.dive.t.push(a.tick); f.dive.p.push(a.by);
        f.dive.x.push(cm(a.x)); f.dive.y.push(cm(a.y)); f.dive.z.push(cm(a.z)); f.dive.o.push(a.outcome);
        break;
      case 'restart':
        f.restart.t.push(a.tick); f.restart.p.push(a.by); f.restart.k.push(a.restart);
        f.restart.x.push(cm(a.x)); f.restart.y.push(cm(a.y)); f.restart.r.push(a.readyTick - a.tick);
        break;
      case 'goal':
        f.goal.t.push(a.tick); f.goal.p.push(a.by); f.goal.s.push(a.side);
        break;
      case 'woodwork':
        f.woodwork.t.push(a.tick); f.woodwork.p.push(a.by);
        break;
      case 'offside':
        f.offside.t.push(a.tick); f.offside.p.push(a.by); f.offside.x.push(cm(a.x)); f.offside.y.push(cm(a.y));
        break;
      case 'sub':
        f.sub.t.push(a.tick); f.sub.p.push(a.on); f.sub.q.push(a.off);
        break;
    }
  }
  for (const col of Object.values(f) as Array<{ t: number[] }>) deltaTicks(col.t);
  return f;
}

// ── Decoding (defensive: the field is cosmetic, so a bad one is dropped) ────

/** Thrown inside decodeActions when a column is malformed. */
class BadActions extends Error {}

/** The columns of one kind, each checked to be an array of `n` entries. */
function columns(raw: Record<string, unknown>, kind: string, names: readonly string[]): { n: number; cols: Record<string, unknown[]> } {
  const obj = raw[kind];
  // A kind the file does not carry is simply empty (forward compatible).
  if (obj === undefined) return { n: 0, cols: Object.fromEntries(names.map((c) => [c, []])) };
  if (typeof obj !== 'object' || obj === null) throw new BadActions(kind);
  const cols: Record<string, unknown[]> = {};
  let n = -1;
  for (const c of names) {
    const col = (obj as Record<string, unknown>)[c];
    if (!Array.isArray(col)) throw new BadActions(`${kind}.${c}`);
    if (n === -1) n = col.length;
    else if (col.length !== n) throw new BadActions(`${kind}.${c} length`);
    cols[c] = col;
  }
  return { n: Math.max(0, n), cols };
}

/** An integer entry. */
function int(v: unknown): number {
  if (typeof v !== 'number' || !Number.isInteger(v)) throw new BadActions('not an integer');
  return v;
}

/** A word from a known set. */
function word<T extends string>(v: unknown, allowed: ReadonlySet<string>): T {
  if (typeof v !== 'string' || !allowed.has(v)) throw new BadActions(`unknown word ${String(v)}`);
  return v as T;
}

/**
 * Decode the file's `actions` field back into recorded actions (players by
 * id; toActionTrack turns them into the viewer's track).
 *
 * @param raw     The field as parsed from JSON (unvalidated).
 * @param roster  The file's union roster.
 * @returns       The sorted actions, or null when the field is malformed.
 */
export function decodeActions(raw: unknown, roster: readonly string[]): RecordedAction[] | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const out: RecordedAction[] = [];
  const player = (v: unknown): string | null => {
    const i = int(v);
    if (i < -1 || i >= roster.length) throw new BadActions('player out of range');
    return i === -1 ? null : roster[i]!;
  };
  const metres = (v: unknown): number => int(v) / ACTION_SPOT_SCALE;
  /** Undo the tick deltas of one kind. */
  const ticks = (col: unknown[]): number[] => {
    const t: number[] = [];
    let at = 0;
    for (let i = 0; i < col.length; i++) {
      at = i === 0 ? int(col[i]) : at + int(col[i]);
      if (at < 0) throw new BadActions('negative tick');
      t.push(at);
    }
    return t;
  };
  try {
    {
      const { n, cols } = columns(r, 'kick', ['t', 'p', 'k', 'd']);
      const t = ticks(cols.t!);
      for (let i = 0; i < n; i++) {
        const d = cols.d![i];
        const kick: Extract<RecordedAction, { kind: 'kick' }> = { kind: 'kick', tick: t[i]!, by: player(cols.p![i]), kick: word<KickKind>(cols.k![i], KICK_KINDS) };
        out.push(d === '' ? kick : { ...kick, delivery: word<KickKind>(d, KICK_KINDS) });
      }
    }
    {
      const { n, cols } = columns(r, 'tackle', ['t', 'p', 'q']);
      const t = ticks(cols.t!);
      for (let i = 0; i < n; i++) out.push({ kind: 'tackle', tick: t[i]!, by: player(cols.p![i]), from: player(cols.q![i]) });
    }
    {
      const { n, cols } = columns(r, 'interception', ['t', 'p']);
      const t = ticks(cols.t!);
      for (let i = 0; i < n; i++) out.push({ kind: 'interception', tick: t[i]!, by: player(cols.p![i]) });
    }
    {
      const { n, cols } = columns(r, 'foul', ['t', 'p', 'q', 'c']);
      const t = ticks(cols.t!);
      for (let i = 0; i < n; i++) {
        out.push({ kind: 'foul', tick: t[i]!, by: player(cols.p![i]), on: player(cols.q![i]), card: word<CardKind>(cols.c![i], CARDS) });
      }
    }
    {
      const { n, cols } = columns(r, 'dive', ['t', 'p', 'x', 'y', 'z', 'o']);
      const t = ticks(cols.t!);
      for (let i = 0; i < n; i++) {
        out.push({
          kind: 'dive', tick: t[i]!, by: player(cols.p![i]),
          x: metres(cols.x![i]), y: metres(cols.y![i]), z: metres(cols.z![i]),
          outcome: word<DiveOutcome>(cols.o![i], OUTCOMES),
        });
      }
    }
    {
      const { n, cols } = columns(r, 'restart', ['t', 'p', 'k', 'x', 'y', 'r']);
      const t = ticks(cols.t!);
      for (let i = 0; i < n; i++) {
        const wait = int(cols.r![i]);
        if (wait < 0) throw new BadActions('restart ready before it began');
        out.push({
          kind: 'restart', tick: t[i]!, restart: word<RestartKind>(cols.k![i], RESTART_KINDS), by: player(cols.p![i]),
          x: metres(cols.x![i]), y: metres(cols.y![i]), readyTick: t[i]! + wait,
        });
      }
    }
    {
      const { n, cols } = columns(r, 'goal', ['t', 'p', 's']);
      const t = ticks(cols.t!);
      for (let i = 0; i < n; i++) out.push({ kind: 'goal', tick: t[i]!, by: player(cols.p![i]), side: word<TeamSide>(cols.s![i], SIDES) });
    }
    {
      const { n, cols } = columns(r, 'woodwork', ['t', 'p']);
      const t = ticks(cols.t!);
      for (let i = 0; i < n; i++) out.push({ kind: 'woodwork', tick: t[i]!, by: player(cols.p![i]) });
    }
    {
      const { n, cols } = columns(r, 'offside', ['t', 'p', 'x', 'y']);
      const t = ticks(cols.t!);
      for (let i = 0; i < n; i++) {
        out.push({ kind: 'offside', tick: t[i]!, by: player(cols.p![i]), x: metres(cols.x![i]), y: metres(cols.y![i]) });
      }
    }
    {
      const { n, cols } = columns(r, 'sub', ['t', 'p', 'q']);
      const t = ticks(cols.t!);
      for (let i = 0; i < n; i++) out.push({ kind: 'sub', tick: t[i]!, on: player(cols.p![i]), off: player(cols.q![i]) });
    }
  } catch (err) {
    if (err instanceof BadActions) return null;
    throw err;
  }
  return sortActions(out);
}
