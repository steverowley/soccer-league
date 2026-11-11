// ── features/match/logic/viewer/actionAnim.test.ts ──────────────────────────
// The event animations (docs/match-viewer.md sections 5B and 7): every
// action kind produces its pose or hairline mark inside its window and
// nothing after it; the windows are REAL time, so they last the same on
// screen at any match speed; nothing writes words on the pitch (the event
// strip does, eventLog.ts); reduced motion keeps the marks and drops the
// motion.

import { describe, expect, it } from 'vitest';
import type { ActionTrack, ReplayAction } from '../replay/actions';
import {
  ANIM_MS,
  MAX_AFTER_MS,
  MAX_PRE_MS,
  PRE_MS,
  REST_BODY,
  actionBody,
  activeAnimations,
  kickLegAt,
  type AnimLookup,
  type AnimQuery,
} from './actionAnim';

const DT = 0.1;
/** A track from actions given in game seconds (tick = sec / DT). */
function track(...actions: ReplayAction[]): ActionTrack {
  return { dtSec: DT, actions: [...actions].sort((a, b) => a.tick - b.tick) };
}
const tick = (sec: number): number => Math.round(sec / DT);

/** Live at 4.5x (a 20-minute match). */
const LIVE = 4.5;
/** The game second `ms` of real time after `sec` at `rate`. */
const after = (sec: number, ms: number, rate = LIVE): number => sec + (ms / 1000) * rate;
const q = (gameSec: number, rate = LIVE, reducedMotion = false): AnimQuery => ({ gameSec, rate, reducedMotion });

const lookup: AnimLookup = {
  ballAt: () => ({ x: 104, y: 33, z: 1.2 }),
  sideOf: (p) => (p < 11 ? 'home' : 'away'),
};

