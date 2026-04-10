// ── entities.ts ──────────────────────────────────────────────────────────────
// WHY: Supabase queries for the unified entity model. The Architect's context
// hydration (Phase 5.1) and the news feed (Phase 8) read from these queries.
// All queries take an injected Supabase client; no direct imports.
//
// NOTE: The `entities`, `entity_traits`, `entity_relationships`, and
// `narratives` tables are created by migration 0002_entities.sql, which
// hasn't been applied yet — so database.ts doesn't include them. We cast
// to `any` (marked CAST:entities) until types are regenerated.

import type { IslSupabaseClient } from '@shared/supabase/client';
import type { Entity, EntityKind, EntityTrait, Narrative } from '../types';

// TYPE ESCAPE HATCH — see profiles.ts for the pattern explanation.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

// ── Entity queries ──────────────────────────────────────────────────────────

/**
 * Fetch all entities of a given kind. Used by the Architect context loader
 * to pull "all referees" or "all pundits" into the LLM prompt window.
 *
 * Returns entities ordered by name for stable iteration. The caller should
 * cache the result for the duration of a match (Phase 5.1 pre-hydration)
 * rather than re-querying on every tick.
 *
 * @param db    Injected Supabase client.
 * @param kind  Entity kind to filter on (e.g. 'referee', 'pundit').
 * @returns     Array of Entity rows, or empty array on error.
 */
export async function getEntitiesByKind(
  db: IslSupabaseClient,
  kind: EntityKind,
): Promise<Entity[]> {
  const { data, error } = await (db as AnyDb) // CAST:entities
    .from('entities')
    .select('*')
    .eq('kind', kind)
    .order('name');

  if (error) {
    console.warn(`[getEntitiesByKind] failed for kind=${kind}:`, error.message);
    return [];
  }
  return (data ?? []) as Entity[];
}

/**
 * Fetch a single entity by ID. Used when the Architect needs to look up a
 * specific entity referenced in a narrative or relationship.
 *
 * @param db  Injected Supabase client.
 * @param id  Entity UUID.
 * @returns   The Entity, or `null` if not found.
 */
export async function getEntityById(
  db: IslSupabaseClient,
  id: string,
): Promise<Entity | null> {
  const { data, error } = await (db as AnyDb) // CAST:entities
    .from('entities')
    .select('*')
    .eq('id', id)
    .single();

  if (error) return null;
  return data as Entity;
}

/**
 * Fetch all traits for a given entity. Returns an array of EntityTrait rows
 * keyed by trait_key. The Architect reads these to personalise commentary
 * (e.g. "this referee is known for strictness: 8/10").
 *
 * @param db        Injected Supabase client.
 * @param entityId  The entity's UUID.
 * @returns         Array of EntityTrait rows.
 */
export async function getEntityTraits(
  db: IslSupabaseClient,
  entityId: string,
): Promise<EntityTrait[]> {
  const { data, error } = await (db as AnyDb) // CAST:entities
    .from('entity_traits')
    .select('*')
    .eq('entity_id', entityId);

  if (error) {
    console.warn(`[getEntityTraits] failed for entity=${entityId}:`, error.message);
    return [];
  }
  return (data ?? []) as EntityTrait[];
}

// ── Narrative queries ───────────────────────────────────────────────────────

/**
 * Fetch recent narratives, optionally filtered by source. The Architect
 * loads the most recent N narratives into its context window at the start
 * of each match so it can reference them in commentary and decisions.
 *
 * @param db      Injected Supabase client.
 * @param limit   Maximum number of narratives to return (default 50).
 * @param source  Optional source filter ('architect', 'match', 'scheduled').
 * @returns       Array of Narrative rows, newest first.
 */
export async function getRecentNarratives(
  db: IslSupabaseClient,
  limit = 50,
  source?: string,
): Promise<Narrative[]> {
  let query = (db as AnyDb) // CAST:entities
    .from('narratives')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (source) {
    query = query.eq('source', source);
  }

  const { data, error } = await query;
  if (error) {
    console.warn('[getRecentNarratives] failed:', error.message);
    return [];
  }
  return (data ?? []) as Narrative[];
}

/**
 * Insert a new narrative row. Called by the Architect (fire-and-forget
 * during matches) and by the scheduled Edge Function (Phase 8).
 *
 * @param db        Injected Supabase client.
 * @param narrative Partial narrative data (id and created_at are auto-generated).
 * @returns         The inserted Narrative, or `null` on error.
 */
export async function insertNarrative(
  db: IslSupabaseClient,
  narrative: {
    kind: string;
    summary: string;
    entities_involved?: string[];
    source: string;
  },
): Promise<Narrative | null> {
  const { data, error } = await (db as AnyDb) // CAST:entities
    .from('narratives')
    .insert({
      kind: narrative.kind,
      summary: narrative.summary,
      entities_involved: narrative.entities_involved ?? [],
      source: narrative.source,
    })
    .select()
    .single();

  if (error) {
    console.warn('[insertNarrative] failed:', error.message);
    return null;
  }
  return data as Narrative;
}
