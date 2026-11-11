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

export { FULL_RUN_MPS, STANDING, STRIDE_MIN_RUN, advanceStride, footfall, runAmount } from './animation';
export type { Gait } from './animation';

export { ARM_HOLDS, FLOPPY, REST_ANGLE, REST_BEND, holdArms, kickArms, newArms, newDrive, stepArms, stepJolt } from './arms';
export type { Arm, ArmDrive, ArmHold, ArmPhysics, ArmState } from './arms';

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
  HAIR_TONES,
  HEAD_SCALE,
  HEAD_TONES,
  LEG_SCALE,
  QUOO_TONES,
  SHOULDER_SCALE,
  SPECIES_KEYS,
  hashStringToSeed,
  makeAppearance,
  mulberry32,
} from './appearance';
export type { Appearance, HairStyle, Species } from './appearance';

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
  LegPose,
  Overlay,
  PoseKind,
} from './actionAnim';

export {
  EVENT_LABEL,
  EVENT_STRIP_ROWS,
  buildEventLog,
  eventRowText,
  eventRowsAt,
  replayClock,
  replayMinute,
} from './eventLog';
export type { EventLogLookup, EventRow, EventRowKind } from './eventLog';

export { SHOT_BEFORE_DIVE_SEC, isShotKick, shotBefore } from './shots';

export { liveRate, replayAt, scheduleReplays } from './replaySchedule';
export type { ReplayKind, ReplayMoment, ReplayWindow } from './replaySchedule';

export { actionTrackOf, makeTrackLookup, rosterFromFrames } from './trackLookup';

export type { ViewerMatch, ViewerRosterPlayer } from './buildMatch';
export { generateDemoMatch } from './demoMatch';
export { simulateMatchFromTeams } from './realMatch';
export type { TeamSimData } from './realMatch';
