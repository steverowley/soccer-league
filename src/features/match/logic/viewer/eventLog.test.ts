// ── features/match/logic/viewer/eventLog.test.ts ─────────────────────────────
// The event strip's rows (docs/match-viewer.md section 7): which actions get
// a row, in which order, with which players, and the replay clock; on
// synthetic tracks for each rule and on a real-squad match decoded from its
// replay file exactly as the viewer gets it.

import { beforeAll, describe, expect, it } from 'vitest';
import type { ActionTrack, ReplayAction } from '../replay/actions';
import { createReplayRecorder } from '../replay/recorder';
import { decodeReplayV3, encodeReplayV3, type ReplayFileV3 } from '../replay/replayV3';
import { trackToSnapshots } from '../replay/snapshots';
import { simulateSpatialMatch, type SpatialTeamInput } from '../spatial/simulateSpatialMatch';
import { toSpatialTeamInput } from '../spatial/spatialEventAdapter';
import type { PositionSnapshot } from '../../api/matchPositions';
import squads from '../../../../../scripts/fixtures/bench-teams.json';
import {
  EVENT_LABEL,
  EVENT_STRIP_ROWS,
  buildEventLog,
  eventRowText,
  eventRowsAt,
  replayClock,
  type EventLogLookup,
  type EventRow,
} from './eventLog';
import { actionTrackOf, makeTrackLookup, rosterFromFrames } from './trackLookup';

const DT = 0.1;
const tick = (sec: number): number => Math.round(sec / DT);
function track(...actions: ReplayAction[]): ActionTrack {
  return { dtSec: DT, actions: [...actions].sort((a, b) => a.tick - b.tick) };
}
const sideOf: EventLogLookup['sideOf'] = (p) => (p < 11 ? 'home' : 'away');
const kinds = (rows: readonly EventRow[]) => rows.map((r) => r.kind);
const name = (p: number): string => `${p + 1} P${p}`;

