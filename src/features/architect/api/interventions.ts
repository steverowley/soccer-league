// ── architect/api/interventions.ts ───────────────────────────────────────────
// WHY: Supabase layer for the Architect's audit-trailed historic rewrites.
//
// The contract this module enforces:
//   1. NO audit row, NO mutation. The audit row is written first (or in
//      the same transaction, via a Supabase RPC when we add one). If the
//      audit write fails, the target mutation NEVER runs.
//   2. Every rewrite goes through validateEdict() before touching the DB,
//      so malformed requests are caught in pure code.
//   3. All queries take an injected Supabase client — never imports.
//
// Tables used (created by 0008_architect_interventions.sql):
//   - architect_interventions (read/write — append-only audit)
//
// Also reads the `narratives` table from 0002_entities.sql (via the
// entities feature's public API — no deep imports).

import type { IslSupabaseClient } from '@shared/supabase/client';
import type { ArchitectInterventionRow } from '../types';
import type { InvalidEdictError } from '../logic/edicts';

// ── Result shapes ───────────────────────────────────────────────────────────

/**
 * Result returned by `logIntervention()`. `success=false` either means
 * the edict was invalid (caller should not retry) or the DB write failed
 * (caller may retry with the same request).
 */
export interface LogInterventionResult {
  success: boolean;
  /** The written audit row, present only on success. */
  row?: ArchitectInterventionRow;
  /** Machine-readable failure code when success=false. */
  code?: InvalidEdictError['code'] | 'db_error';
  /** Human-readable error message when success=false. */
  message?: string;
}


// ── Read queries ────────────────────────────────────────────────────────────

/**
 * Fetch the most recent interventions, newest first. Used by the dev-only
 * `/architect-log` page for sanity-checking cosmic rewrites and by the
 * Architect itself to avoid repeating the same rewrite reasoning twice.
 *
 * @param db     Injected Supabase client.
 * @param limit  Max rows to return. Defaults to 100.
 * @returns      Array of ArchitectInterventionRow, newest first.
 */
export async function getRecentInterventions(
  db: IslSupabaseClient,
  limit: number = 100,
): Promise<ArchitectInterventionRow[]> {
  const { data, error } = await db
    .from('architect_interventions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.warn('[getRecentInterventions] failed:', error.message);
    return [];
  }
  return (data ?? []) as ArchitectInterventionRow[];
}

