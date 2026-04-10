// ── training/logic/cooldown.ts ───────────────────────────────────────────────
// WHY: Rate-limits the training clicker so fans can't farm infinite XP in a
// tight loop. The cooldown also creates *temporal* engagement: a player
// who visits daily accumulates more than one who binges once a week,
// reinforcing the habit-forming loop the social experiment depends on.
//
// DESIGN CHOICES:
//   - Cooldown is per-user, NOT per-player. A fan can click Team A's striker
//     then immediately click Team B's keeper — they just can't spam the same
//     button. This lets fans distribute effort across the roster without
//     artificial friction.
//   - Cooldown is short (1.5 seconds) by default — long enough to prevent
//     accidental double-clicks from registering as two clicks, short enough
//     that a committed fan can train at a satisfying rhythm.
//   - Cooldown is pure: given a last-click timestamp and "now", it returns
//     a deterministic answer. No Date.now() inside the function so tests
//     can inject time.
//
// WHY NOT USE A DB LOCK? Because the DB round-trip is itself slower than
// the cooldown. We enforce optimistically in the UI (disable the button),
// validate in application code before inserting, and let the append-only
// log be the final audit trail. Cheating clients can bypass this; they
// gain marginal advantage at the cost of looking obvious in the log.

import type { CooldownResult } from '../types';

// ── Tuning constants ────────────────────────────────────────────────────────

/**
 * Default cooldown between consecutive clicks *by the same user*, in
 * milliseconds. 1.5 seconds is:
 *   - Long enough to block double-click accidents from a twitchy mouse.
 *   - Short enough to feel like a real clicker game, not a chore.
 *   - Slow enough that a 90-minute match window caps at ~3,600 clicks,
 *     giving a natural ceiling on per-session XP accumulation.
 */
export const DEFAULT_COOLDOWN_MS = 1_500;

/**
 * Absolute maximum clicks per "session" (rolling window). A hard cap on top
 * of the per-click cooldown to prevent AFK auto-clickers from monopolising
 * the leaderboard. See `withinSessionCap()`.
 */
export const SESSION_MAX_CLICKS = 500;

/**
 * Rolling session window in milliseconds. Clicks inside this window count
 * toward SESSION_MAX_CLICKS. One hour is chosen so a dedicated fan can do
 * a focused training burst without hitting the ceiling, while a 24/7
 * auto-clicker bottoms out after ~8 hours.
 */
export const SESSION_WINDOW_MS = 60 * 60 * 1_000;

// ── Pure cooldown helpers ───────────────────────────────────────────────────

/**
 * Decide whether a user is allowed to click *right now*, given their
 * last-click timestamp. Returns the delta so the UI can render a countdown.
 *
 * Edge cases:
 *   - First click ever (lastClickMs === null) is always allowed.
 *   - Clock skew (lastClickMs > nowMs) is treated as allowed — better to
 *     forgive than to block a real fan due to a flaky clock.
 *   - A custom cooldown can be passed in (for future "patron tier"
 *     unlocks that shorten the wait).
 *
 * @param lastClickMs  Timestamp of the user's most recent click, or null
 *                     if they've never clicked before.
 * @param nowMs        Current time in milliseconds since epoch. Injected
 *                     (not Date.now() inside the function) so tests are
 *                     deterministic.
 * @param cooldownMs   Required gap between clicks. Defaults to
 *                     DEFAULT_COOLDOWN_MS.
 * @returns            CooldownResult with `allowed` and `msRemaining`.
 */
export function canClick(
  lastClickMs: number | null,
  nowMs: number,
  cooldownMs: number = DEFAULT_COOLDOWN_MS,
): CooldownResult {
  // Guard against garbage input. Treat "never clicked" as allowed.
  if (lastClickMs === null || !Number.isFinite(lastClickMs)) {
    return { allowed: true, msRemaining: 0 };
  }

  // Clock-skew forgiveness: a future last-click timestamp shouldn't block
  // a legit fan. Allow the click and reset their cooldown from "now".
  if (lastClickMs > nowMs) {
    return { allowed: true, msRemaining: 0 };
  }

  const elapsed = nowMs - lastClickMs;
  if (elapsed >= cooldownMs) {
    return { allowed: true, msRemaining: 0 };
  }

  return { allowed: false, msRemaining: cooldownMs - elapsed };
}

/**
 * Check whether the user has hit the rolling session cap. Call this in
 * addition to `canClick()` before allowing a click through — the cooldown
 * handles spam, this handles AFK farming.
 *
 * @param recentClickTimestamps  Array of click timestamps (ms since epoch),
 *                               in any order, ideally the user's most
 *                               recent ~500 clicks.
 * @param nowMs                  Current time in ms (injected for tests).
 * @param maxClicks              Hard ceiling on clicks in the window.
 *                               Defaults to SESSION_MAX_CLICKS.
 * @param windowMs               Rolling window length in ms. Defaults to
 *                               SESSION_WINDOW_MS.
 * @returns                      True if the user can still click, false if
 *                               they've hit the session cap.
 */
export function withinSessionCap(
  recentClickTimestamps: number[],
  nowMs: number,
  maxClicks: number = SESSION_MAX_CLICKS,
  windowMs: number = SESSION_WINDOW_MS,
): boolean {
  if (recentClickTimestamps.length === 0) return true;

  // Count how many clicks fall within the rolling window. We don't need to
  // sort — a simple filter is O(n) and n is bounded by maxClicks in
  // practice (the API layer only fetches the most recent 500).
  const windowStart = nowMs - windowMs;
  let countInWindow = 0;
  for (const ts of recentClickTimestamps) {
    if (Number.isFinite(ts) && ts >= windowStart && ts <= nowMs) {
      countInWindow += 1;
      // Early exit: we already know we're capped, no need to keep counting.
      if (countInWindow >= maxClicks) return false;
    }
  }
  return countInWindow < maxClicks;
}

/**
 * Convenience wrapper that runs both the per-click cooldown check and the
 * rolling session cap check in one call. Returns the combined verdict plus
 * a human-readable reason for the UI to display when a click is blocked.
 *
 * @param lastClickMs            Timestamp of the last click, or null.
 * @param recentClickTimestamps  Array of recent click timestamps.
 * @param nowMs                  Current time in ms (injected).
 * @returns                      Object with `allowed`, `msRemaining`, and a
 *                               `reason` string when blocked.
 */
export function evaluateClick(
  lastClickMs: number | null,
  recentClickTimestamps: number[],
  nowMs: number,
): CooldownResult & { reason: 'ok' | 'cooldown' | 'session_cap' } {
  // 1. Short-interval spam guard first — cheapest check, most common block.
  const cd = canClick(lastClickMs, nowMs);
  if (!cd.allowed) {
    return { ...cd, reason: 'cooldown' };
  }

  // 2. Rolling session cap. Rarer but harder to dodge.
  if (!withinSessionCap(recentClickTimestamps, nowMs)) {
    return { allowed: false, msRemaining: 0, reason: 'session_cap' };
  }

  return { allowed: true, msRemaining: 0, reason: 'ok' };
}
