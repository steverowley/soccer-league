// ── features/match/logic/spatial/index.ts ────────────────────────────────────
// Barrel for the authoritative spatial match engine (Path A rebuild).
//
// Consumers (the match-worker, the high-res viewer, tests) import from here —
// never from the individual modules — so the internal file layout can change
// without rippling through call sites.

export {
  simulateSpatialMatch,
  DEFAULT_CONFIG,
  type SpatialPlayerInput,
  type SpatialTeamInput,
} from './simulateSpatialMatch';

export {
  type SimConfig,
  type SimEvent,
  type SpatialMatchResult,
  type PositionFrame,
  type FramePlayer,
  type SimPlayerStats,
  type Role,
  type TeamSide,
  PITCH_LENGTH,
  PITCH_WIDTH,
  GOAL_WIDTH,
} from './types';

export { type Formation, narrowFormation } from './formation';
