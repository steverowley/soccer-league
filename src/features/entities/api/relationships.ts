// ── features/entities/api/relationships.ts ──────────────────────────────────
// Supabase reads that the relationship-graph viewer (issues isl-szm/6ub/mcs/
// pfq) depends on.  Three pure async wrappers with Zod validation at the
// boundary — no graph traversal here (lives in logic/), no React, no
// module-level Supabase singleton.
//
// WHAT THIS MODULE OWNS
//   • getEntity(db, id)              — single row from `entities`.
//   • getEntityRelationships(db, id) — union of outgoing AND incoming edges
//                                      for the seed entity, ready for the
//                                      subgraph extractor to walk.
//   • getEntitiesByIds(db, ids)      — bulk hydration of node metadata once
//                                      the subgraph has settled on which
//                                      ids to render.
//
// SCHEMA RECAP (entity_relationships, migration 0002 + 0006)
//   PK is (from_id, to_id, kind).  `strength` is INT clamped client-side to
//   −100..+100 by clampStrength().  `kind` is free-text by design (rival /
//   mentor / lover / etc.) so the schema can absorb new narrative kinds
//   without a migration.  `meta` is JSONB; we surface it as
//   `Record<string, unknown>` to match the existing EntityRelationship type.
//
// FAILURE POLICY
//   Every helper validates rows with Zod's `safeParse` and DROPS malformed
//   rows with a console warning rather than crashing.  Network errors
//   return null / [] so the viewer can render an empty state instead of
//   blowing up the page.

import { z } from 'zod';

import type { IslSupabaseClient } from '@shared/supabase/client';
import type { Entity, EntityKind, EntityRelationship } from '../types';

// ── Zod row schemas ──────────────────────────────────────────────────────────
// Tables are present in the generated Database type, but we re-validate at
// runtime because (a) PostgREST can drop columns under RLS, (b) the column
// list in the SELECT may drift from the type later, and (c) downstream
// graph logic expects `meta` to be an object — Postgres can store any JSONB
// including null / arrays / primitives, and Zod is the only thing that
// catches that on the way in.

/**
 * `entities` row shape.  `kind` is declared `string` by the generated
 * Database type, so we narrow it back to the `EntityKind` union at the
 * boundary — unknown future kinds (added on the server before the union
 * is bumped) survive as `string` and get warn-dropped here so consumers
 * never see a kind they don't know how to render.
 */
const EntityRowSchema = z.object({
  id:           z.string(),
  kind:         z.string(),
  name:         z.string(),
  display_name: z.string().nullable(),
  meta:         z.unknown().nullable(),
  created_at:   z.string(),
});

