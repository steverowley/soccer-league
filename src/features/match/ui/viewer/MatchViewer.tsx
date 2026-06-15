// ── features/match/ui/viewer/MatchViewer.tsx ────────────────────────────────
// The canvas pixel-art match viewer: tiny "little dudes" playing on a to-scale
// 105×68 m pitch, replaying the spatial engine's `match_positions` frames, with
// an in-game camera toggle (whole-pitch broadcast ⇄ ball-following crop).
//
// RESPONSIBILITIES (everything else is pure logic in logic/viewer + render.ts):
//   • own the <canvas>, the requestAnimationFrame loop, and the camera state;
//   • map real wall-clock time → game-second (season pacing) and sample the
//     interpolated positions for this instant;
//   • derive each dude's gait/facing/phase, depth-sort, and draw.
//
// CHUNKY-PIXEL RENDERING
//   The backing store is a fixed low resolution (320×208); CSS stretches it with
//   `image-rendering: pixelated` for the retro look and a tiny fill rate.  The
//   projection tuning is calibrated to this size.
//
// REST STATE
//   Before kickoff or for a legacy match with no frames, every dude stands at its
//   formation home position (idle bob); the ball sits on the centre spot.

import { useEffect, useMemo, useRef, useState } from 'react';

import { COLORS } from '../../../../components/Layout';
// useReducedMotion is a shared accessibility hook exposed on the entities
// barrel; the cross-feature import is barrel-only so it satisfies
// no-restricted-imports.
import { useReducedMotion } from '@features/entities';

import type { PositionSnapshot } from '../../api/matchPositions';
import { getFormationSlots, type FormationKey } from '../../logic/pitch';
import { PITCH_LENGTH, PITCH_WIDTH } from '../../logic/spatial/types';
import {
  advancePhase,
  animStateFromSpeed,
  clampFollowCenter,
  computePose,
  followAnchor,
  makeAppearance,
  pickNearestId,
  projectBroadcast,
  projectFollow,
  realToGameSeconds,
  sampleFrames,
  separatePositions,
  smoothFollowCenter,
  STATIC_POSE,
  type Appearance,
  type HitTarget,
  type ScreenPoint,
  type Viewport,
} from '../../logic/viewer';
import { drawBall, drawDude, drawPitch, type DudeRender, type ProjectFn } from './render';

// ── Constants ───────────────────────────────────────────────────────────────

/**
 * Fixed canvas backing-store size.  Small on purpose (chunky pixels + cheap fill
 * rate); the projection numbers in logic/viewer are calibrated to this size.
 */
const VP: Viewport = { width: 320, height: 208 };

/** Velocity (game m/s) above which we flip a dude's facing — avoids jitter at rest. */
const FACE_FLIP_SPEED = 0.4;

/** Click selection radius in backing-store pixels (a click within this of a dude selects it). */
const SELECT_RADIUS = 16;

/** Which camera is active.  Both share one world model; only the projection differs. */
type CameraMode = 'broadcast' | 'follow';

// ── Public types ─────────────────────────────────────────────────────────────

/** Minimal player info the viewer needs: a stable id (to match frames + seed the look) and position. */
export interface MatchViewerPlayer {
  id: string;
  /** Two-letter position (GK/DF/MF/FW); only GK is special-cased (distinct kit). */
  position: string;
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
  /** Starting XI per side in slot order (GK first); short squads pad with synthetic ids. */
  homePlayers: readonly MatchViewerPlayer[];
  awayPlayers: readonly MatchViewerPlayer[];
  /** Team kit colours (null ⇒ canonical fallback). */
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
  /** Kit fill colour. */
  kit: string;
  /** Deterministic appearance. */
  appearance: Appearance;
  /** Default facing when stationary (home faces +x, away faces −x). */
  faceDefault: number;
}

/**
 * Resolve 11 dude specs for one side: formation slot → metre-space home position,
 * kit colour (GK gets a distinct colour), and a deterministic appearance keyed by
 * player id.  Slots beyond the supplied roster get synthetic ids so the pitch is
 * always full.
 */
