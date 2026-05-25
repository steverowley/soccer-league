// ── architect/api/lore.ts ────────────────────────────────────────────────────
// WHY: Supabase queries for the architect_lore table. The LoreStore (Phase 5.1)
// calls these to hydrate lore before a match and persist mutations after.
//
// All queries take an injected Supabase client; no direct imports.
//
// NOTE: These functions are low-level DB wrappers. Business logic (converting
// between the flat lore object and DB rows) lives in logic/loreStore.ts.

import type { IslSupabaseClient } from '@shared/supabase/client';
import type { Json } from '@/types/database';
import type { ArchitectLoreRow } from '../types';
// #386 slice 5: boundary-validate every architect_lore row before
// the LoreStore consumes it. Drift now degrades gracefully (fewer
// lore entries hydrated) instead of poisoning the in-memory store
// that getContext() reads synchronously during goal bursts.
import { parseArchitectLoreRow, parseArchitectLoreRows } from './lore.schema';

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
  const { data, error } = await db
    .from('architect_lore')
    .select('*');

  if (error) {
    console.warn('[loadAllLore] failed:', error.message);
    return [];
  }
  return parseArchitectLoreRows((data ?? []) as unknown[], 'loadAllLore') as ArchitectLoreRow[];
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
  const { data, error } = await db
    .from('architect_lore')
    .upsert(
      {
        scope,
        key,
        // `Record<string, unknown>` widens to the recursive `Json` type
        // generated for the column; the cast is a structural narrow,
        // not an escape hatch.
        payload: payload as Json,
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
  return parseArchitectLoreRow(data, `upsertLoreRow:${scope}/${key}`) as ArchitectLoreRow | null;
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
  // Same `Json` cast rationale as upsertLoreRow above — the callers'
  // record shape is structurally JSON-safe but TS can't prove that.
  const records = rows.map((r) => ({
    scope: r.scope,
    key: r.key,
    payload: r.payload as Json,
    updated_at: now,
  }));

  const { data, error } = await db
    .from('architect_lore')
    .upsert(records, { onConflict: 'scope,key' })
    .select();

  if (error) {
    console.warn('[batchUpsertLore] failed:', error.message);
    return 0;
  }
  return parseArchitectLoreRows((data ?? []) as unknown[], 'batchUpsertLore').length;
}
