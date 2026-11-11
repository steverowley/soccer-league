// ── features/match/ui/viewer/MatchViewer.tsx ────────────────────────────────
// The canvas pixel-art match viewer: tiny "little dudes" playing on a to-scale
// 105×68 m pitch, replaying the spatial engine's `match_positions` frames, with
// an in-game camera toggle (whole-pitch broadcast ⇄ ball-following crop).
//
// RESPONSIBILITIES (everything else is pure logic in logic/viewer + render.ts):
//   • own the <canvas>, the requestAnimationFrame loop, and the camera state;
//   • map real wall-clock time → game-second (season pacing) and sample the
//     interpolated positions for this instant;
//   • derive each dude's gait/facing/phase, depth-sort, and draw;
//   • place the ball (at the carrier's feet, gliding over jumps, with a trail
//     when it travels fast) and say who has it in a caption under the pitch.
//
// CHUNKY-PIXEL RENDERING
//   The backing store is a fixed low resolution, twice the original 320×208
//   art (PIXEL_SCALE in render.ts); CSS stretches it with `image-rendering:
//   pixelated` and the context draws with image smoothing off, so the pixel
//   style stays while the figures are crisper.  The projection is expressed as
//   fractions of the viewport, and every sprite size is in units of the depth
//   scale, which the component multiplies by PIXEL_SCALE.
//
// CAMERAS
//   A phone-sized viewer (under PHONE_VIEWER_MAX_PX wide) opens on the Ball
//   camera, a wider one on the Pitch; once the viewer picks a camera with the
//   buttons, resizing no longer changes it.
//
// KITS
//   Never straight from `teams.color`: resolveKits (logic/viewer/kits.ts)
//   applies the legibility, clash and keeper rules to the two club colours.
//
// REST STATE
//   Before kickoff or for a legacy match with no frames, every dude stands at its
//   formation home position (idle bob); the ball sits on the centre spot.

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import type { Species } from '../../../../data/peoples';
import { canvasColor, color, hairline, space, tone, type } from '../../../../shared/design';
import { Tag } from '../../../../shared/ui';
// useReducedMotion is a shared accessibility hook exposed on the entities
// barrel; the cross-feature import is barrel-only so it satisfies
// no-restricted-imports.
import { useReducedMotion } from '@features/entities';

import type { PositionSnapshot } from '../../api/matchPositions';
import { getFormationSlots, type FormationKey } from '../../logic/pitch';
import { PITCH_LENGTH, PITCH_WIDTH, type TeamSide } from '../../logic/spatial/types';
import {
  actionBody,
  actionTrackOf,
  activeAnimations,
  advanceStride,
  ballAtFeet,
  buildEventLog,
  cameraForWidth,
  clampFollowCenter,
  eventRowsAt,
  followAnchor,
  footfall,
  holdArms,
  kickArms,
  glideBall,
  liveRate,
  makeAppearance,
  makeTrackLookup,
  newArms,
  newDrive,
  noAnimations,
  pickNearestId,
  projectBroadcast,
  projectFollow,
  pushTrail,
  realToGameSeconds,
  replayMinute,
  replayAt,
  resolveKits,
  rosterFromFrames,
  runAmount,
  sampleFrames,
  scheduleReplays,
  separatePositions,
  smoothFollowCenter,
  stepArms,
  stepJolt,
  trailToDraw,
  type ActionBody,
  type Appearance,
  type ArmState,
  type BallGlide,
  type BallPoint,
  type CameraMode,
  type EventRow,
  type HitTarget,
  type PoseKind,
  type Projected,
  type ScreenPoint,
  type TrailPoint,
  type Viewport,
} from '../../logic/viewer';
import { drawBall, drawDude, drawPitch, PIXEL_SCALE, SPRITE_UNITS_PER_M, type DudeRender, type ProjectFn } from './render';
import { EventStrip } from './EventStrip';
import { cardGlyphRect, drawCardGlyph, drawEventRing, drawGoalFlare, drawSpotMarker, type FigureAt } from './renderEvents';
import { ThrottledAnnouncer } from './ThrottledAnnouncer';

// ── Constants ───────────────────────────────────────────────────────────────

/** The original art's canvas size: the aspect ratio and the 1x pixel grid. */
const BASE_VP: Viewport = { width: 320, height: 208 };

/**
 * Fixed canvas backing-store size: the original art at PIXEL_SCALE (640×416).
 * Still small on purpose (chunky pixels, cheap fill rate); the projection in
 * logic/viewer is expressed as fractions of the viewport, so it scales.
 */
const VP: Viewport = { width: BASE_VP.width * PIXEL_SCALE, height: BASE_VP.height * PIXEL_SCALE };

/** Body acceleration (game m/s^2) the arms feel at most, and how much of it (softened: 4.5x play would make it violent). */
const ARM_ACCEL_MAX = 14;
const ARM_ACCEL_GAIN = 0.6;
/** A footfall jolts the arms only when he is running at least this hard (0..1). */
const JOLT_MIN_RUN = 0.25;

/** Velocity (game m/s) above which we flip a dude's facing — avoids jitter at rest. */
const FACE_FLIP_SPEED = 0.4;

/** Click selection radius in backing-store pixels (a click within this of a dude selects it). */
const SELECT_RADIUS = 16 * PIXEL_SCALE;

