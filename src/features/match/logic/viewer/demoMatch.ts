// ── features/match/logic/viewer/demoMatch.ts ────────────────────────────────
// Synthetic fallback showcase match for the viewer demo.
//
// Preferred path is a REAL matchup (realMatch.ts); this synthetic generator is
// the fallback used when no team data is available (fresh DB, offline).  It runs
// the SAME spatial engine through the shared assembler, so it behaves like a real
// match — just with anonymous, deterministically-generated players.

import {
  assembleMatch,
  type ViewerMatch,
} from './buildMatch';
import {
  type SpatialPlayerInput,
  type SpatialTeamInput,
} from '../spatial/simulateSpatialMatch';
import type { Role, SimPlayerStats } from '../spatial/types';
import { mulberry32 } from './appearance';

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
 * Generate a deterministic synthetic showcase match by running the spatial engine
 * over two anonymous 4-4-2 teams.
 *
 * @param seed  Match seed; same seed ⇒ identical demo.
 * @returns     A `ViewerMatch` ready for <MatchViewer>.
 */
export function generateDemoMatch(seed = 7): ViewerMatch {
  const homeInput = buildTeam('home', seed);
  const awayInput = buildTeam('away', seed + 1000);
  const { frames, homePlayers, awayPlayers, finalScore } = assembleMatch(homeInput, awayInput, seed);
  return {
    frames,
    homePlayers,
    awayPlayers,
    homeFormation: '4-4-2',
    awayFormation: '4-4-2',
    // Null colours → the viewer's canonical quantum / flare fallback.
    homeTeamName: 'Home XI',
    awayTeamName: 'Away XI',
    finalScore,
  };
}