function buildSide(
  side: 'home' | 'away',
  formation: FormationKey,
  players: readonly MatchViewerPlayer[],
  teamColor: string | null | undefined,
  outfieldFallback: string,
  gkColor: string,
): DudeSpec[] {
  const slots = getFormationSlots(formation, side);
  const faceDefault = side === 'home' ? 1 : -1;
  return slots.map((slot, i) => {
    const id = players[i]?.id ?? `${side}-${i}`;
    const isGK = i === 0;
    return {
      id,
      homeX: slot.x * PITCH_LENGTH,
      homeY: slot.y * PITCH_WIDTH,
      kit: isGK ? gkColor : (teamColor ?? outfieldFallback),
      appearance: makeAppearance(id),
      faceDefault,
    };
  });
}

// ── Component ────────────────────────────────────────────────────────────────

/**
 * Canvas match viewer.  Replays the spatial engine's frames as animated pixel-art
 * dudes under a switchable broadcast / follow camera.  Renders a static formation
 * rest state when there are no frames yet.
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
  const [cameraMode, setCameraMode] = useState<CameraMode>('broadcast');

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  /** Per-dude animation phase, persisted across frames. */
  const phaseRef = useRef<Map<string, number>>(new Map());
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

  // Kickoff anchor in epoch ms — parsed once so a same-string re-render is stable.
  const anchorMs = useMemo<number | null>(() => {
    if (!scheduledAt) return null;
    const t = new Date(scheduledAt).getTime();
    return Number.isNaN(t) ? null : t;
  }, [scheduledAt]);

  // Resolve the 22 dude specs once per match shape.  GK colours are fixed and
  // distinct (terraNova / astro) so the keeper reads at a glance; outfielders use
  // the team colour or the canonical quantum / flare fallback.
  const dudeSpecs = useMemo<DudeSpec[]>(
    () => [
      ...buildSide('home', homeFormation, homePlayers, homeColor, COLORS.quantum, COLORS.terraNova),
      ...buildSide('away', awayFormation, awayPlayers, awayColor, COLORS.flare, COLORS.astro),
    ],
    [homeFormation, awayFormation, homePlayers, awayPlayers, homeColor, awayColor],
  );

  // Bake the broadcast pitch once (the static layer never moves under that camera).
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const off = document.createElement('canvas');
    off.width = VP.width;
    off.height = VP.height;
    const offCtx = off.getContext('2d');
    if (!offCtx) return;
    offCtx.imageSmoothingEnabled = false;
    offCtx.fillStyle = COLORS.abyss;
    offCtx.fillRect(0, 0, VP.width, VP.height);
    drawPitch(offCtx, (wx, wy, wz) => projectBroadcast(wx, wy, wz, VP));
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

      // Wall-clock → game-second (same compression the commentary feed uses).
      const elapsedRealSec = anchorMs != null ? (Date.now() - anchorMs) / 1000 : 0;
      const gameSec = realToGameSeconds(elapsedRealSec, durationSeconds);
      const sampled = sampleFrames(frames, gameSec);

      const ballWx = sampled.ball ? sampled.ball.x : PITCH_LENGTH / 2;
      const ballWy = sampled.ball ? sampled.ball.y : PITCH_WIDTH / 2;

      // Pick the projection for the active camera.
      let project: ProjectFn;
      if (cameraMode === 'follow') {
        const target = clampFollowCenter(followAnchor(ballWx, ballWy, VP), VP);
        const prev = followCenterRef.current;
        const center = prev ? smoothFollowCenter(prev, target, dt) : target;
        followCenterRef.current = center;
        project = (wx, wy, wz) => projectFollow(wx, wy, wz, VP, center);
      } else {
        project = (wx, wy, wz) => projectBroadcast(wx, wy, wz, VP);
      }

      // Background + pitch (blit the baked layer under broadcast; redraw under follow).
      ctx.fillStyle = COLORS.abyss;
      ctx.fillRect(0, 0, VP.width, VP.height);
      if (cameraMode === 'broadcast' && bakedPitchRef.current) {
        ctx.drawImage(bakedPitchRef.current, 0, 0);
      } else {
        drawPitch(ctx, project);
      }

      // Pass 1 — resolve each dude's true world position + gait/facing/phase.
      // Position lives in a mutable `pos` object so the separation pass can nudge
      // it in place before we project + pose.
      const pending = dudeSpecs.map((spec) => {
        const s = sampled.players.get(spec.id);
        const pos = { x: s ? s.x : spec.homeX, y: s ? s.y : spec.homeY };
        const gameSpeed = s ? Math.hypot(s.vx, s.vy) : 0;
        const state = reducedMotion ? 'idle' : animStateFromSpeed(gameSpeed);

        // Advance phase (seeded random on first sight so the crowd doesn't march in sync).
        const prevPhase = phaseRef.current.get(spec.id) ?? Math.random() * Math.PI * 2;
        const phase = advancePhase(prevPhase, state, animDt);
        phaseRef.current.set(spec.id, phase);

        // Facing follows horizontal velocity; otherwise it holds.
        let face = faceRef.current.get(spec.id) ?? spec.faceDefault;
        if (s && Math.abs(s.vx) > FACE_FLIP_SPEED) face = s.vx > 0 ? 1 : -1;
        faceRef.current.set(spec.id, face);

        return { spec, pos, state, phase, face };
      });

      // De-overlap (VISUAL ONLY) — spread sprites that the real positions stack on
      // top of each other so the pitch stays legible; the match data is untouched.
      separatePositions(pending.map((p) => p.pos));

      // Pass 2 — project the (possibly nudged) position, record a hit anchor for
      // click selection, and build the render record (highlight/dim by selection).
      const selectedId = selectedIdRef.current;
      const hitTargets: HitTarget[] = [];
      const dudes: DudeRender[] = pending.map((p) => {
        const proj = project(p.pos.x, p.pos.y, 0);
        const sc = proj.sc;
        const pose = reducedMotion ? STATIC_POSE : computePose(p.phase, p.state, sc);
        const isSelected = selectedId != null && p.spec.id === selectedId;
        // Anchor the click target at mid-body (above the feet) so clicking the torso/head registers.
        hitTargets.push({ id: p.spec.id, sx: proj.x, sy: proj.y - 6 * sc });
        return {
          wx: p.pos.x,
          wy: p.pos.y,
          pose,
          appearance: p.spec.appearance,
          kit: p.spec.kit,
          face: p.face,
          highlighted: isSelected,
          dimmed: selectedId != null && !isSelected,
        };
      });
      hitTargetsRef.current = hitTargets;

      // Depth-sort dudes + ball back-to-front by world y (far touchline first).
      const order: Array<{ k: number; dude: DudeRender | null }> = dudes.map((d) => ({ k: d.wy, dude: d }));
      order.push({ k: ballWy + 0.05, dude: null });
      order.sort((a, b) => a.k - b.k);
      for (const o of order) {
        if (o.dude) drawDude(ctx, project, o.dude);
        else drawBall(ctx, project, { wx: ballWx, wy: ballWy, wz: 0 });
      }

      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [frames, anchorMs, durationSeconds, dudeSpecs, cameraMode, reducedMotion]);

  // Switching camera resets the follow centre so it snaps to the ball cleanly.
  const switchCamera = (mode: CameraMode): void => {
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

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: `${VP.width} / ${VP.height}`,
        background: COLORS.abyss,
        border: `1px solid ${COLORS.hairline}`,
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

      {/* In-game camera toggle. */}
      <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 4 }}>
        <CameraButton label="Pitch" active={cameraMode === 'broadcast'} onClick={() => switchCamera('broadcast')} />
        <CameraButton label="Ball" active={cameraMode === 'follow'} onClick={() => switchCamera('follow')} />
      </div>
    </div>
  );
}

/** Small overlay button for the camera toggle, styled in the ISL palette. */
function CameraButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        font: 'inherit',
        fontSize: 11,
        letterSpacing: '0.02em',
        padding: '4px 9px',
        cursor: 'pointer',
        borderRadius: 2,
        color: active ? '#fff' : COLORS.dust70,
        background: active ? COLORS.quantum : 'rgba(17,17,17,0.7)',
        border: `1px solid ${active ? COLORS.quantum : COLORS.hairline}`,
      }}
    >
      {label}
    </button>
  );
}
