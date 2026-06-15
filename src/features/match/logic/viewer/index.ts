// ── features/match/logic/viewer/index.ts ────────────────────────────────────
// Internal barrel for the canvas viewer's pure logic.  Lets the sibling UI
// (ui/viewer/) import via `'../../logic/viewer'` without reaching into
// individual modules.  The feature-level barrel owns the public surface.

export {
  FOLLOW_ZOOM,
  projectBroadcast,
  projectFollow,
  followAnchor,
  clampFollowCenter,
  smoothFollowCenter,
} from './projection';
export type { Viewport, Projected, ScreenPoint } from './projection';

export {
  WALK_SPEED_MPS,
  RUN_SPEED_MPS,
  STEP_RATE,
  HOP_AMP,
  SWING_AMP,
  STATIC_POSE,
  animStateFromSpeed,
  advancePhase,
  computePose,
} from './animation';
export type { AnimState, Pose } from './animation';

export {
  PITCH_MARKINGS,
  GOALS,
  GOAL_HEIGHT,
  GOAL_DEPTH,
} from './geometry';
export type { Marking, GoalSpec } from './geometry';

export {
  TOTAL_GAME_SECONDS,
  realToGameSeconds,
  frameGameSeconds,
  sampleFrames,
} from './playback';
export type { SampledPlayer, SampledBall, SampledFrame } from './playback';

export {
  SEPARATION_MIN_DIST,
  SEPARATION_ITERATIONS,
  separatePositions,
} from './separation';
export type { SepPoint } from './separation';

export {
  SKIN_TONES,
  HUMAN_SKIN_COUNT,
  HAIR_COLORS,
  HAT_COLORS,
  hashStringToSeed,
  mulberry32,
  makeAppearance,
} from './appearance';
export type { Appearance, HairStyle, Build, HatStyle } from './appearance';

export type { ViewerMatch, ViewerRosterPlayer } from './buildMatch';
export { generateDemoMatch } from './demoMatch';
export { simulateMatchFromTeams } from './realMatch';
export type { TeamSimData } from './realMatch';
