// ── features/agents/api/memories.ts ─────────────────────────────────────────
// Supabase queries for the `entity_memories` table introduced by migration
// 0035_voice_corpus.sql.  Memories are structured facts (NO text generation)
// that downstream phases consume:
//   - Phase 5 corpus-enricher reads recent + high-salience memories as the
//     dynamic input to LLM prompts.
//   - Phase 8 reflex-tier decision resolvers read 1-hop subject memories to
//     shade in-match probabilities (e.g. striker's rivalry with this keeper).
//   - Phase 9 drama-tick escalates unresolved goals when supporting memories
//     accumulate.
//
// LAYER BOUNDARY
//   - Memories are the cheap path: client-side `MemoryWriteListener` and the
//     authoritative server-side `writeMatchMemories()` both write here.
//   - The (entity_id, fact_kind, occurred_at, md5(payload)) unique index in
//     the SQL schema dedupes dual-write paths.  This file relies on that
//     index; callers don't need to guard against duplicates.
//   - Reads are public; writes require authenticated (insert) or service-role
//     (update/delete) per RLS in migration 0035.

import { z } from 'zod';

import type { IslSupabaseClient } from '@shared/supabase/client';
import type { MemoryInsert, MemoryRow } from '../types';

// ── Zod schema ──────────────────────────────────────────────────────────────
// Runtime validation mirrors the SQL CHECK (salience BETWEEN 1 AND 10) so
// any out-of-range row that bypassed the constraint (e.g. via a future
// schema relaxation) still gets caught at read time.

/** Runtime validator for `entity_memories` rows returned from Supabase. */
const MemoryRowSchema = z.object({
  id: z.string().uuid(),
  entity_id: z.string().uuid(),
  fact_kind: z.string(),
  payload: z.unknown(),
  salience: z.number().int().min(1).max(10),
  subjects: z.array(z.string().uuid()),
  occurred_at: z.string(),
  consumed_count: z.number().int().nonnegative(),
});

// ── List for one entity ─────────────────────────────────────────────────────

/**
 * Fetch recent memories for one entity, newest first.  Hot path for the
 * Phase 5 enricher prompt builder and any decision resolver that reads
 * "what does this entity remember?"
 *
 * Uses the (entity_id, occurred_at DESC) index created by migration 0035.
 *
 * @param db        Injected Supabase client.
 * @param entityId  Entity whose memory log to read.
 * @param limit     Max rows to return.  Defaults to 50 — enough for the
 *                  enricher's "last 5–10 high-salience memories" filter
 *                  without paging.
 * @returns         Validated memory rows, newest first.  Empty array on
 *                  error or no memories.
 */
export async function listMemoriesForEntity(
  db: IslSupabaseClient,
  entityId: string,
  limit: number = 50,
): Promise<MemoryRow[]> {
  const { data, error } = await db
    .from('entity_memories')
    .select('*')
    .eq('entity_id', entityId)
    .order('occurred_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.warn('[listMemoriesForEntity] failed:', error.message);
    return [];
  }

  const validated: MemoryRow[] = [];
  for (const row of data ?? []) {
    const parsed = MemoryRowSchema.safeParse(row);
    if (parsed.success) {
      validated.push(parsed.data as MemoryRow);
    } else {
      console.warn('[listMemoriesForEntity] dropped invalid row:', parsed.error.message);
    }
  }
  return validated;
}

// ── Insert ──────────────────────────────────────────────────────────────────

/**
 * Insert a memory row.  The dedup unique index handles concurrent dual-
 * write races between the browser-side `MemoryWriteListener` (Phase 2 —
 * lives in `src/features/agents/ui/MemoryWriteListener.tsx`) and the
 * server-side `writeMatchMemories()` step in `supabase/functions/
 * match-worker/postMatchEffects.ts`.
 *
 * Caller is responsible for picking sensible `salience` per fact_kind
 * (the resolver in `logic/memoryWriter.ts` does this).
 *
 * @param db       Injected Supabase client.
 * @param payload  Insert payload; `id` and `consumed_count` default.
 * @returns        The inserted (or dedup-skipped existing) row.  Null on
 *                 hard error.  Dedup hits are returned as the existing
 *                 row when the upsert option is used; see below.
 */
export async function insertMemory(
  db: IslSupabaseClient,
  payload: MemoryInsert,
): Promise<MemoryRow | null> {
  // `upsert` with `ignoreDuplicates` makes the call idempotent: if the
  // dedup unique index already has this (entity, kind, occurred_at, payload)
  // combo, the row is left untouched and the duplicate insert is silently
  // skipped.  Easier than carrying an ON CONFLICT clause through every
  // listener call site.
  const { data, error } = await db
    .from('entity_memories')
    .upsert(payload, {
      ignoreDuplicates: true,
      onConflict: 'entity_id,fact_kind,occurred_at',
    })
    .select('*')
    .maybeSingle();

  if (error) {
    console.warn('[insertMemory] failed:', error.message);
    return null;
  }
  if (!data) {
    // Duplicate skipped — that's expected for the dual-write path.
    return null;
  }

  const parsed = MemoryRowSchema.safeParse(data);
  if (!parsed.success) {
    console.warn('[insertMemory] inserted row failed Zod:', parsed.error.message);
    return null;
  }
  return parsed.data as MemoryRow;
}

// ── Increment consumed_count ────────────────────────────────────────────────

/**
 * Increment `consumed_count` on a memory the enricher just turned into a
 * snippet.  Used by the Phase 5 enricher to rotate fresh facts through
 * the LLM rather than re-seeding the same memory every tick.
 *
 * Fire-and-forget; a missed bump is recoverable.
 *
 * @param db        Injected Supabase client (service-role required by RLS).
 * @param memoryId  UUID of the consumed memory.
 */
export async function bumpMemoryConsumed(
  db: IslSupabaseClient,
  memoryId: string,
): Promise<void> {
  const { data: current, error: readErr } = await db
    .from('entity_memories')
    .select('consumed_count')
    .eq('id', memoryId)
    .single();

  if (readErr || !current) {
    console.warn('[bumpMemoryConsumed] read failed:', readErr?.message);
    return;
  }

  const { error: updateErr } = await db
    .from('entity_memories')
    .update({ consumed_count: current.consumed_count + 1 })
    .eq('id', memoryId);

  if (updateErr) {
    console.warn('[bumpMemoryConsumed] update failed:', updateErr.message);
  }
}
