// ── training/api/trainingLog.ts ──────────────────────────────────────────────
// WHY: Supabase queries for the training feature — recording clicks,
// reading a player's lifetime XP, and fetching a user's recent click
// history so the cooldown/session-cap logic has something to evaluate.
//
// All queries take an injected Supabase client so tests can inject fakes.
//
// Tables used (created by 0007_training.sql, not yet in database.ts):
//   - player_training_log (read/write — append-only log)
//
// All casts marked CAST:training for grep-and-remove after database.ts regen.

import type { IslSupabaseClient } from '@shared/supabase/client';
import type { TrainingLogEntry, TrainingStat } from '../types';
import { applyClick, XP_PER_CLICK } from '../logic/xpCurve';
import { evaluateClick } from '../logic/cooldown';

// TYPE ESCAPE HATCH — player_training_log is not yet in generated
// database.ts. All uses are marked with CAST:training so we can grep and
// remove them once the typed client is regenerated.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

// ── Read: lifetime XP for a player ──────────────────────────────────────────

/**
 * Compute a player's lifetime XP total by summing every xp_added row in
 * their training log. This is the canonical source of truth for "how
 * much has this player been trained?" — we intentionally do NOT
 * denormalise a cached total onto the players table, because the log is
 * append-only and cheap to re-aggregate on demand.
 *
 * @param db        Injected Supabase client.
 * @param playerId  The player's UUID.
 * @returns         Cumulative XP across all time. 0 if the player has
 *                  never been trained or an error occurred.
 */
export async function getPlayerLifetimeXp(
  db: IslSupabaseClient,
  playerId: string,
): Promise<number> {
  const { data, error } = await (db as AnyDb) // CAST:training
    .from('player_training_log')
    .select('xp_added')
    .eq('player_id', playerId);

  if (error) {
    console.warn('[getPlayerLifetimeXp] failed:', error.message);
    return 0;
  }

  // Sum xp_added across all rows. Defensive coerce-to-number in case a
  // row somehow slips through with an unexpected type.
  const rows = (data ?? []) as Array<{ xp_added: number }>;
  return rows.reduce((sum, r) => sum + (Number(r.xp_added) || 0), 0);
}

// ── Read: a user's recent click timestamps (for cooldown checks) ────────────

/**
 * Fetch the timestamps of a user's most recent clicks, newest first. Used
 * to evaluate the rolling-window session cap and the per-click cooldown.
 *
 * We only fetch up to SESSION_MAX_CLICKS rows because that's the most the
 * cooldown logic needs — anything older than the rolling window is
 * irrelevant and only bloats payload size.
 *
 * @param db      Injected Supabase client.
 * @param userId  The user's UUID.
 * @param limit   Max rows to fetch. Defaults to 500 (SESSION_MAX_CLICKS).
 * @returns       Array of timestamps in ms-since-epoch, newest first.
 */
export async function getRecentClickTimestamps(
  db: IslSupabaseClient,
  userId: string,
  limit: number = 500,
): Promise<number[]> {
  const { data, error } = await (db as AnyDb) // CAST:training
    .from('player_training_log')
    .select('created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.warn('[getRecentClickTimestamps] failed:', error.message);
    return [];
  }

  // Convert ISO strings to ms for the pure cooldown logic. Rows with
  // unparseable timestamps are dropped — they're corrupt data, not
  // actionable.
  const rows = (data ?? []) as Array<{ created_at: string }>;
  const timestamps: number[] = [];
  for (const r of rows) {
    const ms = Date.parse(r.created_at);
    if (!Number.isNaN(ms)) timestamps.push(ms);
  }
  return timestamps;
}

// ── Write: record a click ───────────────────────────────────────────────────

/**
 * Result shape returned by `recordClick()`. Tells the caller whether the
 * click actually landed, what (if anything) it bumped, and why it was
 * rejected when it wasn't allowed.
 */
