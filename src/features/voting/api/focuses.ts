// ── voting/api/focuses.ts ────────────────────────────────────────────────────
// WHY: Supabase queries for the voting feature — option generation, vote
// casting, and tally reading. All queries take an injected Supabase client.
//
// Tables used (created by 0006_voting.sql, not yet in database.ts):
//   - focus_options (read/write)
//   - focus_votes (read/write)
//   - focus_tally (read — SQL view)
//
// All casts marked CAST:voting for grep-and-remove after database.ts regen.

import type { IslSupabaseClient } from '@shared/supabase/client';
import type { FocusOption, FocusVote, FocusTallyEntry } from '../types';
import { ALL_FOCUS_TEMPLATES } from '../logic/focusTemplates';

// TYPE ESCAPE HATCH — tables not yet in generated database.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

// ── Option generation ───────────────────────────────────────────────────────

/**
 * Generate focus options for a team for a given season. Inserts all static
 * templates (4 major + 5 minor) as focus_options rows. Uses upsert so
 * re-running is idempotent.
 *
 * In future phases, this will call the Architect LLM to generate
 * team-specific options based on lore and season performance.
 *
 * @param db        Injected Supabase client.
 * @param teamId    Team slug.
 * @param seasonId  Season UUID.
 * @returns         Number of options created/updated.
 */
export async function generateFocusOptions(
  db: IslSupabaseClient,
  teamId: string,
  seasonId: string,
): Promise<number> {
  const rows = ALL_FOCUS_TEMPLATES.map((t) => ({
    team_id: teamId,
    season_id: seasonId,
    option_key: t.option_key,
    label: t.label,
    description: t.description,
    tier: t.tier,
  }));

  const { data, error } = await (db as AnyDb) // CAST:voting
    .from('focus_options')
    .upsert(rows, { onConflict: 'team_id,season_id,option_key' })
    .select();

  if (error) {
    console.warn('[generateFocusOptions] failed:', error.message);
    return 0;
  }
  return (data as FocusOption[]).length;
}

// ── Option queries ──────────────────────────────────────────────────────────

/**
 * Fetch all focus options for a team in a specific season.
 *
 * @param db        Injected Supabase client.
 * @param teamId    Team slug.
 * @param seasonId  Season UUID.
 * @returns         Array of FocusOption rows.
 */
export async function getTeamFocusOptions(
  db: IslSupabaseClient,
  teamId: string,
  seasonId: string,
): Promise<FocusOption[]> {
  const { data, error } = await (db as AnyDb) // CAST:voting
    .from('focus_options')
    .select('*')
    .eq('team_id', teamId)
    .eq('season_id', seasonId)
    .order('tier')
    .order('option_key');

  if (error) {
    console.warn('[getTeamFocusOptions] failed:', error.message);
    return [];
  }
  return (data ?? []) as FocusOption[];
}

// ── Vote casting ────────────────────────────────────────────────────────────

/**
 * Cast a vote by spending credits on a focus option. Inserts a focus_votes
 * row and deducts credits from the user's profile.
 *
 * The caller must verify `canAffordVote()` before calling this. The DB
 * CHECK constraint on `profiles.credits >= 0` is a safety net.
 *
 * @param db             Injected Supabase client.
 * @param userId         The voting user's UUID.
 * @param focusOptionId  The focus option UUID to vote for.
 * @param creditsSpent   Number of credits to allocate (must be > 0).
 * @returns              The inserted FocusVote row, or null on error.
 */
export async function castVote(
  db: IslSupabaseClient,
  userId: string,
  focusOptionId: string,
  creditsSpent: number,
): Promise<FocusVote | null> {
  // 1. Insert the vote.
  const { data: vote, error: voteErr } = await (db as AnyDb) // CAST:voting
    .from('focus_votes')
    .insert({
      user_id: userId,
      focus_option_id: focusOptionId,
      credits_spent: creditsSpent,
    })
    .select()
    .single();

  if (voteErr) {
    console.warn('[castVote] insert failed:', voteErr.message);
    return null;
  }

  // 2. Deduct credits from the user's profile.
  // Try atomic RPC first, fall back to read-modify-write.
  const { error: rpcErr } = await (db as AnyDb)
    .rpc('decrement_credits', { user_id: userId, amount: creditsSpent });

  if (rpcErr) {
    const { data: profile } = await (db as AnyDb) // CAST:profiles
      .from('profiles')
      .select('credits')
      .eq('id', userId)
      .single();

    if (profile) {
      await (db as AnyDb)
        .from('profiles')
        .update({ credits: (profile as { credits: number }).credits - creditsSpent })
        .eq('id', userId);
    }
  }

  return vote as FocusVote;
}

/**
 * Fetch all votes cast by a specific user for a given season. Used on the
 * voting page to show the user their current allocations.
 *
 * @param db        Injected Supabase client.
 * @param userId    The user's UUID.
 * @param seasonId  Season UUID (used to filter via a join on focus_options).
 * @returns         Array of FocusVote rows.
 */
export async function getUserVotesForSeason(
  db: IslSupabaseClient,
  userId: string,
  seasonId: string,
): Promise<FocusVote[]> {
  // Join through focus_options to filter by season.
  const { data, error } = await (db as AnyDb) // CAST:voting
    .from('focus_votes')
    .select('*, focus_options!inner(season_id)')
    .eq('user_id', userId)
    .eq('focus_options.season_id', seasonId);

  if (error) {
    console.warn('[getUserVotesForSeason] failed:', error.message);
    return [];
  }
  return (data ?? []) as FocusVote[];
}

// ── Tally queries ───────────────────────────────────────────────────────────

/**
 * Fetch the running vote tally for a team in a season. Reads from the
 * `focus_tally` SQL view which aggregates credits per option.
 *
 * @param db        Injected Supabase client.
 * @param teamId    Team slug.
 * @param seasonId  Season UUID.
 * @returns         Array of FocusTallyEntry rows, one per option.
 */
export async function getTeamTally(
  db: IslSupabaseClient,
  teamId: string,
  seasonId: string,
): Promise<FocusTallyEntry[]> {
  const { data, error } = await (db as AnyDb) // CAST:voting
    .from('focus_tally')
    .select('*')
    .eq('team_id', teamId)
    .eq('season_id', seasonId)
    .order('tier')
    .order('total_credits', { ascending: false });

  if (error) {
    console.warn('[getTeamTally] failed:', error.message);
    return [];
  }
  return (data ?? []) as FocusTallyEntry[];
}
