// ── voting/api/focuses.ts ────────────────────────────────────────────────────
// WHY: Supabase queries for the voting feature — option generation, vote
// casting, and tally reading. All queries take an injected Supabase client.
//
// Tables used (created by 0006_voting.sql):
//   - focus_options (read/write)
//   - focus_votes (read/write)
//   - focus_tally (read — SQL view)

import type { IslSupabaseClient } from '@shared/supabase/client';
import type { FocusOption, FocusVote, FocusTallyEntry } from '../types';
import { ALL_FOCUS_TEMPLATES } from '../logic/focusTemplates';
// #386 slice 3: boundary-validate every row read from focus_options,
// focus_votes (insert return), and the focus_tally view. Drift catches
// column rename / type drift at the api edge instead of half-rendering
// the voting UI.
import {
  parseFocusOptionRows,
  parseFocusTallyRows,
  parseFocusVoteRow,
} from './focuses.schema';

// The optimistic `decrement_credits` RPC fallback below is a pre-existing
// dev-era convenience that was never deployed as a SQL function; the
// generated types correctly omit it. We cast just that one RPC call so the
// existing read-modify-write fallback path still compiles. Production
// vote-cost debits run via that fallback path today.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RpcAny = any;

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

  const { data, error } = await db
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
  const { data, error } = await db
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
  return parseFocusOptionRows((data ?? []) as unknown[], 'getTeamFocusOptions') as FocusOption[];
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
  const { data: vote, error: voteErr } = await db
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
  // Try atomic RPC first, fall back to read-modify-write. The
  // `decrement_credits` RPC isn't declared in the generated types
  // (it predates the typegen and was never deployed as a SQL function);
  // the call always errors, which hits the RMW fallback below.
  const { error: rpcErr } = await (db.rpc as RpcAny)(
    'decrement_credits',
    { user_id: userId, amount: creditsSpent },
  );

  if (rpcErr) {
    const { data: profile } = await db
      .from('profiles')
      .select('credits')
      .eq('id', userId)
      .single();

    if (profile) {
      await db
        .from('profiles')
        .update({ credits: profile.credits - creditsSpent })
        .eq('id', userId);
    }
  }

  return parseFocusVoteRow(vote, 'castVote') as FocusVote | null;
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
  const { data, error } = await db
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
  return parseFocusTallyRows((data ?? []) as unknown[], 'getTeamTally') as FocusTallyEntry[];
}
