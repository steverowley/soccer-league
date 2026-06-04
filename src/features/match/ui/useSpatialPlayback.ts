// ── features/match/ui/useSpatialPlayback.ts ──────────────────────────────────
// Converts a pre-loaded array of `match_positions` rows into per-tick player +
// ball position overrides for <PitchView>, synced to the same real-time pacing
// clock LiveCommentary uses.
//
// ARCHITECTURE
//   This is a replay system, NOT a live physics stream.  The spatial engine
//   pre-computes every player and ball position for the full 90 minutes during
//   batch simulation (~100ms), stores the result in `match_positions`, and the
//   viewer replays it over the season's `match_duration_seconds` window by
//   advancing through the pre-loaded frame array as real wall-clock time
//   elapses past `scheduledAt`.
//
// PACING — SYNC WITH THE COMMENTARY FEED
//   The commentary feed reveals a 90-game-minute match over
//   `match_duration_seconds` real seconds (600s = 10min default) — it
//   COMPRESSES game time.  This hook MUST apply the identical mapping or the
//   dots would crawl along at 1× and fall ~9× behind the play-by-play (a
//   90-minute match would take 90 real minutes on the pitch but only 10 in the
//   feed).  So real elapsed time is converted to game time before frame
//   lookup, mirroring `computeElapsedGameMinute` (× 90) at second resolution:
//     gameSec = (realElapsedSec / durationSeconds) × (90 × 60)
//
// FRAME RESOLUTION
//   The spatial engine emits one frame every 2 game-seconds (frameEverySec=2)
//   producing ~2 700 frames per 90-minute match.  This hook ticks every
//   TICK_MS real-time ms; on each tick it binary-searches the frame array for
//   the last frame whose game-time ≤ current game-seconds, then updates state
//   only when the active frame index actually changes — avoiding unnecessary
//   React re-renders between frame boundaries.
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
 * Total regulation game time in seconds (90 minutes × 60).  The pacing window
 * (`match_duration_seconds`) is mapped onto this span so that, by the end of
 * the window, playback has advanced through a full 90 minutes of frames —
 * matching `computeElapsedGameMinute`, which scales the same window by 90.
 * Stoppage-time frames (minute 91+) sit just past this value and are reached
 * fractionally after the window closes, where playback holds the final frame.
 */
const TOTAL_GAME_SECONDS = 90 * 60;

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
 * Returns -1 when no frame has started yet (gameSec < first frame's time).
 *
 * @param frames   Pre-loaded, (minute, second)-sorted snapshot array.
 * @param gameSec  Game-clock seconds since kickoff (already compressed from
 *                 real time by the caller).  Negative before kickoff → -1.
 */
function findFrameIndex(frames: PositionSnapshot[], gameSec: number): number {
  if (frames.length === 0) return -1;
  // Each frame's own game-time in seconds since kickoff:
  //   frameGameSec = (minute - 1) * 60 + second
  // We want the index of the last frame where frameGameSec ≤ gameSec.
  let lo = 0, hi = frames.length - 1, result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const f = frames[mid]!;
    const frameGameSec = (f.minute - 1) * 60 + f.second;
    if (frameGameSec <= gameSec) {
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
 * @param frames           Pre-loaded position snapshots from `getMatchPositions`.
 *                         Pass `[]` when the spatial engine wasn't used (legacy
 *                         matches) — the hook returns `active: false` gracefully.
 * @param scheduledAt      ISO-8601 timestamp of the match kickoff.  Real elapsed
 *                         time is measured from here, then compressed to game
 *                         time via `durationSeconds`.  Pass `null` before the
 *                         match row is loaded.
 * @param durationSeconds  The season's `match_duration_seconds` — how long the
 *                         viewer takes to reveal the full 90 minutes in real
 *                         time (600s default).  Drives the same compression the
 *                         commentary feed uses, keeping the dots in lockstep
 *                         with the play-by-play.
 * @returns                Normalised overrides + `active` flag.  Thread the
 *                         result into <PitchView> when `active` is true.
 */
export function useSpatialPlayback(
  frames: PositionSnapshot[],
  scheduledAt: string | null,
  durationSeconds: number,
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
      const realElapsedSec = (Date.now() - anchorMs) / 1000;
      // Compress real elapsed time into game time using the season pacing
      // knob — identical to the commentary's mapping — so the dots and the
      // event feed reveal the same game-minute at the same wall-clock moment.
      // A non-positive duration would divide-by-zero / invert; fall back to a
      // 1× mapping (real seconds = game seconds) so playback still progresses.
      const gameSec = durationSeconds > 0
        ? (realElapsedSec / durationSeconds) * TOTAL_GAME_SECONDS
        : realElapsedSec;
      const idx = findFrameIndex(frames, gameSec);
      if (idx !== lastIndexRef.current) {
        lastIndexRef.current = idx;
        setFrameIndex(idx);
      }
    };

    advance();
    const id = setInterval(advance, TICK_MS);
    return () => clearInterval(id);
  }, [frames, anchorMs, durationSeconds]);

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
