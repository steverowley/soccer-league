// ── features/match/logic/replay/actionRecorder.ts ────────────────────────────
// Records the replay's action track while the engine runs (the contract is
// actions.ts; docs/match-viewer.md section 5).  Composed into the replay
// recorder (recorder.ts), so the simulate function on Vercel and the local
// demo record it the same way.
//
// WHERE EACH ACTION COMES FROM (all read-only)
//   kick          SimConfig.observer.kick: every KickInfo the engine sets on
//                 the ball (a strike, throw, header, poke, parry or
//                 deflection), as it is made, so a pass touched in the tick
//                 it was struck still counts.  The kick that takes a
//                 restart is labelled with the restart (corner, goalkick,
//                 freekick, kickoff, throw, penalty) and keeps the engine's
//                 own kind in `delivery` when that differs.
//   dive          SimConfig.observer.dive: the keeper's `dive` (target and
//                 height) as he commits.  Its outcome is settled by what
//                 follows: a parry or deflection by him is a save, the ball
//                 in his possession (a catch, or a first touch) is a catch,
//                 the dive ending any other way (a goal, the ball past or
//                 away from him) is beaten.  A keeper who catches or parries
//                 without a dive gets one at that moment, at the contact
//                 point (a parry) or his own position (a catch).
//   restart       onTick: each new `world.restart` (kind, taker, spot,
//                 readyAt rounded up to the first tick it may be taken).
//   tackle, interception, foul (+ card), goal, woodwork, offside, sub
//                 the engine's own event list (SimEvent), one action per
//                 event at its exact tick, handed over when the match ends.
//                 An own goal's scorer is the last man to touch the ball;
//                 an offside's spot is the free kick it gave.
//   Passes, shots, saves, penalties and balls out are not separate actions:
//   they are the kicks, dives and restarts above.
//
// TICKS
//   tick = round(clockSec / dtSec): 0 is the kickoff (the world before the
//   first step), n the state after the n-th step, matching the replay's
//   ball keyframes.

import type {
  KickInfo, KickKind, Restart, RestartKind, SimEvent, SimObserver, SimPlayer, SimWorld,
} from '../spatial/types';
import type { DiveOutcome } from './actions';
import { sortActions, type RecordedAction } from './actionTrack';

/** The KickKind a restart's taking kick is labelled with ('keeper' keeps the engine's kind). */
const RESTART_KICK: Readonly<Partial<Record<RestartKind, KickKind>>> = {
  kickoff: 'kickoff',
  throw: 'throw',
  corner: 'corner',
  goalkick: 'goalkick',
  freekick: 'freekick',
  penalty: 'penalty',
};

/** A recorded dive. */
type DiveRec = Extract<RecordedAction, { kind: 'dive' }>;

/** A recorded restart. */
type RestartRec = Extract<RecordedAction, { kind: 'restart' }>;

/** A dive whose outcome is not settled yet. */
interface OpenDive {
  action: DiveRec;
  /** The keeper's `dive` object it belongs to (the dive ends when it changes). */
  ref: SimPlayer['dive'];
}

/** A recorder of the action track: hand `onTick` and `observer` to the engine. */
export interface ActionRecorder {
  onTick: (world: Readonly<SimWorld>) => void;
  observer: SimObserver;
  /**
   * The finished track, players by id, sorted.
   *
   * @param events  The match's SimEvent list (SpatialMatchResult.events).
   */
  actions: (events: readonly SimEvent[]) => RecordedAction[];
}

/** Tolerance for float drift when rounding a clock second up to a tick. */
const TICK_EPS = 1e-6;

/**
 * Create an action recorder for one match.
 *
 * @returns  The tick observer, the engine observer and the track accessor.
 */