export interface RecordClickResult {
  /** True if the click was written to the log; false if blocked or errored. */
  success: boolean;
  /** Reason the click was blocked. Only present on failure. */
  reason?: 'cooldown' | 'session_cap' | 'db_error' | 'not_allowed';
  /** Ms to wait before the next click is allowed (for the UI countdown). */
  msRemaining?: number;
  /** The stat bumped, if this click crossed a threshold. */
  statBumped?: TrainingStat | null;
  /** The player's new lifetime XP total after this click. */
  newTotalXp?: number;
}

/**
 * Record a single training click. Runs the cooldown/session-cap check,
 * computes whether the click crosses a stat threshold, and writes an
 * append-only row to `player_training_log`.
 *
 * The DB RLS policy guarantees a user can only insert rows as themselves
 * (`auth.uid() = user_id`), but we also enforce the cooldown client-side
 * so the UI can render a countdown instead of showing a hard error.
 *
 * Edge cases:
 *   - If the DB insert fails for any reason, we return success=false and
 *     do NOT retry — the caller can show a toast and the user can click
 *     again. Better than silently swallowing.
 *   - We fetch lifetime XP fresh on every click so concurrent trainers
 *     compose correctly. There's still a tiny race window between the
 *     SELECT and the INSERT, but at XP_PER_CLICK granularity the worst
 *     case is an off-by-one on a stat bump — acceptable.
 *
 * @param db        Injected Supabase client.
 * @param userId    The clicking user's UUID.
 * @param playerId  The target player's UUID.
 * @param nowMs     Current time in ms (injected for test determinism).
 * @returns         RecordClickResult describing what happened.
 */
export async function recordClick(
  db: IslSupabaseClient,
  userId: string,
  playerId: string,
  nowMs: number = Date.now(),
): Promise<RecordClickResult> {
  // 1. Fetch the user's recent click history for cooldown evaluation.
  //    We issue these two reads in parallel — neither depends on the other.
  const [history, lifetimeXp] = await Promise.all([
    getRecentClickTimestamps(db, userId),
    getPlayerLifetimeXp(db, playerId),
  ]);

  const lastClickMs = history.length > 0 ? (history[0] ?? null) : null;

  // 2. Gate on cooldown + session cap BEFORE touching the DB. Saves a
  //    round-trip on the common spam-click case.
  const verdict = evaluateClick(lastClickMs, history, nowMs);
  if (!verdict.allowed) {
    return {
      success: false,
      reason: verdict.reason === 'ok' ? 'not_allowed' : verdict.reason,
      msRemaining: verdict.msRemaining,
    };
  }

  // 3. Compute whether this click crosses a stat threshold. This is pure
  //    logic — same inputs, same outputs — so we can log the decision
  //    alongside the row for auditability.
  const clickResult = applyClick(lifetimeXp, XP_PER_CLICK);

  // 4. Insert the row. Append-only; we never update training log rows.
  const { error } = await (db as AnyDb) // CAST:training
    .from('player_training_log')
    .insert({
      user_id: userId,
      player_id: playerId,
      xp_added: XP_PER_CLICK,
      stat_bumped: clickResult.statBumped,
    });

  if (error) {
    console.warn('[recordClick] insert failed:', error.message);
    return { success: false, reason: 'db_error' };
  }

  return {
    success: true,
    statBumped: clickResult.statBumped,
    newTotalXp: clickResult.newTotalXp,
  };
}

// ── Read: full training log entries for a player (for detail views) ─────────

/**
 * Fetch the most recent training log entries for a specific player.
 * Used on the PlayerDetail page to render a "recent training activity"
 * feed and to count total bumps received per stat.
 *
 * @param db        Injected Supabase client.
 * @param playerId  The player's UUID.
 * @param limit     Max rows to return. Defaults to 100.
 * @returns         Array of TrainingLogEntry rows, newest first.
 */
export async function getPlayerTrainingLog(
  db: IslSupabaseClient,
  playerId: string,
  limit: number = 100,
): Promise<TrainingLogEntry[]> {
  const { data, error } = await (db as AnyDb) // CAST:training
    .from('player_training_log')
    .select('*')
    .eq('player_id', playerId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.warn('[getPlayerTrainingLog] failed:', error.message);
    return [];
  }
  return (data ?? []) as TrainingLogEntry[];
}