describe('buildEventLog: which actions get a row', () => {
  it('no track, no rows (an old replay keeps only the On the ball line)', () => {
    expect(buildEventLog(null)).toEqual([]);
    expect(buildEventLog({ dtSec: DT, actions: [] })).toEqual([]);
  });

  it('passes, dribbles, clearances and a keeper release are not logged', () => {
    const log = buildEventLog(
      track(
        { kind: 'kick', tick: tick(1), by: 3, kick: 'pass' },
        { kind: 'kick', tick: tick(2), by: 4, kick: 'dribble' },
        { kind: 'kick', tick: tick(3), by: 15, kick: 'clear' },
        { kind: 'restart', tick: tick(4), restart: 'keeper', by: 0, x: 5, y: 34, readyTick: tick(6) },
      ),
    );
    expect(log).toEqual([]);
  });

  it('a goal names the scorer; an own goal says so', () => {
    const log = buildEventLog(
      track({ kind: 'goal', tick: tick(100), by: 9, side: 'home' }, { kind: 'goal', tick: tick(200), by: 4, side: 'away' }),
      { sideOf },
    );
    expect(kinds(log)).toEqual(['goal', 'ownGoal']);
    expect(EVENT_LABEL.ownGoal).toBe('OWN GOAL');
    expect(eventRowText(log[0]!, name)).toBe('10 P9');
  });

  it('a tackle: the winner wins it from the loser', () => {
    const [row] = buildEventLog(track({ kind: 'tackle', tick: tick(30), by: 16, from: 9 }));
    expect(row).toMatchObject({ kind: 'tackle', who: 16, other: 9, sec: 30 });
    expect(eventRowText(row!, name)).toBe('17 P16 wins it from 10 P9');
  });

  it('a foul: the offender on the victim, then the card at the same clock, card on top', () => {
    const log = buildEventLog(track({ kind: 'foul', tick: tick(60), by: 3, on: 10, card: 'yellow' }));
    expect(kinds(log)).toEqual(['foul', 'yellow']);
    expect(log[0]!.sec).toBe(log[1]!.sec);
    expect(eventRowText(log[0]!, name)).toBe('4 P3 on 11 P10');
    expect(eventRowText(log[1]!, name)).toBe('4 P3');
    expect(kinds(eventRowsAt(log, 60))).toEqual(['yellow', 'foul']);
    expect(kinds(buildEventLog(track({ kind: 'foul', tick: tick(60), by: 3, on: 10, card: 'red' })))).toEqual(['foul', 'red']);
    expect(kinds(buildEventLog(track({ kind: 'foul', tick: tick(60), by: 3, on: 10, card: 'none' })))).toEqual(['foul']);
  });

  it('a save of a shot: SAVE, PARRY or CATCH with the keeper and the shooter', () => {
    const shot: ReplayAction = { kind: 'kick', tick: tick(68), by: 9, kick: 'shot' };
    const dive = (outcome: 'save' | 'catch' | 'beaten'): ReplayAction => ({ kind: 'dive', tick: tick(70), by: 12, x: 104, y: 33, z: 1, outcome });
    const caught = buildEventLog(track(shot, dive('catch')));
    expect(caught).toEqual([expect.objectContaining({ kind: 'catch', who: 12, other: 9, sec: 70 })]);
    expect(eventRowText(caught[0]!, name)).toBe('13 P12 from 10 P9');
    expect(kinds(buildEventLog(track(shot, dive('save'), { kind: 'kick', tick: tick(70.3), by: 12, kick: 'parry' })))).toEqual(['parry']);
    expect(kinds(buildEventLog(track(shot, dive('save'), { kind: 'kick', tick: tick(70.3), by: 12, kick: 'deflection' })))).toEqual(['save']);
    expect(buildEventLog(track(shot, dive('beaten')))).toEqual([]);
  });

  it('a claimed cross is not a save; a save the ball then goes in from leaves only the goal', () => {
    const cross: ReplayAction = { kind: 'kick', tick: tick(68), by: 9, kick: 'cross' };
    expect(buildEventLog(track(cross, { kind: 'dive', tick: tick(70), by: 12, x: 104, y: 33, z: 1, outcome: 'catch' }))).toEqual([]);
    const log = buildEventLog(
      track(
        { kind: 'kick', tick: tick(68), by: 9, kick: 'shot' },
        { kind: 'dive', tick: tick(70), by: 12, x: 104, y: 33, z: 1, outcome: 'save' },
        { kind: 'goal', tick: tick(71), by: 9, side: 'home' },
      ),
      { sideOf },
    );
    expect(kinds(log)).toEqual(['goal']);
  });

  it('woodwork names the shooter, at the moment the ball met the frame', () => {
    const t = track({ kind: 'woodwork', tick: tick(80), by: 9 });
    expect(buildEventLog(t)).toEqual([expect.objectContaining({ kind: 'woodwork', who: 9, sec: 80 })]);
    expect(buildEventLog(t, { frameHitBefore: (sec) => ({ sec: sec - 2.5 }) })[0]!.sec).toBeCloseTo(77.5);
  });

  it('a shot out for a goal kick is WIDE, before the GOAL KICK row', () => {
    const log = buildEventLog(
      track(
        { kind: 'kick', tick: tick(50), by: 9, kick: 'shot' },
        { kind: 'dive', tick: tick(50.5), by: 12, x: 104, y: 33, z: 1, outcome: 'beaten' },
        { kind: 'restart', tick: tick(52), restart: 'goalkick', by: 12, x: 99.5, y: 34, readyTick: tick(70) },
      ),
    );
    expect(kinds(log)).toEqual(['wide', 'goalkick']);
    expect(log[0]).toMatchObject({ who: 9, sec: 52 });
    expect(kinds(eventRowsAt(log, 60))).toEqual(['goalkick', 'wide']);
  });

  it('a shot played on (or out for a corner) is not WIDE', () => {
    const played = track({ kind: 'kick', tick: tick(50), by: 9, kick: 'shot' }, { kind: 'interception', tick: tick(51), by: 14 });
    expect(kinds(buildEventLog(played))).toEqual(['interception']);
    const corner = track(
      { kind: 'kick', tick: tick(50), by: 9, kick: 'shot' },
      { kind: 'restart', tick: tick(52), restart: 'corner', by: 7, x: 105, y: 0, readyTick: tick(70) },
    );
    expect(kinds(buildEventLog(corner))).toEqual(['corner']);
  });

  it('offside then its free kick; restarts name the taker; a substitution names both and the club', () => {
    const log = buildEventLog(
      track(
        { kind: 'offside', tick: tick(90), by: 10, x: 80, y: 22 },
        { kind: 'restart', tick: tick(90), restart: 'freekick', by: 13, x: 80, y: 22, readyTick: tick(100) },
        { kind: 'restart', tick: tick(120), restart: 'throw', by: 2, x: 40, y: 68, readyTick: tick(125) },
        { kind: 'restart', tick: tick(140), restart: 'corner', by: 7, x: 105, y: 0, readyTick: tick(160) },
        { kind: 'restart', tick: tick(180), restart: 'penalty', by: 9, x: 94, y: 34, readyTick: tick(200) },
        { kind: 'sub', tick: tick(3300), on: 23, off: 4 },
      ),
    );
    expect(kinds(log)).toEqual(['offside', 'freekick', 'throw', 'corner', 'penalty', 'sub']);
    expect(log.map((r) => EVENT_LABEL[r.kind])).toEqual(['OFFSIDE', 'FREE KICK', 'THROW-IN', 'CORNER', 'PENALTY', 'SUBSTITUTION']);
    expect(eventRowText(log[5]!, name, () => 'Mars Athletic')).toBe('24 P23 on, 5 P4 off, Mars Athletic');
    expect(eventRowText(log[5]!, name)).toBe('24 P23 on, 5 P4 off');
  });

  it('a kick-off is logged when it is taken, so the GOAL row stays on top through the pause', () => {
    const log = buildEventLog(
      track(
        { kind: 'goal', tick: tick(500), by: 9, side: 'home' },
        { kind: 'restart', tick: tick(500), restart: 'kickoff', by: 20, x: 52.5, y: 34, readyTick: tick(560) },
        { kind: 'kick', tick: tick(561), by: 20, kick: 'kickoff' },
      ),
      { sideOf },
    );
    expect(kinds(eventRowsAt(log, 559))).toEqual(['goal']);
    expect(kinds(eventRowsAt(log, 562))).toEqual(['kickoff', 'goal']);
    expect(log[1]!.sec).toBeCloseTo(561);
  });
});