export function createActionRecorder(): ActionRecorder {
  const recorded: RecordedAction[] = [];
  let dtSec = 0.1;
  const open = new Map<string, OpenDive>();
  let lastRestart: Restart | null = null;
  /** The restart in progress and its action, until its taking kick. */
  let pending: { r: Readonly<Restart>; action: RestartRec } | null = null;
  /** Offside free kicks by tick: the offside action's spot. */
  const offsideSpot = new Map<number, { x: number; y: number }>();
  /** The last man to touch the ball at each tick the score changed. */
  const goalTouch = new Map<number, string | null>();
  let goalsSeen = 0;
  /** Ball height at the end of the previous tick (a dive-less catch's height). */
  let lastBallZ = 0;

  const tickOf = (world: Readonly<SimWorld>): number => Math.round(world.clockSec / world.dtSec);

  /** Settle an open dive and stop tracking it. */
  const settle = (keeperId: string, outcome: DiveOutcome): void => {
    const d = open.get(keeperId);
    if (!d) return;
    d.action.outcome = outcome;
    open.delete(keeperId);
  };

  const findPlayer = (world: Readonly<SimWorld>, id: string): Readonly<SimPlayer> | undefined => {
    for (const p of world.home) if (p.id === id) return p;
    for (const p of world.away) if (p.id === id) return p;
    return undefined;
  };

  const kick = (k: Readonly<KickInfo>, world: Readonly<SimWorld>): void => {
    const tick = tickOf(world);
    let label: KickKind = k.kind;
    let delivery: KickKind | null = null;
    // deadBallTick clears world.restart, then the taker kicks: this is the
    // kick that takes the restart in progress.
    if (pending !== null && world.restart === null && k.playerId === pending.r.takerId) {
      const as = RESTART_KICK[pending.r.kind];
      if (as !== undefined && as !== k.kind) {
        label = as;
        delivery = k.kind;
      }
      pending = null;
    }
    recorded.push(delivery === null
      ? { kind: 'kick', tick, by: k.playerId, kick: label }
      : { kind: 'kick', tick, by: k.playerId, kick: label, delivery });

    if (k.kind === 'parry' || k.kind === 'deflection') {
      const p = findPlayer(world, k.playerId);
      if (p && p.role === 'GK') {
        if (open.has(p.id)) settle(p.id, 'save');
        else recorded.push({ kind: 'dive', tick, by: p.id, x: k.from.x, y: k.from.y, z: world.ball.z, outcome: 'save' });
      }
    }
  };

  const dive = (k: Readonly<SimPlayer>, world: Readonly<SimWorld>): void => {
    const d = k.dive;
    if (d === null) return;
    // A new dive ends the previous one untouched.
    settle(k.id, 'beaten');
    const action: DiveRec = { kind: 'dive', tick: tickOf(world), by: k.id, x: d.at.x, y: d.at.y, z: d.z, outcome: 'beaten' };
    recorded.push(action);
    open.set(k.id, { action, ref: d });
  };

  const onTick = (world: Readonly<SimWorld>): void => {
    const tick = tickOf(world);
    if (tick === 0) dtSec = world.dtSec;

    const r = world.restart;
    if (r !== null && r !== lastRestart) {
      const action: RestartRec = {
        kind: 'restart', tick, restart: r.kind, by: r.takerId, x: r.spot.x, y: r.spot.y,
        readyTick: Math.max(tick + 1, Math.ceil(r.readyAt / world.dtSec - TICK_EPS)),
      };
      recorded.push(action);
      pending = { r, action };
      if (r.kind === 'freekick' && r.indirect) offsideSpot.set(tick, { x: r.spot.x, y: r.spot.y });
      if (r.kind === 'keeper') {
        // A keeper's restart begins only when he catches the ball.
        if (open.has(r.takerId)) settle(r.takerId, 'catch');
        else recorded.push({ kind: 'dive', tick, by: r.takerId, x: r.spot.x, y: r.spot.y, z: lastBallZ, outcome: 'catch' });
      }
    }
    lastRestart = r;
    // The engine re-picks a taker who has left the pitch: follow it.
    if (pending !== null && r === pending.r && pending.action.by !== r.takerId) pending.action.by = r.takerId;

    for (const [id, d] of open) {
      if (world.ball.ownerId === id) { settle(id, 'catch'); continue; }
      const p = findPlayer(world, id);
      if (!p || p.dive !== d.ref) settle(id, 'beaten');
    }

    const goals = world.score[0] + world.score[1];
    if (goals !== goalsSeen) {
      goalTouch.set(tick, world.ball.lastTouchId);
      goalsSeen = goals;
    }
    lastBallZ = world.ball.z;
  };

  const actions = (events: readonly SimEvent[]): RecordedAction[] => {
    const out: RecordedAction[] = recorded.slice();
    for (const e of events) {
      const tick = Math.round(e.tSec / dtSec);
      const by = e.playerId ?? null;
      switch (e.type) {
        case 'tackle':
          out.push({ kind: 'tackle', tick, by, from: e.otherId ?? null });
          break;
        case 'interception':
          out.push({ kind: 'interception', tick, by });
          break;
        case 'foul':
          out.push({ kind: 'foul', tick, by, on: e.otherId ?? null, card: e.card ?? 'none' });
          break;
        case 'goal':
          out.push({ kind: 'goal', tick, by: by ?? goalTouch.get(tick) ?? null, side: e.side ?? 'home' });
          break;
        case 'woodwork':
          out.push({ kind: 'woodwork', tick, by });
          break;
        case 'offside': {
          const at = offsideSpot.get(tick) ?? { x: 0, y: 0 };
          out.push({ kind: 'offside', tick, by, x: at.x, y: at.y });
          break;
        }
        case 'substitution':
          out.push({ kind: 'sub', tick, on: by, off: e.otherId ?? null });
          break;
        default:
          // kickoff, pass, shot, save, penalty and balls out are the kicks,
          // dives and restarts already recorded.
          break;
      }
    }
    return sortActions(out);
  };

  return { onTick, observer: { kick, dive }, actions };
}
