// ── features/match/logic/matchRelationships.ts ───────────────────────────────
// Pre-match relationship hydration for the player decision pipeline.
//
// PURPOSE
// ───────
// The decision blender (decisionBlender.ts) needs entity-graph relationship
// data for up to 46 entities per match (22 home + 22 away + 2 managers +
// 1 referee).  That data lives in the `entity_relationships` table in Supabase.
// We must load it BEFORE the simulation starts, because:
//
//   1. The simulation loop (genEvent, called 90 times) is fully synchronous.
//      No async calls are permitted inside it — the engine must be as fast
//      as possible and predictable in its RNG consumption.
//
//   2. All Architect context (intentions, fate, curses) is also pre-hydrated
//      before kickoff via prepareArchitectForMatch().  This module follows
//      the same pattern so the two systems can be composed without changing
//      the genEvent() contract.
//
// QUERY STRATEGY
// ──────────────
// A single PostgREST query with two `.in()` conditions on the union of all
// participant entity IDs covers every edge that could be relevant to the
// match.  An edge between two entities neither of which plays in this match
// is silently excluded.
//
// The result is indexed into a nested Map: entity_id_A → entity_id_B → edge[].
// Because entity_relationships edges are directed (from_id → to_id), we index
// each edge in BOTH directions so callers can look up "does player A have any
// edge with player B?" without caring which end they're on.
//
// FAILURE POLICY
// ──────────────
// If the Supabase query fails (network error, RLS block, etc.), this module
// returns an empty RelationshipIndex rather than throwing.  The simulation
// then runs with no relationship modifiers — identical to the behaviour
// before Phase 2 was implemented.  A console warning is emitted so the
// operator can diagnose without a hard crash.

import { z } from 'zod';
import type { IslSupabaseClient } from '@shared/supabase/client';
import type { EntityRelationship } from '../../entities/types';
import {
  buildRelationshipContext,
  type RelationshipContext,
} from './decisionBlender';

// ── RelationshipIndex ─────────────────────────────────────────────────────────

/**
 * Pre-loaded, in-memory relationship index for a single match.
 *
 * The outer Map is keyed by entity_id (player, manager, or referee).
 * The inner Map is keyed by the OTHER entity's entity_id.
 * The value is the array of all edges between those two entities (there can
 * be more than one: e.g. a 'rivalry' AND a 'former_teammates' edge between
 * the same pair).
 *
 * Both directions of every edge are indexed, so looking up (A → B) and
 * (B → A) both work regardless of which end was `from_id` in the DB row.
 *
 * Use getEdgesBetween() rather than accessing the nested Maps directly —
 * it handles the undefined-key case and always returns a fresh array.
 */
export interface RelationshipIndex {
  readonly byEntity: ReadonlyMap<string, ReadonlyMap<string, EntityRelationship[]>>;
}

/** An empty index — returned on query failure or when no entity IDs are supplied. */
const EMPTY_INDEX: RelationshipIndex = { byEntity: new Map() };

// ── Zod row schema ────────────────────────────────────────────────────────────
//
// We re-validate at the boundary rather than trusting the generated Database
// type, because:
//   • PostgREST can drop columns under RLS rules.
//   • The `meta` column is JSONB and can be any shape; we normalise null → {}.
//   • `strength` is INT in Postgres but arrives as `number` in JSON — Zod
//     confirms this rather than assuming.

const RelRowSchema = z.object({
  from_id:  z.string(),
  to_id:    z.string(),
  kind:     z.string(),
  strength: z.number(),
  meta:     z.unknown().nullable(),
});

function toRelationship(row: z.infer<typeof RelRowSchema>): EntityRelationship {
  return {
    from_id:  row.from_id,
    to_id:    row.to_id,
    kind:     row.kind,
    strength: row.strength,
    meta: (row.meta && typeof row.meta === 'object' && !Array.isArray(row.meta))
      ? (row.meta as Record<string, unknown>)
      : {},
  };
}

// ── Index builder ─────────────────────────────────────────────────────────────

/**
 * Insert one edge into the mutable index in BOTH directions.
 *
 * Indexing both directions means:
 *   getEdgesBetween(index, A, B)  and
 *   getEdgesBetween(index, B, A)
 * both return the same edge, which is what the blender needs — it doesn't
 * know (or care) which player initiated the relationship.
 */
