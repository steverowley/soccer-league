// ── features/match/ui/useSpatialPlayback.ts ──────────────────────────────────
// Converts a pre-loaded array of `match_positions` rows into per-tick player +
// ball position overrides for <PitchView>, synced to the same real-time pacing
// clock LiveCommentary uses.
//
// ARCHITECTURE
//   This is a replay system, NOT a live physics stream.  The spatial engine
//   pre-computes every player and ball position for the full 90 minutes during
//   batch simulation (~100ms), stores the result in `match_positions`, and the
//   viewer replays it at 1× speed by advancing through the pre-loaded frame
//   array as real wall-clock time elapses past `scheduledAt`.
//
// FRAME RESOLUTION
//   The spatial engine emits one frame every 2 game-seconds (frameEverySec=2)
//   producing ~2 700 frames per 90-minute match.  This hook ticks every
//   TICK_MS real-time ms; on each tick it binary-searches the frame array for
//   the last frame whose game-time ≤ current elapsed game-seconds, then
//   updates state only when the active frame index actually changes — avoiding
//   unnecessary React re-renders between frame boundaries.
//
// COORDINATE NORMALISATION
//   The spatial engine uses pitch-metre space: x ∈ [0, 105], y ∈ [0, 68].
//   PitchView renders in normalised [0, 1] space (multiplied by PITCH_VIEWBOX_*
//   inside the SVG).  This hook normalises before returning so PitchView stays
//   unaware of the spatial engine's coordinate system.
//
// GRACEFUL DEGRADATION
//   • `frames` empty → `active = false`, zero overrides returned; PitchView
//     falls back to its choreography-hook positions.
//   • `scheduledAt` null → same as above (match not yet started).
//   • Elapsed time before the first frame → first frame used (clamp to 0).
//   • Elapsed time past the last frame → last frame held (no rewind).

import { useEffect, useMemo, useRef, useState } from 'react';

import type { PositionSnapshot } from '../api/matchPositions';

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * How often the hook checks whether the active frame should advance.
 * 500 ms strikes the balance: fast enough to pick up a new 2-second frame
 * within one half-frame-period (≤1 s late), cheap enough to not contend with
 * the 1-second commentary tick or cause visible jitter on lower-end devices.
 */
const TICK_MS = 500;

/**
 * FIFA standard pitch length in metres.  Dividing spatial-engine x by this
 * value normalises to [0, 1] for PitchView's SVG coordinate space.
 */
const PITCH_LENGTH_M = 105;

/**
 * FIFA standard pitch width in metres.  Dividing spatial-engine y by this
 * value normalises to [0, 1] for PitchView's SVG coordinate space.
 */
const PITCH_WIDTH_M = 68;

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Normalised player position in [0, 1] space, ready for PitchView's
 * `positionOverrides` prop.
 */
export interface NormalisedPosition {
  /** Pitch fraction along the length axis: 0 = home goal line, 1 = away goal. */
  x: number;
  /** Pitch fraction along the width axis: 0 = top touchline, 1 = bottom. */
  y: number;
}

/**
 * Result returned by `useSpatialPlayback`.
 *
 * `playerOverrides` and `ballOverride` are passed directly to <PitchView> to
 * replace the choreography-hook positions with real spatial-engine positions.
 * When `active` is false the caller should NOT pass these props so PitchView
 * falls back to the event-driven choreography.
 */