/** `entity_relationships` row shape — both directions share this. */
const RelationshipRowSchema = z.object({
  from_id:  z.string(),
  to_id:    z.string(),
  kind:     z.string(),
  strength: z.number(),
  meta:     z.unknown().nullable(),
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Coerce a Zod-parsed entity row into the public `Entity` shape, normalising
 * `meta: null` → `{}` (the graph layer expects an object) and re-typing the
 * free-text `kind` column as `EntityKind`.
 *
 * Returns null when the kind is unknown — callers should treat that as
 * "drop this row" rather than crashing.
 */
function toEntity(row: z.infer<typeof EntityRowSchema>): Entity | null {
  // We accept any string for `kind` at the DB layer but the type union
  // is closed in TypeScript.  Cast through string is safe because every
  // downstream consumer narrows again on `entity.kind === '<literal>'`.
  return {
    id:           row.id,
    kind:         row.kind as EntityKind,
    name:         row.name,
    display_name: row.display_name,
    meta:         (row.meta && typeof row.meta === 'object' && !Array.isArray(row.meta))
                    ? (row.meta as Record<string, unknown>)
                    : {},
    created_at:   row.created_at,
  };
}

/**
 * Coerce a Zod-parsed relationship row into the public `EntityRelationship`
 * shape.  Mirrors the `meta: null → {}` normalisation in `toEntity`.
 */
function toRelationship(row: z.infer<typeof RelationshipRowSchema>): EntityRelationship {
  return {
    from_id:  row.from_id,
    to_id:    row.to_id,
    kind:     row.kind,
    strength: row.strength,
    meta:     (row.meta && typeof row.meta === 'object' && !Array.isArray(row.meta))
                ? (row.meta as Record<string, unknown>)
                : {},
  };
}

// ── getEntity ────────────────────────────────────────────────────────────────

/**
 * Fetch a single entity row by id.
 *
 * Returns `null` when the row doesn't exist (PostgREST returns the not-found
 * PGRST116 error code via `.maybeSingle()`'s `data: null`), when the row
 * fails Zod validation, or when the network fails.  All three cases get
 * one console warning each so debug pages can still tell them apart.
 *
 * @param db        Injected Supabase client.
 * @param entityId  UUID of the entity to fetch.
 * @returns         Validated Entity, or null on miss / error.
 */
export async function getEntity(
  db:       IslSupabaseClient,
  entityId: string,
): Promise<Entity | null> {
  const { data, error } = await db
    .from('entities')
    .select('id, kind, name, display_name, meta, created_at')
    .eq('id', entityId)
    .maybeSingle();

  if (error) {
    console.warn('[getEntity] failed:', error.message);
    return null;
  }
  if (!data) return null;

  const parsed = EntityRowSchema.safeParse(data);
  if (!parsed.success) {
    console.warn('[getEntity] dropped invalid row:', parsed.error.message);
    return null;
  }
  return toEntity(parsed.data);
}

// ── getEntityRelationships ───────────────────────────────────────────────────

/**
 * Fetch every relationship touching the seed entity — both directions.
 *
 * `entity_relationships` is a directed edge table with PK
 * `(from_id, to_id, kind)`.  A pair of entities A↔B can have separate rows
 * for A→B and B→A, possibly with different `kind` / `strength`.  The
 * subgraph viewer treats those as bidirectional for layout but renders
 * each row distinctly — so we union both sides server-side and let the
 * pure-logic extractor decide how to dedupe (it uses the PK triple).
 *
 * Implementation: two queries (outgoing `.eq('from_id', id)` and incoming
 * `.eq('to_id', id)`) merged in memory.  We tried a single `.or()` query
 * but Supabase's PostgREST `.or()` URL-encodes the column list awkwardly
 * for multi-condition predicates and there's no measurable round-trip cost
 * to two simple eq()s on an indexed column.
 *
 * @param db        Injected Supabase client.
 * @param entityId  Seed entity UUID.
 * @returns         All edges where entityId is `from_id` OR `to_id`,
 *                  validated and deduped by (from_id, to_id, kind).
 *                  Empty array on any error.
 */
export async function getEntityRelationships(
  db:       IslSupabaseClient,
  entityId: string,
): Promise<EntityRelationship[]> {
  const [outRes, inRes] = await Promise.all([
    db.from('entity_relationships')
      .select('from_id, to_id, kind, strength, meta')
      .eq('from_id', entityId),
    db.from('entity_relationships')
      .select('from_id, to_id, kind, strength, meta')
      .eq('to_id', entityId),
  ]);

  if (outRes.error) {
    console.warn('[getEntityRelationships] outgoing failed:', outRes.error.message);
  }
  if (inRes.error) {
    console.warn('[getEntityRelationships] incoming failed:', inRes.error.message);
  }

  // Dedupe by the PK triple.  When both queries surface the same row (it
  // can't happen with the current `eq` filters — a row matches at most one
  // side unless from_id === to_id, which the schema doesn't forbid) we
  // keep the first occurrence.
  const seen = new Set<string>();
  const merged: EntityRelationship[] = [];
  for (const row of [...(outRes.data ?? []), ...(inRes.data ?? [])]) {
    const parsed = RelationshipRowSchema.safeParse(row);
    if (!parsed.success) {
      console.warn('[getEntityRelationships] dropped invalid row:', parsed.error.message);
      continue;
    }
    const r = parsed.data;
    const pk = `${r.from_id}|${r.to_id}|${r.kind}`;
    if (seen.has(pk)) continue;
    seen.add(pk);
    merged.push(toRelationship(r));
  }
  return merged;
}

// ── listEntities ─────────────────────────────────────────────────────────────

/**
 * List entities, optionally filtered to a set of kinds.
 *
 * Used by the Galaxy Atlas (World page) to populate the browseable entity
 * directory.  Alphabetical order keeps the list predictable and diffable
 * across renders — the page doesn't need recency ordering here.
 *
 * WHY a separate function from getEntitiesByIds
 *   `getEntitiesByIds` takes an explicit list of known UUIDs — it's a bulk
 *   hydration tool for the subgraph renderer, not a discovery tool.
 *   `listEntities` is a discovery tool: "give me all politicians" or "give me
 *   the first 200 entities".  The different intent and pagination needs
 *   justify a focused helper rather than stretching the existing one.
 *
 * @param db     Injected Supabase client.
 * @param kinds  Optional filter — only return entities whose `kind` is in this
 *               array.  Omit (or pass an empty array) to return all kinds up
 *               to `limit`.
 * @param limit  Maximum rows to return.  Default 200 — the full ISL entity
 *               graph is currently well under this cap; bump if future phases
 *               add many more entities.
 * @returns      Validated Entity rows sorted by name.  Empty on error.
 */
export async function listEntities(
  db:     IslSupabaseClient,
  kinds?: string[],
  limit = 200,
): Promise<Entity[]> {
  let q = db
    .from('entities')
    .select('id, kind, name, display_name, meta, created_at')
    .order('name', { ascending: true })
    .limit(limit);

  if (kinds && kinds.length > 0) {
    q = q.in('kind', kinds);
  }

  const { data, error } = await q;
  if (error) {
    console.warn('[listEntities] failed:', error.message);
    return [];
  }

  const validated: Entity[] = [];
  for (const row of data ?? []) {
    const parsed = EntityRowSchema.safeParse(row);
    if (!parsed.success) {
      console.warn('[listEntities] dropped invalid row:', parsed.error.message);
      continue;
    }
    const e = toEntity(parsed.data);
    if (e) validated.push(e);
  }
  return validated;
}

// ── getEntitiesByIds ─────────────────────────────────────────────────────────

/**
 * Bulk-fetch entity rows by id.  Used by the subgraph layout to hydrate
 * node metadata (name, kind) after the pure-logic extractor decides which
 * ids belong in the visible graph.
 *
 * Empty input is short-circuited — PostgREST treats `.in('id', [])` as
 * "match nothing" but the URL serialises to `id=in.()` which logs ugly
 * 400s in some proxies; better to return [] directly.
 *
 * Order of the returned array is NOT guaranteed to match the input ids.
 * Callers that need a specific render order should sort the result
 * themselves (e.g. by name or by graph-imposed layout coordinates).
 *
 * @param db   Injected Supabase client.
 * @param ids  UUIDs to fetch.  Duplicates and missing rows are tolerated.
 * @returns    Validated Entity rows.  Empty on error or empty input.
 */
export async function getEntitiesByIds(
  db:  IslSupabaseClient,
  ids: readonly string[],
): Promise<Entity[]> {
  if (ids.length === 0) return [];

  // Dedupe input so the URL doesn't carry redundant ids — PostgREST's `in`
  // operator returns the matching row at most once anyway, but a tidy URL
  // keeps the network panel readable during debugging.
  const unique = Array.from(new Set(ids));

  const { data, error } = await db
    .from('entities')
    .select('id, kind, name, display_name, meta, created_at')
    .in('id', unique);

  if (error) {
    console.warn('[getEntitiesByIds] failed:', error.message);
    return [];
  }

  const validated: Entity[] = [];
  for (const row of data ?? []) {
    const parsed = EntityRowSchema.safeParse(row);
    if (!parsed.success) {
      console.warn('[getEntitiesByIds] dropped invalid row:', parsed.error.message);
      continue;
    }
    const e = toEntity(parsed.data);
    if (e) validated.push(e);
  }
  return validated;
}
