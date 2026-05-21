// ── features/betting/api/wagerLeaderboard.ts ────────────────────────────────
// Read helper for the `wager_leaderboard` SQL view defined in
// migration 0004_betting.sql.  The view aggregates wager outcomes per
// user without exposing individual bets (RLS on `wagers` already keeps
// rows owner-scoped; the view rolls up the totals so we can show a
// "who's winning" board without leaking who bet on what).
//
// WHY HERE
//   The view is owned by the betting feature.  This helper keeps the
//   data path through `features/betting/api/`, matching the layer
//   boundary defined in CLAUDE.md (api/ owns Supabase + Zod, never UI).
//
// FAILURE POLICY
//   Best-effort.  On error / empty, returns [].  Caller renders an
//   empty-state.  Throwing here would force every consumer to wrap in
//   try/catch — a worse default for a leaderboard surface.

import { z } from 'zod';

import type { IslSupabaseClient } from '@shared/supabase/client';
import type { WagerLeaderboardEntry } from '../types';

// ── Tuning constants ───────────────────────────────────────────────────────

/**
 * Default board depth.
 *
 * MECHANICAL EFFECT: 50 covers the "page" surface for the /leaderboards
 * route — deep enough to show the long-tail middle and casual bettors,
 * shallow enough to fit one screen with minimal scroll on desktop.
 * Callers can override per render (e.g. a homepage widget that wants
 * just the top 5).
 */
const DEFAULT_LIMIT = 50;

// ── Zod schema ─────────────────────────────────────────────────────────────
// Mirrors the WagerLeaderboardEntry shape declared in features/betting/types.ts.
// Runtime validation prevents a view-schema change (e.g. a new int column
// rewritten as nullable) from silently producing NaN totals in the UI.

const WagerLeaderboardEntrySchema = z.object({
  user_id: z.string().uuid(),
  username: z.string(),
  favourite_team_id: z.string().nullable(),
  total_bets: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  total_staked: z.number().int().nonnegative(),
  total_won: z.number().int().nonnegative(),
  net_profit: z.number().int(),
});

// ── Read helper ────────────────────────────────────────────────────────────

/**
 * Fetch the top-N wager leaderboard rows, sorted by net_profit DESC.
 *
 * Sorts by `net_profit` (positive = winners; negative = degenerates)
 * rather than `total_won` so a high-volume bettor with poor returns
 * doesn't outrank a low-volume bettor with a stellar hit rate.  The
 * board is a "who's making money" surface, not a "who plays most"
 * surface.
 *
 * @param db      Injected Supabase client (anon allowed; the view grants
 *                SELECT to anon + authenticated per migration 0004).
 * @param limit   Max rows.  Defaults to DEFAULT_LIMIT (50).
 * @returns       Validated rows.  Empty array on error / no data.
 */
export async function getWagerLeaderboard(
  db: IslSupabaseClient,
  limit: number = DEFAULT_LIMIT,
): Promise<WagerLeaderboardEntry[]> {
  const { data, error } = await db
    .from('wager_leaderboard')
    .select('*')
    // Sort by net profit so the board shows winners up top.  Tiebreaker
    // on total_won surfaces high-volume earners above coin-flip bettors
    // with identical net profit.
    .order('net_profit', { ascending: false })
    .order('total_won', { ascending: false })
    .limit(limit);

  if (error) {
    console.warn('[getWagerLeaderboard] failed:', error.message);
    return [];
  }

  // Validate row-by-row; drop the bad ones rather than failing the whole
  // board on a single schema drift.
  const validated: WagerLeaderboardEntry[] = [];
  for (const row of data ?? []) {
    const parsed = WagerLeaderboardEntrySchema.safeParse(row);
    if (parsed.success) {
      validated.push(parsed.data as WagerLeaderboardEntry);
    } else {
      console.warn(
        '[getWagerLeaderboard] dropped invalid row:',
        parsed.error.message,
      );
    }
  }
  return validated;
}
