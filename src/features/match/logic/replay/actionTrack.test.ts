// ── features/match/logic/replay/actionTrack.test.ts ─────────────────────────
// The replay's action track on a full simulated match between two real ISL
// squads (docs/match-viewer.md section 5): recorded while the engine runs,
// encoded into the v3 file, served from a fake Storage and read back through
// getMatchPositions, and built by the local demo path.
//
// What is asserted, against the engine's own records:
//   - recording changes nothing: the match is byte-identical with and
//     without the recorder (and with the trace sink used as the oracle);
//   - every SimEvent of every kind has its action one-for-one (count, tick,
//     players): tackles, interceptions, fouls with their card, goals,
//     woodwork, offsides, substitutions, passes (as kicks), balls out and
//     goals and fouls (as the restarts they set up);
//   - every kick the engine makes appears once with its kind: the oracle is
//     the engine's trace sink, which records each strike, header, poke,
//     parry and block where it happens;
//   - every restart has a taker and a ready tick after it began, and its
//     taking kick carries the restart's label;
//   - keeper dives agree with what followed: a save event has a save or
//     catch dive, a save dive has his parry, a catch has the ball in his
//     hands, a beaten dive was never touched;
//   - decode(encode(x)) gives the same track (spots to 1 cm), an old v3
//     file without actions still decodes, a malformed action field is
//     dropped without losing the replay, and the demo path carries the same
//     track.

import { describe, it, expect, beforeAll } from 'vitest';
import { simulateSpatialMatch, type SpatialTeamInput } from '../spatial/simulateSpatialMatch';
import { toSpatialTeamInput } from '../spatial/spatialEventAdapter';
import type { KickKind, SimEvent, TraceRecord } from '../spatial/types';
import { createReplayRecorder, type ReplayTrack } from './recorder';
import { encodeReplayV3, type ReplayFileV3 } from './replayV3';
import { toActionTrack, unionRoster, type RecordedAction } from './actionTrack';
import type { ActionTrack, ReplayAction } from './actions';
import { getMatchPositions, type PositionSnapshot } from '../../api/matchPositions';
import { assembleMatch } from '../viewer/buildMatch';
import { gzipBytes } from '../../../../../supabase/functions/match-worker/replayFile.ts';
import squads from '../../../../../scripts/fixtures/bench-teams.json';

// ── Fixtures ────────────────────────────────────────────────────────────────

/** Deterministic UUID-shaped id (production player ids are UUIDs). */
const uuidFor = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** A real ISL squad from the bench fixture, built the way the worker builds it. */
function squad(i: number): SpatialTeamInput {
  const t = (squads as any[])[i];
  const players = (t.ps as unknown[][]).map((p, j) => ({
    id: uuidFor(i * 100 + j), name: String(p[0]), position: String(p[1]), starter: Boolean(p[2]), team_id: t.id,
    attacking: Number(p[3]), defending: Number(p[4]), mental: Number(p[5]), athletic: Number(p[6]), technical: Number(p[7]),
  }));
  return toSpatialTeamInput({ managers: [{ preferred_formation: t.f, style: t.s, game_model: t.gm }], players });
}

const DT = 0.1;
const tickOf = (tSec: number): number => Math.round(tSec / DT);

/**
 * Two real-squad matches chosen for coverage (scanned from seeds 1000 to
 * 1039): one with a penalty (the keeper's committed guess, the penalty
 * kick), one with an own goal (a goal the engine credits to nobody).
 */
const FIXTURES = [
  { label: 'a match with a penalty', h: 4, a: 0, seed: 1006, penalty: true, ownGoal: false },
  { label: 'a match with an own goal', h: 5, a: 1, seed: 1019, penalty: false, ownGoal: true },
];

/** A recorded action of one kind. */
type Rec<K extends RecordedAction['kind']> = Extract<RecordedAction, { kind: K }>;

let seed = 0;
let home: SpatialTeamInput;
let away: SpatialTeamInput;
let events: SimEvent[] = [];
let traces: TraceRecord[] = [];
/** The ball's owner after every tick (index = tick). */
let owners: Array<string | null> = [];
let track: ReplayTrack;
let actions: RecordedAction[] = [];
let plain = '';
let recordedOnly = '';
let recordedTraced = '';
let file: ReplayFileV3;
let gz: Uint8Array;
let snaps: PositionSnapshot[] = [];

