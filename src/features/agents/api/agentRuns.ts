// ── features/agents/api/agentRuns.ts ────────────────────────────────────────
// Supabase queries for the `agent_runs` table introduced by migration
// 0035_voice_corpus.sql.  This table is the cost + cache observability
// surface for the entire agent system — every LLM call writes a row, and
// every retrieval outcome (hit / miss) writes a zero-token row.
//
// CONSUMERS
//   - Phase 5 corpus-enricher writes 'enrich' rows for each new snippet batch.
//   - Phase 8 reflex resolvers and Phase 9 drama-tick write 'decision' /
//     'drama' rows.
//   - The composer (logic/composer.ts) writes 'corpus_hit' and
//     'corpus_miss' rows so the cache-hit-rate metric is queryable.
//   - The Phase 3 persona factory writes 'persona_seed' rows when it
//     calls the LLM to draft `voice_paragraph` + `core_quotes`.
//
// COST GUARDRAIL
//   The Phase 5 enricher reads this table to enforce daily budget caps
//   per-entity and globally before deciding whether to fire another batch.
//   That logic lives in the enricher edge function; this file only exposes
//   the write primitive.
//
// LAYER BOUNDARY
//   Service-role only for both reads and writes — never user-facing.

import type { IslSupabaseClient } from '@shared/supabase/client';
import type { AgentRunInsert } from '../types';

// ── Insert ──────────────────────────────────────────────────────────────────

/**
 * Append one observability row to `agent_runs`.  Fire-and-forget: a
 * failed insert means we lost a single cost data-point, which is annoying
 * but never blocks the response.  Errors are warned and swallowed.
 *
 * For hit/miss telemetry (kind='corpus_hit' / 'corpus_miss') token fields
 * default to 0 in the SQL schema; only the `entity_id`, `kind`, and
 * timestamp matter for those rows.
 *
 * For LLM calls (kind='enrich' / 'drama' / 'persona_seed' / 'decision')
 * callers MUST pass the four token counts from the Anthropic SDK
 * response — `prompt_tokens`, `output_tokens`, `cache_read_tokens`,
 * `cache_create_tokens` — so the cache-effectiveness metric is honest.
 *
 * @param db       Injected Supabase client (service-role required by RLS).
 * @param payload  Insert payload; `id` and `created_at` default.
 */
export async function logAgentRun(
  db: IslSupabaseClient,
  payload: AgentRunInsert,
): Promise<void> {
  const { error } = await db.from('agent_runs').insert(payload);
  if (error) {
    console.warn('[logAgentRun] failed:', error.message);
  }
}
