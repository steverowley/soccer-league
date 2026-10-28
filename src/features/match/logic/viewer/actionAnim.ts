// ── features/match/logic/viewer/actionAnim.ts ───────────────────────────────
// Event animations in SCREEN time (docs/match-viewer.md section 5B): given the
// replay's action track, the game second being drawn and how fast the match
// is playing, which poses and pitch overlays are showing right now.
//
// WHY SCREEN TIME
//   A match is revealed at 4.5x (20 minutes for 90).  A kick timed in match
//   seconds would last two frames.  So every action STARTS at its exact game
//   moment but PLAYS for a fixed real-time length (ANIM_MS), whatever the
//   match speed: a kick is about a third of a second on screen at 4.5x, at 1x
//   and inside a 0.5x slow-motion replay alike.  A kick also winds up a
//   moment BEFORE contact (PRE_MS), so the leg swings through as the ball
//   leaves rather than after it has gone.
//
// WHAT IT RETURNS
//   - poses:    per-player body overrides (kick, slide, fall, dive, catch...),
//               keyed by ROSTER INDEX like the action track; actionBody()
//               turns one into the numbers the sprite code draws with.
//   - overlays: marks drawn on the pitch (restart spot, dust, whistle, card,
//               net ripple, woodwork flash, through-ball target, offside
//               flag, substitution arrows).  Marks tied to a player name him;
//               marks tied to a place carry metres.
//   - label:    the one pitch label showing (GOAL, OFFSIDE, CORNER...).
//   - trail:    how the ball's trail is styled (by the kind of the last kick).
//   - ballHeld: a player holding the ball up (throw-in, keeper's catch).
//   - sub:      the substitution being announced under the pitch.
//
// REDUCED MOTION
//   No body poses, dust, net ripple, woodwork flash or styled trail; the
//   labels, cards, spot markers, whistle mark, target mark, offside flag and
//   substitution arrows still show (they are information, not motion).
//
// PURE: no React, no canvas.  Anything that needs the replay itself (where
// the ball was at a moment, where a through ball was met, which side a
// player is on) comes through the optional AnimLookup the caller provides.

import { actionsBetween, firstActionAtOrAfter, type ActionTrack, type ReplayAction } from '../replay/actions';
import { PITCH_LENGTH, type KickKind, type RestartKind, type TeamSide } from '../spatial/types';

// ── Timing (milliseconds of REAL time) ───────────────────────────────────────

/** How long each animation plays on screen, in real milliseconds. */
export const ANIM_MS = {
  kick: 340,
  shot: 460,
  header: 380,
  throw: 420,
  /** The throw-in taker holds the ball over his head this long before the throw. */
  throwHold: 650,
  slide: 560,
  stumble: 520,
  lunge: 420,
  fall: 1300,
  whistle: 1000,
  card: 1800,
  dive: 650,
  catch: 900,
  celebrate: 1900,
  goalLabel: 2400,
  ripple: 1000,
  woodwork: 450,
  offside: 1600,
  sub: 3500,
  /** The styled trail and the through-ball target stay at least this long. */
  trail: 900,
  dust: 450,
  /** A restart's label and spot show at least this long, even for a quick restart. */
  restartMin: 900,
  /** A card is raised this long after the foul (once the victim is falling). */
  cardDelay: 300,
} as const;

/** Wind-up before contact, in real milliseconds (the leg goes back first). */
export const PRE_MS = { kick: 140, slide: 120, lunge: 100 } as const;

/**
 * The longest anything above lasts after its action (bounds the lookback).
 * A literal, not Math.max over ANIM_MS: a call at module level is a side
 * effect to Rollup and could keep this module in the entry chunk.  The test
 * holds it equal to the largest duration.
 */
export const MAX_AFTER_MS = 3500;
/** The longest wind-up (bounds the look-ahead); held equal by the test too. */
export const MAX_PRE_MS = 140;

/**
 * How far back (game seconds) a restart can still be on show: the longest
 * pause in the engine is the kick-off after a goal, 60 game seconds.
 */
export const RESTART_LOOKBACK_SEC = 90;

