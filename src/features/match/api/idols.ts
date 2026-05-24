// ── features/match/api/idols.ts ───────────────────────────────────────────
// Slice 6 of #387 — moves the idol-score reads out of src/lib/supabase.ts.
//
// Three reads against the `player_idol_score` view (created by migration
// 0020, refined by 0019/0020 follow-ups):
//
//   getIdolBoard(db, opts?)
//     The two-board fetch that powers /idols and /leaderboards.
//     Returns { global, byTeam } — the global top-N + a per-team
//     bucket of each team's top entries.
//
//   getPlayerIdolRank(db, playerId)
//     Per-player rank lookup used by /players/:id to show "rank N
//     globally, rank M on Mars Athletic".
//
//   getTopIdolsForArchitect(db, limit?)
//     Tiny name+rank tuple list. Consumed by the Architect's
//     pre-match context hydration — `try/catch → []` semantics
//     preserved so a transient view failure never blocks the
//     simulation pipeline.
//
// All three now take the typed `IslSupabaseClient` (the original
// `getPlayerIdolRank` + `getTopIdolsForArchitect` already accepted
// `SupabaseClient<Database>`; only the wider `getIdolBoard` is new in
// the DI sense). Consumers (Idols, Leaderboards, PlayerDetail, the
// architect-galaxy-tick edge function adjacent path) thread the
// useSupabase() client through.

import type { IslSupabaseClient } from '@shared/supabase/client';

// ── Row + result types ───────────────────────────────────────────────────

/**
 * One row from the `player_idol_score` view. Mirrors the column
 * shape the SQL view emits today; #386 will swap this for a
 * Zod-validated schema at the API boundary.
 */
export interface IdolRow {
  id:                 string;
  name:               string;
  team_id:            string;
  global_rank:        number;
  team_rank:          number;
  favourite_count:    number;
  training_count_14d: number;
}

/**
 * Shape returned by `getIdolBoard`: a global Top-N plus a per-team
 * bucket of each team's top entries. Consumers render the two
 * panels independently — the bucket index is a flat
 * `Record<team_id, IdolRow[]>`.
 */
export interface IdolBoardResult {
  global: IdolRow[];
  byTeam: Record<string, IdolRow[]>;
}

// ── Defaults ──────────────────────────────────────────────────────────────

/**
 * Default size of the global Top-N. 20 keeps the Idols page above
 * the fold on a phone-width viewport without forcing pagination.
 */
const DEFAULT_GLOBAL_LIMIT = 20;

/**
 * Default cap on rows per team in the byTeam bucket. 5 matches
 * what Idols/Leaderboards render today; raising it would change the
 * page layout, not the row threshold.
 */
const DEFAULT_TEAM_LIMIT = 5;

/**
 * Default limit for the Architect's idol-list hydration. 10 is the
 * Cosmic Voices' canonical batch size for "well-known names" —
 * matches the number of namespace slots in the Architect's lore
 * pre-hydration.
 */
const DEFAULT_ARCHITECT_LIMIT = 10;

// ── Compact view-row shape for the Architect ──────────────────────────────

/**
 * Tuple returned by `getTopIdolsForArchitect`. The Architect's
 * context hydration only needs name + globalRank; the wider
 * `IdolRow` would inflate the LLM prompt without benefit.
 */
export interface TopIdolForArchitect {
  name:        string;
  globalRank:  number;
}

// ── getIdolBoard ──────────────────────────────────────────────────────────

/**
 * Fetch the two-board idol leaderboard data in two parallel-ish
 * queries (sequential here to keep the error-handling simple; the
 * view is fast and these run on a page-mount path, not in a hot
 * loop).
 *
 * @param db          Injected Supabase client.
 * @param opts.globalLimit  How many rows to take from the global Top-N.
 *                          Defaults to 20.
 * @param opts.teamLimit    Per-team cap inside the byTeam bucket.
 *                          Defaults to 5.
 * @returns           `{ global, byTeam }`. Throws on Supabase error.
 */
export async function getIdolBoard(
  db:     IslSupabaseClient,
  { globalLimit = DEFAULT_GLOBAL_LIMIT, teamLimit = DEFAULT_TEAM_LIMIT } = {},
): Promise<IdolBoardResult> {
  const { data: topRows, error: topErr } = await db
    .from('player_idol_score')
    .select('*')
    .order('global_rank', { ascending: true })
    .limit(globalLimit);
  if (topErr) throw topErr;

  const { data: teamRows, error: teamErr } = await db
    .from('player_idol_score')
    .select('*')
    .lte('team_rank', teamLimit)
    .order('team_id',   { ascending: true })
    .order('team_rank', { ascending: true });
  if (teamErr) throw teamErr;

  // Bucket the per-team rows by `team_id`. The reducer accumulates
  // into a plain object so consumers can do an O(1) lookup per
  // team without rescanning.
  const byTeam = (teamRows ?? []).reduce(
    (acc: Record<string, unknown[]>, row: Record<string, unknown>) => {
      const teamId = row.team_id as string;
      if (!acc[teamId]) acc[teamId] = [];
      acc[teamId].push(row);
      return acc;
    },
    {},
  ) as Record<string, IdolRow[]>;

  return {
    global: ((topRows as unknown) ?? []) as IdolRow[],
    byTeam,
  };
}

// ── getPlayerIdolRank ─────────────────────────────────────────────────────

/**
 * Fetch a single player's row from `player_idol_score`. Returns
 * null when the player has no scored appearances (e.g. a brand-new
 * youth-system pull).
 *
 * @param db        Injected Supabase client.
 * @param playerId  Player UUID.
 */
export async function getPlayerIdolRank(
  db:        IslSupabaseClient,
  playerId:  string,
): Promise<IdolRow | null> {
  const { data, error } = await db
    .from('player_idol_score')
    .select('*')
    .eq('player_id', playerId)
    .maybeSingle();
  if (error) throw error;
  return (data as IdolRow | null) ?? null;
}

// ── getTopIdolsForArchitect ───────────────────────────────────────────────

/**
 * Compact name+rank tuple list for the Cosmic Architect's pre-match
 * context hydration. Best-effort: any Supabase error (transient
 * view rebuild, RLS hiccup) maps to `[]` so the simulation pipeline
 * isn't blocked by a missing leaderboard.
 *
 * @param db     Injected Supabase client.
 * @param limit  How many top rows to return. Defaults to 10.
 */
export async function getTopIdolsForArchitect(
  db:     IslSupabaseClient,
  limit:  number = DEFAULT_ARCHITECT_LIMIT,
): Promise<TopIdolForArchitect[]> {
  try {
    const { data, error } = await db
      .from('player_idol_score')
      .select('name, global_rank')
      .order('global_rank', { ascending: true })
      .limit(limit);
    if (error) return [];
    return ((data as unknown ?? []) as Array<Record<string, unknown>>).map((r) => ({
      name:        r.name        as string,
      globalRank:  r.global_rank as number,
    }));
  } catch {
    return [];
  }
}
