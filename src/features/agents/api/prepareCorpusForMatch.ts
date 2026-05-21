// ── features/agents/api/prepareCorpusForMatch.ts ────────────────────────────
// Pre-match hydration for the reflex-tier decision resolvers (Phase 8).
//
// WHY THIS HELPER EXISTS
//   The reflex resolvers (`shoot_or_pass`, `card_severity`) run on the
//   sub-second in-match hot path and MUST stay synchronous — they're
//   called inside `gameEngine.genEvent()` which the simulator drives
//   thousands of times per match.  Doing a Supabase round trip per
//   decision would tank simulation speed.
//
//   The fix matches the Architect's own pattern (`prepareArchitectForMatch`):
//   load every involved entity's persona + recent memories ONCE before
//   kickoff into in-memory maps, then hand those maps to the engine via
//   `genCtx.agentCorpus`.  Every in-match resolver call becomes a
//   synchronous map lookup.
//
// LAYER BOUNDARY
//   This is an `api/` module — it owns the DB I/O.  Resolvers stay pure
//   under `logic/resolvers/`.  Callers (the worker's processMatch loop;
//   the in-browser simulateFullMatch preview path) hydrate via this
//   helper and inject the result into the engine.
//
// SCALE
//   A match touches at most ~50 entities (22 starters × 2 teams + 1
//   referee + 2 managers).  We hydrate ALL of them in two batched reads
//   (one for personas, one for memories) so the helper stays O(1)
//   round-trips regardless of squad size.

import type { IslSupabaseClient } from '@shared/supabase/client';
import type { MemoryRow, PersonaRow } from '../types';
import { listPersonasForEntities } from './personas';
import { listMemoriesForEntity } from './memories';

// ── Tuning constants ────────────────────────────────────────────────────────

/**
 * Max memories per entity loaded into the in-match cache.
 *
 * MECHANICAL EFFECT: 25 is enough for the reflex resolvers' "last 5 hits
 * against THIS keeper" filter to land naturally without paging, but small
 * enough that a 50-entity match stays well under 1500 memory rows total.
 * Older memories still exist in the DB; resolvers just don't see them
 * during this specific match.  Raise if reflex outputs flatten.
 */
const MEMORIES_PER_ENTITY = 25;

// ── Public types ────────────────────────────────────────────────────────────

/**
 * In-memory corpus snapshot consumed by the reflex-tier resolvers via
 * `genCtx.agentCorpus`.  Both maps are keyed by entity_id.
 *
 * The engine's resolver wiring reads `personas.get(playerEntityId)` and
 * `memories.get(refEntityId) ?? []` synchronously — no DB calls during
 * the simulation loop.
 */
export interface AgentCorpusSnapshot {
  /** entity_id → persona row.  Missing entries imply the resolver should fall back. */
  personas: Map<string, PersonaRow>;
  /** entity_id → recent memories (newest first).  Empty array when nothing logged. */
  memories: Map<string, MemoryRow[]>;
}

// ── Hydrator ────────────────────────────────────────────────────────────────

/**
 * Load every persona + recent memories for the supplied entity IDs.
 *
 * Two round trips total: one batched `listPersonasForEntities` followed
 * by one parallel `Promise.all` over `listMemoriesForEntity`.  The fan-out
 * on the memory side is intentional — entity_memories has no `IN` query
 * helper that returns rows grouped by entity, so we keep the existing
 * single-entity helper and run the calls in parallel.
 *
 * Best-effort throughout: lookup failures inside `listPersonasForEntities`
 * / `listMemoriesForEntity` warn-log internally and return [] — this
 * helper never throws and never rejects.  Missing entries in the returned
 * maps signal the resolvers to fall back to neutral / generic behaviour.
 *
 * @param db         Injected Supabase client (anon or service-role; reads
 *                   are public per migration 0035 RLS).
 * @param entityIds  Entity IDs of every player + referee + manager
 *                   participating in the match.  Duplicates are tolerated;
 *                   the helper dedupes internally.
 * @returns          The hydrated snapshot ready to slot into `genCtx`.
 */
export async function prepareCorpusForMatch(
  db: IslSupabaseClient,
  entityIds: readonly string[],
): Promise<AgentCorpusSnapshot> {
  // Empty input shortcut — avoids two no-op round trips when the caller
  // doesn't have any entity IDs to hydrate (legacy fixtures with no
  // entity_id link, integration tests with bare engine inputs).
  if (entityIds.length === 0) {
    return { personas: new Map(), memories: new Map() };
  }

  // Dedupe so the parallel memory fetch doesn't double up on the same
  // entity (e.g. when both manager + referee resolution surface the same
  // id by coincidence).
  const uniqueIds = Array.from(new Set(entityIds));

  // ── Personas: one batched read ──────────────────────────────────────────
  const personaRows = await listPersonasForEntities(db, uniqueIds);
  const personas = new Map<string, PersonaRow>();
  for (const row of personaRows) {
    personas.set(row.entity_id, row);
  }

  // ── Memories: parallel reads, one per entity ────────────────────────────
  // Promise.all keeps the wall-clock at one round-trip even though the
  // call count is N.  Memory rows are small (~200 bytes) so the cumulative
  // payload for a 50-entity match stays under 250 KB.
  const memoryResults = await Promise.all(
    uniqueIds.map(async (id) => {
      const rows = await listMemoriesForEntity(db, id, MEMORIES_PER_ENTITY);
      return [id, rows] as const;
    }),
  );
  const memories = new Map<string, MemoryRow[]>();
  for (const [id, rows] of memoryResults) {
    memories.set(id, rows);
  }

  return { personas, memories };
}