/**
 * Screen readers hear who has the ball at most this often (ms): the caption
 * changes with every touch, which would be a stream of announcements.
 */
const ANNOUNCE_EVERY_MS = 8000;
/** Goals and red cards from the event strip are announced at most this often (ms). */
const ANNOUNCE_EVENT_EVERY_MS = 1500;

/** A game-clock step larger than this (seconds), or any step back, is a seek: snap, no glide or trail. */
const SEEK_GAME_SEC = 5;

/** A player only holds the ball up (throw-in, catch) when the ball is within this of him (m). */
const HELD_BALL_NEAR_M = 4;

/** How far (m) a diving keeper's figure reaches toward his dive target, at full stretch. */
const DIVE_REACH_M = 1.2;

/**
 * The pitch surface and everything around it: Galactic Abyss, the page
 * background (docs/match-viewer.md section 6), from the canvas palette (a
 * canvas cannot read CSS variables).
 */
const CANVAS_BG = canvasColor.bg;

/** Scale a projected point's depth scale into backing-store sprite units. */
function atScale(p: Projected): Projected {
  return { x: p.x, y: p.y, sc: p.sc * PIXEL_SCALE };
}

// ── Public types ─────────────────────────────────────────────────────────────

/** Minimal player info the viewer needs: a stable id (to match frames + seed the look) and position. */
export interface MatchViewerPlayer {
  id: string;
  /** Two-letter position (GK/DF/MF/FW); only GK is special-cased (the keeper kit). */
  position: string;
  /** Display name for the "on the ball" caption, when known. */
  name?: string;
  /** Shirt number (`players.jersey_number`), when known; else the slot order is used. */
  number?: number | null;
  /**
   * His people, read from his bio (`entities.meta.profile.species`). The
   * figure is drawn from it; absent (an old bio, a synthetic pad) means Terran.
   * Looks only: the engine knows nothing about peoples.
   */
  species?: Species | null;
}

/** Props for <MatchViewer>. */
export interface MatchViewerProps {
  /** Pre-loaded position frames from `getMatchPositions` (empty ⇒ rest state). */
  frames: PositionSnapshot[];
  /** ISO kickoff timestamp — the real-time pacing anchor (null before it loads). */
  scheduledAt: string | null;
  /** Season `match_duration_seconds` — compresses 90 min into this real-time window. */
  durationSeconds: number;
  /** Home / away tactical shape (drives rest-state home positions). */
  homeFormation: FormationKey;
  awayFormation: FormationKey;
  /** Each side's squad: the starting XI in slot order (GK first) followed by any
   *  bench players, so substitutes can be drawn once they come on.  Short squads
   *  pad with synthetic ids. */
  homePlayers: readonly MatchViewerPlayer[];
  awayPlayers: readonly MatchViewerPlayer[];
  /** Club colours (null ⇒ the side's muted fallback); resolveKits turns them into kits. */
  homeColor?: string | null;
  awayColor?: string | null;
  /** Names + scores for the screen-reader label. */
  homeTeamName?: string;
  awayTeamName?: string;
  homeScore?: number;
  awayScore?: number;
  /**
   * Id of the currently-selected player (highlighted on the pitch, others dimmed).
   * Omit to disable selection visuals.
   */
  selectedPlayerId?: string | null;
  /**
   * Called when a player is clicked (id), or when empty pitch is clicked (null).
   * When provided, the canvas becomes clickable.
   */
  onSelectPlayer?: (id: string | null) => void;
}

// ── Dude spec (static per match) ─────────────────────────────────────────────

/** A player's fixed render identity — resolved once from formation + roster. */
interface DudeSpec {
  id: string;
  /** Formation home position in metres (used for the rest state / missing frames). */
  homeX: number;
  homeY: number;
  /** Which side the player is on (picks his kit from resolveKits). */
  team: 'home' | 'away';
  /** Goalkeepers wear their side's keeper kit. */
  gk: boolean;
  /** Display name for the caption, when known. */
  name: string | null;
  /** Squad number printed on the chest: his shirt number, else slot order (1–11, bench 12+). */
  number: number;
  /** His figure: his people (from his bio) and the variation seeded by his id. */
  appearance: Appearance;
  /** Default facing when stationary (home faces +x, away faces −x). */
  faceDefault: number;
  /** True for a substitute: no home slot, rendered ONLY once they're in a frame. */
  bench: boolean;
}

/**
 * Resolve the dude specs for one side: the starting XI (one per formation slot)
 * plus any bench players supplied beyond the slot count.  Each gets a
 * metre-space home position (bench players have none: they sit off the pitch
 * until subbed on), its side, a keeper flag, his shirt number (slot order when
 * the roster has none) and a deterministic appearance keyed by player id.
 * Empty slots in a short XI get synthetic ids so the pitch is always full.
 *
 * WHO KEEPS GOAL: the player whose position is GK, not slot 0.  The match
 * page orders the XI by rating (the engine's order), so slot 0 is often a
 * forward; marking slot 0 dressed a forward as the keeper.  Slot 0 is only
 * the fallback when no starter is listed as a GK (synthetic or short squads).
 */
