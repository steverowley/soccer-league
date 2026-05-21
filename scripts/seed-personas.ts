#!/usr/bin/env tsx
// ── scripts/seed-personas.ts ────────────────────────────────────────────────
// One-shot backfill that gives every entity in `entities` a row in
// `entity_persona`.  Phase 3 of the Universal Agent System (bd
// isl-bqx.4): the deterministic foundation that Phase 5's corpus-enricher
// then progressively personalises with LLM-generated voice updates.
//
// WHY THIS SCRIPT EXISTS
//   Migration 0035_voice_corpus.sql created the `entity_persona` table
//   but does not seed it — there are 700+ entities and the persona
//   factory needs each one's traits + 1-hop relationships to produce a
//   coherent row.  Doing that in SQL is awkward; doing it in TS where
//   the factory already lives is cheap.
//
// COST
//   Zero LLM calls.  The Phase 3 factory is intentionally
//   deterministic.  Phase 5 enricher will spend Haiku/Sonnet tokens
//   later to refresh voice_paragraph and core_quotes from accumulated
//   memories; this script just seeds the substrate.
//
// IDEMPOTENCY
//   The factory is pure, and `upsertPersona` keys on entity_id, so
//   re-running this script overwrites rows with the same content.
//   Safe to rerun after a partial failure or after a personaFactory
//   change.
//
// HOW TO RUN
//   SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> npx tsx scripts/seed-personas.ts
//
//   The service-role key is required because RLS on `entity_persona`
//   restricts INSERT/UPDATE to service_role.  NEVER commit the key.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import {
  createPersona,
  type FactoryRelationshipInput,
  type FactoryTraitInput,
} from '../src/features/agents/logic/personaFactory';
import { upsertPersona } from '../src/features/agents/api/personas';
import type { Database } from '../src/types/database';

// ── Environment ─────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env['SUPABASE_URL'] ?? process.env['VITE_SUPABASE_URL'];
const SUPABASE_SERVICE_ROLE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY'];

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    '[seed-personas] Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY environment variables.',
  );
  process.exit(1);
}

/** Service-role-authenticated Supabase client; required for the RLS write path. */
const db: SupabaseClient<Database> = createClient<Database>(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  {
    // No realtime needed; we're doing batch writes from a Node CLI.
    auth: { persistSession: false, autoRefreshToken: false },
  },
);

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Page through the entities table, returning every row.  Supabase's
 * default limit is 1000 — we explicitly request the same so we never
 * silently truncate.
 *
 * @returns Every entity row, in insertion order.
 */
async function fetchAllEntities() {
  const PAGE_SIZE = 1000;
  const all: Array<{
    id: string;
    kind: string;
    name: string;
    display_name: string | null;
    meta: unknown;
  }> = [];
  let from = 0;
  // Loop until we read a short page (< PAGE_SIZE) — that's the natural
  // end-of-pagination signal.
  while (true) {
    const { data, error } = await db
      .from('entities')
      .select('id, kind, name, display_name, meta')
      .range(from, from + PAGE_SIZE - 1)
      .order('created_at', { ascending: true });
    if (error) {
      console.error('[seed-personas] entities fetch failed:', error.message);
      process.exit(2);
    }
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

/**
 * Pre-load every row of entity_traits and group by entity_id so the
 * factory loop is one in-memory lookup per entity rather than 700+
 * individual SELECTs.  Same approach for relationships.
 *
 * @returns A Map keyed by entity_id with the entity's trait rows.
 */
async function fetchTraitsByEntity(): Promise<Map<string, FactoryTraitInput[]>> {
  const out = new Map<string, FactoryTraitInput[]>();
  const { data, error } = await db
    .from('entity_traits')
    .select('entity_id, trait_key, trait_value');
  if (error) {
    console.error('[seed-personas] entity_traits fetch failed:', error.message);
    process.exit(2);
  }
  for (const row of data ?? []) {
    const list = out.get(row.entity_id) ?? [];
    list.push({ trait_key: row.trait_key, trait_value: row.trait_value });
    out.set(row.entity_id, list);
  }
  return out;
}

/**
 * Pre-load every entity_relationships row and index by from_id + to_id so
 * a single lookup returns 1-hop neighbours in either direction.
 *
 * @returns Map keyed by entity_id with that entity's incoming + outgoing relationships.
 */
async function fetchRelationshipsByEntity(): Promise<Map<string, FactoryRelationshipInput[]>> {
  const out = new Map<string, FactoryRelationshipInput[]>();
  const { data, error } = await db
    .from('entity_relationships')
    .select('from_id, to_id, kind, strength');
  if (error) {
    console.error('[seed-personas] entity_relationships fetch failed:', error.message);
    process.exit(2);
  }
  for (const row of data ?? []) {
    // Both endpoints get the row in their neighbour list.
    const fromList = out.get(row.from_id) ?? [];
    fromList.push({
      from_id: row.from_id,
      to_id: row.to_id,
      kind: row.kind,
      ...(typeof row.strength === 'number' ? { strength: row.strength } : {}),
    });
    out.set(row.from_id, fromList);

    const toList = out.get(row.to_id) ?? [];
    toList.push({
      from_id: row.from_id,
      to_id: row.to_id,
      kind: row.kind,
      ...(typeof row.strength === 'number' ? { strength: row.strength } : {}),
    });
    out.set(row.to_id, toList);
  }
  return out;
}

// ── Main ────────────────────────────────────────────────────────────────────

/**
 * Run the backfill: fetch entities + traits + relationships, build a
 * persona per entity via the pure factory, upsert in batches with
 * progress logging.
 */
async function main(): Promise<void> {
  console.log('[seed-personas] starting');

  const [entities, traitsByEntity, relsByEntity] = await Promise.all([
    fetchAllEntities(),
    fetchTraitsByEntity(),
    fetchRelationshipsByEntity(),
  ]);
  console.log(`[seed-personas] fetched ${entities.length} entities`);

  let upserted = 0;
  let failed = 0;
  for (const entity of entities) {
    const traits = traitsByEntity.get(entity.id) ?? [];
    const relationships = relsByEntity.get(entity.id) ?? [];
    const payload = createPersona({ entity, traits, relationships });
    const result = await upsertPersona(db, payload);
    if (result) {
      upserted += 1;
    } else {
      failed += 1;
    }
    // Light progress signal — every 50 rows.  Useful for big runs where
    // a silent CLI looks hung.
    if ((upserted + failed) % 50 === 0) {
      console.log(`[seed-personas] processed ${upserted + failed} / ${entities.length}`);
    }
  }

  console.log(
    `[seed-personas] done: upserted=${upserted}, failed=${failed}, total=${entities.length}`,
  );
  if (failed > 0) {
    process.exit(3);
  }
}

main().catch((err) => {
  console.error('[seed-personas] fatal:', err);
  process.exit(4);
});
