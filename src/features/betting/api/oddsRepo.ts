// ── betting/api/oddsRepo.ts ──────────────────────────────────────────────────
// WHY: Supabase queries for the `match_odds` table — reading and writing
// computed decimal odds for matches. The odds are computed by the pure logic
// in logic/odds.ts and stored here so the UI can display them and wagers
// can snapshot them at placement time.

import type { IslSupabaseClient } from '@shared/supabase/client';
import type { MatchOdds } from '../types';
import { parseMatchOddsRow } from './oddsRepo.schema';

/**
 * Fetch computed odds for a single match. Returns null if odds haven't
 * been computed yet (match is too far in the future or hasn't been
 * processed by the odds generator).
 *
 * @param db       Injected Supabase client.
 * @param matchId  The match UUID.
 * @returns        MatchOdds row, or null if not found.
 */
export async function getMatchOdds(
  db: IslSupabaseClient,
  matchId: string,
): Promise<MatchOdds | null> {
  const { data, error } = await db
    .from('match_odds')
    .select('*')
    .eq('match_id', matchId)
    .single();

  if (error) return null;
  // Validate at the boundary (#386): DB drift fails loud → documented null
  // fallback rather than `undefined` odds leaking into the WagerWidget.
  return parseMatchOddsRow(data, 'getMatchOdds') as MatchOdds | null;
}

/**
 * Save or update computed odds for a match. Uses upsert with the match_id
 * PK for conflict resolution — re-computing odds before kickoff simply
 * overwrites the previous values.
 *
 * @param db        Injected Supabase client.
 * @param matchId   The match UUID.
 * @param homeOdds  Decimal odds for home win.
 * @param drawOdds  Decimal odds for draw.
 * @param awayOdds  Decimal odds for away win.
 * @returns         The upserted MatchOdds row, or null on error.
 */
export async function saveMatchOdds(
  db: IslSupabaseClient,
  matchId: string,
  homeOdds: number,
  drawOdds: number,
  awayOdds: number,
): Promise<MatchOdds | null> {
  const { data, error } = await db
    .from('match_odds')
    .upsert(
      {
        match_id: matchId,
        home_odds: homeOdds,
        draw_odds: drawOdds,
        away_odds: awayOdds,
        computed_at: new Date().toISOString(),
      },
      { onConflict: 'match_id' },
    )
    .select()
    .single();

  if (error) {
    console.warn('[saveMatchOdds] failed:', error.message);
    return null;
  }
  // Validate the upsert's returned row at the boundary (#386), same as the read.
  return parseMatchOddsRow(data, 'saveMatchOdds') as MatchOdds | null;
}
