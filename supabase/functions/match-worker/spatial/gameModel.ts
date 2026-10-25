// ── features/match/logic/spatial/gameModel.ts ────────────────────────────────
// The manager's game model (docs/phases-of-play.md section 3.2): the coaching
// choices a manager makes for each phase of play.  The ENGINE owns the phase
// machine (phase.ts); the MANAGER owns these choices.  They are universe data:
// stored on the manager entity (`entities.meta.game_model`), seeded per
// manager from his profile, and handed to the engine through
// `SpatialTeamInput.gameModel`.
//
// Every manager starts from his style's preset; his stored model overrides
// any subset of keys.  parseGameModel validates the stored JSON: unknown keys
// are ignored, a bad value falls back to the preset's.  A game model only
// moves where players WANT to be and which jobs they value; it never decides
// an outcome.
//
// This module is duplicated byte-for-byte into the match-worker, like the
// rest of spatial/.

/** In-possession structure: players in the back line, the pivot, the front. */
export type BuildUpShape = '2-3-5' | '3-2-5' | '4-2-4' | '3-1-6';
/** What the full-backs do while the side has the ball. */
export type FullBackRole = 'overlap' | 'invert' | 'stay';
/** How the rest defence is staggered: back line + screen. */
export type RestShape = '2+2' | '3+1' | '2+3' | '3+2' | '4+2' | '3+3' | '4+1' | '2+4';
export type Width = 'wide' | 'balanced' | 'narrow';
export type Tempo = 'patient' | 'vertical' | 'direct';
export type OnRegain = 'counter' | 'secure';
export type OnLoss = 'counterpress' | 'recover';
export type BlockHeight = 'high' | 'mid' | 'low';
export type PressTrigger = 'back_pass' | 'bad_touch' | 'wide' | 'always';
export type LineManagement = 'aggressive' | 'measured' | 'cautious';

/** One manager's coaching choices, per phase. */
export interface GameModel {
  /** Build-up and progression structure. */
  readonly buildUpShape: BuildUpShape;
  readonly fullBackRole: FullBackRole;
  /** Outfield players behind the ball in settled possession (3 to 7). */
  readonly restDefence: number;
  readonly restShape: RestShape;
  /** How far (m) from their own goal the centre-backs stand when the side is
   *  settled in the opponent's half. */
  readonly settledLineHeight: number;
  readonly width: Width;
  readonly tempo: Tempo;
  /** Attacking transition: commit runners now, or keep it and build again. */
  readonly onRegain: OnRegain;
  /** Defensive transition: swarm the ball, or drop into the block. */
  readonly onLoss: OnLoss;
  /** Counter-press: how many go for the ball, and for how long (s). */
  readonly counterpressPlayers: number;
  readonly counterpressSec: number;
  /** Default block out of possession. */
  readonly blockHeight: BlockHeight;
  /** When the block engages the ball. */
  readonly pressTriggers: readonly PressTrigger[];
  /** Block targets (m): back line to front line, and across. */
  readonly blockLength: number;
  readonly blockWidth: number;
  /** How hard the line steps up on a covered ball and drops on an uncovered one. */
  readonly lineManagement: LineManagement;
}

/** The eight league styles' presets (keyed by the exact `managers.style`). */
export const STYLE_PRESETS: Readonly<Record<string, GameModel>> = Object.freeze({
  Possession: {
    buildUpShape: '2-3-5', fullBackRole: 'invert', restDefence: 5, restShape: '2+3', settledLineHeight: 47,
    width: 'wide', tempo: 'patient', onRegain: 'secure', onLoss: 'counterpress', counterpressPlayers: 3, counterpressSec: 5,
    blockHeight: 'mid', pressTriggers: ['back_pass', 'bad_touch'], blockLength: 32, blockWidth: 38, lineManagement: 'measured',
  },
  'High Pressing': {
    buildUpShape: '3-2-5', fullBackRole: 'overlap', restDefence: 5, restShape: '3+2', settledLineHeight: 40,
    width: 'wide', tempo: 'vertical', onRegain: 'counter', onLoss: 'counterpress', counterpressPlayers: 4, counterpressSec: 6,
    blockHeight: 'high', pressTriggers: ['always'], blockLength: 30, blockWidth: 38, lineManagement: 'aggressive',
  },
  Aggressive: {
    buildUpShape: '3-2-5', fullBackRole: 'overlap', restDefence: 5, restShape: '3+2', settledLineHeight: 38,
    width: 'balanced', tempo: 'vertical', onRegain: 'counter', onLoss: 'counterpress', counterpressPlayers: 3, counterpressSec: 5,
    blockHeight: 'high', pressTriggers: ['back_pass', 'bad_touch', 'wide'], blockLength: 32, blockWidth: 40, lineManagement: 'aggressive',
  },
  Direct: {
    buildUpShape: '4-2-4', fullBackRole: 'stay', restDefence: 6, restShape: '4+2', settledLineHeight: 32,
    width: 'wide', tempo: 'direct', onRegain: 'counter', onLoss: 'recover', counterpressPlayers: 2, counterpressSec: 4,
    blockHeight: 'mid', pressTriggers: ['bad_touch', 'wide'], blockLength: 34, blockWidth: 42, lineManagement: 'measured',
  },
  Counterattacking: {
    buildUpShape: '4-2-4', fullBackRole: 'stay', restDefence: 6, restShape: '4+2', settledLineHeight: 30,
    width: 'balanced', tempo: 'vertical', onRegain: 'counter', onLoss: 'recover', counterpressPlayers: 1, counterpressSec: 3,
    blockHeight: 'low', pressTriggers: ['bad_touch'], blockLength: 30, blockWidth: 36, lineManagement: 'cautious',
  },
  Offensive: {
    buildUpShape: '3-1-6', fullBackRole: 'overlap', restDefence: 4, restShape: '3+1', settledLineHeight: 42,
    width: 'wide', tempo: 'vertical', onRegain: 'counter', onLoss: 'counterpress', counterpressPlayers: 3, counterpressSec: 5,
    blockHeight: 'high', pressTriggers: ['back_pass', 'bad_touch'], blockLength: 36, blockWidth: 44, lineManagement: 'aggressive',
  },
  Balanced: {
    buildUpShape: '3-2-5', fullBackRole: 'overlap', restDefence: 5, restShape: '3+2', settledLineHeight: 32,
    width: 'balanced', tempo: 'vertical', onRegain: 'counter', onLoss: 'counterpress', counterpressPlayers: 4, counterpressSec: 6,
    blockHeight: 'mid', pressTriggers: ['back_pass', 'bad_touch'], blockLength: 34, blockWidth: 40, lineManagement: 'measured',
  },
  Defensive: {
    buildUpShape: '4-2-4', fullBackRole: 'stay', restDefence: 6, restShape: '4+2', settledLineHeight: 28,
    width: 'narrow', tempo: 'patient', onRegain: 'secure', onLoss: 'recover', counterpressPlayers: 1, counterpressSec: 3,
    blockHeight: 'low', pressTriggers: ['bad_touch'], blockLength: 28, blockWidth: 34, lineManagement: 'cautious',
  },
});

