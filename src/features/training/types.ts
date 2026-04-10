// ── training/types.ts ────────────────────────────────────────────────────────
// WHY: Shared types for the training feature. Mirrors the player_training_log
// table shape plus pure-logic helper types used by xpCurve and cooldown.
//
// Kept narrow on purpose — if a field isn't consumed outside this feature,
// it doesn't belong here.

/**
 * Which of the five core stats a training click can bump. Matches the
 * CHECK constraint on `player_training_log.stat_bumped` in 0007_training.sql
 * and the camelCase columns consumed by `normalizeTeamForEngine()`.
 */
export type TrainingStat =
  | 'attacking'
  | 'defending'
  | 'mental'
  | 'athletic'
  | 'technical';

/**
 * A single row in `player_training_log`. Append-only — we never update or
 * delete rows, so the log also acts as an audit trail.
 */
export interface TrainingLogEntry {
  id: string;
  player_id: string;
  user_id: string;
  xp_added: number;
  /** Null when the click only accumulated XP without triggering a bump. */
  stat_bumped: TrainingStat | null;
  created_at: string;
}

/**
 * Result of a single click, returned by `applyClick()`. Tells the UI whether
 * this click crossed a stat threshold and — if so — which stat was bumped.
 */
export interface ClickResult {
  /** New cumulative XP total for this player after the click. */
  newTotalXp: number;
  /** The stat bumped by this click, if any. */
  statBumped: TrainingStat | null;
  /** Total stat bumps this player has received across their lifetime. */
  totalBumps: number;
}

/**
 * Cooldown check result. Returned by `canClick()`. If `allowed === false`,
 * `msRemaining` tells the UI how long until the next click is permitted.
 */
export interface CooldownResult {
  allowed: boolean;
  /** Milliseconds until the next click is allowed. 0 when allowed. */
  msRemaining: number;
}