export interface SpatialPlaybackResult {
  /**
   * Map from player id → normalised [0, 1] position for the current frame.
   * Empty when `active` is false.
   */
  playerOverrides: ReadonlyMap<string, NormalisedPosition>;
  /**
   * Ball position in [0, 1] space for the current frame.
   * null when `active` is false or before the first frame loads.
   */
  ballOverride: { x: number; y: number; ownerId: string | null } | null;
  /**
   * True when the hook has loaded at least one frame and the match clock has
   * started (scheduledAt is in the past).  The caller should pass
   * `positionOverrides` and `ballOverride` to <PitchView> only when true.
   */
  active: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Return the index of the last frame whose game-time is ≤ `elapsedSec`.
 *
 * Uses a simple linear scan from the end — ~2700 frames but the current
 * frame index only advances monotonically so a forward scan from the last
 * known index is effectively O(1) in steady state.  The full scan is only
 * needed on the initial call or after a tab wake-up where many frames
 * elapsed while the interval was paused by the browser.
 *
 * Returns -1 when no frame has started yet (elapsedSec < first frame's time).
 *
 * @param frames     Pre-loaded, (minute, second)-sorted snapshot array.
 * @param elapsedSec Real seconds elapsed since `scheduledAt`.
 */
function findFrameIndex(frames: PositionSnapshot[], elapsedSec: number): number {
  if (frames.length === 0) return -1;
  // Each frame's game-time in seconds since kickoff:
  //   gameSec = (minute - 1) * 60 + second
  // We want the last frame where gameSec ≤ elapsedSec.
  let lo = 0, hi = frames.length - 1, result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const f = frames[mid]!;
    const gameSec = (f.minute - 1) * 60 + f.second;
    if (gameSec <= elapsedSec) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}

/**
 * Convert a single `PositionSnapshot` into the normalised override maps
 * expected by <PitchView>.
 *
 * Coordinates are divided by FIFA pitch dimensions so they land in [0, 1]
 * space that PitchView's SVG multiplies by its viewBox size.
 *
 * @param snap  The snapshot to convert.
 * @returns     Normalised player map + ball override.
 */
function toNormalisedOverrides(snap: PositionSnapshot): {
  playerOverrides: Map<string, NormalisedPosition>;
  ballOverride:    { x: number; y: number; ownerId: string | null };
} {
  const playerOverrides = new Map<string, NormalisedPosition>();
  for (const p of snap.snapshots.players) {
    playerOverrides.set(p.id, {
      x: p.x / PITCH_LENGTH_M,
      y: p.y / PITCH_WIDTH_M,
    });
  }
  const ball = snap.snapshots.ball;
  return {
    playerOverrides,
    ballOverride: {
      x:       ball.x / PITCH_LENGTH_M,
      y:       ball.y / PITCH_WIDTH_M,
      ownerId: ball.ownerId,
    },
  };
}

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Drives real spatial position playback for <PitchView>.
 *
 * Syncs to the real-time pacing clock anchored at `scheduledAt` — the same
 * anchor LiveCommentary uses — so the dots and commentary events stay in step
 * without any additional coordination.
 *
 * @param frames       Pre-loaded position snapshots from `getMatchPositions`.
 *                     Pass `[]` when the spatial engine wasn't used (legacy
 *                     matches) — the hook returns `active: false` gracefully.
 * @param scheduledAt  ISO-8601 timestamp of the match kickoff.  The elapsed
 *                     game seconds are computed as `(now − scheduledAt) / 1000`.
 *                     Pass `null` before the match row is loaded.
 * @returns            Normalised overrides + `active` flag.  Thread the result
 *                     into <PitchView> when `active` is true.
 */
export function useSpatialPlayback(
  frames: PositionSnapshot[],
  scheduledAt: string | null,
): SpatialPlaybackResult {
  // ── Derived anchor timestamp ─────────────────────────────────────────────
  // Parse once, memoised so a parent re-render with the same ISO string
  // doesn't produce a new Date instance that invalidates downstream effects.
  const anchorMs = useMemo<number | null>(() => {
    if (!scheduledAt) return null;
    const t = new Date(scheduledAt).getTime();
    return isNaN(t) ? null : t;
  }, [scheduledAt]);

  // ── Active frame index ───────────────────────────────────────────────────
  // -1 = no frame active yet (before first frame's game-time).
  // The ref tracks the last-seen index so the interval only setState when
  // the index actually changes, avoiding needless re-renders.
  const lastIndexRef = useRef<number>(-1);
  const [frameIndex, setFrameIndex] = useState<number>(-1);

  useEffect(() => {
    // No frames or no anchor → can't play back.  Reset state so a match
    // that gains frames mid-session picks up cleanly on the next tick.
    if (frames.length === 0 || anchorMs === null) {
      lastIndexRef.current = -1;
      setFrameIndex(-1);
      return;
    }

    // Advance one tick immediately on mount / dependency change so the
    // caller sees the right frame on the first render without waiting for
    // the first interval to fire.
    const advance = () => {
      const elapsedSec = (Date.now() - anchorMs) / 1000;
      const idx = findFrameIndex(frames, elapsedSec);
      if (idx !== lastIndexRef.current) {
        lastIndexRef.current = idx;
        setFrameIndex(idx);
      }
    };

    advance();
    const id = setInterval(advance, TICK_MS);
    return () => clearInterval(id);
  }, [frames, anchorMs]);

  // ── Compute override maps ─────────────────────────────────────────────────
  // Derive normalised positions from the current frame index.
  // Memoised on frameIndex so a parent re-render at the same game-second
  // doesn't rebuild 22-entry Maps on every render cycle.
  const [playerOverrides, ballOverride, active] = useMemo<
    [ReadonlyMap<string, NormalisedPosition>, { x: number; y: number; ownerId: string | null } | null, boolean]
  >(() => {
    if (frameIndex < 0 || frameIndex >= frames.length) {
      return [new Map(), null, false];
    }
    const snap = frames[frameIndex]!;
    const { playerOverrides: po, ballOverride: bo } = toNormalisedOverrides(snap);
    return [po, bo, true];
  }, [frameIndex, frames]);

  return { playerOverrides, ballOverride, active };
}