/** Serve one replay file from a fake Storage and read it through the app's decoder. */
async function readBack(bytes: Uint8Array, id: string): Promise<PositionSnapshot[]> {
  const url = `https://storage.test/replays/${id}.json.gz`;
  const db = {
    storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: url } }) }) },
    from: () => {
      throw new Error('the legacy tables must not be read when the replay file exists');
    },
  } as unknown as Parameters<typeof getMatchPositions>[0];
  const fetch = async (input: string) =>
    input === url ? new Response(bytes.slice(), { status: 200 }) : new Response(null, { status: 404 });
  return getMatchPositions(db, id, { fetch });
}

const gzipJson = (v: unknown): Promise<Uint8Array> => gzipBytes(new TextEncoder().encode(JSON.stringify(v)));

/** The track as a file written before actions were recorded would hold it. */
function withoutActions(t: ReplayTrack): ReplayTrack {
  const copy = { ...t };
  delete copy.actions;
  return copy;
}

/** Simulate one fixture three ways and read its replay back (fills the lets above). */
async function load(h: number, a: number, s: number): Promise<void> {
  seed = s;
  home = squad(h);
  away = squad(a);
  plain = JSON.stringify(simulateSpatialMatch(home, away, { seed }));

  // The recorder alone: what the simulate function runs.
  const solo = createReplayRecorder();
  recordedOnly = JSON.stringify(simulateSpatialMatch(home, away, { seed, onTick: solo.onTick, observer: solo.observer }));

  // The recorder plus the trace sink (the oracle for kicks and dives) and the
  // ball's owner on every tick.
  const rec = createReplayRecorder();
  traces = [];
  owners = [];
  const r = simulateSpatialMatch(home, away, {
    seed,
    trace: (t) => traces.push(t),
    observer: rec.observer,
    onTick: (w) => {
      rec.onTick(w);
      owners.push(w.ball.ownerId);
    },
  });
  recordedTraced = JSON.stringify(r);
  events = r.events;
  track = rec.track(events);
  actions = track.actions!;
  file = encodeReplayV3('m1', track);
  gz = await gzipJson(file);
  snaps = await readBack(gz, 'm1');
}

const ofKind = <K extends RecordedAction['kind']>(k: K): Array<Rec<K>> =>
  actions.filter((a): a is Rec<K> => a.kind === k);
const eventsOf = (t: SimEvent['type']): SimEvent[] => events.filter((e) => e.type === t);

/** The engine's own kind of a recorded kick (a restart label keeps it in `delivery`). */
const engineKind = (k: Rec<'kick'>): KickKind => k.delivery ?? k.kick;

/** Sort a list of tuples for multiset comparison. */
const sorted = (xs: string[]): string[] => xs.slice().sort();