/** A styled trail outlives its real-time minimum while the ball is still on this flight (game s). */
const TRAIL_FLIGHT_SEC = 2.5;

/** Height (m) at which a held ball is drawn: over the head for a throw, at the chest for a catch. */
export const HELD_OVERHEAD_M = 2.2;
export const HELD_CHEST_M = 1.3;

// ── Types ────────────────────────────────────────────────────────────────────

/** The body animations a player can be in. */
export type PoseKind =
  | 'kick'
  | 'shot'
  | 'header'
  | 'throwHold'
  | 'throw'
  | 'slide'
  | 'stumble'
  | 'lunge'
  | 'fall'
  | 'dive'
  | 'catch'
  | 'parry'
  | 'celebrate';

/** One player's animation this frame. */
export interface ActionPose {
  kind: PoseKind;
  /** Progress through the animation, 0..1 (real time). */
  t: number;
  /** Where contact falls in `t` for a pose with a wind-up (0 when none). */
  contact: number;
  /** Dive only: where the keeper commits to (metres) and the ball's height there. */
  toX?: number;
  toY?: number;
  toZ?: number;
}

/** How the ball's trail is drawn, by the kind of the last kick. */
export type TrailKind = 'pass' | 'through' | 'cross' | 'long' | 'clear' | 'shot';

/** A mark on the pitch. `t` is progress 0..1 through its real-time window. */
export type Overlay =
  | { kind: 'spot'; x: number; y: number; restart: RestartKind }
  | { kind: 'dust'; player: number; t: number }
  | { kind: 'whistle'; player: number; t: number }
  | { kind: 'card'; player: number; card: 'yellow' | 'red'; t: number }
  | { kind: 'ripple'; goalX: number; t: number }
  | { kind: 'woodwork'; x: number; y: number; z: number; t: number }
  | { kind: 'target'; x: number; y: number; t: number }
  | { kind: 'offside'; x: number; y: number; t: number }
  | { kind: 'subArrows'; t: number };

/** Everything showing at one instant. */
export interface ActiveAnimations {
  poses: Map<number, ActionPose>;
  overlays: Overlay[];
  /** The pitch label in the design system's label style, or null. */
  label: string | null;
  trail: TrailKind | null;
  /** A player holding the ball up, and the height to draw it at. */
  ballHeld: { player: number; z: number } | null;
  /** The substitution to name under the pitch (roster indices). */
  sub: { on: number; off: number } | null;
}

/** What the caller knows about the replay, for the marks that need it. */
export interface AnimLookup {
  /** Where the ball was at a game second (null when unknown). */
  ballAt?(sec: number): { x: number; y: number; z: number } | null;
  /** Where the ball kicked at `sec` was next controlled (a through ball's meeting point). */
  receptionAfter?(sec: number): { x: number; y: number; sec: number } | null;
  /** Which side a roster index plays for (null when unknown). */
  sideOf?(player: number): TeamSide | null;
}

/** The instant being drawn. */
export interface AnimQuery {
  /** Game seconds since kickoff of the picture on screen. */
  gameSec: number;
  /** Game seconds that pass per real second right now (4.5 live, 0.5 in a goal replay). */
  rate: number;
  reducedMotion: boolean;
}

// ── Labels ───────────────────────────────────────────────────────────────────

/** The pitch label for each restart ('keeper' is the keeper's own release: no label). */
export const RESTART_LABEL: Readonly<Record<RestartKind, string | null>> = {
  kickoff: 'KICK-OFF',
  throw: 'THROW-IN',
  corner: 'CORNER',
  goalkick: 'GOAL KICK',
  freekick: 'FREE KICK',
  penalty: 'PENALTY',
  keeper: null,
};

/** Label priority: a higher one replaces a lower one showing at the same time. */
const LABEL_RANK = { restart: 1, offside: 2, goal: 3 } as const;

// ── Kick kinds ───────────────────────────────────────────────────────────────

