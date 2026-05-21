// ── features/agents/api/snippets.ts ─────────────────────────────────────────
// Supabase queries for the `entity_snippets` table introduced by migration
// 0035_voice_corpus.sql.  Snippets are the persistent voice library: each
// entity has a growing pool of tagged short-form text that the retrieval
// engine (logic/corpus.ts) and composer (logic/composer.ts) read at
// publish-time, and that the corpus-enricher (Phase 5 — supabase/functions/
// corpus-enricher) writes at enrichment-time.
//
// LAYER BOUNDARY
//   - This file is the only place that talks to Supabase for snippet rows.
//   - All callers receive an injected client (`IslSupabaseClient`) — no
//     module-level supabase imports, per the engineering principles.
//   - All inbound rows are validated through `SnippetRowSchema` so DB drift
//     fails loud at the boundary rather than corrupting downstream logic.
//
// ZOD CASTING
//   The generated `Tables<'entity_snippets'>` already covers shape — the
//   Zod schema adds runtime validation for snippet kind, valence range, and
//   array contents so a manually-inserted row with bad data can't poison
//   the retrieval engine.

import { z } from 'zod';

import type { IslSupabaseClient } from '@shared/supabase/client';
import type {
  SnippetInsert,
  SnippetRow,
} from '../types';

// ── Zod schema ──────────────────────────────────────────────────────────────
// Mirrors `Tables<'entity_snippets'>` exactly.  Drift between SQL and TS
// surfaces here at the first read, not deep in retrieval scoring.

/**
 * Runtime validator for a row returned from `entity_snippets`.  Anything
 * that fails to parse is dropped by `listSnippetsForEntity` with a console
 * warning — corruption of the voice library is rare enough that we'd
 * rather skip the bad row than crash the news feed.
 */
const SnippetRowSchema = z.object({
  id: z.string().uuid(),
  entity_id: z.string().uuid(),
  kind: z.string(),
  text: z.string(),
  mood: z.string().nullable(),
  context_tags: z.array(z.string()),
  subjects: z.array(z.string().uuid()),
  // Valence is a smallint constrained -2..+2 by the SQL CHECK; mirror it
  // here so a future migration that widens the range surfaces in code.
  valence: z.number().int().min(-2).max(2),
  usage_count: z.number().int().nonnegative(),
  last_used_at: z.string().nullable(),
  seed_memory_id: z.string().uuid().nullable(),
  pinned: z.boolean(),
  created_at: z.string(),
});

// ── List ────────────────────────────────────────────────────────────────────

/**
 * Load every snippet for one entity.  The voice library per entity is
 * capped at ~200 rows (pruning rules in Phase 10), so a `SELECT *` here
 * is cheaper than running the picker server-side via a stored procedure
 * and keeps all scoring logic in pure TypeScript.
 *
 * Called by `pickSnippet()` when the in-memory snippet cache for the
 * entity is cold; results should be cached by the caller for the
 * duration of a request / match.
 *
 * @param db       Injected Supabase client.
 * @param entityId Entity whose library to fetch.
 * @returns        Validated snippet rows.  Empty array on error or if the
 *                 entity has no snippets yet (common for freshly-seeded
 *                 entities pre-enrichment).
 */
export async function listSnippetsForEntity(
  db: IslSupabaseClient,
  entityId: string,
): Promise<SnippetRow[]> {
  const { data, error } = await db
    .from('entity_snippets')
    .select('*')
    .eq('entity_id', entityId);

  if (error) {
    console.warn('[listSnippetsForEntity] failed:', error.message);
    return [];
  }

  // Validate row-by-row so one corrupt entry doesn't lose the whole pool.
  const validated: SnippetRow[] = [];
  for (const row of data ?? []) {
    const parsed = SnippetRowSchema.safeParse(row);
    if (parsed.success) {
      validated.push(parsed.data);
    } else {
      console.warn(
        '[listSnippetsForEntity] dropped invalid row:',
        parsed.error.message,
      );
    }
  }
  return validated;
}

// ── Insert ──────────────────────────────────────────────────────────────────

/**
 * Insert a single snippet row.  Used by:
 *   - Phase 3 personaFactory when seeding core_quotes as snippets.
 *   - Phase 5 corpus-enricher when an LLM enrichment pass yields snippets.
 *   - One-shot seed scripts.
 *
 * Writes through the service-role key per RLS in migration 0035; an
 * authenticated client will receive a permission error.
 *
 * @param db      Injected Supabase client (service-role for writes).
 * @param payload Insert payload with required fields populated.
 * @returns       The inserted row, or null on error.
 */
export async function insertSnippet(
  db: IslSupabaseClient,
  payload: SnippetInsert,
): Promise<SnippetRow | null> {
  const { data, error } = await db
    .from('entity_snippets')
    .insert(payload)
    .select('*')
    .single();

  if (error) {
    console.warn('[insertSnippet] failed:', error.message);
    return null;
  }

  const parsed = SnippetRowSchema.safeParse(data);
  if (!parsed.success) {
    console.warn('[insertSnippet] inserted row failed Zod:', parsed.error.message);
    return null;
  }
  return parsed.data;
}

// ── Usage bookkeeping ───────────────────────────────────────────────────────

/**
 * Increment `usage_count` and refresh `last_used_at` for a snippet that
 * was just served to the user.  Best-effort fire-and-forget — a failed
 * bump is annoying (the picker may re-serve the same snippet) but never
 * blocks the response.
 *
 * Called by the composer/news listener at publication time, NOT at
 * retrieval time, so previewing a corpus pick (e.g. an admin debug view)
 * doesn't poison the scoring weights.
 *
 * @param db         Injected Supabase client (service-role for writes).
 * @param snippetId  UUID of the snippet that was just used.
 * @returns          Promise that resolves once the update lands.  Never throws.
 */
export async function bumpSnippetUsage(
  db: IslSupabaseClient,
  snippetId: string,
): Promise<void> {
  // Read-modify-write because Supabase JS doesn't expose `usage_count + 1`
  // as a typed expression.  Race conditions yield a slightly stale count
  // — acceptable for a soft scoring weight.
  const { data: current, error: readErr } = await db
    .from('entity_snippets')
    .select('usage_count')
    .eq('id', snippetId)
    .single();

  if (readErr || !current) {
    console.warn('[bumpSnippetUsage] read failed:', readErr?.message);
    return;
  }

  const { error: updateErr } = await db
    .from('entity_snippets')
    .update({
      usage_count: current.usage_count + 1,
      last_used_at: new Date().toISOString(),
    })
    .eq('id', snippetId);

  if (updateErr) {
    console.warn('[bumpSnippetUsage] update failed:', updateErr.message);
  }
}
