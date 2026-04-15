// ── entities/logic/relationshipGraph.ts ──────────────────────────────────────
// WHY: Pure graph utilities over a pre-fetched array of `entity_relationships`
// rows. No React, no Supabase. The Architect's context hydration loads the
// relationship table into memory once per match (typically a few hundred
// rows) and then runs many cheap synchronous traversals during the sim loop:
//
//   • "Who does this pundit dislike?" → neighbours(pundit_id, { minStrength: -100, maxStrength: -20 })
//   • "Are these two entities connected?" → areConnected(a, b)
//   • "What's the rivalry chain between these teams?" → findPath(a, b)
//
// All functions operate on the in-memory edge list. The graph is built
// lazily via an index (`buildGraph`) so repeated queries against the same
// dataset don't re-scan the array. Callers can either:
//
//   a) Use the one-shot helpers (`neighbours`, `findRelationship`) for a
//      single lookup — these walk the array linearly. Fine for small
//      relationship tables or one-off queries.
//   b) Call `buildGraph(relationships)` once and reuse the returned
//      `RelationshipGraph` object for multiple lookups. This pays a one-
//      time O(E) indexing cost and gives O(degree) lookups afterwards.
//
// PERFORMANCE NOTES:
//   - Typical Season 1 relationship count: ~0 (no relationships are seeded
//     in 0002_entities.sql; the Architect creates them at runtime).
//   - Phase 8 will introduce autonomous relationship generation; the
//     expected ceiling is a few thousand edges across the whole league.
//   - findPath uses BFS with a depth limit (default 4) to cap worst-case
//     behaviour on dense graphs. A chain longer than 4 hops is useless
//     for narrative purposes anyway ("X's mentor's teammate's rival's
//     journalist" is nonsense).

import type { EntityRelationship } from '../types';

// ── Types ───────────────────────────────────────────────────────────────────

/**
 * Options for `neighbours()` and its cousins — filter edges by kind and
 * by strength range. All fields are optional; omitting a filter means
 * "don't filter on this dimension".
 */
export interface RelationshipFilter {
  /** Match only this relationship kind (e.g. 'rival', 'mentor'). */
  kind?: string;
  /**
   * Minimum strength (inclusive). Use -100 or omit to include hostile
   * relationships. Use +20 to filter to "friendly or better".
   */
  minStrength?: number;
  /**
   * Maximum strength (inclusive). Use +100 or omit to include allied
   * relationships. Use -20 to filter to "hostile or worse".
   */
  maxStrength?: number;
}

/**
 * Indexed relationship graph built by `buildGraph()`. Holds the original
 * edge list plus adjacency maps for fast lookup:
 *
 *   outgoing:  from_id → edges where this entity is the source
 *   incoming:  to_id   → edges where this entity is the target
 *
 * Both maps index the SAME edges from different angles. An undirected
 * neighbour query (`neighbours`) unions the two; a directed query
 * (`outgoing`/`incoming`) reads only one side.
 */
export interface RelationshipGraph {
  readonly edges: readonly EntityRelationship[];
  readonly outgoing: ReadonlyMap<string, readonly EntityRelationship[]>;
  readonly incoming: ReadonlyMap<string, readonly EntityRelationship[]>;
}

// ── Constants ───────────────────────────────────────────────────────────────

/**
 * Default cap on path-finding depth. BFS up to this many hops inclusive.
 *
 * Rationale: narrative chains longer than 4 hops ("enemy of my friend's
 * mentor's journalist") read as word salad when the Architect tries to
 * riff on them. Capping at 4 also bounds worst-case BFS on dense graphs
 * so a future runaway seed can't wedge the match prep.
 */
export const DEFAULT_MAX_HOPS = 4;

// ── buildGraph ──────────────────────────────────────────────────────────────