/** The body pose for each kick kind (null: no pose, e.g. a dribble touch). */
const KICK_POSE: Readonly<Record<KickKind, PoseKind | null>> = {
  pass: 'kick',
  through: 'kick',
  cross: 'kick',
  long: 'kick',
  clear: 'kick',
  shot: 'shot',
  throw: 'throw',
  goalkick: 'kick',
  corner: 'kick',
  freekick: 'kick',
  penalty: 'shot',
  kickoff: 'kick',
  dribble: null,
  header: 'header',
  parry: 'parry',
  deflection: null,
  poke: 'kick',
};

/** The trail style for each kick kind (null: the trail is not restyled). */
const KICK_TRAIL: Readonly<Record<KickKind, TrailKind | null>> = {
  pass: 'pass',
  through: 'through',
  cross: 'cross',
  long: 'long',
  clear: 'clear',
  shot: 'shot',
  throw: 'pass',
  goalkick: 'long',
  corner: 'cross',
  freekick: 'long',
  penalty: 'shot',
  kickoff: 'pass',
  dribble: null,
  header: 'pass',
  parry: null,
  deflection: null,
  poke: 'pass',
};

/** Pose priority: a higher one wins over a lower one on the same player; ties go to the later action. */
const POSE_RANK: Readonly<Record<PoseKind, number>> = {
  kick: 1,
  header: 1,
  parry: 1,
  shot: 2,
  throw: 2,
  throwHold: 2,
  lunge: 2,
  slide: 3,
  stumble: 3,
  catch: 4,
  celebrate: 4,
  fall: 5,
  dive: 5,
};

/** Real duration of a kick pose, by kind. */
function kickMs(pose: PoseKind): number {
  if (pose === 'shot') return ANIM_MS.shot;
  if (pose === 'header') return ANIM_MS.header;
  if (pose === 'throw') return ANIM_MS.throw;
  return ANIM_MS.kick;
}

// ── The query ────────────────────────────────────────────────────────────────

/** An empty result (no track, or nothing on). */
export function noAnimations(): ActiveAnimations {
  return { poses: new Map(), overlays: [], label: null, trail: null, ballHeld: null, sub: null };
}

/** The kick that takes a restart: the first kick after it (nobody else plays the ball in a stoppage). */
function restartTakenAt(track: ActionTrack, from: number, tick: number): number | null {
  for (let i = from + 1; i < track.actions.length; i++) {
    const a = track.actions[i]!;
    if (a.kind === 'kick' && a.tick > tick) return a.tick;
    if (a.kind === 'restart') return null;
  }
  return null;
}

/**
 * Everything animating at one instant.
 *
 * @param track   The decoded action track (null: no animations at all).
 * @param q       The game second on screen, the playback rate (game s per
 *                real s) and the reduced-motion preference.
 * @param lookup  Optional replay lookups for the marks that need positions.
 * @returns       Poses by roster index, pitch overlays, the label, the trail
 *                style, a held ball and the substitution being announced.
 */