describe('eventRowsAt', () => {
  const log = buildEventLog(
    track(
      { kind: 'tackle', tick: tick(10), by: 1, from: 12 },
      { kind: 'interception', tick: tick(20), by: 13 },
      { kind: 'foul', tick: tick(30), by: 2, on: 14, card: 'none' },
      { kind: 'offside', tick: tick(40), by: 15, x: 80, y: 20 },
    ),
  );

  it('the newest three, newest first; nothing before the first', () => {
    expect(eventRowsAt(log, 5)).toEqual([]);
    expect(kinds(eventRowsAt(log, 25))).toEqual(['interception', 'tackle']);
    expect(kinds(eventRowsAt(log, 45))).toEqual(['offside', 'foul', 'interception']);
    expect(eventRowsAt(log, 45)).toHaveLength(EVENT_STRIP_ROWS);
    expect(kinds(eventRowsAt(log, 30))).toEqual(['foul', 'interception', 'tackle']); // at the exact second
  });

  it('keys are stable, so a row keeps its identity as it moves down', () => {
    expect(eventRowsAt(log, 45)[1]!.key).toBe(eventRowsAt(log, 35)[0]!.key);
  });
});

describe('replayClock', () => {
  it('minute\'second" with the minute counted from 1, like the replay frames', () => {
    expect(replayClock(0)).toBe(`1'00"`);
    expect(replayClock(1294.7)).toBe(`22'34"`);
    expect(replayClock(59.99)).toBe(`1'59"`);
    expect(replayClock(60)).toBe(`2'00"`);
    expect(replayClock(5399)).toBe(`90'59"`);
    expect(replayClock(-3)).toBe(`1'00"`);
  });
});

