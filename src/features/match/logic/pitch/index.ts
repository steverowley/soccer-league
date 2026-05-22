// ── features/match/logic/pitch/index.ts ─────────────────────────────────────
// Internal barrel for the pitch logic modules.  Lets sibling UI code
// import via `import { initPitchState } from '../../logic/pitch'`
// rather than reaching into individual files — keeps the relative path
// stable when the internal layout shifts.
//
// The feature-level barrel (`src/features/match/index.ts`) still owns
// the public surface; this file is intra-feature plumbing only.

export {
  FORMATIONS,
  getFormationSlots,
  isFormationKey,
} from './formations';
export type {
  FormationKey,
  PitchPoint,
  Side,
} from './formations';

export {
  ARCHETYPES,
  eventToArchetype,
  listMappedEventTypes,
} from './archetypes';
export type { Archetype } from './archetypes';

export {
  IDLE_DRIFT_EPSILON,
  IDLE_DRIFT_RATE,
  idleDriftStep,
  initPitchState,
} from './pitchState';
export type {
  BallDot,
  PitchPhase,
  PitchState,
  PlayerDot,
} from './pitchState';

// ── Choreographer (issue isl-lfo) ───────────────────────────────────────
// Pure archetype → keyframe reducer + deterministic RNG helpers.  The
// hook layer (ui/pitch/useChoreographyQueue.ts) consumes these.
export {
  ARCHETYPE_BUDGET_MS,
  choreographArchetype,
  eventSeed,
  mulberry32,
} from './choreographer';
export type {
  ChoreographyPayload,
  Keyframe,
} from './choreographer';
