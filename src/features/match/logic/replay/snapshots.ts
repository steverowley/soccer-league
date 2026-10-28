// ── features/match/logic/replay/snapshots.ts ─────────────────────────────────
// A v3 replay track as the viewer's `PositionSnapshot[]`, so playback,
// hit-testing and rendering read v2 and v3 replays through one shape.
//
// Each player frame (every 0.5 s) becomes one snapshot with:
//   - `tSec`: its exact game time (v2 snapshots only carry whole seconds);
//   - `snapshots.players` / `snapshots.ball`: the same fields a v2 frame has
//     (the ball sampled from the track at that instant), for any consumer
//     that reads a frame directly;
//   - `ballTrack`: the whole match's ball keyframes, ONE object shared by
//     every snapshot, which `sampleFrames` replays with the engine's physics.
//
// Used by the replay-file decoder (api/matchPositions.ts) and by the local
// demo path (viewer/buildMatch.ts), so both hand the viewer the same thing.

import type { PositionSnapshot } from '../../api/matchPositions';
import { sampleBallTrack } from './ballTrack';
import type { ReplayTrack } from './recorder';

/**
 * Convert a replay track into time-sorted viewer snapshots.
 *
 * @param track  A recorded or decoded v3 track.
 * @returns      One snapshot per player frame, sharing the ball track.
 */
export function trackToSnapshots(track: ReplayTrack): PositionSnapshot[] {
  const out: PositionSnapshot[] = new Array<PositionSnapshot>(track.frames.length);
  for (let i = 0; i < track.frames.length; i++) {
    // Whole ticks, so the frame time is exactly a tick time (0.5 = 5 x 0.1).
    const ticks = Math.round((i * track.everySec) / track.dtSec);
    const tSec = Math.round(ticks * track.dtSec * 1000) / 1000;
    const ball = sampleBallTrack(track.ball, tSec);
    const owner = ball.ownerId;
    out[i] = {
      minute: Math.min(120, Math.max(1, Math.floor(tSec / 60) + 1)),
      second: Math.floor(tSec % 60),
      tSec,
      ballTrack: track.ball,
      snapshots: {
        players: track.frames[i]!.map((p) => ({ id: p.id, x: p.x, y: p.y, hasBall: p.id === owner })),
        ball: { x: ball.x, y: ball.y, ownerId: owner },
      },
    };
  }
  return out;
}
