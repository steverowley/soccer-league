// ── betting/api/wagerVolume.ts ───────────────────────────────────────────────
//
// Thin DB layer for the live wager-volume widget.  Fetches every wager row
// for a match (any status) and hands them to the pure aggregator in
// `logic/wagerVolume.ts`, which computes the per-side breakdown.
//
// WHY ALL STATUSES (not just 'open')
//   The widget shows market sentiment around the fixture as a whole — past,
//   present, and projected.  Settled wagers (won/lost) should still count
//   towards "the room leaned X" because they were placed before settlement
//   and represent committed sentiment.  Filtering to 'open' would erase the
//   history of a finished match the moment its wagers settled.
//
// FAILURE POLICY
//   Returns an empty summary on error rather than throwing.  The volume
//   widget is enriching content; a Supabase blip must never block the
//   match page from rendering.

import type { IslSupabaseClient } from '@shared/supabase/client';
import {
  summariseMatchWagers,
  type AggregatableWager,
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

/**
 * Fetch every wager for a match and return the per-side volume summary.
 * One round-trip; aggregation happens client-side via summariseMatchWagers.
 *
 * @param db       Injected Supabase client.
 * @param matchId  The match UUID.
 * @returns        WagerVolumeSummary, or EMPTY_SUMMARY on error / no rows.
 */
export async function getWagerVolumeForMatch(
  db: IslSupabaseClient,
  matchId: string,
): Promise<WagerVolumeSummary> {
  const { data, error } = await (db as AnyDb) // CAST:wagers
    .from('wagers')
    .select('team_choice, stake')
    .eq('match_id', matchId);

  if (error) {
    console.warn(`[getWagerVolumeForMatch] failed for match=${matchId}:`, error.message);
    return EMPTY_SUMMARY;
  }
  return summariseMatchWagers((data ?? []) as AggregatableWager[]);
}
