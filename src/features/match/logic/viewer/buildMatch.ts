// ── features/match/logic/viewer/buildMatch.ts ───────────────────────────────
// Shared assembly from a pair of spatial team inputs to the shape <MatchViewer>
// consumes.  Both the synthetic demo (demoMatch.ts) and a real-team matchup
// (realMatch.ts) run the SAME engine through here, so they replay identically.

import type { PositionSnapshot } from '../../api/matchPositions';
import type { FormationKey } from '../pitch';
import {
  DEFAULT_CONFIG,
  simulateSpatialMatch,
  type SpatialTeamInput,
} from '../spatial/simulateSpatialMatch';
import type { PositionFrame } from '../spatial/types';

/** Minimal per-player descriptor the viewer needs (structurally a MatchViewerPlayer). */
export interface ViewerRosterPlayer {
  id: string;
  /** GK/DF/MF/FW — only used cosmetically; the viewer treats slot 0 as the keeper. */
  position: string;
  /** Display name, when known (used by the click-to-inspect panel). */
  name?: string;
}

/** Everything <MatchViewer> needs to replay one assembled match. */
export interface ViewerMatch {
  frames: PositionSnapshot[];
  homePlayers: ViewerRosterPlayer[];
  awayPlayers: ViewerRosterPlayer[];
  homeFormation: FormationKey;
  awayFormation: FormationKey;
  homeColor: string | null;
  awayColor: string | null;
  homeTeamName: string;
  awayTeamName: string;
  finalScore: [number, number];
}

/**
 * Convert the engine's replay frames into `match_positions` snapshots — the exact
 * mapping the match-worker uses: minute = floor(tSec/60)+1 (clamped to extra
 * time), second = tSec within the minute, and `hasBall` derived from the carrier.
 *
 * @param frames  Engine `PositionFrame`s (one per 2 game-seconds).
 * @returns       Snapshots in the shape the viewer / `getMatchPositions` produce.
 */
export function framesToSnapshots(frames: readonly PositionFrame[]): PositionSnapshot[] {
  return frames.map((frame) => {
    const minute = Math.min(120, Math.max(1, Math.floor(frame.tSec / 60) + 1));
    const second = Math.floor(frame.tSec % 60);
    return {
      minute,
      second,
      snapshots: {
        players: frame.players.map((p) => ({
          id: p.id,
          x: p.x,
          y: p.y,
          hasBall: p.id === frame.ball.ownerId,
        })),
        ball: { x: frame.ball.x, y: frame.ball.y, ownerId: frame.ball.ownerId },
      },
    };
  });
}

/**
 * Run the spatial engine for two team inputs and assemble the frames + rosters
 * the viewer renders.
 *
 * The engine emits frame players in formation-slot order — home XI (GK first)
 * then away XI — so we read the rendered rosters straight off the first frame
 * (guaranteeing the viewer's dude ids match the frame ids exactly), and recover
 * each player's position/name from the input by id.
 *
 * @param homeInput  Home team's engine input (formation + XI with stats).
 * @param awayInput  Away team's engine input.
 * @param seed       Match seed — same inputs + seed ⇒ identical match.
 * @returns          Frames, the two rendered rosters, and the final score.
 */
export function assembleMatch(
  homeInput: SpatialTeamInput,
  awayInput: SpatialTeamInput,
  seed: number,
): {
  frames: PositionSnapshot[];
  homePlayers: ViewerRosterPlayer[];
  awayPlayers: ViewerRosterPlayer[];
  finalScore: [number, number];
} {
  const result = simulateSpatialMatch(homeInput, awayInput, { ...DEFAULT_CONFIG, seed });
  const first = result.frames[0];

  // Recover {position, name} for a rendered id from the team's input players.
  const roster = (
    input: SpatialTeamInput,
    framePlayers: ReadonlyArray<{ id: string }>,
    fallbackIfGk: boolean,
  ): ViewerRosterPlayer[] =>
    framePlayers.map((fp, i) => {
      const src = input.players.find((p) => p.id === fp.id);
      const position = src?.role ?? (fallbackIfGk && i === 0 ? 'GK' : 'MF');
      return src?.name !== undefined
        ? { id: fp.id, position, name: src.name }
        : { id: fp.id, position };
    });

  // first.players is [home XI (11), away XI (11)] in slot order; slot 0 is GK.
  const homeFrame = first ? first.players.slice(0, 11) : [];
  const awayFrame = first ? first.players.slice(11, 22) : [];

  return {
    frames: framesToSnapshots(result.frames),
    homePlayers: roster(homeInput, homeFrame, true),
    awayPlayers: roster(awayInput, awayFrame, true),
    finalScore: result.finalScore,
  };
}