describe.each(FIXTURES)('$label', (fx) => {
  beforeAll(() => load(fx.h, fx.a, fx.seed), 180_000);

  describe('the action track of a full real-squad match', () => {
    it('recording never alters the match', () => {
      expect(recordedOnly).toBe(plain);
      expect(recordedTraced).toBe(plain);
    });

    it('covers the fixture\'s rare moments', () => {
      if (fx.penalty) {
        const pen = ofKind('restart').find((r) => r.restart === 'penalty')!;
        expect(pen).toBeDefined();
        expect(ofKind('kick').some((k) => k.kick === 'penalty' && k.by === pen.by && k.tick >= pen.readyTick)).toBe(true);
        // The keeper commits as the penalty is struck: a dive at the kick's tick.
        const kick = ofKind('kick').find((k) => k.kick === 'penalty')!;
        expect(ofKind('dive').some((d) => d.tick === kick.tick)).toBe(true);
      }
      if (fx.ownGoal) {
        const og = eventsOf('goal').find((e) => !e.playerId)!;
        expect(og).toBeDefined();
        const g = ofKind('goal').find((x) => x.tick === tickOf(og.tSec))!;
        // Credited to the attackers, put in by a defender.
        const defenders = g.side === 'home' ? away : home;
        const ids = new Set([...defenders.players, ...(defenders.bench ?? [])].map((p) => p.id));
        expect(g.by !== null && ids.has(g.by)).toBe(true);
      }
    });

    it('is sorted by tick and covers the whole match', () => {
      for (let i = 1; i < actions.length; i++) expect(actions[i]!.tick).toBeGreaterThanOrEqual(actions[i - 1]!.tick);
      expect(actions.length).toBeGreaterThan(1000);
      expect(actions.at(-1)!.tick).toBeGreaterThan(5000 / DT);
    });

    it('has one action per tackle, interception, foul, goal, woodwork, offside and substitution event', () => {
      const tackle = eventsOf('tackle').map((e) => [tickOf(e.tSec), e.playerId, e.otherId].join());
      expect(ofKind('tackle').map((a) => [a.tick, a.by, a.from].join())).toEqual(tackle);
      const icpt = eventsOf('interception').map((e) => [tickOf(e.tSec), e.playerId].join());
      expect(ofKind('interception').map((a) => [a.tick, a.by].join())).toEqual(icpt);
      const foul = eventsOf('foul').map((e) => [tickOf(e.tSec), e.playerId, e.otherId, e.card ?? 'none'].join());
      expect(ofKind('foul').map((a) => [a.tick, a.by, a.on, a.card].join())).toEqual(foul);
      const goal = eventsOf('goal').map((e) => [tickOf(e.tSec), e.side].join());
      expect(ofKind('goal').map((a) => [a.tick, a.side].join())).toEqual(goal);
      eventsOf('goal').forEach((e, i) => {
        const a = ofKind('goal')[i]!;
        if (e.playerId) expect(a.by).toBe(e.playerId);
        expect(a.by).not.toBeNull();
      });
      const wood = eventsOf('woodwork').map((e) => [tickOf(e.tSec), e.playerId].join());
      expect(ofKind('woodwork').map((a) => [a.tick, a.by].join())).toEqual(wood);
      const off = eventsOf('offside').map((e) => [tickOf(e.tSec), e.playerId].join());
      expect(ofKind('offside').map((a) => [a.tick, a.by].join())).toEqual(off);
      const sub = eventsOf('substitution').map((e) => [tickOf(e.tSec), e.playerId, e.otherId].join());
      expect(ofKind('sub').map((a) => [a.tick, a.on, a.off].join())).toEqual(sub);

      // The fixture exercises every kind, so none of the above is vacuous.
      for (const k of ['tackle', 'interception', 'foul', 'goal', 'offside', 'sub'] as const) {
        expect(ofKind(k).length, k).toBeGreaterThan(0);
      }
    });

    it('every offside is placed at the free kick it gave', () => {
      for (const o of ofKind('offside')) {
        const fk = ofKind('restart').find((r) => r.tick === o.tick && r.restart === 'freekick');
        expect(fk).toBeDefined();
        expect([o.x, o.y]).toEqual([fk!.x, fk!.y]);
      }
    });

    it('every pass event is a kick by the passer at its tick', () => {
      const passKinds: ReadonlySet<KickKind> = new Set(['pass', 'through', 'cross', 'long']);
      const kicks = ofKind('kick').filter((k) => passKinds.has(engineKind(k))).map((k) => [k.tick, k.by].join());
      const passes = eventsOf('pass').map((e) => [tickOf(e.tSec), e.playerId].join());
      expect(sorted(kicks)).toEqual(sorted(passes));
    });

    it('every kick the engine makes appears once, with its kind', () => {
      // The oracle: the trace record each kind of strike or touch writes.
      const truth: string[] = [];
      for (const t of traces) {
        const tick = Math.round(t.tSec * 10);
        let kind: KickKind | null = null;
        if (t.kind === 'shot') kind = t.data.restart === 'penalty' ? 'penalty' : 'shot';
        else if (t.kind === 'pass') kind = t.data.kind as KickKind;
        else if (t.kind === 'clear') kind = 'clear';
        else if (t.kind === 'header') kind = t.data.toMate ? 'header' : 'clear';
        else if (t.kind === 'keeper' && t.data.action === 'parry') kind = 'parry';
        else if (t.kind === 'block') kind = 'deflection';
        else if (t.kind === 'challenge' && t.data.outcome === 'ball') kind = 'poke';
        if (kind) truth.push([tick, t.playerId, kind].join());
      }
      const kicks = ofKind('kick').map((k) => [k.tick, k.by, engineKind(k)].join());
      expect(kicks.length).toBeGreaterThan(500);
      expect(sorted(kicks)).toEqual(sorted(truth));
      const kinds = new Set(ofKind('kick').map(engineKind));
      for (const k of ['pass', 'long', 'shot', 'throw', 'clear', 'header', 'poke', 'parry', 'deflection'] as const) {
        expect(kinds.has(k), k).toBe(true);
      }
    });

    it('every restart has a taker and a ready tick after it began, one per ball out, goal and foul', () => {
      const restarts = ofKind('restart');
      for (const r of restarts) {
        expect(r.by).not.toBeNull();
        expect(r.readyTick).toBeGreaterThan(r.tick);
      }
      // The engine's own record of every restart set up.
      const dead = traces.filter((t) => t.kind === 'dead').map((t) => [Math.round(t.tSec * 10), t.data.kind].join());
      expect(restarts.map((r) => [r.tick, r.restart].join())).toEqual(dead);
      const at = (kind: string): string[] => restarts.filter((r) => r.restart === kind).map((r) => String(r.tick));
      const ev = (type: SimEvent['type']): string[] => eventsOf(type).map((e) => String(tickOf(e.tSec)));
      expect(at('throw')).toEqual(ev('out_throw'));
      expect(at('corner')).toEqual(ev('out_corner'));
      expect(at('goalkick')).toEqual(ev('out_goalkick'));
      expect(at('penalty')).toEqual(ev('penalty'));
      expect(at('kickoff')).toEqual(['0', ...ev('goal')]);
      const fouls = eventsOf('foul').map((e) => tickOf(e.tSec));
      const offsides = eventsOf('offside').map((e) => tickOf(e.tSec));
      expect(sorted([...at('freekick'), ...at('penalty')])).toEqual(sorted([...fouls, ...offsides].map(String)));
    });

    it('labels the kick that takes each restart, by its taker', () => {
      const restarts = ofKind('restart');
      const kicks = ofKind('kick');
      const label: Partial<Record<string, KickKind>> = {
        kickoff: 'kickoff', throw: 'throw', corner: 'corner', goalkick: 'goalkick', freekick: 'freekick', penalty: 'penalty',
      };
      let taken = 0;
      let takenLabelled = 0;
      const restartOnly = new Set<KickKind>(['kickoff', 'corner', 'goalkick', 'freekick']);
      restarts.forEach((r, i) => {
        const end = restarts[i + 1]?.tick ?? Infinity;
        const k = kicks.find((x) => x.tick >= r.readyTick && x.tick < end);
        if (!k) {
          // Only the last restart can still be waiting at full time.
          expect(i).toBe(restarts.length - 1);
          return;
        }
        taken += 1;
        expect(k.by).toBe(r.by);
        const want = label[r.restart];
        if (want) expect(k.kick).toBe(want);
        else expect(k.delivery).toBeUndefined();
        if (want && restartOnly.has(want)) takenLabelled += 1;
      });
      expect(taken).toBeGreaterThan(50);
      // No kick carries a restart-only label except the one taking a restart.
      expect(kicks.filter((k) => restartOnly.has(k.kick)).length).toBe(takenLabelled);
    });

    it('keeper dives agree with what followed them', () => {
      const dives = ofKind('dive');
      expect(dives.filter((d) => d.outcome === 'save').length).toBeGreaterThan(0);
      expect(dives.filter((d) => d.outcome === 'catch').length).toBeGreaterThan(0);
      expect(dives.filter((d) => d.outcome === 'beaten').length).toBeGreaterThan(0);
      // Every committed dive the engine traced is in the track.
      const traced = traces.filter((t) => t.kind === 'dive' || t.kind === 'keeper_guess')
        .map((t) => [Math.round(t.tSec * 10), t.playerId].join());
      const keyed = dives.map((d) => [d.tick, d.by].join());
      for (const t of traced) expect(keyed).toContain(t);

      const keeperTouches = ofKind('kick').filter((k) => k.kick === 'parry' || k.kick === 'deflection');
      dives.forEach((d, i) => {
        // A dive lasts until the same keeper's next dive.
        const next = dives.slice(i + 1).find((x) => x.by === d.by);
        const end = next ? next.tick : Infinity;
        const touchedIn = (k: Rec<'kick'>): boolean => k.by === d.by && k.tick >= d.tick && (k.tick < end || k.tick === d.tick);
        if (d.outcome === 'save') expect(keeperTouches.some(touchedIn), `save at ${d.tick}`).toBe(true);
        if (d.outcome === 'catch') {
          let held = false;
          for (let t = d.tick; t <= Math.min(end, owners.length - 1) && !held; t++) held = owners[t] === d.by;
          expect(held, `catch at ${d.tick}`).toBe(true);
        }
        if (d.outcome === 'beaten') {
          const parried = keeperTouches.some((k) => k.by === d.by && k.tick >= d.tick && k.tick < end);
          expect(parried, `beaten at ${d.tick}`).toBe(false);
        }
      });

      // Every save event: the keeper's latest dive by then was a save or a catch.
      for (const e of eventsOf('save')) {
        const t = tickOf(e.tSec);
        const last = dives.filter((d) => d.by === e.playerId && d.tick <= t).at(-1);
        expect(last, `save event at ${t}`).toBeDefined();
        expect(['save', 'catch']).toContain(last!.outcome);
      }
      // Every goal: the beaten keeper's dive in the moments before was beaten,
      // unless he got a hand to it (a parry into his own net).
      for (const g of ofKind('goal')) {
        const keeperSide = g.side === 'home' ? away : home;
        const ids = new Set([...keeperSide.players, ...(keeperSide.bench ?? [])].map((p) => p.id));
        const last = dives.filter((d) => d.by !== null && ids.has(d.by) && d.tick <= g.tick && g.tick - d.tick < 30).at(-1);
        if (last && last.outcome !== 'beaten') {
          expect(last.outcome).toBe('save');
        }
      }
    });
  });

  describe('the action track in the v3 file', () => {
    /** Round spots to the stored centimetre for comparison. */
    const toCm = (t: ActionTrack): ReplayAction[] =>
      t.actions.map((a) => {
        const r = (v: number): number => Math.round(v * 100) / 100;
        if (a.kind === 'dive') return { ...a, x: r(a.x), y: r(a.y), z: r(a.z) };
        if (a.kind === 'restart' || a.kind === 'offside') return { ...a, x: r(a.x), y: r(a.y) };
        return a;
      });

    it('decodes to the recorded track, one object shared by every frame', () => {
      const at = snaps[0]!.actionTrack!;
      expect(at).toBeDefined();
      expect(snaps.every((s) => s.actionTrack === at)).toBe(true);
      expect(at.roster).toEqual(file.roster);
      const want = toActionTrack(actions, unionRoster(track.frames, actions), track.dtSec);
      expect(want.roster).toEqual(file.roster);
      expect(at.actions.length).toBe(actions.length);
      expect(toCm(at)).toEqual(toCm(want));
      expect(at.dtSec).toBe(0.1);
      // Indices are real roster members (no unknown players in a full match).
      for (const a of at.actions) {
        const ps = a.kind === 'tackle' ? [a.by, a.from] : a.kind === 'foul' ? [a.by, a.on] : a.kind === 'sub' ? [a.on, a.off] : [a.by];
        for (const p of ps) expect(p >= 0 && p < at.roster!.length).toBe(true);
      }
    });

    it('an old v3 file without actions still decodes, with no action track', async () => {
      const bare = encodeReplayV3('m2', withoutActions(track));
      expect('actions' in bare).toBe(false);
      const s = await readBack(await gzipJson(bare), 'm2');
      expect(s.length).toBe(snaps.length);
      expect(s[0]!.ballTrack).toBeDefined();
      expect(s[0]!.actionTrack).toBeUndefined();
    });

    it('a malformed action field is dropped without losing the replay', async () => {
      const bad = { ...file, actions: { ...file.actions!, kick: { t: [1], p: [9999], k: ['pass'], d: [''] } } };
      const s = await readBack(await gzipJson(bad), 'm3');
      expect(s.length).toBe(snaps.length);
      expect(s[0]!.actionTrack).toBeUndefined();
      const unknownWord = { ...file, actions: { ...file.actions!, foul: { t: [1], p: [0], q: [1], c: ['green'] } } };
      const s2 = await readBack(await gzipJson(unknownWord), 'm4');
      expect(s2[0]!.actionTrack).toBeUndefined();
    });

    it('adds well under 30 KB gzipped to the file', async () => {
      const bare = await gzipJson(encodeReplayV3('m1', withoutActions(track)));
      expect(gz.length - bare.length).toBeLessThan(30 * 1024);
      expect(gz.length).toBeLessThan(0.6 * 1024 * 1024);
    });

    it('the local demo path carries the same action track', () => {
      const demo = assembleMatch(home, away, seed);
      const at = demo.frames[0]!.actionTrack!;
      expect(at).toBeDefined();
      expect(demo.frames.every((f) => f.actionTrack === at)).toBe(true);
      expect(toCm(at)).toEqual(toCm(snaps[0]!.actionTrack!));
    }, 180_000);
  });
});
