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
  PHONE_VIEWER_MAX_PX,
  cameraForWidth,
} from './projection';
export type { CameraMode } from './projection';
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
  SPECIES,
  SPECIES_KEYS,
  HAIR_TONE,
  hashStringToSeed,
  mulberry32,
  parseDescription,
  makeAppearance,
} from './appearance';
export type {
  Appearance,
  AppearanceHints,
  HairStyle,
  Build,
  Species,
  SpeciesSpec,
  HeadShape,
  EyeKind,
  AntennaKind,
} from './appearance';

export {
  CHANGE_KITS,
  CLASH_MIN_DE,
  FIGURE_MIN_DE,
  GRASS_MIN_CONTRAST,
  KEEPER_KITS,
  KEEPER_MIN_DE,
  KEEPER_MIN_GRASS_CONTRAST,
  KIT_REFERENCE,
  contrastRatio,
  deltaE,
  isLegibleKit,
  legibleKit,
  resolveKits,
} from './kits';
export type { Kit, SideKits, MatchKits } from './kits';

export {
  FEET_OFFSET_M,
  GLIDE_GAP_M,
  GLIDE_MS,
  TRAIL_GAME_SEC,
  TRAIL_MIN_MPS,
  ballAtFeet,
  glideBall,
  pushTrail,
  trailToDraw,
} from './ball';
export type { BallPoint, BallGlide, GlideStep, TrailPoint } from './ball';

export { pickNearestId } from './hitTest';
export type { HitTarget } from './hitTest';

export {
  ANIM_MS,
  PRE_MS,
  RESTART_LABEL,
  REST_BODY,
  activeAnimations,
  actionBody,
  kickLegAt,
  noAnimations,
} from './actionAnim';
export type {
  ActionBody,
  ActionPose,
  ActiveAnimations,
  AnimLookup,
  AnimQuery,
  ArmPreset,
  Overlay,
  PoseKind,
  TrailKind,
} from './actionAnim';

export { liveRate, replayAt, scheduleReplays } from './replaySchedule';
export type { ReplayKind, ReplayMoment, ReplayWindow } from './replaySchedule';

export { actionTrackOf, findReception, makeTrackLookup, rosterFromFrames } from './trackLookup';

export type { ViewerMatch, ViewerRosterPlayer } from './buildMatch';
export { generateDemoMatch } from './demoMatch';
export { simulateMatchFromTeams } from './realMatch';
export type { TeamSimData } from './realMatch';
