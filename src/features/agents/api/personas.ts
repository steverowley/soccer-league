// ── features/agents/api/personas.ts ─────────────────────────────────────────
// Supabase queries for the `entity_persona` table introduced by migration
// 0035_voice_corpus.sql.  Personas are the stable anchor every other
// agent-layer piece grounds on:
//   - Snippets (`entity_snippets`) are scored against the persona's lexicon
//     and constrained by its taboos.
//   - The enricher (Phase 5) builds its prompt around `voice_paragraph +
//     core_quotes + lexicon + taboos`; this static block is the highest-
//     leverage prompt-cache target in the system.
//   - Decision resolvers (Phase 6+) read `personality_vec` and `goals` to
//     shade reflex / reflection / drama outputs.
//
// Personas are created once per entity by the Phase 3 `personaFactory`
// (which calls Haiku to seed `voice_paragraph` + `core_quotes` from
// `entity_traits` + 1-hop `entity_relationships`).  Updates are rare —
// limited to the quarterly re-derivation in Phase 10.
//
// LAYER BOUNDARY
//   - Reads: public (RLS open).
//   - Writes: service-role only (the factory and the quarterly job).

import { z } from 'zod';

import type { IslSupabaseClient } from '@shared/supabase/client';
import type { PersonaInsert, PersonaRow } from '../types';

// ── Zod schema ──────────────────────────────────────────────────────────────
// Personas have JSONB columns whose schema we don't lock down at the DB
// level (different entity kinds carry different goal shapes).  Zod here
// only validates the columns we do constrain — type & shape.

/** Runtime validator for `entity_persona` rows returned from Supabase. */
const PersonaRowSchema = z.object({
  entity_id: z.string().uuid(),
  personality_vec: z.unknown(),
  voice_paragraph: z.string(),
  goals: z.unknown(),
  core_quotes: z.array(z.string()),
  lexicon: z.array(z.string()),
  taboos: z.array(z.string()),
  last_enriched_at: z.string().nullable(),
  updated_at: z.string(),
});

// ── Single-entity read ──────────────────────────────────────────────────────

/**
 * Fetch the persona row for one entity.  Returns null if the entity
 * doesn't have a persona yet (common pre-Phase-3 backfill).  The caller
 * (composer / decision resolver) should treat a missing persona as
 * "fall back to generic" rather than as an error.
 *
 * @param db        Injected Supabase client.
 * @param entityId  Entity whose persona to fetch.
 * @returns         The persona row, or null when missing / on error.
 */
export async function getPersona(
  db: IslSupabaseClient,
  entityId: string,
): Promise<PersonaRow | null> {
  const { data, error } = await db
    .from('entity_persona')
    .select('*')
    .eq('entity_id', entityId)
    .maybeSingle();

  if (error) {
    console.warn('[getPersona] failed:', error.message);
    return null;
  }
  if (!data) return null;

  const parsed = PersonaRowSchema.safeParse(data);
  if (!parsed.success) {
    console.warn('[getPersona] row failed Zod:', parsed.error.message);
    return null;
  }
  return parsed.data as PersonaRow;
}

// ── Bulk-list ───────────────────────────────────────────────────────────────

/**
 * Bulk-fetch personas for many entities.  Used by:
 *   - The Phase 5 enricher's "pick N stale entities" pass to load their
 *     personas in one round trip instead of N-many sequential calls.
 *   - The `prepareCorpusForMatch()` step (Phase 8 hot-path) to hydrate
 *     all match-relevant personas before kickoff so in-match retrieval
 *     stays synchronous.
 *
 * @param db         Injected Supabase client.
 * @param entityIds  Entity IDs whose personas to load.  Order is not
 *                   preserved in the response — caller should index by
 *                   entity_id.
 * @returns          Validated rows; entities without personas are simply
 *                   absent from the result.
 */
export async function listPersonasForEntities(
  db: IslSupabaseClient,
  entityIds: readonly string[],
): Promise<PersonaRow[]> {
  if (entityIds.length === 0) return [];
  const { data, error } = await db
    .from('entity_persona')
    .select('*')
    .in('entity_id', entityIds as string[]);

  if (error) {
    console.warn('[listPersonasForEntities] failed:', error.message);
    return [];
  }

  const validated: PersonaRow[] = [];
  for (const row of data ?? []) {
    const parsed = PersonaRowSchema.safeParse(row);
    if (parsed.success) {
      validated.push(parsed.data as PersonaRow);
    } else {
      console.warn('[listPersonasForEntities] dropped invalid row:', parsed.error.message);
    }
  }
  return validated;
}

// ── Upsert ──────────────────────────────────────────────────────────────────

/**
 * Insert or replace a persona row.  Used by:
 *   - The Phase 3 `personaFactory.create()` when seeding a brand-new
 *     entity (signing, youth promotion, fresh ref hire).
 *   - The Phase 10 quarterly re-derivation when `voice_paragraph` /
 *     `core_quotes` are refreshed from accumulated top-salience memories.
 *
 * RLS in migration 0035 restricts writes to service_role; an authenticated
 * client will receive a permission error.
 *
 * @param db       Injected Supabase client (service-role).
 * @param payload  Insert payload — `entity_id` required, everything else
 *                 has a SQL default.
 * @returns        The upserted row, or null on error.
 */
export async function upsertPersona(
  db: IslSupabaseClient,
  payload: PersonaInsert,
): Promise<PersonaRow | null> {
  const { data, error } = await db
    .from('entity_persona')
    .upsert(payload, { onConflict: 'entity_id' })
    .select('*')
    .single();

  if (error) {
    console.warn('[upsertPersona] failed:', error.message);
    return null;
  }

  const parsed = PersonaRowSchema.safeParse(data);
  if (!parsed.success) {
    console.warn('[upsertPersona] returned row failed Zod:', parsed.error.message);
    return null;
  }
  return parsed.data as PersonaRow;
}