describe('activeAnimations: windows', () => {
  it('returns nothing without a track (a replay with no action track plays as before)', () => {
    const a = activeAnimations(null, q(100));
    expect(a.poses.size).toBe(0);
    expect(a.overlays).toEqual([]);
  });

  it('the lookback covers the longest animation and the wind-up covers the longest pre-roll', () => {
    expect(MAX_AFTER_MS).toBe(Math.max(...Object.values(ANIM_MS)));
    expect(MAX_PRE_MS).toBe(Math.max(...Object.values(PRE_MS)));
  });

  it('a kick winds up before contact, plays for its real duration, then is gone', () => {
    const t = track({ kind: 'kick', tick: tick(100), by: 3, kick: 'pass' });
    expect(activeAnimations(t, q(after(100, -PRE_MS.kick - 20))).poses.size).toBe(0);
    const windup = activeAnimations(t, q(after(100, -PRE_MS.kick / 2))).poses.get(3);
    expect(windup?.kind).toBe('kick');
    expect(actionBody(windup!).kickLeg).toBeLessThan(0); // leg back before contact
    const through = activeAnimations(t, q(after(100, ANIM_MS.kick * 0.3))).poses.get(3);
    expect(actionBody(through!).kickLeg).toBeGreaterThan(0); // swung through after it
    expect(activeAnimations(t, q(after(100, ANIM_MS.kick + 5))).poses.size).toBe(0);
  });

  it('durations are real time: the same on screen at 4.5x, 9x and in a 0.5x replay', () => {
    const t = track({ kind: 'kick', tick: tick(100), by: 3, kick: 'pass' });
    for (const rate of [0.5, 1, 4.5, 9]) {
      expect(activeAnimations(t, q(after(100, ANIM_MS.kick - 10, rate), rate)).poses.has(3)).toBe(true);
      expect(activeAnimations(t, q(after(100, ANIM_MS.kick + 10, rate), rate)).poses.has(3)).toBe(false);
    }
  });

  it('a shot is a stronger strike than a pass, and neither marks the pitch', () => {
    const shot = track({ kind: 'kick', tick: tick(50), by: 9, kick: 'shot' });
    const pass = track({ kind: 'kick', tick: tick(50), by: 9, kick: 'pass' });
    const at = (tr: ActionTrack) => activeAnimations(tr, q(after(50, 80)));
    expect(at(shot).poses.get(9)?.kind).toBe('shot');
    expect(at(shot).overlays).toEqual([]);
    expect(at(pass).overlays).toEqual([]);
    const peak = (tr: ActionTrack) => Math.max(...[0.3, 0.4, 0.5, 0.6].map((f) => actionBody({ ...at(tr).poses.get(9)!, t: f }).kickLeg));
    expect(peak(shot)).toBeGreaterThan(peak(pass));
  });

  it('a dribble touch does not pose', () => {
    expect(activeAnimations(track({ kind: 'kick', tick: tick(10), by: 1, kick: 'dribble' }), q(10.1)).poses.size).toBe(0);
  });

  it('a set piece delivered as a shot strikes as a shot; a throw stays a throw', () => {
    const fk = { kind: 'kick', tick: tick(10), by: 1, kick: 'freekick', delivery: 'shot' } as unknown as ReplayAction;
    expect(activeAnimations(track(fk), q(after(10, 60))).poses.get(1)?.kind).toBe('shot');
    const thrown = { kind: 'kick', tick: tick(10), by: 1, kick: 'throw', delivery: 'pass' } as unknown as ReplayAction;
    expect(activeAnimations(track(thrown), q(after(10, 60))).poses.get(1)?.kind).toBe('throw');
  });

  it('an unknown player (index -1) animates nobody and breaks nothing', () => {
    const t = track({ kind: 'tackle', tick: tick(30), by: -1, from: 15 }, { kind: 'sub', tick: tick(30), on: -1, off: 4 });
    const a = activeAnimations(t, q(after(30, 150)), lookup);
    expect(a.poses.get(15)?.kind).toBe('stumble');
  });

  it('a tackle: the winner slides inside a hairline ring, the loser stumbles', () => {
    const t = track({ kind: 'tackle', tick: tick(30), by: 4, from: 15 });
    const a = activeAnimations(t, q(after(30, 150)));
    expect(a.poses.get(4)?.kind).toBe('slide');
    expect(a.poses.get(15)?.kind).toBe('stumble');
    expect(a.overlays).toEqual([expect.objectContaining({ kind: 'ring', player: 4 })]);
    expect(activeAnimations(t, q(after(30, ANIM_MS.ring + 10))).overlays).toEqual([]);
    const slide = actionBody({ ...a.poses.get(4)!, t: 0.5 });
    expect(slide.tilt).toBeLessThan(-0.8); // feet first, leaning back
    expect(slide.legs).toBe('slide');
    expect(slide.lying).toBe(true); // down on the grass
    expect(slide.impulse).toBeGreaterThan(1); // the arms fling
    expect(activeAnimations(t, q(after(30, ANIM_MS.slide + 20))).poses.size).toBe(0);
  });

  it('an interception is a lunge', () => {
    const t = track({ kind: 'interception', tick: tick(40), by: 7 });
    expect(activeAnimations(t, q(after(40, 100))).poses.get(7)?.kind).toBe('lunge');
    expect(activeAnimations(t, q(after(40, ANIM_MS.lunge + 10))).poses.has(7)).toBe(false);
  });

  it('a foul: the victim falls and lies inside a ring, and the card glyph goes to the offender', () => {
    const t = track({ kind: 'foul', tick: tick(60), by: 2, on: 18, card: 'yellow' });
    const mid = activeAnimations(t, q(after(60, 600)));
    expect(mid.poses.get(18)?.kind).toBe('fall');
    const down = actionBody(mid.poses.get(18)!);
    expect(down.tilt).toBeLessThan(-1.3); // on his back
    expect(down.lying).toBe(true);
    expect(activeAnimations(t, q(after(60, 300))).overlays).toContainEqual(expect.objectContaining({ kind: 'ring', player: 18 }));
    expect(mid.overlays).toContainEqual(expect.objectContaining({ kind: 'card', player: 2, card: 'yellow' }));
    expect(activeAnimations(t, q(after(60, ANIM_MS.ring + 20))).overlays.some((o) => o.kind === 'ring')).toBe(false);
    const late = activeAnimations(t, q(after(60, ANIM_MS.cardDelay + ANIM_MS.card + 20)));
    expect(late.overlays.some((o) => o.kind === 'card')).toBe(false);
    expect(late.poses.has(18)).toBe(false);
  });

  it('a red card is red, and a foul without a card raises none', () => {
    const red = track({ kind: 'foul', tick: tick(60), by: 2, on: 18, card: 'red' });
    expect(activeAnimations(red, q(after(60, 800))).overlays).toContainEqual(expect.objectContaining({ kind: 'card', card: 'red' }));
    const none = track({ kind: 'foul', tick: tick(60), by: 2, on: 18, card: 'none' });
    expect(activeAnimations(none, q(after(60, 800))).overlays.some((o) => o.kind === 'card')).toBe(false);
  });

  it('a keeper dive stretches toward its target; a catch then holds the ball up', () => {
    const t = track({ kind: 'dive', tick: tick(70), by: 0, x: 1, y: 30, z: 1.5, outcome: 'catch' });
    const dive = activeAnimations(t, q(after(70, 300))).poses.get(0);
    expect(dive).toMatchObject({ kind: 'dive', toX: 1, toY: 30, toZ: 1.5 });
    const body = actionBody(dive!);
    expect(body.tilt).toBeGreaterThan(1.2); // horizontal, toward the ball
    expect(body.arms).toBe('dive'); // stretched out past his head
    expect(body.lift).toBeGreaterThan(0);
    const caught = activeAnimations(t, q(after(70, ANIM_MS.dive + 300)));
    expect(caught.poses.get(0)?.kind).toBe('catch');
    expect(actionBody(caught.poses.get(0)!).arms).toBe('hug'); // the ball at his chest
    expect(caught.ballHeld?.player).toBe(0);
    expect(activeAnimations(t, q(after(70, ANIM_MS.dive + ANIM_MS.catch + 20))).poses.size).toBe(0);
  });

  it('a save of a shot rings the keeper; a dive at a cross does not', () => {
    const saved = track(
      { kind: 'kick', tick: tick(68), by: 9, kick: 'shot' },
      { kind: 'dive', tick: tick(70), by: 0, x: 1, y: 30, z: 1.5, outcome: 'save' },
    );
    expect(activeAnimations(saved, q(after(70, 200))).overlays).toContainEqual(expect.objectContaining({ kind: 'ring', player: 0 }));
    const claimed = track(
      { kind: 'kick', tick: tick(68), by: 9, kick: 'cross' },
      { kind: 'dive', tick: tick(70), by: 0, x: 1, y: 30, z: 1.5, outcome: 'catch' },
    );
    expect(activeAnimations(claimed, q(after(70, 200))).overlays.some((o) => o.kind === 'ring')).toBe(false);
    const beaten = track(
      { kind: 'kick', tick: tick(68), by: 9, kick: 'shot' },
      { kind: 'dive', tick: tick(70), by: 0, x: 1, y: 30, z: 1.5, outcome: 'beaten' },
    );
    expect(activeAnimations(beaten, q(after(70, 200))).overlays.some((o) => o.kind === 'ring')).toBe(false);
  });

  it('a parry is a parry pose', () => {
    const t = track({ kind: 'kick', tick: tick(70), by: 0, kick: 'parry' });
    expect(actionBody(activeAnimations(t, q(after(70, 100))).poses.get(0)!).arms).toBe('up');
  });

  it('restarts: the spot marker for the whole stoppage, gone once taken', () => {
    const kinds: Array<Extract<ReplayAction, { kind: 'restart' }>['restart']> = ['corner', 'freekick', 'throw', 'goalkick', 'penalty', 'kickoff', 'keeper'];
    for (const restart of kinds) {
      const t = track(
        { kind: 'restart', tick: tick(200), restart, by: 6, x: 105, y: 0, readyTick: tick(228) },
        { kind: 'kick', tick: tick(229), by: 6, kick: 'corner' },
      );
      expect(activeAnimations(t, q(215)).overlays, restart).toEqual([{ kind: 'spot', x: 105, y: 0, restart }]);
      expect(activeAnimations(t, q(229.5)).overlays.some((o) => o.kind === 'spot')).toBe(false);
    }
  });

  it('a quick restart still shows its spot for a real-time minimum', () => {
    const t = track({ kind: 'restart', tick: tick(200), restart: 'throw', by: 6, x: 40, y: 68, readyTick: tick(200.5) });
    expect(activeAnimations(t, q(after(200, ANIM_MS.restartMin - 50))).overlays.some((o) => o.kind === 'spot')).toBe(true);
    expect(activeAnimations(t, q(after(200, ANIM_MS.restartMin + 50))).overlays.some((o) => o.kind === 'spot')).toBe(false);
  });

  it('a throw-in: the ball over the head with both arms, then the throw', () => {
    const t = track(
      { kind: 'restart', tick: tick(300), restart: 'throw', by: 8, x: 40, y: 68, readyTick: tick(310) },
      { kind: 'kick', tick: tick(310), by: 8, kick: 'throw' },
    );
    const hold = activeAnimations(t, q(309.8));
    expect(hold.poses.get(8)?.kind).toBe('throwHold');
    expect(actionBody(hold.poses.get(8)!).arms).toBe('overhead');
    expect(hold.ballHeld).toMatchObject({ player: 8 });
    expect(activeAnimations(t, q(305)).poses.has(8)).toBe(false); // walking up first
    const thrown = activeAnimations(t, q(after(310, 250)));
    expect(thrown.poses.get(8)?.kind).toBe('throw');
    expect(actionBody(thrown.poses.get(8)!).arms).toBe('forward');
  });

  it('a goal: the goal frame flares and the scorer celebrates (arms up, feet on the grass)', () => {
    const t = track({ kind: 'goal', tick: tick(500), by: 9, side: 'home' });
    const a = activeAnimations(t, q(after(500, 400)), lookup);
    expect(a.overlays).toEqual([expect.objectContaining({ kind: 'flare', goalX: 105 })]);
    expect(a.poses.get(9)?.kind).toBe('celebrate');
    for (const f of [1 / 6, 0.5, 0.9]) {
      const body = actionBody({ ...a.poses.get(9)!, t: f });
      expect(body.arms).toBe('celebrate'); // the V overhead
      expect(body.lift).toBe(0); // no hop
    }
    expect(activeAnimations(t, q(after(500, ANIM_MS.flare + 20)), lookup).overlays).toEqual([]);
  });

  it('after a goal the camera stays on the scorer and the ball is drawn in the net while he celebrates', () => {
    const t = track({ kind: 'goal', tick: tick(500), by: 9, side: 'home' });
    const a = activeAnimations(t, q(after(500, 400)), lookup);
    expect(a.focus).toBe(9);
    expect(a.ballInNet).not.toBeNull();
    expect(a.ballInNet!.x).toBeGreaterThan(105); // behind the line, in the net
    expect(a.ballInNet!.y).toBeGreaterThanOrEqual(30.34);
    expect(a.ballInNet!.y).toBeLessThanOrEqual(37.66);
    const after1 = activeAnimations(t, q(after(500, ANIM_MS.celebrate + 20)), lookup);
    expect(after1.focus).toBeNull();
    expect(after1.ballInNet).toBeNull();
  });

  it('an own goal is not celebrated by the player who put it in', () => {
    const t = track({ kind: 'goal', tick: tick(500), by: 15, side: 'home' });
    expect(activeAnimations(t, q(after(500, 400)), lookup).poses.has(15)).toBe(false);
  });

  it('woodwork flares the frame of the goal the ball struck', () => {
    const t = track({ kind: 'woodwork', tick: tick(80), by: 9 });
    expect(activeAnimations(t, q(after(80, 100)), lookup).overlays).toEqual([expect.objectContaining({ kind: 'flare', goalX: 105 })]);
    expect(activeAnimations(t, q(after(80, ANIM_MS.flare + 10)), lookup).overlays).toEqual([]);
  });

  it('woodwork flares when the ball met the frame, before the (later) woodwork event', () => {
    const hitLookup: AnimLookup = { ...lookup, frameHitBefore: (sec) => ({ x: 0.2, y: 30.3, z: 1, sec: sec - 2.5 }) };
    const t = track({ kind: 'woodwork', tick: tick(80), by: 9 });
    expect(activeAnimations(t, q(after(77.5, 100)), hitLookup).overlays).toEqual([expect.objectContaining({ kind: 'flare', goalX: 0 })]);
    expect(activeAnimations(t, q(after(77.5, ANIM_MS.flare + 10)), hitLookup).overlays).toEqual([]);
  });

  it('offside, a substitution, an interception and a pass put nothing on the pitch (the strip names them)', () => {
    const t = track(
      { kind: 'offside', tick: tick(90), by: 10, x: 80, y: 22 },
      { kind: 'sub', tick: tick(90), on: 23, off: 4 },
      { kind: 'interception', tick: tick(90), by: 7 },
      { kind: 'kick', tick: tick(90), by: 3, kick: 'through' },
    );
    expect(activeAnimations(t, q(after(90, 300)), lookup).overlays).toEqual([]);
  });
});