/**
 * Index an edge list into adjacency maps for fast repeat lookups. Call
 * this once per match (during pre-hydration) and reuse the returned
 * object for all subsequent queries within the match.
 *
 * The build is O(E) in time and space. Both adjacency maps store
 * references to the original edge objects — no cloning — so the indexed
 * graph shares memory with the input array.
 *
 * @param relationships  The full edge list loaded from `entity_relationships`.
 * @returns              Indexed graph with outgoing/incoming adjacency maps.
 */
export function buildGraph(
  relationships: readonly EntityRelationship[],
): RelationshipGraph {
  // Local mutable maps — we freeze into ReadonlyMap at the boundary.
  const out = new Map<string, EntityRelationship[]>();
  const inc = new Map<string, EntityRelationship[]>();

  // Single pass over the edge list: push each edge onto both adjacency maps.
  for (const edge of relationships) {
    // ── Outgoing index ────────────────────────────────────────────────────
    let o = out.get(edge.from_id);
    if (!o) {
      o = [];
      out.set(edge.from_id, o);
    }
    o.push(edge);

    // ── Incoming index ────────────────────────────────────────────────────
    let i = inc.get(edge.to_id);
    if (!i) {
      i = [];
      inc.set(edge.to_id, i);
    }
    i.push(edge);
  }

  return {
    edges: relationships,
    outgoing: out,
    incoming: inc,
  };
}

// ── Internal helpers ────────────────────────────────────────────────────────

/**
 * Test whether an edge matches all fields of a RelationshipFilter. Missing
 * filter fields are treated as "any value matches".
 */
function edgeMatches(
  edge: EntityRelationship,
  filter: RelationshipFilter | undefined,
): boolean {
  if (!filter) return true;
  if (filter.kind !== undefined && edge.kind !== filter.kind) return false;
  if (filter.minStrength !== undefined && edge.strength < filter.minStrength) {
    return false;
  }
  if (filter.maxStrength !== undefined && edge.strength > filter.maxStrength) {
    return false;
  }
  return true;
}

// ── Query: outgoing / incoming / neighbours ─────────────────────────────────

/**
 * Edges where `entityId` is the source (from_id). Applies an optional
 * filter on kind and strength.
 *
 * @param graph     Indexed graph from `buildGraph()`.
 * @param entityId  The source entity's UUID.
 * @param filter    Optional kind/strength filter.
 * @returns         Array of matching edges (fresh array; caller may mutate).
 */
export function outgoing(
  graph: RelationshipGraph,
  entityId: string,
  filter?: RelationshipFilter,
): EntityRelationship[] {
  const edges = graph.outgoing.get(entityId) ?? [];
  return edges.filter((e) => edgeMatches(e, filter));
}

/**
 * Edges where `entityId` is the target (to_id). Applies an optional
 * filter on kind and strength.
 *
 * @param graph     Indexed graph from `buildGraph()`.
 * @param entityId  The target entity's UUID.
 * @param filter    Optional kind/strength filter.
 * @returns         Array of matching edges (fresh array; caller may mutate).
 */
export function incoming(
  graph: RelationshipGraph,
  entityId: string,
  filter?: RelationshipFilter,
): EntityRelationship[] {
  const edges = graph.incoming.get(entityId) ?? [];
  return edges.filter((e) => edgeMatches(e, filter));
}

/**
 * All edges incident on `entityId` — both outgoing and incoming —
 * deduplicated by (from_id, to_id, kind) so a self-loop isn't counted
 * twice. Applies an optional filter on kind and strength.
 *
 * Use this when you want "everyone this entity is connected to" without
 * caring about direction.
 *
 * @param graph     Indexed graph from `buildGraph()`.
 * @param entityId  The pivot entity's UUID.
 * @param filter    Optional kind/strength filter.
 * @returns         Array of matching edges (fresh array).
 */
