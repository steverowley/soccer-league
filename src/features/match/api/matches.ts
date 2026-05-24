// ── features/match/api/matches.ts ─────────────────────────────────────────
// First slice of #387 — dissolving `src/lib/supabase.ts`.
//
// WHY
// ───
// The 815-LOC `src/lib/supabase.ts` is the DI escape hatch every page
// imports from. Each function inside it uses the module-singleton
// `supabase` client directly, bypassing the SupabaseProvider context
// the rest of the app uses for dependency injection. Engineering
// principle 6 (CLAUDE.md) forbids the pattern.
//
// This file holds the dissolution's first extraction: `getMatch`,
// which was used only by `src/pages/MatchDetail.tsx`. The new version
// takes the typed Supabase client as a `db` parameter so the consumer
// passes the one it got from `useSupabase()`.
//
// SHAPE
// ─────
// The function signature mirrors the original except for the leading
// `db` argument. Return shape is preserved — MatchDetail's local
// `Match` interface continues to narrow the joined row. We keep the
// loose `any`-like return for now because the nested-select shape is
// wide and #386 (Zod boundary schemas) is the right place to lock it
// down, not here.

import type { IslSupabaseClient } from '@shared/supabase/client';

// ── getMatch ──────────────────────────────────────────────────────────────

/**
 * Fetch a single match by id with the team / competition / lineup /
 * match-player-stats joins the MatchDetail page renders.
 *
 * Migrated from `src/lib/supabase.ts` (PR #387 slice 1). The select
 * shape is byte-identical to the original so MatchDetail's local
 * `Match` type narrowing keeps working without prop edits.
 *
 * @param db       Injected Supabase client (via `useSupabase()`).
 * @param matchId  UUID of the target match.
 * @returns        The joined match row. Throws on Supabase error so
 *                 the caller's existing .catch() error handler fires
 *                 unchanged — preserves the previous lib-singleton
 *                 contract.
 */
export async function getMatch(db: IslSupabaseClient, matchId: string) {
  const { data, error } = await db
    .from('matches')
    .select(
      `
      *,
      competitions (id, name, type, format),
      home_team:teams!matches_home_team_id_fkey (
        *,
        managers (id, name, preferred_formation, style),
        players (id, name, position, starter, jersey_number, overall_rating)
      ),
      away_team:teams!matches_away_team_id_fkey (
        *,
        managers (id, name, preferred_formation, style),
        players (id, name, position, starter, jersey_number, overall_rating)
      ),
      match_player_stats (
        *,
        players (id, name, position, overall_rating)
      )
    `,
    )
    .eq('id', matchId)
    .single();
  if (error) throw error;
  return data;
}