describe('activeAnimations: reduced motion', () => {
  it('drops poses and the held ball, keeps the ring, card glyph and frame flare', () => {
    const t = track(
      { kind: 'tackle', tick: tick(10), by: 4, from: 15 },
      { kind: 'foul', tick: tick(10), by: 2, on: 18, card: 'yellow' },
      { kind: 'kick', tick: tick(10), by: 9, kick: 'shot' },
      { kind: 'goal', tick: tick(10.2), by: 9, side: 'home' },
    );
    const a = activeAnimations(t, q(after(10.2, 400), LIVE, true), lookup);
    expect(a.poses.size).toBe(0);
    expect(a.ballHeld).toBeNull();
    const kinds = a.overlays.map((o) => o.kind);
    expect(kinds).toContain('ring');
    expect(kinds).toContain('card');
    expect(kinds).toContain('flare');
  });
});

describe('actionBody', () => {
  it('kickLegAt: back before contact, through after, home at the end', () => {
    expect(kickLegAt(0.15, 0.3)).toBeLessThan(0);
    expect(kickLegAt(0.5, 0.3)).toBeGreaterThan(0.5);
    expect(Math.abs(kickLegAt(1, 0.3))).toBeLessThan(1e-9);
  });

  it('every pose returns finite numbers and the rest body is neutral', () => {
    expect(REST_BODY).toEqual({ tilt: 0, lift: 0, legs: 'gait', kickLeg: 0, arms: 'rest', lying: false, impulse: 0 });
    const kinds = ['kick', 'shot', 'header', 'throwHold', 'throw', 'slide', 'stumble', 'lunge', 'fall', 'dive', 'catch', 'parry', 'celebrate'] as const;
    for (const kind of kinds) {
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const b = actionBody({ kind, t, contact: 0.3, toZ: 1 });
        for (const v of [b.tilt, b.lift, b.kickLeg, b.impulse]) expect(Number.isFinite(v), `${kind} ${t}`).toBe(true);
        expect(b.impulse, `${kind} flings the arms when it begins`).toBeGreaterThan(0);
      }
    }
  });

  it('a lying pose lies only while the body is well over, and every pose ends upright', () => {
    for (const kind of ['slide', 'fall', 'dive'] as const) {
      expect(actionBody({ kind, t: 0.5, contact: 0.18 }).lying, kind).toBe(true);
      const end = actionBody({ kind, t: 1, contact: 0.18 });
      expect(end.lying, kind).toBe(false);
      expect(Math.abs(end.tilt), kind).toBeLessThan(0.05);
    }
  });
});