export function activeAnimations(
  track: ActionTrack | null | undefined,
  q: AnimQuery,
  lookup: AnimLookup = {},
): ActiveAnimations {
  const out = noAnimations();
  if (!track || track.actions.length === 0) return out;
  const rate = q.rate > 0 ? q.rate : 1;
  const motion = !q.reducedMotion;
  const dt = track.dtSec;
  const now = q.gameSec;
  /** Real seconds since a game second (negative before it). */
  const realSince = (sec: number): number => (now - sec) / rate;

  const poseRank = new Map<number, number>();
  const setPose = (player: number, pose: ActionPose): void => {
    if (!motion) return;
    const rank = POSE_RANK[pose.kind];
    if ((poseRank.get(player) ?? -1) > rank) return;
    poseRank.set(player, rank);
    out.poses.set(player, pose);
  };
  let labelRank = 0;
  const setLabel = (text: string | null, rank: number): void => {
    if (text == null || rank < labelRank) return;
    labelRank = rank;
    out.label = text;
  };
  /** Progress through [start, start + ms] in real time, or null when outside it. */
  const within = (startSec: number, ms: number, preMs = 0): number | null => {
    const age = realSince(startSec) * 1000 + preMs;
    const len = ms + preMs;
    if (age < 0 || age >= len) return null;
    return age / len;
  };

  // The window to scan: long enough back for the longest animation (and a
  // restart's whole pause), a little ahead for the wind-ups.
  const back = Math.max((MAX_AFTER_MS / 1000) * rate, RESTART_LOOKBACK_SEC);
  const ahead = (MAX_PRE_MS / 1000) * rate;
  const fromSec = now - back;
  const actions = actionsBetween(track, fromSec, now + ahead);
  const firstIndex = firstActionAtOrAfter(track, Math.ceil(fromSec / dt - 1e-9));

  // The latest restart before now is the one on show (a newer one replaces it).
  let lastRestart: { a: Extract<ReplayAction, { kind: 'restart' }>; index: number } | null = null;
  // The latest trail-carrying kick, and whether play moved on after it.
  let trailKick: { sec: number; kind: TrailKind } | null = null;

  actions.forEach((a, k) => {
    const sec = a.tick * dt;
    const index = firstIndex + k;
    if (sec <= now && a.kind !== 'restart' && trailKick && a.kind !== 'dive') {
      // Any later touch ends the previous kick's flight (its trail style).
      trailKick = null;
    }
    switch (a.kind) {
      case 'kick': {
        const pose = KICK_POSE[a.kick];
        const pre = pose === 'kick' || pose === 'shot' ? PRE_MS.kick : 0;
        if (pose) {
          const t = within(sec, kickMs(pose), pre);
          if (t != null) setPose(a.by, { kind: pose, t, contact: pre / (pre + kickMs(pose)) });
        }
        const trail = KICK_TRAIL[a.kick];
        if (trail && sec <= now) trailKick = { sec, kind: trail };
        if (a.kick === 'through' && sec <= now) {
          const meet = lookup.receptionAfter?.(sec);
          if (meet) {
            const endSec = Math.max(meet.sec, sec + (ANIM_MS.trail / 1000) * rate);
            if (now <= endSec) out.overlays.push({ kind: 'target', x: meet.x, y: meet.y, t: (now - sec) / (endSec - sec) });
          }
        }
        break;
      }
      case 'tackle': {
        const t = within(sec, ANIM_MS.slide, PRE_MS.slide);
        if (t != null) setPose(a.by, { kind: 'slide', t, contact: PRE_MS.slide / (PRE_MS.slide + ANIM_MS.slide) });
        const ts = within(sec, ANIM_MS.stumble);
        if (ts != null) setPose(a.from, { kind: 'stumble', t: ts, contact: 0 });
        const td = within(sec, ANIM_MS.dust);
        if (motion && td != null) out.overlays.push({ kind: 'dust', player: a.by, t: td });
        break;
      }
      case 'interception': {
        const t = within(sec, ANIM_MS.lunge, PRE_MS.lunge);
        if (t != null) setPose(a.by, { kind: 'lunge', t, contact: PRE_MS.lunge / (PRE_MS.lunge + ANIM_MS.lunge) });
        break;
      }
      case 'foul': {
        const tl = within(sec, ANIM_MS.lunge, PRE_MS.lunge);
        if (tl != null) setPose(a.by, { kind: 'lunge', t: tl, contact: PRE_MS.lunge / (PRE_MS.lunge + ANIM_MS.lunge) });
        const tf = within(sec, ANIM_MS.fall);
        if (tf != null) setPose(a.on, { kind: 'fall', t: tf, contact: 0 });
        const tw = within(sec, ANIM_MS.whistle);
        if (tw != null) out.overlays.push({ kind: 'whistle', player: a.on, t: tw });
        if (a.card !== 'none') {
          const tc = within(sec + (ANIM_MS.cardDelay / 1000) * rate, ANIM_MS.card);
          if (tc != null) out.overlays.push({ kind: 'card', player: a.by, card: a.card, t: tc });
        }
        break;
      }
      case 'dive': {
        const t = within(sec, ANIM_MS.dive);
        if (t != null) setPose(a.by, { kind: 'dive', t, contact: 0, toX: a.x, toY: a.y, toZ: a.z });
        if (a.outcome === 'catch') {
          const tc = within(sec + (ANIM_MS.dive / 1000) * rate, ANIM_MS.catch);
          if (tc != null) {
            setPose(a.by, { kind: 'catch', t: tc, contact: 0 });
            if (motion) out.ballHeld = { player: a.by, z: HELD_CHEST_M };
          }
        }
        break;
      }
      case 'restart':
        if (sec <= now) lastRestart = { a, index };
        break;
      case 'goal': {
        const tl = within(sec, ANIM_MS.goalLabel);
        if (tl != null) setLabel('GOAL', LABEL_RANK.goal);
        const side = lookup.sideOf?.(a.by) ?? null;
        const ownGoal = side != null && side !== a.side;
        const tc = within(sec, ANIM_MS.celebrate);
        if (tc != null && !ownGoal) setPose(a.by, { kind: 'celebrate', t: tc, contact: 0 });
        const tr = within(sec, ANIM_MS.ripple);
        if (motion && tr != null) {
          const ball = lookup.ballAt?.(sec);
          if (ball) out.overlays.push({ kind: 'ripple', goalX: ball.x < PITCH_LENGTH / 2 ? 0 : PITCH_LENGTH, t: tr });
        }
        break;
      }
      case 'woodwork': {
        const t = within(sec, ANIM_MS.woodwork);
        if (motion && t != null) {
          const ball = lookup.ballAt?.(sec);
          if (ball) out.overlays.push({ kind: 'woodwork', x: ball.x, y: ball.y, z: ball.z, t });
        }
        break;
      }
      case 'offside': {
        const t = within(sec, ANIM_MS.offside);
        if (t != null) {
          out.overlays.push({ kind: 'offside', x: a.x, y: a.y, t });
          setLabel('OFFSIDE', LABEL_RANK.offside);
        }
        break;
      }
      case 'sub': {
        const t = within(sec, ANIM_MS.sub);
        if (t != null) {
          out.overlays.push({ kind: 'subArrows', t });
          out.sub = { on: a.on, off: a.off };
        }
        break;
      }
    }
  });

  // The restart in progress: its spot, its label, and a throw-in taker
  // lifting the ball over his head as the pause runs out.
  if (lastRestart) {
    const { a, index } = lastRestart as { a: Extract<ReplayAction, { kind: 'restart' }>; index: number };
    const start = a.tick * dt;
    const minEnd = start + (ANIM_MS.restartMin / 1000) * rate;
    let end = Math.max(a.readyTick * dt, minEnd);
    const taken = restartTakenAt(track, index, a.tick);
    if (taken != null) end = Math.min(end, Math.max(taken * dt, minEnd));
    if (now >= start && now < end) {
      out.overlays.push({ kind: 'spot', x: a.x, y: a.y, restart: a.restart });
      setLabel(RESTART_LABEL[a.restart], LABEL_RANK.restart);
      if (a.restart === 'throw') {
        const holdFrom = Math.max(start, end - (ANIM_MS.throwHold / 1000) * rate);
        if (now >= holdFrom) {
          setPose(a.by, { kind: 'throwHold', t: (now - holdFrom) / Math.max(1e-6, end - holdFrom), contact: 0 });
          if (motion) out.ballHeld = { player: a.by, z: HELD_OVERHEAD_M };
        }
      }
    }
  }

  // The trail style: the last kick's kind while its flight lasts.
  const tk = trailKick as { sec: number; kind: TrailKind } | null;
  if (motion && tk) {
    const realAge = realSince(tk.sec) * 1000;
    if (realAge < ANIM_MS.trail || now - tk.sec < TRAIL_FLIGHT_SEC) out.trail = tk.kind;
  }
  return out;
}

