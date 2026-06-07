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
 * Cast a vote by spending credits on a focus option, via the atomic
 * `cast_focus_vote` RPC (migration 0072). The RPC validates auth, the
 * 10-credit minimum, own-club eligibility, and the balance, then inserts the
 * vote and debits credits in one transaction — the voter identity comes from
 * auth.uid() server-side, not a client-supplied id, and the debit can no
 * longer be skipped (#524).
 *
 * @param db             Injected Supabase client.
 * @param focusOptionId  The focus option UUID to vote for.
 * @param creditsSpent   Credits to allocate (server enforces >= 10).
 * @returns              The inserted FocusVote row, or null on error.
 */
export async function castVote(
  db: IslSupabaseClient,
  focusOptionId: string,
  creditsSpent: number,
): Promise<FocusVote | null> {
  const { data, error } = await db.rpc('cast_focus_vote', {
    p_focus_option_id: focusOptionId,
    p_credits: creditsSpent,
  });

  if (error) {
    console.warn('[castVote] RPC failed:', error.message);
    return null;
  }

  return parseFocusVoteRow(data, 'castVote') as FocusVote | null;
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