function indexEdge(
  index: Map<string, Map<string, EntityRelationship[]>>,
  edge:  EntityRelationship,
): void {
  for (const [from, to] of [[edge.from_id, edge.to_id], [edge.to_id, edge.from_id]] as const) {
    let inner = index.get(from);
    if (!inner) {
      inner = new Map<string, EntityRelationship[]>();
      index.set(from, inner);
    }
    let arr = inner.get(to);
    if (!arr) {
      arr = [];
      inner.set(to, arr);
    }
    // Avoid double-insertion when from_id === to_id (self-loop) — the loop
    // above would push the same edge twice for the same key pair.
    if (!arr.includes(edge)) arr.push(edge);
  }
}

// ── Main export: preloadMatchRelationships ───────────────────────────────────

/**
 * Fetch all entity-graph relationships relevant to a match and build an
 * in-memory index for synchronous lookups during simulation.
 *
 * Must be called ONCE before the simulation loop starts.  The returned
 * RelationshipIndex is then passed (or closed over) by the genEvent() caller
 * so the simulation never touches the network.
 *
 * QUERY DETAILS
 * ─────────────
 * One Supabase query with `.or('from_id.in.(...),to_id.in.(...)')` using the
 * union of all participant entity IDs.  This returns every edge where AT LEAST
 * ONE endpoint is a match participant — which is all we need, because an edge
 * between two non-participants can never affect the match.
 *
 * Maximum entity IDs per query: 46 (22 + 22 players + 2 managers + referee).
 * PostgREST handles this comfortably; `in` arrays up to ~1 000 items are fine.
 *
 * @param db             Injected Supabase client (service-role in the worker,
 *                       anon/user in the browser preview — RLS governs what
 *                       entity_relationships rows are readable).
 * @param participantIds All entity_ids of players, managers, and the referee
 *                       taking part in this match.  Duplicates and nulls are
 *                       filtered out before the query.  An empty set short-
 *                       circuits to an empty index without a network call.
 * @returns              Pre-built RelationshipIndex, or EMPTY_INDEX on error.
 */
export async function preloadMatchRelationships(
  db:             IslSupabaseClient,
  participantIds: readonly (string | null | undefined)[],
): Promise<RelationshipIndex> {
  // ── Dedupe and filter nulls ────────────────────────────────────────────────
  // entity_id columns are nullable on old player rows (migration 0002 added
  // the column; rows inserted before that have entity_id = null).  We skip
  // nulls — those players simply have no relationship context.
  const ids = Array.from(new Set(participantIds.filter((id): id is string => !!id)));

  // Short-circuit: no entity IDs means nothing to query.
  if (ids.length === 0) return EMPTY_INDEX;

  // ── Single query: edges where any participant appears on either end ────────
  // PostgREST's `.or()` with two `.in()` conditions is the most efficient
  // single-round-trip approach.  We select only the columns we need; `meta`
  // is included because some relationship kinds store extra data there (e.g.
  // 'shared_homeworld' stores the planet name for narrative use).
  const { data, error } = await db
    .from('entity_relationships')
    .select('from_id, to_id, kind, strength, meta')
    .or(`from_id.in.(${ids.join(',')}),to_id.in.(${ids.join(',')})`)
    // Reasonable upper bound: 46 participants × average 5 edges each = ~230 rows.
    // A limit of 2 000 gives headroom for highly-connected entities (pundits,
    // journalists) that may appear as relationship endpoints through the Architect.
    .limit(2000);

  if (error) {
    console.warn('[matchRelationships] query failed:', error.message);
    return EMPTY_INDEX;
  }

  if (!data || data.length === 0) return EMPTY_INDEX;

  // ── Validate and index ────────────────────────────────────────────────────
  const index = new Map<string, Map<string, EntityRelationship[]>>();

  for (const row of data) {
    const parsed = RelRowSchema.safeParse(row);
    if (!parsed.success) {
      // Drop malformed rows with a warning — don't crash the whole match.
      console.warn('[matchRelationships] dropped invalid row:', parsed.error.message);
      continue;
    }
    indexEdge(index, toRelationship(parsed.data));
  }

  return { byEntity: index };
}