// ── Pose -> body ─────────────────────────────────────────────────────────────

/** Arm positions the sprite code knows. */
export type ArmPreset = 'rest' | 'up' | 'out' | 'overhead' | 'forward' | 'back';

/** The numbers the sprite code draws an animated body with. */
export interface ActionBody {
  /** Whole-body rotation about the feet in radians; positive leans the way he faces. */
  tilt: number;
  /** Extra lift of the whole body above the grass, in sprite (`sc`) units. */
  lift: number;
  /** The front leg: -1 drawn back, 0 planted, +1 swung through (can exceed 1 for a shot). */
  kickLeg: number;
  arms: ArmPreset;
  /** Body squash and stretch multipliers. */
  scaleX: number;
  scaleY: number;
}

/** The planted body (no animation). */
export const REST_BODY: ActionBody = { tilt: 0, lift: 0, kickLeg: 0, arms: 'rest', scaleX: 1, scaleY: 1 };

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Smooth 0..1 ease. */
const ease = (v: number): number => {
  const c = clamp01(v);
  return c * c * (3 - 2 * c);
};
/** 0 -> 1 -> 0 over the animation. */
const bell = (t: number): number => Math.sin(Math.PI * clamp01(t));
/** Rise over [0, a], hold, fall over [b, 1]. */
const plateau = (t: number, a: number, b: number): number => (t < a ? ease(t / a) : t > b ? 1 - ease((t - b) / (1 - b)) : 1);