export function neighbours(
  graph: RelationshipGraph,
  entityId: string,
  filter?: RelationshipFilter,
): EntityRelationship[] {
  const outs = graph.outgoing.get(entityId) ?? [];
  const ins = graph.incoming.get(entityId) ?? [];

  // Merge and dedupe. Self-loops (from_id === to_id) would otherwise appear
  // in both adjacency lists; we canonicalise on the (from, to, kind) triple.
  const seen = new Set<string>();
  const merged: EntityRelationship[] = [];
  for (const edge of [...outs, ...ins]) {
    const key = `${edge.from_id}\u0000${edge.to_id}\u0000${edge.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (edgeMatches(edge, filter)) merged.push(edge);
  }
  return merged;
}

/**
 * The set of entity IDs directly connected to `entityId`, regardless of
 * direction. Useful for BFS seed sets and "who does X know?" queries.
 *
 * @param graph     Indexed graph.
 * @param entityId  Pivot entity UUID.
 * @param filter    Optional kind/strength filter applied to the edges
 *                  BEFORE extracting the other endpoint.
 * @returns         Set of neighbour entity IDs (excludes entityId itself).
 */
export function neighbourIds(
  graph: RelationshipGraph,
  entityId: string,
  filter?: RelationshipFilter,
): Set<string> {
  const ids = new Set<string>();
  for (const edge of neighbours(graph, entityId, filter)) {
    // Add whichever endpoint is NOT the pivot. Self-loops contribute
    // nothing (the pivot is already implicit) and are skipped here.
    if (edge.from_id !== entityId) ids.add(edge.from_id);
    if (edge.to_id !== entityId) ids.add(edge.to_id);
  }
  return ids;
}

// ── Query: specific edges ───────────────────────────────────────────────────

/**
 * Find the directed edge from → to with a specific kind, if one exists.
 * The (from_id, to_id, kind) triple is the primary key of the
 * entity_relationships table, so at most one such edge can exist.
 *
 * @param graph    Indexed graph.
 * @param fromId   Source entity UUID.
 * @param toId     Target entity UUID.
 * @param kind     Relationship kind (e.g. 'rival').
 * @returns        The edge if present, else `undefined`.
 */
export function findRelationship(
  graph: RelationshipGraph,
  fromId: string,
  toId: string,
  kind: string,
): EntityRelationship | undefined {
  const out = graph.outgoing.get(fromId);
  if (!out) return undefined;
  return out.find((e) => e.to_id === toId && e.kind === kind);
}

/**
 * Test whether any edge exists between `a` and `b` in either direction,
 * optionally restricted to a specific kind.
 *
 * @param graph  Indexed graph.
 * @param a      First entity UUID.
 * @param b      Second entity UUID.
 * @param kind   Optional kind restriction.
 * @returns      `true` iff at least one matching edge exists in either direction.
 */
export function areConnected(
  graph: RelationshipGraph,
  a: string,
  b: string,
  kind?: string,
): boolean {
  const out = graph.outgoing.get(a) ?? [];
  for (const edge of out) {
    if (edge.to_id === b && (kind === undefined || edge.kind === kind)) {
      return true;
    }
  }
  const inc = graph.incoming.get(a) ?? [];
  for (const edge of inc) {
    if (edge.from_id === b && (kind === undefined || edge.kind === kind)) {
      return true;
    }
  }
  return false;
}

// ── Path finding ────────────────────────────────────────────────────────────

/**
 * Options for `findPath()`.
 */
export interface FindPathOptions {
  /**
   * Maximum hop count. Paths longer than this are discarded. Defaults to
   * `DEFAULT_MAX_HOPS` (4) to bound worst-case BFS cost on dense graphs
   * and keep narrative chains readable.
   */
  maxHops?: number;
  /**
   * Optional filter applied to every edge considered during traversal.
   * Useful for "find the shortest RIVALRY chain" queries.
   */
  filter?: RelationshipFilter;
  /**
   * If `true`, traverse edges in both directions (ignoring
   * from_id→to_id). If `false`, only follow outgoing edges. Defaults
   * to `true` because most narrative questions are direction-agnostic.
   */
  undirected?: boolean;
}

/**
 * Shortest path between two entities in terms of hop count, or `null` if
 * none exists within `maxHops`. Returns the sequence of entity IDs
 * including both endpoints; an empty array is never returned.
 *
 * Uses breadth-first search so the returned path is optimal in hop count.
 * Ties are broken by insertion order of the adjacency maps (i.e. by the
 * order of edges in the original array).
 *
 * @example
 *   findPath(graph, 'manager-a', 'journalist-z')
 *   // → ['manager-a', 'pundit-x', 'journalist-z']  (2 hops)
 */
export function findPath(
  graph: RelationshipGraph,
  fromId: string,
  toId: string,
  opts: FindPathOptions = {},
): string[] | null {
  // ── Edge cases ────────────────────────────────────────────────────────
  // A self-path is trivially just [from]. We return it rather than null
  // so callers can distinguish "you already are this entity" from
  // "unreachable". Zero-hop paths are useful for recursive builders.
  if (fromId === toId) return [fromId];

  const maxHops = opts.maxHops ?? DEFAULT_MAX_HOPS;
  const undirected = opts.undirected ?? true;
  const filter = opts.filter;

  // ── BFS state ─────────────────────────────────────────────────────────
  // `predecessors` maps each discovered node to the node we came from,
  // used to reconstruct the path when we reach the target. Entries for
  // the root are the sentinel empty string — we only reconstruct back
  // until we encounter it.
  const predecessors = new Map<string, string>();
  predecessors.set(fromId, '');
  const queue: Array<{ id: string; depth: number }> = [{ id: fromId, depth: 0 }];

  while (queue.length > 0) {
    const node = queue.shift();
    if (!node) break; // should not happen; appeases TS
    if (node.depth >= maxHops) continue;

    // ── Gather adjacent edges ────────────────────────────────────────────
    // Undirected traversal unions outgoing + incoming so we can walk
    // backwards across the edge direction. Directed traversal only looks
    // at outgoing.
    const adj = undirected
      ? neighbours(graph, node.id, filter)
      : outgoing(graph, node.id, filter);

    for (const edge of adj) {
      // Extract the "other" endpoint relative to the current node.
      const next = edge.from_id === node.id ? edge.to_id : edge.from_id;
      // Skip already-seen nodes — BFS doesn't revisit.
      if (predecessors.has(next)) continue;

      predecessors.set(next, node.id);
      if (next === toId) {
        // ── Reconstruct path by walking predecessors back to the root ──
        const path: string[] = [next];
        let cursor = node.id;
        while (cursor !== '' && cursor !== fromId) {
          path.push(cursor);
          const prev = predecessors.get(cursor);
          if (prev === undefined) break;
          cursor = prev;
        }
        path.push(fromId);
        path.reverse();
        return path;
      }
      queue.push({ id: next, depth: node.depth + 1 });
    }
  }

  return null;
}

// ── Aggregates ──────────────────────────────────────────────────────────────

/**
 * Sum the strength of all matching incident edges on an entity — a crude
 * proxy for "how liked/disliked is this entity overall?" Useful for the
 * Architect when colouring generic narratives (if an entity has strongly
 * negative total strength, describe the vibe as "embattled", etc.).
 *
 * @param graph     Indexed graph.
 * @param entityId  Pivot entity UUID.
 * @param filter    Optional kind/strength filter.
 * @returns         Summed strength across all matching incident edges.
 */
export function totalStrength(
  graph: RelationshipGraph,
  entityId: string,
  filter?: RelationshipFilter,
): number {
  let total = 0;
  for (const edge of neighbours(graph, entityId, filter)) {
    total += edge.strength;
  }
  return total;
}

/**
 * Count matching incident edges on an entity. Convenience wrapper around
 * `neighbours(...).length` that doesn't allocate the intermediate array.
 *
 * @param graph     Indexed graph.
 * @param entityId  Pivot entity UUID.
 * @param filter    Optional kind/strength filter.
 * @returns         Degree count (outgoing + incoming, deduplicated).
 */
export function degree(
  graph: RelationshipGraph,
  entityId: string,
  filter?: RelationshipFilter,
): number {
  return neighbours(graph, entityId, filter).length;
}
