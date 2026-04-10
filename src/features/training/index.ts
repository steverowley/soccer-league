// ── feature: training ───────────────────────────────────────────────────────
// WHY: The training minigame gives fans something to do *between* matches and
// creates a direct mechanical link between player engagement and player
// development. Every click is a vote cast for a specific player's growth —
// mirroring the collective-agency theme of the broader game.
//
// Mechanics (from the Notion plan):
//   - Clicker between matches: each click adds XP to the chosen player.
//   - XP converts to small stat bumps stored in `player_training_log`.
//   - Rate-limited via `logic/cooldown.ts` to prevent trivial farming.
//   - Stat bumps are small enough that no single fan can unilaterally boost a
//     player to godhood — the community effect matters.
//
// Tables (created in Phase 6 migration 0007_training.sql):
//   - `player_training_log` (player_id, user_id, xp_added, stat_bumped, created_at)
//
// Layer breakdown:
//   - `logic/xpCurve.ts`  — pure function mapping total XP → stat bump thresholds.
//     No React, no Supabase; fully unit-tested.
//   - `logic/cooldown.ts` — pure function: given last-click timestamp + user
//     tier, returns whether a new click is allowed. Fully unit-tested.
//   - `api/trainingLog.ts` — Supabase reads/writes for the append-only log.
//   - `ui/TrainingPage.tsx` / `ui/ClickerWidget.tsx` — React components (TODO).
//
// STATUS: Phase 6 complete — curve + cooldown + log API. UI deferred.

// ── Types ──────────────────────────────────────────────────────────────────
export type {
  TrainingStat,
  TrainingLogEntry,
  ClickResult,
  CooldownResult,
} from './types';

// ── Logic (pure TS) ────────────────────────────────────────────────────────
export {
  XP_PER_CLICK,
  BASE_XP_COST,
  CURVE_MULTIPLIER,
  STAT_ROTATION,
  xpRequiredForBump,
  bumpsEarned,
  statForBump,
  applyClick,
  xpUntilNextBump,
} from './logic/xpCurve';

export {
  DEFAULT_COOLDOWN_MS,
  SESSION_MAX_CLICKS,
  SESSION_WINDOW_MS,
  canClick,
  withinSessionCap,
  evaluateClick,
} from './logic/cooldown';

// ── API (Supabase queries) ─────────────────────────────────────────────────
export {
  getPlayerLifetimeXp,
  getRecentClickTimestamps,
  recordClick,
  getPlayerTrainingLog,
} from './api/trainingLog';

export type { RecordClickResult } from './api/trainingLog';