// ── A real match, decoded from its replay file ───────────────────────────────

const uuidFor = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function squad(i: number): SpatialTeamInput {
  const t = (squads as Array<{ id: string; f: string; s: string; gm: unknown; ps: unknown[][] }>)[i]!;
  const players = (t.ps as unknown[][]).map((p, j) => ({
    id: uuidFor(i * 100 + j), name: String(p[0]), position: String(p[1]), starter: Boolean(p[2]), team_id: t.id,
    attacking: Number(p[3]), defending: Number(p[4]), mental: Number(p[5]), athletic: Number(p[6]), technical: Number(p[7]),
  }));
  return toSpatialTeamInput({ managers: [{ preferred_formation: t.f, style: t.s, game_model: t.gm }], players });
}

describe('a real-squad match decoded from its replay file (the one with an own goal)', () => {
  let frames: PositionSnapshot[] = [];
  let actions: readonly ReplayAction[] = [];
  let roster: readonly string[] = [];
  let log: EventRow[] = [];
  let homeIds = new Set<string>();

  beforeAll(() => {
    const home = squad(5);
    const away = squad(1);
    homeIds = new Set(home.players.map((p) => p.id));
    const rec = createReplayRecorder();
    const r = simulateSpatialMatch(home, away, { seed: 1019, onTick: rec.onTick, observer: rec.observer });
    const file = JSON.parse(JSON.stringify(encodeReplayV3('m1', rec.track(r.events)))) as ReplayFileV3;
    frames = trackToSnapshots(decodeReplayV3(file)!);
    const t = actionTrackOf(frames)!;
    actions = t.actions;
    roster = t.roster && t.roster.length > 0 ? t.roster : rosterFromFrames(frames);
    const lookup = makeTrackLookup(frames, roster, (id) => (homeIds.has(id) ? 'home' : 'away'));
    log = buildEventLog(t, lookup);
  }, 180_000);

  it('one row per goal (the own goal says so), per foul and per card; no passes', () => {
    const count = (k: ReplayAction['kind']) => actions.filter((a) => a.kind === k).length;
    expect(log.filter((r) => r.kind === 'goal' || r.kind === 'ownGoal')).toHaveLength(count('goal'));
    expect(log.some((r) => r.kind === 'ownGoal')).toBe(true);
    expect(log.filter((r) => r.kind === 'foul')).toHaveLength(count('foul'));
    expect(log.filter((r) => r.kind === 'yellow' || r.kind === 'red')).toHaveLength(
      actions.filter((a) => a.kind === 'foul' && a.card !== 'none').length,
    );
    expect(log.filter((r) => r.kind === 'tackle')).toHaveLength(count('tackle'));
    expect(log.filter((r) => r.kind === 'sub')).toHaveLength(count('sub'));
    // Far fewer rows than actions: the strip is for notable moments.
    expect(log.length).toBeLessThan(actions.length / 4);
  });

  it('rows are in time order, keys unique, every player a real roster index', () => {
    for (let i = 1; i < log.length; i++) expect(log[i]!.sec).toBeGreaterThanOrEqual(log[i - 1]!.sec);
    expect(new Set(log.map((r) => r.key)).size).toBe(log.length);
    for (const r of log) {
      expect(roster[r.who], `${r.kind} who`).toBeDefined();
      if (r.other != null) expect(roster[r.other], `${r.kind} other`).toBeDefined();
    }
  });

  it('at each goal the GOAL row is on top, and stays there until the kick-off is taken', () => {
    for (const g of log.filter((r) => r.kind === 'goal' || r.kind === 'ownGoal')) {
      expect(eventRowsAt(log, g.sec)[0]!.key).toBe(g.key);
      expect(eventRowsAt(log, g.sec + 20)[0]!.key).toBe(g.key);
    }
  });

  it('the clock agrees with the replay frames\' own minute and second', () => {
    for (const f of frames.filter((_, i) => i % 997 === 0)) {
      expect(replayClock(f.tSec!)).toBe(`${f.minute}'${String(f.second).padStart(2, '0')}"`);
    }
  });
});