/** The neutral model: Balanced.  Used for an unknown style and by the
 *  `gameModel` ablation (one neutral preset for both sides). */
export const NEUTRAL_GAME_MODEL: GameModel = STYLE_PRESETS['Balanced']!;

const ENUMS: Readonly<Record<string, readonly string[]>> = {
  buildUpShape: ['2-3-5', '3-2-5', '4-2-4', '3-1-6'],
  fullBackRole: ['overlap', 'invert', 'stay'],
  restShape: ['2+2', '3+1', '2+3', '3+2', '4+2', '3+3', '4+1', '2+4'],
  width: ['wide', 'balanced', 'narrow'],
  tempo: ['patient', 'vertical', 'direct'],
  onRegain: ['counter', 'secure'],
  onLoss: ['counterpress', 'recover'],
  blockHeight: ['high', 'mid', 'low'],
  lineManagement: ['aggressive', 'measured', 'cautious'],
};

const RANGES: Readonly<Record<string, readonly [number, number]>> = {
  restDefence: [3, 7],
  settledLineHeight: [20, 58],
  counterpressPlayers: [0, 6],
  counterpressSec: [0, 10],
  blockLength: [22, 45],
  blockWidth: [28, 52],
};

const TRIGGERS: readonly string[] = ['back_pass', 'bad_touch', 'wide', 'always'];

/** The preset for a `managers.style` string (Balanced when unknown). */
export function presetFor(style: string | null | undefined): GameModel {
  return STYLE_PRESETS[style ?? ''] ?? NEUTRAL_GAME_MODEL;
}

/**
 * Build a manager's game model: his style preset, overridden by whatever the
 * stored `meta.game_model` validly sets.  Unknown keys are ignored; a value of
 * the wrong type or out of range keeps the preset's value.
 *
 * @param style   `managers.style`.
 * @param stored  `entities.meta.game_model` (any JSON), or nothing.
 */
export function parseGameModel(style: string | null | undefined, stored?: unknown): GameModel {
  const base = presetFor(style);
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return base;
  const src = stored as Record<string, unknown>;
  const out: Record<string, unknown> = { ...base };
  for (const [k, allowed] of Object.entries(ENUMS)) {
    const v = src[k];
    if (typeof v === 'string' && allowed.includes(v)) out[k] = v;
  }
  for (const [k, [lo, hi]] of Object.entries(RANGES)) {
    const v = src[k];
    if (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi) out[k] = v;
  }
  const t = src['pressTriggers'];
  if (Array.isArray(t) && t.every((x) => typeof x === 'string' && TRIGGERS.includes(x))) {
    out['pressTriggers'] = [...new Set(t as string[])];
  }
  return out as unknown as GameModel;
}

/** The rest-defence split: [back line, screen].  The back count is kept from
 *  the shape and the screen fills the remaining count. */
export function restSplit(m: GameModel, count: number): [number, number] {
  const back = Math.max(1, Math.min(count, Number(m.restShape.split('+')[0])));
  return [back, Math.max(0, count - back)];
}

/** Players in the back line, pivot and front for a build-up shape. */
export function buildUpLines(shape: BuildUpShape): [number, number, number] {
  const [a, b, c] = shape.split('-').map(Number);
  return [a!, b!, c!];
}