// ── Query helpers ─────────────────────────────────────────────────────────────

/**
 * Return all relationship edges between two specific entities.
 *
 * Order of arguments is irrelevant — both (A, B) and (B, A) return the same
 * edges because the index stores both directions.
 *
 * Returns an empty array (never null/undefined) when no edges exist,
 * which makes caller code cleaner: `for (const rel of getEdgesBetween(...))`
 * works without a null check.
 *
 * @param index    The pre-loaded RelationshipIndex from preloadMatchRelationships().
 * @param entityA  First entity's entity_id.
 * @param entityB  Second entity's entity_id.
 * @returns        Array of matching edges; empty when none exist.
 */
export function getEdgesBetween(
  index:   RelationshipIndex,
  entityA: string,
  entityB: string,
): EntityRelationship[] {
  return index.byEntity.get(entityA)?.get(entityB) ?? [];
}

/**
 * Return all edges incident on a single entity — i.e. every relationship
 * this entity has with any other match participant.
 *
 * @param index    The pre-loaded RelationshipIndex.
 * @param entityId The entity whose edges we want.
 * @returns        Deduplicated array of all edges touching this entity.
 */
export function getEdgesFor(
  index:    RelationshipIndex,
  entityId: string,
): EntityRelationship[] {
  const inner = index.byEntity.get(entityId);
  if (!inner) return [];

  // The inner map keys are "other entity IDs"; values are edge arrays.
  // Flatten them. Edges are stored in both directions so each edge appears
  // once here (from the perspective of entityId as the pivot).
  const seen = new Set<string>();
  const result: EntityRelationship[] = [];
  for (const [, edges] of inner) {
    for (const edge of edges) {
      // Dedupe by canonical PK: (from_id, to_id, kind)
      const pk = `${edge.from_id}|${edge.to_id}|${edge.kind}`;
      if (!seen.has(pk)) {
        seen.add(pk);
        result.push(edge);
      }
    }
  }
  return result;
}

// ── Per-player context builder ────────────────────────────────────────────────

/**
 * Build a RelationshipContext for every player on the pitch, ready to be
 * passed into blendDecision().
 *
 * This is a convenience wrapper that calls buildRelationshipContext() from
 * decisionBlender.ts for each player, using the pre-loaded index to avoid
 * repeated DB calls.
 *
 * @param index            Pre-loaded index from preloadMatchRelationships().
 * @param homePlayerIds    entity_ids of home starters (null entries skipped).
 * @param awayPlayerIds    entity_ids of away starters (null entries skipped).
 * @param homeManagerId    entity_id of the home manager (null if not in graph).
 * @param awayManagerId    entity_id of the away manager (null if not in graph).
 * @returns                Map from entity_id → RelationshipContext, covering
 *                         every player whose entity_id is non-null.
 */
export function buildAllRelationshipContexts(
  index:          RelationshipIndex,
  homePlayerIds:  readonly (string | null | undefined)[],
  awayPlayerIds:  readonly (string | null | undefined)[],
  homeManagerId:  string | null | undefined,
  awayManagerId:  string | null | undefined,
): Map<string, RelationshipContext> {
  const result = new Map<string, RelationshipContext>();

  // Build entity-ID sets for fast membership checks inside buildRelationshipContext
  const homeIds = new Set(homePlayerIds.filter((id): id is string => !!id));
  const awayIds = new Set(awayPlayerIds.filter((id): id is string => !!id));

  // Process home players (opponents = awayIds; manager = homeManagerId)
  for (const playerId of homeIds) {
    const edges = getEdgesFor(index, playerId);
    result.set(
      playerId,
      buildRelationshipContext(
        playerId,
        homeManagerId ?? null,
        homeIds,
        awayIds,
        edges,
      ),
    );
  }

  // Process away players (opponents = homeIds; manager = awayManagerId)
  for (const playerId of awayIds) {
    const edges = getEdgesFor(index, playerId);
    result.set(
      playerId,
      buildRelationshipContext(
        playerId,
        awayManagerId ?? null,
        awayIds,
        homeIds,
        edges,
      ),
    );
  }

  return result;
}
