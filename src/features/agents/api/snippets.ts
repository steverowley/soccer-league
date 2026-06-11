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
import type { SnippetRow } from '../types';

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