/**
 * The kicking leg through a kick: drawn back until contact, then swung
 * through (further for a shot) and eased home.
 */
export function kickLegAt(t: number, contact: number, strength = 1): number {
  if (contact > 0 && t < contact) return -ease(t / contact);
  const u = contact < 1 ? (t - contact) / (1 - contact) : 1;
  if (u < 0.3) return -1 + (1 + 1.2 * strength) * ease(u / 0.3);
  return 1.2 * strength * (1 - ease((u - 0.3) / 0.7));
}

/**
 * Turn an animation into body numbers.
 *
 * @param p  The pose (kind, progress, contact point, dive target).
 * @returns  Tilt, lift, front-leg swing, arms and squash for the sprite code.
 */
export function actionBody(p: ActionPose): ActionBody {
  const t = clamp01(p.t);
  switch (p.kind) {
    case 'kick':
      return { ...REST_BODY, kickLeg: kickLegAt(t, p.contact), tilt: -0.1 * bell(t), arms: 'rest' };
    case 'shot':
      return { ...REST_BODY, kickLeg: kickLegAt(t, p.contact, 1.35), tilt: -0.22 * bell(t), arms: 'out', scaleX: 1.06 };
    case 'header':
      return { ...REST_BODY, lift: 2.4 * bell(t), tilt: 0.25 * bell(t), arms: 'out' };
    case 'throwHold':
      return { ...REST_BODY, tilt: -0.12, arms: 'overhead' };
    case 'throw':
      return { ...REST_BODY, tilt: -0.15 + 0.4 * ease(t / 0.5) * (1 - ease((t - 0.5) / 0.5)), arms: t < 0.3 ? 'overhead' : 'forward' };
    case 'slide': {
      const k = plateau(t, 0.22, 0.7);
      return { ...REST_BODY, tilt: -1.05 * k, kickLeg: 1.3 * k, arms: 'back', scaleX: 1 + 0.12 * k };
    }
    case 'stumble':
      return { ...REST_BODY, tilt: 0.55 * bell(t), kickLeg: -0.6 * bell(t), arms: 'out' };
    case 'lunge':
      return { ...REST_BODY, tilt: 0.5 * bell(t), kickLeg: 1.2 * bell(t), arms: 'out', scaleX: 1 + 0.08 * bell(t) };
    case 'fall':
      return { ...REST_BODY, tilt: 1.45 * plateau(t, 0.22, 0.82), arms: 'out' };
    case 'dive': {
      const k = plateau(t, 0.28, 0.85);
      const height = Math.min(2.4, Math.max(0, p.toZ ?? 0));
      return { ...REST_BODY, tilt: 1.35 * k, lift: (1 + 2.6 * height) * bell(Math.min(1, t * 1.15)), arms: 'overhead', scaleX: 1 + 0.15 * k };
    }
    case 'catch':
      return { ...REST_BODY, arms: 'up' };
    case 'parry':
      return { ...REST_BODY, tilt: 0.3 * bell(t), arms: 'out' };
    case 'celebrate':
      return { ...REST_BODY, arms: 'up', lift: 2.6 * Math.abs(Math.sin(Math.PI * 3 * t)) * (1 - 0.4 * t) };
  }
}
