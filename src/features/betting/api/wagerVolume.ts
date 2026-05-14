// ── betting/api/wagerVolume.ts ───────────────────────────────────────────────
//
// Thin DB layer for the live wager-volume widget.  Fetches pre-aggregated
// rows from the public `wager_volume_v` view (one row per
// (match_id, team_choice)) and hands them to the pure summariser in
// `logic/wagerVolume.ts`.
//
// WHY THROUGH A VIEW — not the wagers table directly
//   `wagers.wagers_select_own` RLS restricts SELECTs to
//   `auth.uid() = user_id`.  Querying the table from the page would mean:
//     • Anonymous users → 0 rows back, always "market silent"
//     • Signed-in users → only their own bets, mislabelled as the market
//   Aggregating in a view that runs as the view owner (RLS-exempt
//   postgres role) and exposes only match-level totals — no user_id, no
//   individual bet rows — leaks no per-user information while making the
//   match-wide totals public.  Migration 0017 creates the view + grants.
//
// WHY ALL STATUSES (not just 'open')
//   The widget shows market sentiment around the fixture as a whole.
//   Settled wagers (won/lost) were placed BEFORE settlement and represent
//   committed sentiment that should still count toward "the room leaned X."
//   The view aggregates over every status; this API does not filter.
//
// FAILURE POLICY
//   Returns EMPTY_SUMMARY on error rather than throwing.  The volume
//   widget is enriching content; a Supabase blip must never block the
//   match page from rendering.

import type { IslSupabaseClient } from '@shared/supabase/client';
import {
  summariseFromViewRows,
  type WagerVolumeViewRow,
  type WagerVolumeSummary,
} from '../logic/wagerVolume';

// TYPE ESCAPE HATCH — see other api/* modules for the pattern explanation.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

/**
 * Empty summary returned on error or when no wagers exist for a match.
 * Keeps the call-site type stable so callers don't have to null-check.
 */
const EMPTY_SUMMARY: WagerVolumeSummary = {
  totalWagers: 0,
  totalStake:  0,
  home: { stake: 0, percent: 0, count: 0 },
  draw: { stake: 0, percent: 0, count: 0 },
  away: { stake: 0, percent: 0, count: 0 },
  hasSignal: false,
};

/** Valid team_choice strings the view may return. */
const VALID_TEAM_CHOICES = new Set(['home', 'draw', 'away']);

/**
 * Fetch the wager volume for a match via the public `wager_volume_v` view.
 * The view returns 0–3 rows (one per team_choice that has at least one
 * bet); we filter to the requested match and summarise.
 *
 * @param db       Injected Supabase client.
 * @param matchId  The match UUID.
 * @returns        WagerVolumeSummary, or EMPTY_SUMMARY on error / no rows.
 */
export async function getWagerVolumeForMatch(
  db: IslSupabaseClient,
  matchId: string,
): Promise<WagerVolumeSummary> {
  const { data, error } = await (db as AnyDb) // CAST:wager_volume_v
    .from('wager_volume_v')
    .select('team_choice, total_stake, bet_count')
    .eq('match_id', matchId);

  if (error) {
    console.warn(`[getWagerVolumeForMatch] failed for match=${matchId}:`, error.message);
    return EMPTY_SUMMARY;
  }

  // Normalise the view's nullable columns into the pure-logic shape.
  // PostgreSQL marks every view column nullable by default; we drop
  // rows where the discriminant is null or unknown rather than treating
  // them as 'home'.  Defensive — should never happen given the CHECK
  // constraint on wagers.team_choice.
  const rows: WagerVolumeViewRow[] = (data ?? [])
    .filter((r: { team_choice: string | null }) =>
      r.team_choice != null && VALID_TEAM_CHOICES.has(r.team_choice),
    )
    .map((r: { team_choice: string; total_stake: number | null; bet_count: number | null }) => ({
      team_choice: r.team_choice as 'home' | 'draw' | 'away',
      total_stake: r.total_stake ?? 0,
      bet_count:   r.bet_count   ?? 0,
    }));

  return summariseFromViewRows(rows);
}