function buildSide(
  side: 'home' | 'away',
  formation: FormationKey,
  players: readonly MatchViewerPlayer[],
): DudeSpec[] {
  const slots = getFormationSlots(formation, side);
  const faceDefault = side === 'home' ? 1 : -1;
  const starterHasGk = players.slice(0, slots.length).some((p) => p.position === 'GK');
  // Starters: one dude per formation slot, keyed by the XI ids in slot order.
  const starters: DudeSpec[] = slots.map((slot, i) => {
    const p = players[i];
    const id = p?.id ?? `${side}-${i}`;
    return {
      id,
      homeX: slot.x * PITCH_LENGTH,
      homeY: slot.y * PITCH_WIDTH,
      team: side,
      gk: starterHasGk ? p?.position === 'GK' : i === 0,
      name: p?.name ?? null,
      number: p?.number ?? i + 1,
      appearance: makeAppearance(id, p?.species ?? null),
      faceDefault,
      bench: false,
    };
  });
  // Bench: players supplied beyond the slot count.  They have no home slot and
  // render only once a substitution puts their id into the frames (the render
  // loop's frame-presence check), so their home position is a never-used filler.
  const bench: DudeSpec[] = players.slice(slots.length).map((p, i) => ({
    id: p.id,
    homeX: PITCH_LENGTH / 2,
    homeY: PITCH_WIDTH / 2,
    team: side,
    gk: p.position === 'GK',
    name: p.name ?? null,
    number: p.number ?? slots.length + i + 1,
    appearance: makeAppearance(p.id, p.species ?? null),
    faceDefault,
    bench: true,
  }));
  return [...starters, ...bench];
}

// ── Component ────────────────────────────────────────────────────────────────

/**
 * Canvas match viewer.  Replays the spatial engine's frames as animated pixel-art
 * dudes under a switchable broadcast / follow camera, with a caption under the
 * pitch naming the player on the ball.  Renders a static formation rest state
 * when there are no frames yet.
 */
