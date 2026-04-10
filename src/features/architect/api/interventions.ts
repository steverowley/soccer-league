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
// Tables used (created by 0008_architect_interventions.sql, not yet in
// database.ts):
//   - architect_interventions (read/write — append-only audit)
//
// Also reads the `narratives` table from 0002_entities.sql (via the
// entities feature's public API — no deep imports).
//
// All casts marked CAST:architect for grep-and-remove after database.ts regen.

import type { IslSupabaseClient } from '@shared/supabase/client';
import type {
  ArchitectInterventionRow,
  InterventionRequest,
} from '../types';
import {
  validateEdict,
  interventionToRow,
  InvalidEdictError,
} from '../logic/edicts';

// TYPE ESCAPE HATCH — architect_interventions not yet in generated
// database.ts. See profiles.ts for the pattern explanation.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

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

// ── Core: log an intervention ───────────────────────────────────────────────

/**
 * Validate + insert a single intervention into the audit table. Does NOT
 * perform the target-table mutation — that's `logInterventionAndRewrite`'s
 * job. Use this function when you only need to record a soft intervention
 * (e.g. a narrative that doesn't map to a specific column change).
 *
 * Validation errors (bad table, short reason, missing snapshot, no-op,
 * etc.) short-circuit with a structured error code. DB errors return a
 * generic `db_error` code and log to console for diagnosis.
 *
 * @param db       Injected Supabase client.
 * @param request  The intervention to log.
 * @returns        LogInterventionResult describing what happened.
 */
export async function logIntervention(
  db: IslSupabaseClient,
  request: InterventionRequest,
): Promise<LogInterventionResult> {
  // Step 1 — pure validation. Fails loud, never touches the DB on error.
  let validated: InterventionRequest;
  try {
    validated = validateEdict(request);
  } catch (err) {
    if (err instanceof InvalidEdictError) {
      return { success: false, code: err.code, message: err.message };
    }
    // Unknown exception class — rethrow so it's not silently swallowed.
    throw err;
  }

  // Step 2 — insert the audit row. Fire-and-forget is NOT appropriate
  // here: if the audit fails, we must refuse to do the mutation.
  const row = interventionToRow(validated);
  const { data, error } = await (db as AnyDb) // CAST:architect
    .from('architect_interventions')
    .insert(row)
    .select()
    .single();

  if (error) {
    console.warn('[logIntervention] insert failed:', error.message);
    return { success: false, code: 'db_error', message: error.message };
  }

  return { success: true, row: data as ArchitectInterventionRow };
}

// ── Combined: audit + rewrite ───────────────────────────────────────────────

/**
 * Log an intervention AND apply the target-table rewrite in sequence.
 * This is the "production" entry point for Architect meddling — always
 * prefer it over calling logIntervention() + a direct update() yourself.
 *
 * The ordering is deliberate: audit row first, then mutation. If the
 * audit write fails, we refuse to touch the target table — it's better
 * to leave history intact than to rewrite it silently. If the mutation
 * fails after the audit was recorded, we write a compensating row with
 * meta.failed = true so the audit log stays truthful.
 *
 * @param db       Injected Supabase client.
 * @param request  The intervention (must include targetTable, targetId,
 *                 field, oldValue, newValue, reason).
 * @returns        LogInterventionResult — success means BOTH the audit
 *                 and the target mutation succeeded.
 */
export async function logInterventionAndRewrite(
  db: IslSupabaseClient,
  request: InterventionRequest,
): Promise<LogInterventionResult> {
  // Step 1 — audit row first. If it fails, we're done: no mutation.
  const logged = await logIntervention(db, request);
  if (!logged.success) return logged;

  // Step 2 — apply the mutation. When `field` is null this is a
  // multi-column rewrite, in which case `newValue` is expected to be the
  // full row-shape object. When `field` is set, `newValue` is the
  // replacement value for that column.
  const updatePayload: Record<string, unknown> =
    request.field === null
      ? (request.newValue as Record<string, unknown>)
      : { [request.field]: request.newValue };

  const { error: updateErr } = await (db as AnyDb) // CAST:architect
    .from(request.targetTable)
    .update(updatePayload)
    .eq('id', request.targetId);

  // Step 3 — compensating audit on failure. We do NOT try to roll back
  // the audit row; we add a second row that records the failure so the
  // log remains honest.
  if (updateErr) {
    console.warn(
      `[logInterventionAndRewrite] update failed on ${request.targetTable}:`,
      updateErr.message,
    );
    // Fire-and-forget: if this also fails, console.warn is enough — the
    // operator can still diagnose from the original failed row.
    const compensation: InterventionRequest = {
      targetTable: request.targetTable,
      targetId: request.targetId,
      field: request.field,
      oldValue: request.newValue, // what we tried to write
      newValue: request.oldValue, // what's still in the DB
      reason: `ROLLBACK NOTICE: rewrite failed — ${updateErr.message}`,
      meta: { ...(request.meta ?? {}), failed: true },
    };
    // Ignore errors on the compensation write to avoid throw loops.
    logIntervention(db, compensation).catch((e) => {
      console.warn('[logInterventionAndRewrite] compensation write failed:', e);
    });
    return {
      success: false,
      code: 'db_error',
      message: `Audit written but target mutation failed: ${updateErr.message}`,
    };
  }

  return logged;
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
  const { data, error } = await (db as AnyDb) // CAST:architect
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

/**
 * Fetch every intervention that touched a specific row. Used by the
 * MatchDetail page to render a "this match was rewritten N times" banner
 * and a chronological audit trail of the meddling.
 *
 * @param db           Injected Supabase client.
 * @param targetTable  The table name (e.g. 'matches').
 * @param targetId     The row UUID.
 * @returns            Array of ArchitectInterventionRow, newest first.
 */
export async function getInterventionsForTarget(
  db: IslSupabaseClient,
  targetTable: string,
  targetId: string,
): Promise<ArchitectInterventionRow[]> {
  const { data, error } = await (db as AnyDb) // CAST:architect
    .from('architect_interventions')
    .select('*')
    .eq('target_table', targetTable)
    .eq('target_id', targetId)
    .order('created_at', { ascending: false });

  if (error) {
    console.warn(
      `[getInterventionsForTarget] failed for ${targetTable}/${targetId}:`,
      error.message,
    );
    return [];
  }
  return (data ?? []) as ArchitectInterventionRow[];
}
