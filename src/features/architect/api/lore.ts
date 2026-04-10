// ── architect/api/lore.ts ────────────────────────────────────────────────────
// WHY: Supabase queries for the architect_lore table. The LoreStore (Phase 5.1)
// calls these to hydrate lore before a match and persist mutations after.
//
// All queries take an injected Supabase client; no direct imports. The
// `architect_lore` table is created by migration 0003_architect_lore.sql,
// which hasn't been applied yet — so database.ts doesn't include it. We cast
// to `any` (marked CAST:architect_lore) until types are regenerated.
//
// NOTE: These functions are low-level DB wrappers. Business logic (converting
// between the flat lore object and DB rows) lives in logic/loreStore.ts.

import type { IslSupabaseClient } from '@shared/supabase/client';
import type { ArchitectLoreRow } from '../types';

// TYPE ESCAPE HATCH — see profiles.ts for the pattern explanation.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

/**
 * Load all lore rows from the architect_lore table. The table is small
 * (a few hundred rows after a full season) so loading everything in one
 * query is simpler and faster than scope-filtered queries.
 *
 * Called once before match start during the pre-hydration phase.
 *
 * @param db  Injected Supabase client.
 * @returns   Array of ArchitectLoreRow, or empty array on error.
 */
export async function loadAllLore(
  db: IslSupabaseClient,
): Promise<ArchitectLoreRow[]> {
  const { data, error } = await (db as AnyDb) // CAST:architect_lore
    .from('architect_lore')
    .select('*');

  if (error) {
    console.warn('[loadAllLore] failed:', error.message);
    return [];
  }
  return (data ?? []) as ArchitectLoreRow[];
}

/**
 * Load lore rows matching specific scope prefixes. Useful when you only need
 * a subset of lore (e.g. global + the two teams in a match).
 *
 * Uses Supabase `or` filter with LIKE patterns for each scope prefix.
 *
 * @param db      Injected Supabase client.
 * @param scopes  Array of scope strings or prefixes (e.g. ['global', 'player:Kael Vorn']).
 * @returns       Matching ArchitectLoreRow array, or empty array on error.
 */
export async function loadLoreByScopes(
  db: IslSupabaseClient,
  scopes: string[],
): Promise<ArchitectLoreRow[]> {
  if (scopes.length === 0) return [];

  // Build an OR filter: exact match for simple scopes, LIKE for prefixes.
  const filters = scopes
    .map((s) => `scope.eq.${s}`)
    .join(',');

  const { data, error } = await (db as AnyDb) // CAST:architect_lore
    .from('architect_lore')
    .select('*')
    .or(filters);

  if (error) {
    console.warn('[loadLoreByScopes] failed:', error.message);
    return [];
  }
  return (data ?? []) as ArchitectLoreRow[];
}

/**
 * Upsert a single lore row. Uses the (scope, key) UNIQUE constraint for
 * conflict resolution — existing rows are updated, new rows are inserted.
 *
 * This is the primary write path for fire-and-forget lore mutations during
 * and after matches. Callers should NOT await this in the hot path.
 *
 * @param db      Injected Supabase client.
 * @param scope   Lore scope (e.g. 'player:Kael Vorn').
 * @param key     Lore key within the scope (e.g. 'arc').
 * @param payload JSONB payload.
 * @returns       The upserted row, or null on error.
 */
export async function upsertLoreRow(
  db: IslSupabaseClient,
  scope: string,
  key: string,
  payload: Record<string, unknown>,
): Promise<ArchitectLoreRow | null> {
  const { data, error } = await (db as AnyDb) // CAST:architect_lore
    .from('architect_lore')
    .upsert(
      {
        scope,
        key,
        payload,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'scope,key' },
    )
    .select()
    .single();

  if (error) {
    console.warn(`[upsertLoreRow] failed for ${scope}/${key}:`, error.message);
    return null;
  }
  return data as ArchitectLoreRow;
}

/**
 * Batch-upsert multiple lore rows in a single round-trip. Used by
 * `LoreStore.flush()` to persist all dirty entries at match end.
 *
 * @param db    Injected Supabase client.
 * @param rows  Array of { scope, key, payload } objects to upsert.
 * @returns     Number of successfully upserted rows, or 0 on error.
 */
export async function batchUpsertLore(
  db: IslSupabaseClient,
  rows: Array<{ scope: string; key: string; payload: Record<string, unknown> }>,
): Promise<number> {
  if (rows.length === 0) return 0;

  const now = new Date().toISOString();
  const records = rows.map((r) => ({
    scope: r.scope,
    key: r.key,
    payload: r.payload,
    updated_at: now,
  }));

  const { data, error } = await (db as AnyDb) // CAST:architect_lore
    .from('architect_lore')
    .upsert(records, { onConflict: 'scope,key' })
    .select();

  if (error) {
    console.warn('[batchUpsertLore] failed:', error.message);
    return 0;
  }
  return (data as ArchitectLoreRow[]).length;
}