export function MatchViewer({
  frames,
  scheduledAt,
  durationSeconds,
  homeFormation,
  awayFormation,
  homePlayers,
  awayPlayers,
  homeColor,
  awayColor,
  homeTeamName,
  awayTeamName,
  homeScore,
  awayScore,
  selectedPlayerId,
  onSelectPlayer,
}: MatchViewerProps) {
  const reducedMotion = useReducedMotion();
  // First guess from the window (no flash on a phone); the ResizeObserver
  // below corrects it from the viewer's real width until the viewer chooses.
  const [cameraMode, setCameraMode] = useState<CameraMode>(() =>
    typeof window === 'undefined' ? 'broadcast' : cameraForWidth(window.innerWidth),
  );
  /** True once the viewer pressed a camera button: resizing no longer switches. */
  const cameraChosenRef = useRef(false);

  const boxRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  /** Per-dude animation phase, persisted across frames. */
  const phaseRef = useRef<Map<string, number>>(new Map());
  /** Per-dude spring arms (logic/viewer/arms.ts), persisted across frames. */
  const armsRef = useRef<Map<string, ArmState>>(new Map());
  /**
   * Per-dude motion memory: last frame's velocity and game second (his
   * acceleration drives the arms) and the pose he was in (a new pose flings them).
   */
  const motionRef = useRef<Map<string, { vx: number; sec: number; kind: PoseKind | null; t: number }>>(new Map());
  /** The viewer's real-time clock in seconds (blinks, breathing); frozen under reduced motion. */
  const clockRef = useRef(0);
  /** One scratch drive for every player's arms (mutated, never reallocated). */
  const driveRef = useRef(newDrive());
  /** Per-dude facing, persisted so a momentarily-stationary dude keeps its last facing. */
  const faceRef = useRef<Map<string, number>>(new Map());
  /** Smoothed follow-camera centre (null ⇒ snap to the ball on the next frame). */
  const followCenterRef = useRef<ScreenPoint | null>(null);
  /** Offscreen-baked broadcast pitch (static layer drawn once, blitted each frame). */
  const bakedPitchRef = useRef<HTMLCanvasElement | null>(null);
  /** Latest selected id, read inside the loop without re-creating it on selection change. */
  const selectedIdRef = useRef<string | null>(selectedPlayerId ?? null);
  useEffect(() => {
    selectedIdRef.current = selectedPlayerId ?? null;
  }, [selectedPlayerId]);
  /** Per-frame screen anchors for click hit-testing (rebuilt every frame). */
  const hitTargetsRef = useRef<HitTarget[]>([]);
  /** Where the ball was drawn last frame, the glide in progress, and its recent path. */
  const ballShownRef = useRef<BallPoint | null>(null);
  const ballGlideRef = useRef<BallGlide | null>(null);
  const trailRef = useRef<TrailPoint[]>([]);
  /** Game second of the last frame (detects seeks and restarts). */
  const lastGameSecRef = useRef<number | null>(null);

  /**
   * Who has the ball, for the caption: a player id, 'loose' while nobody
   * does, or null before there is any match data.  Set from the render loop
   * only when it changes.
   */
  const [carrierKey, setCarrierKey] = useState<string | null>(null);
  const carrierKeyRef = useRef<string | null>(null);
  /**
   * The event strip's rows (newest first), following LIVE match time: a
   * slow-motion replay does not re-log the moments it shows.  Set from the
   * render loop only when the rows change.
   */
  const [stripRows, setStripRows] = useState<readonly EventRow[]>([]);
  const stripKeyRef = useRef('');
  /** Goal and red-card rows already seen (announced once each; those on screen at load are not). */
  const seenRowsRef = useRef<Set<string> | null>(null);
  /** The latest goal or red card to announce to screen readers. */
  const [eventAnnouncement, setEventAnnouncement] = useState<{ row: EventRow } | null>(null);
  /** True while a slow-motion replay is on screen (a cut snaps the camera; the Replay tag shows). */
  const inReplayRef = useRef(false);
  const [inReplayShown, setInReplayShown] = useState(false);
  /** True while a scored ball is drawn in the net (its start and end are cuts). */
  const ballInNetRef = useRef(false);

  // Kickoff anchor in epoch ms — parsed once so a same-string re-render is stable.
  const anchorMs = useMemo<number | null>(() => {
    if (!scheduledAt) return null;
    const t = new Date(scheduledAt).getTime();
    return Number.isNaN(t) ? null : t;
  }, [scheduledAt]);

  // Both sides' kits under the legibility, clash and keeper rules.
  const kits = useMemo(() => resolveKits(homeColor, awayColor), [homeColor, awayColor]);

  // Resolve the 22 dude specs once per match shape.
  const dudeSpecs = useMemo<DudeSpec[]>(
    () => [
      ...buildSide('home', homeFormation, homePlayers),
      ...buildSide('away', awayFormation, awayPlayers),
    ],
    [homeFormation, awayFormation, homePlayers, awayPlayers],
  );

  // The event layer (docs/match-viewer.md section 5): the replay's action
  // track, its roster (actions name players by roster index), the lookups
  // the animations ask, and the slow-motion replays.  A replay without a
  // track (v2, older v3) gets none of it and plays exactly as before.
  const events = useMemo(() => {
    const track = actionTrackOf(frames);
    if (!track) return null;
    // The recorder ships the union roster on the track; a track without
    // one names the frames' roster, rebuilt from the frames.
    const shipped = (track as typeof track & { roster?: readonly string[] }).roster;
    const roster = shipped && shipped.length > 0 ? shipped : rosterFromFrames(frames);
    const sideById = new Map<string, TeamSide>(dudeSpecs.map((d) => [d.id, d.team]));
    const lookup = makeTrackLookup(frames, roster, (id) => sideById.get(id) ?? null);
    const indexById = new Map<string, number>(roster.map((id, i) => [id, i]));
    const replays = reducedMotion ? [] : scheduleReplays(track, durationSeconds, lookup);
    // The event strip's rows for the whole match (docs/match-viewer.md section 7).
    const log = buildEventLog(track, lookup);
    return { track, roster, lookup, indexById, replays, log };
  }, [frames, dudeSpecs, durationSeconds, reducedMotion]);

  // Phone-sized viewers open on the Ball camera, wider ones on the Pitch,
  // until the viewer picks one.
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (cameraChosenRef.current) return;
      if (width <= 0) return;
      const mode = cameraForWidth(width);
      if (mode === 'follow') followCenterRef.current = null;
      setCameraMode(mode);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Bake the broadcast pitch once (the static layer never moves under that camera).
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const off = document.createElement('canvas');
    off.width = VP.width;
    off.height = VP.height;
    const offCtx = off.getContext('2d');
    if (!offCtx) return;
    offCtx.imageSmoothingEnabled = false;
    offCtx.fillStyle = CANVAS_BG;
    offCtx.fillRect(0, 0, VP.width, VP.height);
    drawPitch(offCtx, (wx, wy, wz) => atScale(projectBroadcast(wx, wy, wz, VP)));
    bakedPitchRef.current = off;
  }, []);

  // The render loop.  Re-created when any input that changes the drawing does;
  // refs carry per-dude continuity across re-creations.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;

    let last = performance.now();
    let raf = 0;

    const loop = (now: number): void => {
      // Real frame delta, clamped so a tab-wake doesn't produce a giant step.
      let dt = (now - last) / 1000;
      last = now;
      if (dt > 0.05) dt = 0.05;
      const animDt = reducedMotion ? 0 : dt; // freeze decorative motion for reduced-motion users
      clockRef.current += animDt;
      const clock = clockRef.current;
      const drive = driveRef.current;

      // Wall-clock → game-second (same compression the commentary feed uses).
      const elapsedRealSec = anchorMs != null ? (Date.now() - anchorMs) / 1000 : 0;
      const liveSec = realToGameSeconds(elapsedRealSec, durationSeconds);
      // A slow-motion replay (section 5C) draws an earlier moment slower
      // during a stoppage; the live clock carries on underneath it.
      const replay = events ? replayAt(events.replays, liveSec) : null;
      const gameSec = replay ? replay.replaySec : liveSec;
      const animRate = replay ? replay.window.speed : liveRate(durationSeconds);
      const inReplay = replay != null;
      if (inReplay !== inReplayRef.current) {
        inReplayRef.current = inReplay;
        followCenterRef.current = null; // a cut: snap the camera
        setInReplayShown(inReplay);
      }

      // The event strip follows the LIVE clock (a replay does not re-log).
      if (events) {
        const rows = eventRowsAt(events.log, liveSec);
        const rowsKey = rows.map((r) => r.key).join('|');
        if (rowsKey !== stripKeyRef.current) {
          stripKeyRef.current = rowsKey;
          setStripRows(rows);
          // Goals and red cards are announced once each, as they happen;
          // the ones already on the strip when the viewer opens are not.
          const seen = seenRowsRef.current;
          if (!seen) {
            seenRowsRef.current = new Set(rows.map((r) => r.key));
          } else {
            const fresh = rows.find((r) => !seen.has(r.key) && (r.kind === 'goal' || r.kind === 'ownGoal' || r.kind === 'red'));
            for (const r of rows) seen.add(r.key);
            if (fresh) setEventAnnouncement({ row: fresh });
          }
        }
      }
      const sampled = sampleFrames(frames, gameSec);
      const prevGameSec = lastGameSecRef.current;
      const seek = prevGameSec == null || gameSec < prevGameSec || gameSec - prevGameSec > SEEK_GAME_SEC;
      lastGameSecRef.current = gameSec;
      // What is animating now: poses by roster index, marks, the label.
      const anims = events
        ? activeAnimations(events.track, { gameSec, rate: animRate, reducedMotion }, events.lookup)
        : noAnimations();

      // Pass 1 — resolve each dude's true world position + gait/facing/phase.
      // Position lives in a mutable `pos` object so the separation pass can nudge
      // it in place before we project + pose.
      // Once the match is being played, the frame set is the source of truth for
      // who is ON the pitch: a subbed-off (or not-yet-on) player is simply absent
      // and isn't drawn, while a substitute appears the moment their id arrives.
      // Before kickoff (no sampled players) the starters stand at their home
      // slots; bench players never show in that rest state.
      const playing = sampled.players.size > 0;
      const pending = dudeSpecs.flatMap((spec) => {
        const s = sampled.players.get(spec.id);
        if (!s && (playing || spec.bench)) return [];
        const pos = { x: s ? s.x : spec.homeX, y: s ? s.y : spec.homeY };
        const vx = s ? s.vx : 0;
        const vy = s ? s.vy : 0;
        const run = reducedMotion ? 0 : runAmount(Math.hypot(vx, vy));

        // Advance the stride in real time (a random start on first sight so
        // the crowd doesn't march in step).
        const prevPhase = phaseRef.current.get(spec.id) ?? Math.random() * Math.PI * 2;
        const phase = advanceStride(prevPhase, run, animDt);
        phaseRef.current.set(spec.id, phase);

        // Facing follows horizontal velocity; otherwise it holds.
        let face = faceRef.current.get(spec.id) ?? spec.faceDefault;
        if (s && Math.abs(s.vx) > FACE_FLIP_SPEED) face = s.vx > 0 ? 1 : -1;
        faceRef.current.set(spec.id, face);

        // His event animation, if one is playing (roster index from the track).
        const idx = events?.indexById.get(spec.id) ?? -1;
        const act = idx >= 0 ? anims.poses.get(idx) : undefined;
        const body: ActionBody | null = act ? actionBody(act) : null;

        // His floppy arms (docs/match-viewer.md section 6): springs driven by
        // his acceleration, jolted on each footfall, flung when a pose
        // begins, held by the pose while it lasts.  Real time throughout.
        let arms = armsRef.current.get(spec.id);
        if (!arms) {
          arms = newArms(spec.appearance.seed);
          armsRef.current.set(spec.id, arms);
        }
        let motion = motionRef.current.get(spec.id);
        if (!motion) {
          motion = { vx, sec: gameSec, kind: null, t: 0 };
          motionRef.current.set(spec.id, motion);
        }
        const dSec = gameSec - motion.sec;
        const ax = !seek && dSec > 1e-6 ? Math.max(-ARM_ACCEL_MAX, Math.min(ARM_ACCEL_MAX, (vx - motion.vx) / dSec)) * ARM_ACCEL_GAIN : 0;
        if (!reducedMotion) {
          if (act && body && (act.kind !== motion.kind || act.t < motion.t)) kickArms(arms, body.impulse);
          if (run > JOLT_MIN_RUN && footfall(prevPhase, phase)) stepJolt(arms);
          drive.run = run;
          drive.phase = phase;
          drive.ax = ax;
          drive.ay = body?.arms === 'celebrate' ? -30 * Math.cos(clock * 6 + spec.appearance.seed * 9) : 0;
          drive.t = clock;
          holdArms(drive, body?.arms);
          stepArms(arms, animDt, drive);
        }
        motion.vx = vx;
        motion.sec = gameSec;
        motion.kind = act ? act.kind : null;
        motion.t = act ? act.t : 0;
        // A diving keeper reaches toward where he committed to (up to
        // DIVE_REACH_M, out and back over the dive), ahead of his position.
        if (act?.kind === 'dive' && act.toX != null && act.toY != null) {
          const dx = act.toX - pos.x;
          const dy = act.toY - pos.y;
          const d = Math.hypot(dx, dy);
          if (d > 0.01) {
            const k = (Math.min(DIVE_REACH_M, d) * Math.sin(Math.PI * Math.min(1, act.t))) / d;
            pos.x += dx * k;
            pos.y += dy * k;
          }
        }

        return [{ spec, pos, vx, vy, run, phase, face, idx, act, body, arms }];
      });

      // De-overlap (VISUAL ONLY) — spread sprites that the real positions stack on
      // top of each other so the pitch stays legible; the match data is untouched.
      separatePositions(pending.map((p) => p.pos));

      // The ball.  With an owner it sits at his DRAWN feet (after the nudge
      // above), so it never drifts off a dribbler; otherwise it is the sampled
      // point, at the height the replay gives (0 when it has none).  A jump
      // (the owner changed between snapshots) becomes a short glide.
      const sb = sampled.ball;
      const ownerId = sb?.ownerId ?? null;
      const owner = ownerId != null ? pending.find((p) => p.spec.id === ownerId) : undefined;
      // A held ball (a throw-in taker's hands over his head, a keeper's
      // catch) sits on the holder's sprite instead.
      const heldBy = anims.ballHeld ? pending.find((p) => p.idx === anims.ballHeld!.player) : undefined;
      const holder = heldBy && sb && Math.hypot(sb.x - heldBy.pos.x, sb.y - heldBy.pos.y) < HELD_BALL_NEAR_M ? heldBy : undefined;
      const heldLift = holder && anims.ballHeld ? anims.ballHeld.z * SPRITE_UNITS_PER_M : null;
      const target: BallPoint = holder
        ? { x: holder.pos.x, y: holder.pos.y, z: 0 }
        : anims.ballInNet
          ? anims.ballInNet
          : owner
            ? ballAtFeet({ x: owner.pos.x, y: owner.pos.y, vx: owner.vx, vy: owner.vy }, owner.face)
            : { x: sb ? sb.x : PITCH_LENGTH / 2, y: sb ? sb.y : PITCH_WIDTH / 2, z: sb ? Math.max(0, sb.z) : 0 };
      // Putting the ball in the net, or taking it back to the centre spot,
      // is a cut like a seek: no glide across the pitch, no trail.
      const inNet = anims.ballInNet != null;
      const snap = seek || inNet !== ballInNetRef.current;
      ballInNetRef.current = inNet;
      const step = glideBall(ballShownRef.current, target, ballGlideRef.current, now, !reducedMotion && !snap);
      const ball = step.shown;
      ballShownRef.current = ball;
      ballGlideRef.current = step.glide;
      let trail: TrailPoint[] = [];
      if (reducedMotion || snap) {
        trailRef.current = [];
      } else {
        trailRef.current = pushTrail(trailRef.current, { ...ball, t: gameSec });
        trail = trailToDraw(trailRef.current).slice(0, -1);
      }

      // Caption: who has it (only when that changes, so React renders rarely).
      const key = !sampled.hasData ? null : owner ? owner.spec.id : 'loose';
      if (key !== carrierKeyRef.current) {
        carrierKeyRef.current = key;
        setCarrierKey(key);
      }

      // Pick the projection for the active camera (it follows the drawn
      // ball, or the scorer while he celebrates).  A replay always runs on
      // the Ball camera.
      const follow = cameraMode === 'follow' || inReplay;
      const focus = anims.focus != null ? pending.find((p) => p.idx === anims.focus) : undefined;
      let project: ProjectFn;
      if (follow) {
        const anchor = focus ? focus.pos : ball;
        const target2 = clampFollowCenter(followAnchor(anchor.x, anchor.y, VP), VP);
        const prev = followCenterRef.current;
        const center = prev ? smoothFollowCenter(prev, target2, dt) : target2;
        followCenterRef.current = center;
        project = (wx, wy, wz) => atScale(projectFollow(wx, wy, wz, VP, center));
      } else {
        project = (wx, wy, wz) => atScale(projectBroadcast(wx, wy, wz, VP));
      }

      // Background + pitch (blit the baked layer under broadcast; redraw under follow).
      ctx.fillStyle = CANVAS_BG;
      ctx.fillRect(0, 0, VP.width, VP.height);
      if (!follow && bakedPitchRef.current) {
        ctx.drawImage(bakedPitchRef.current, 0, 0);
      } else {
        drawPitch(ctx, project);
      }

      // Pass 2 — project the (possibly nudged) position, record a hit anchor for
      // click selection, and build the render record (highlight/dim by selection).
      const selectedId = selectedIdRef.current;
      const hitTargets: HitTarget[] = [];
      const byIndex = new Map<number, (typeof pending)[number]>();
      /** Every figure on screen in art pixels, by roster index (-1: unknown), for the card glyph. */
      const figures: Array<FigureAt & { idx: number }> = [];
      const dudes: DudeRender[] = pending.map((p) => {
        if (p.idx >= 0) byIndex.set(p.idx, p);
        const proj = project(p.pos.x, p.pos.y, 0);
        const sc = proj.sc;
        figures.push({ idx: p.idx, x: proj.x / PIXEL_SCALE, y: proj.y / PIXEL_SCALE, as: sc / PIXEL_SCALE });
        const isSelected = selectedId != null && p.spec.id === selectedId;
        // Anchor the click target at mid-body (above the feet) so clicking the torso/head registers.
        hitTargets.push({ id: p.spec.id, sx: proj.x, sy: proj.y - 6 * sc });
        const side = kits[p.spec.team];
        // A keeper dives along his line, which runs up and down the screen
        // under both cameras: his sampled position already travels that
        // way, so the pose lays him out horizontally toward the pitch (never
        // back into his own net).
        let face = p.face;
        if (p.act?.kind === 'dive') face = p.pos.x < PITCH_LENGTH / 2 ? 1 : -1;
        return {
          wx: p.pos.x,
          wy: p.pos.y,
          phase: p.phase,
          run: p.run,
          appearance: p.spec.appearance,
          kit: p.spec.gk ? side.keeper : side.outfield,
          face,
          arms: p.arms,
          t: clock,
          highlighted: isSelected,
          dimmed: selectedId != null && !isSelected,
          carrier: owner != null && p === owner,
          act: p.body,
        };
      });
      hitTargetsRef.current = hitTargets;

      // Event marks on the grass and the goal frame (under the figures):
      // the restart spot, the hairline ring round the player at the centre
      // of a tackle, foul or save, and the frame flaring after a goal or a
      // shot off the woodwork.  Hairline Lunar Dust; no words on the pitch.
      for (const o of anims.overlays) {
        if (o.kind === 'spot') drawSpotMarker(ctx, project, o.x, o.y);
        else if (o.kind === 'flare') drawGoalFlare(ctx, project, o.goalX, o.t, reducedMotion);
        else if (o.kind === 'ring') {
          const p = byIndex.get(o.player);
          if (p) drawEventRing(ctx, project, p.pos.x, p.pos.y, o.t, reducedMotion, 'back');
        }
      }
      // The rings' near halves, drawn in depth order among the figures below.
      const nearRings = anims.overlays
        .flatMap((o) => {
          if (o.kind !== 'ring') return [];
          const p = byIndex.get(o.player);
          return p ? [{ x: p.pos.x, y: p.pos.y, t: o.t }] : [];
        })
        .sort((a, b) => a.y - b.y);

      // Dudes back-to-front by world y (far touchline first), then the ball
      // over everyone: in a crowd (a corner, a penalty) a figure in front
      // would otherwise hide it, and finding the ball matters more than the
      // occlusion.  Its dark outline keeps it separate from a body behind it.
      dudes.sort((a, b) => a.wy - b.wy);
      let ringAt = 0;
      for (const d of dudes) {
        // A ring's near half goes in front of the figures standing in it and
        // behind the ones nearer the camera.
        while (ringAt < nearRings.length && nearRings[ringAt]!.y < d.wy) {
          const r = nearRings[ringAt++]!;
          drawEventRing(ctx, project, r.x, r.y, r.t, reducedMotion, 'front');
        }
        drawDude(ctx, project, d);
      }
      while (ringAt < nearRings.length) {
        const r = nearRings[ringAt++]!;
        drawEventRing(ctx, project, r.x, r.y, r.t, reducedMotion, 'front');
      }

      // The card glyph beside the offender's head, on the side where it
      // covers no other player (over the figures, so his own kit never hides it).
      for (const o of anims.overlays) {
        if (o.kind !== 'card') continue;
        const him = figures.find((f) => f.idx === o.player);
        if (!him) continue;
        const rect = cardGlyphRect(him, figures.filter((f) => f !== him));
        drawCardGlyph(ctx, rect, o.card, o.t, reducedMotion);
      }

      drawBall(ctx, project, { wx: ball.x, wy: ball.y, wz: ball.z, trail, heldLift });

      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [frames, anchorMs, durationSeconds, dudeSpecs, kits, cameraMode, reducedMotion, events]);

  // Switching camera resets the follow centre so it snaps to the ball cleanly,
  // and records the choice so resizing no longer overrides it.
  const switchCamera = (mode: CameraMode): void => {
    cameraChosenRef.current = true;
    if (mode === 'follow') followCenterRef.current = null;
    setCameraMode(mode);
  };

  // Translate a click (CSS px) into backing-store space and select the nearest
  // dude (or null → deselect when the click misses everyone).
  const selectAt = (clientX: number, clientY: number): void => {
    if (!onSelectPlayer) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = (clientX - rect.left) * (VP.width / rect.width);
    const y = (clientY - rect.top) * (VP.height / rect.height);
    onSelectPlayer(pickNearestId(hitTargetsRef.current, x, y, SELECT_RADIUS));
  };

  // Screen-reader label — the sighted equivalent lives in the commentary feed.
  const ariaLabel =
    homeTeamName != null && awayTeamName != null && homeScore != null && awayScore != null
      ? `Match pitch view. ${homeTeamName} ${homeScore}, ${awayTeamName} ${awayScore}.`
      : 'Match pitch view.';

  // The caption under the pitch.
  const carrier = carrierKey != null && carrierKey !== 'loose' ? dudeSpecs.find((d) => d.id === carrierKey) ?? null : null;
  const carrierClub = carrier ? (carrier.team === 'home' ? homeTeamName : awayTeamName) : undefined;
  const announcement = carrier ? carrierSentence(carrier, carrierClub) : '';

  // The event strip names players by roster index: his shirt number and
  // name, else "Number 7"; a substitution also names his club.
  const specById = new Map(dudeSpecs.map((d) => [d.id, d]));
  const specOf = (player: number): DudeSpec | null => {
    const id = events?.roster[player];
    return id != null ? specById.get(id) ?? null : null;
  };
  const nameOf = (player: number): string => {
    const spec = specOf(player);
    return spec ? stripName(spec) : 'Unknown player';
  };
  const clubOf = (player: number): string | undefined => {
    const spec = specOf(player);
    return spec ? (spec.team === 'home' ? homeTeamName : awayTeamName) : undefined;
  };
  const eventSpoken = eventAnnouncement ? eventSentence(eventAnnouncement.row, nameOf, clubOf) : '';

  return (
    <div>
      <div
        ref={boxRef}
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: `${BASE_VP.width} / ${BASE_VP.height}`,
          background: color.bg,
          ...hairline(color.line),
          boxSizing: 'border-box',
        }}
      >
        <canvas
          ref={canvasRef}
          width={VP.width}
          height={VP.height}
          role="img"
          aria-label={ariaLabel}
          onClick={onSelectPlayer ? (e) => selectAt(e.clientX, e.clientY) : undefined}
          style={{
            width: '100%',
            height: '100%',
            display: 'block',
            imageRendering: 'pixelated',
            cursor: onSelectPlayer ? 'pointer' : 'default',
          }}
        />

        {/* A slow-motion replay is on: the design system's Tag, top left,
            where the camera toggles' twin would sit. */}
        {inReplayShown && (
          <div style={{ position: 'absolute', top: space[8], left: space[8], pointerEvents: 'none' }}>
            <Tag style={{ background: color.bg }}>Replay</Tag>
          </div>
        )}

        {/* In-game camera toggle: two filter tags; the active camera takes
            the selected state (Lunar Dust fill), not purple. The tags sit
            on an Abyss backing so they stay legible over the pitch. */}
        <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 4 }}>
          <CameraButton label="Pitch" active={cameraMode === 'broadcast'} onClick={() => switchCamera('broadcast')} />
          <CameraButton label="Ball" active={cameraMode === 'follow'} onClick={() => switchCamera('follow')} />
        </div>
      </div>

      {/* The event strip (docs/match-viewer.md section 7): the last three
          notable moments in words, newest on top.  Only for a replay with an
          action track; older replays keep just the caption below. */}
      {events && <EventStrip rows={stripRows} nameOf={nameOf} clubOf={clubOf} reducedMotion={reducedMotion} />}
      <ThrottledAnnouncer text={eventSpoken} everyMs={ANNOUNCE_EVENT_EVERY_MS} />

      {/* Who has the ball.  The visible line follows every touch and is
          hidden from screen readers; the polite live region beside it is
          updated at most every ANNOUNCE_EVERY_MS so they are not flooded.
          One line always (the page must not jump as the ball moves): the
          name, then the club, truncate rather than wrap on a phone. */}
      <p
        aria-hidden="true"
        style={{ margin: 0, marginTop: space[8], display: 'flex', gap: space[8], alignItems: 'baseline', flexWrap: 'nowrap', minWidth: 0, whiteSpace: 'nowrap' }}
      >
        <span style={{ ...type.label, ...tone.tertiary, flexShrink: 0 }}>On the ball</span>
        {carrier ? (
          <>
            <span style={{ ...type.body, ...tone.primary, fontWeight: 700, flexShrink: 0 }}>{carrier.number}</span>
            <span style={{ ...type.body, ...tone.primary, ...truncate() }}>{carrier.name ?? `Number ${carrier.number}`}</span>
            {carrierClub && <span style={{ ...type.small, ...tone.secondary, ...truncate(), flexShrink: 100 }}>{carrierClub}</span>}
          </>
        ) : (
          <span style={{ ...type.body, ...tone.secondary }}>{carrierKey === 'loose' ? 'Loose ball' : '\u00a0'}</span>
        )}
      </p>
      <ThrottledAnnouncer text={announcement} everyMs={ANNOUNCE_EVERY_MS} />
    </div>
  );
}

