// ── features/admin/api/admin.ts ──────────────────────────────────────────────
// Supabase mutations powering the /admin testing tooling (Package 14).
//
// WHAT THIS MODULE OWNS
//   • `fastForwardScheduledMatches` — bumps the worker's effective clock by
//     subtracting hours from `matches.scheduled_at`.  This is the cheapest
//     way to make the worker pick a match up *now* without injecting a
//     side-channel clock service.
//   • `triggerSeasonEnactment` — wraps the existing `enactSeasonFocuses`
//     pipeline so the admin page can fire it manually without waiting for
//     the worker's normal "all league matches done" detection.
//
// WHAT IT DOES NOT DO
//   • No business logic — the season-completion rule lives in
//     features/match/logic/seasonLifecycle.ts.
//   • No allowlist enforcement — the route + UI gate that.  Server-side
//     enforcement still relies on RLS at the matches/seasons tables.
//   • No "skip to season end" — that's a separate concern handled by the
//     match worker simulating each due match in turn after a large
//     fast-forward.  Keeping the surface small avoids tempting an admin to
//     bypass the simulator entirely.

import type { IslSupabaseClient } from '@shared/supabase/client';

// TYPE ESCAPE HATCH — same pattern as betting/api/oddsRepo.ts (CAST:*).
// The `seasons.status` column from migration 0014 isn't yet in
// src/types/database.ts; the cast removes it from the strict typing path
// without disabling type-checks on the rest of the file.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * Milliseconds in one hour.  Centralised so the fast-forward arithmetic
 * uses a named constant instead of an inline `3_600_000` magic number.
 */
const MS_PER_HOUR = 3_600_000;

// ── Public types ─────────────────────────────────────────────────────────────

/**
 * Summary returned by `fastForwardScheduledMatches`.  Surfaces the matched
 * row count so the admin UI can confirm the action did something rather
 * than silently no-op when no scheduled matches exist.
 */
export interface FastForwardResult {
  /** How many scheduled rows had their `scheduled_at` shifted backwards. */
  matchesShifted: number;
  /** The hour offset applied — echoed back so the UI can label the toast. */
  hoursShifted:   number;
}

/**
 * Summary returned by `triggerSeasonEnactment`.  Mirrors the upstream
 * `SeasonEnactmentResult` shape but kept narrow here so admin UI doesn't
 * have to reach into the voting feature's internal types.
 */
export interface TriggerEnactmentResult {
  /** Number of (team, tier) focuses successfully enacted. */
  enacted:  number;
  /** Number of (team, tier) focuses skipped (already enacted, no votes, …). */
  skipped:  number;
}

// ── Fast-forward ─────────────────────────────────────────────────────────────

/**
 * Shift every scheduled match's `scheduled_at` backward by `hours`.
 *
 * The match worker already polls for `status='scheduled' AND scheduled_at <=
 * now()`, so subtracting from `scheduled_at` is functionally identical to
 * advancing the worker's wall clock — without any worker-side changes.
 *
 * Negative or zero `hours` is a no-op (safer than throwing): an admin who
 * accidentally types `-5` doesn't push fixtures into the future where they
 * disappear from the queue.
 *
 * @param db     Service-role client (RLS denies anon updates to matches).
 * @param hours  Positive number of hours to roll back.
 * @returns      The number of rows shifted plus the hours used.
 */
export async function fastForwardScheduledMatches(
  db:    IslSupabaseClient,
  hours: number,
): Promise<FastForwardResult> {
  if (!Number.isFinite(hours) || hours <= 0) {
    return { matchesShifted: 0, hoursShifted: 0 };
  }

  // ── Step 1: pull every scheduled row with a non-null scheduled_at ───────
  // We need the existing values to compute new timestamps client-side —
  // PostgREST has no `UPDATE … SET col = col - interval` shortcut without
  // an SQL function.  At ~250 rows per season the round trip is cheap.
  const { data: rows, error: readErr } = await (db as AnyDb)
    .from('matches')
    .select('id, scheduled_at')
    .eq('status', 'scheduled')
    .not('scheduled_at', 'is', null);

  if (readErr) {
    console.warn('[fastForwardScheduledMatches] read failed:', readErr.message);
    return { matchesShifted: 0, hoursShifted: hours };
  }

  const matches = (rows ?? []) as Array<{ id: string; scheduled_at: string }>;
  if (matches.length === 0) return { matchesShifted: 0, hoursShifted: hours };

  // ── Step 2: write each new value ───────────────────────────────────────
  // Per-row UPDATEs not a bulk one because PostgREST cannot `UPDATE …
  // FROM (VALUES …)` without an RPC.  At 250 fixtures × ~50 ms = 12.5 s
  // worst case — acceptable for a hand-fired admin button.
  const offsetMs = hours * MS_PER_HOUR;
  let shifted = 0;
  for (const m of matches) {
    const ts = Date.parse(m.scheduled_at);
    if (!Number.isFinite(ts)) continue;
    const next = new Date(ts - offsetMs).toISOString();
    const { error: writeErr } = await (db as AnyDb)
      .from('matches')
      .update({ scheduled_at: next })
      .eq('id', m.id);
    if (!writeErr) shifted++;
  }

  return { matchesShifted: shifted, hoursShifted: hours };
}

// ── Manual enactment ─────────────────────────────────────────────────────────

/**
 * Force-fire `enactSeasonFocuses` for the given season.
 *
 * The worker runs this automatically when a season's league phase finishes
 * (Package 13).  This admin-fired path is for two cases:
 *   1. Dev / test setups where the worker hasn't simulated all matches yet.
 *   2. Recovery from a transient failure that left a season stuck in
 *      `voting` after the worker's automatic transition succeeded but the
 *      enactment call itself errored.
 *
 * The function dynamically imports the voting feature's enactment API to
 * avoid a static cross-feature dependency at the barrel level — the admin
 * feature should never be a load-time blocker for the rest of the app.
 *
 * @param db        Service-role Supabase client.
 * @param seasonId  UUID of the season whose focuses should be enacted.
 * @returns         Counts of enacted vs skipped focuses.
 */
export async function triggerSeasonEnactment(
  db:        IslSupabaseClient,
  seasonId:  string,
): Promise<TriggerEnactmentResult> {
  // Lazy import: the admin feature is rarely used so we avoid pulling the
  // voting feature's full enactment graph into the main bundle on every
  // page load.  (Vite will still tree-shake unused enactment branches.)
  const { enactSeasonFocuses } = await import('@features/voting');
  const result = await enactSeasonFocuses(db, seasonId);
  return { enacted: result.enacted, skipped: result.skipped };
}
