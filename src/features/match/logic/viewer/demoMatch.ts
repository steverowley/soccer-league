// ── features/match/logic/viewer/demoMatch.ts ────────────────────────────────
// Generates a self-contained showcase match for the on-demand viewer demo.
//
// WHY
//   The viewer only appears for a real match that has stored `match_positions`
//   frames.  To demo it on the site at any time — independent of whether a live
//   match exists — we run the REAL spatial engine client-side over two synthetic
//   teams and map its replay frames into the exact `PositionSnapshot` shape the
//   viewer consumes.  Authentic motion, no DB, no live fixture required.
//
// DETERMINISTIC: same seed ⇒ same match, so the demo is stable.

import type { PositionSnapshot } from '../../api/matchPositions';
import type { FormationKey } from '../pitch';
import {
  DEFAULT_CONFIG,
  simulateSpatialMatch,
  type SpatialPlayerInput,
  type SpatialTeamInput,
} from '../spatial/simulateSpatialMatch';
import type { Role, SimPlayerStats } from '../spatial/types';
import { mulberry32 } from './appearance';

/** Minimal player descriptor the viewer needs (structurally a MatchViewerPlayer). */
export interface DemoPlayer {
  id: string;
  position: string;
}

/** Everything <MatchViewer> needs to replay the synthetic demo match. */
export interface DemoMatch {
  frames: PositionSnapshot[];
  homePlayers: DemoPlayer[];
  awayPlayers: DemoPlayer[];
  homeFormation: FormationKey;
  awayFormation: FormationKey;
  homeColor: string | null;
  awayColor: string | null;
  /** Final score, handy if a caller wants to show it. */
  finalScore: [number, number];
}

/** 4-4-2 role layout, GK first — supported by both the engine and the viewer. */
const DEMO_ROLES: readonly Role[] = [
  'GK', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'FW', 'FW',
];

/**
 * Build believable-but-synthetic stats (~55–84, keepers get high goalkeeping)
 * from a seeded RNG so the match plays out naturally and reproducibly.
 */
function statsFor(role: Role, r: () => number): SimPlayerStats {
  const mid = (): number => 55 + Math.floor(r() * 30); // 55..84
  return {
    shooting: mid(),
    passing: mid(),
    dribbling: mid(),
    speed: mid(),
    stamina: mid(),
    tackling: mid(),
    positioning: mid(),
    goalkeeping: role === 'GK' ? 70 + Math.floor(r() * 25) : 30 + Math.floor(r() * 20),
    vision: mid(),
  };
}

/** Build one synthetic 4-4-2 team with deterministic ids + stats. */
function buildTeam(side: 'home' | 'away', seed: number): SpatialTeamInput {
  const r = mulberry32(seed);
  const players: SpatialPlayerInput[] = DEMO_ROLES.map((role, i) => ({
    id: `demo-${side}-${i}`,
    name: `${side === 'home' ? 'H' : 'A'}${i}`,
    role,
    stats: statsFor(role, r),
  }));
  return { formation: '4-4-2', players };
}

/**
 * Generate a full 90-minute showcase match by running the spatial engine over
 * two synthetic teams and converting its frames into `PositionSnapshot`s exactly
 * as the match-worker does (minute/second + `hasBall` derived from the owner).
 *
 * @param seed  Match seed; same seed ⇒ identical demo.
 * @returns     Frames + rosters + shape/colours for <MatchViewer>.
 */
export function generateDemoMatch(seed = 7): DemoMatch {
  const home = buildTeam('home', seed);
  const away = buildTeam('away', seed + 1000);
  const result = simulateSpatialMatch(home, away, { ...DEFAULT_CONFIG, seed });

  const frames: PositionSnapshot[] = result.frames.map((frame) => {
    // Same mapping the worker uses: minute = floor(tSec/60)+1 (clamped to extra
    // time), second = tSec within the minute, hasBall = id matches the carrier.
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

  const toDemoPlayer = (p: SpatialPlayerInput): DemoPlayer => ({ id: p.id, position: p.role });
  return {
    frames,
    homePlayers: home.players.map(toDemoPlayer),
    awayPlayers: away.players.map(toDemoPlayer),
    homeFormation: '4-4-2',
    awayFormation: '4-4-2',
    // Null colours → the viewer's canonical quantum / flare fallback.
    homeColor: null,
    awayColor: null,
    finalScore: result.finalScore,
  };
}