/**
 * The spoken form of the caption: "On the ball: 7 Rhea Voss, Mercury Runners".
 */
function carrierSentence(spec: DudeSpec, club: string | undefined): string {
  const who = spec.name ? `${spec.number} ${spec.name}` : `number ${spec.number}`;
  return club ? `On the ball: ${who}, ${club}.` : `On the ball: ${who}.`;
}

/** A flex item that shrinks and ends in an ellipsis instead of wrapping. */
function truncate(): CSSProperties {
  return { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' };
}

/** A player as the event strip names him: "17 Talus", else "Number 7". */
function stripName(spec: DudeSpec): string {
  return spec.name ? `${spec.number} ${spec.name}` : `Number ${spec.number}`;
}

/**
 * The spoken form of a goal or red-card row: "Goal in minute 22: 9 Gush Li,
 * Mars Athletic." (the minute as the strip's clock counts it).
 */
function eventSentence(row: EventRow, nameOf: (player: number) => string, clubOf: (player: number) => string | undefined): string {
  const minute = replayMinute(row.sec);
  const what = row.kind === 'red' ? 'Red card' : row.kind === 'ownGoal' ? 'Own goal' : 'Goal';
  const club = clubOf(row.who);
  return `${what} in minute ${minute}: ${nameOf(row.who)}${club ? `, ${club}` : ''}.`;
}

/**
 * Overlay toggle for the camera: a design-system Tag in its toggle form
 * (aria-pressed), selected when that camera is active.
 */
function CameraButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <Tag selected={active} onClick={onClick} style={active ? {} : { background: color.bg }}>
      {label}
    </Tag>
  );
}
