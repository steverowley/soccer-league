// ── features/entities/logic/subgraph.ts ─────────────────────────────────────
// Pure-logic subgraph extractor for the relationship-graph viewer (issue
// isl-6ub).  Walks the indexed `RelationshipGraph` produced by `buildGraph`
// in BFS order, applies per-hop filtering + truncation, and returns a
// bounded `{ nodeIds, edges }` slice that the SVG renderer (isl-pfq) can
// hand to the d3-force layout (isl-mcs).
//
// LAYER BOUNDARY
//   • No React, no Supabase, no I/O.  All inputs are values; all outputs
//     are new values.  Side-effect free — same inputs always produce
//     the same output by reference shape (Sets/arrays are fresh each
//     call but their contents are deterministic).
//   • The "fetch" side lives in `../api/relationships.ts` (issue isl-szm)
//     and runs once per viewer mount; the extractor is then run many
//     times as the user changes opts (zoom, kind filter, strength
//     threshold) without re-querying the database.
//
// DETERMINISM
//   • The extractor is called once per filter change, so identical inputs
//     must produce byte-identical outputs — otherwise React's
//     reconciliation thrashes the d3-force simulation and nodes jitter.
//   • Within a hop, edges are sorted by:
//       1. |strength| descending  (narrative weight)
//       2. "other endpoint" id ascending   (stable tiebreaker)
//       3. kind ascending                  (final tiebreaker for parallel edges)
//   • BFS visits frontier nodes in the order they were added, which is
//     itself derived from the sort above, so the whole walk is total.
//
// BOUNDS
//   • Output edges ≤ (maxNeighbours per node) × (frontier size per hop).
//     Frontier size grows by at most maxNeighbours per node per hop, so the
//     total node count is ≤ 1 + Σᵢ (maxNeighbours)ⁱ for i ∈ [1..maxHops].
//   • At the defaults (maxHops=2, maxNeighbours=12) that's 1 + 12 + 144 =
//     157 nodes worst case, which d3-force handles in well under 50 ms.

import type { EntityRelationship } from '../types';
import {
  type RelationshipGraph,
  neighbours,
} from './relationshipGraph';

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * Default BFS depth from the seed.  Two hops is the narrative sweet spot:
 *
 *   hop 0: seed (the entity being viewed)
 *   hop 1: direct connections (rivals, mentors, partners — the "ego net")
 *   hop 2: friends-of-friends — enough context to surface coincidences
 *          ("oh, this manager and that journalist both know X")
 *          without descending into noise.
 *
 * Anything deeper than 2 reads as word-salad in the visualisation
 * ("enemy of my friend's mentor's pundit") and explodes the node count.
 */
export const DEFAULT_MAX_HOPS = 2;

/**
 * Default per-node cap on neighbours followed.  Twelve mirrors the d3-force
 * radial layout budget at the viewport size we ship today: any more and
 * label collisions start to dominate visually.  When tuning, remember
 * this is per-NODE, not per-graph — the seed plus its 12 first-hop
 * neighbours each pulling 12 of their own already produces a busy graph.
 */
export const DEFAULT_MAX_NEIGHBOURS = 12;

// ── Public types ─────────────────────────────────────────────────────────────

/**
 * Options controlling the BFS walk.  All fields are optional; omitting a
 * field falls back to the corresponding DEFAULT_* constant above (or to
 * "no filter" for `minStrength` / `kinds`).
 */
export interface SubgraphOpts {
  /**
   * Maximum BFS hop count.  Defaults to {@link DEFAULT_MAX_HOPS}.  Hop 0
   * is the seed itself; `maxHops=1` returns the seed and its direct
   * neighbours; `maxHops=2` includes friends-of-friends; etc.
   */
  maxHops?: number;
  /**
   * Per-NODE cap on neighbours to follow.  Defaults to
   * {@link DEFAULT_MAX_NEIGHBOURS}.  When a node has more incident edges
   * than this cap, the extractor keeps the top-N by |strength| (with
   * deterministic tiebreakers documented in the module header).
   */
  maxNeighbours?: number;
  /**
   * Minimum |strength| (absolute magnitude) for an edge to be considered.
   * Defaults to 0 — every edge passes.  Used to suppress weak/noise
   * relationships near the neutral end of the −100..+100 scale.  Applies
   * to BOTH outgoing and incoming edges (the extractor walks edges via
   * `neighbours()` which unions both).
   */
  minStrength?: number;
  /**
   * Allow-list of relationship kinds (`'rival'`, `'mentor'`, etc.).
   * Defaults to undefined = every kind passes.  Edges whose `kind` is not
   * in this list are skipped entirely, even when their strength would
   * otherwise qualify.
   */
  kinds?: readonly string[];
}

/**
 * Output of {@link extractSubgraph}.  Both fields are FRESH allocations
 * even on identical inputs — the renderer is free to mutate them.
 */
export interface Subgraph {
  /**
   * Every entity id reachable from the seed within `maxHops`, INCLUDING
   * the seed itself.  Always non-empty (the seed is always present, even
   * when it has no edges).
   */
  nodeIds: Set<string>;
  /**
   * Every edge followed during the walk, deduplicated by the
   * (from_id, to_id, kind) primary key.  Order is BFS-discovery order
   * (hop-by-hop, with the per-hop sort above as the within-hop tiebreaker).
   */
  edges: EntityRelationship[];
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Composite ordering key string used when sorting candidate edges within a
 * single hop.  Returns a tuple-like ordering of:
 *
 *   1. |strength| descending  → higher absolute strength sorts FIRST
 *   2. "other endpoint" id ascending → lex smaller sorts FIRST
 *   3. kind ascending          → lex smaller sorts FIRST
 *
 * Implemented as a numeric/string comparator rather than a join-and-
 * compare to avoid string allocation in the hot path (a 12-edge node
 * is typical, but a celebrity entity can have hundreds).
 *
 * @param a            One candidate edge.
 * @param b            The other candidate edge.
 * @param pivotId      The node whose neighbours we're sorting — used to
 *                     resolve which endpoint is the "other" one.
 * @returns            Standard comparator number: negative if `a` sorts
 *                     before `b`, positive if after, 0 if equal.
 */
function compareCandidates(
  a:       EntityRelationship,
  b:       EntityRelationship,
  pivotId: string,
): number {
  // ── 1. |strength| descending ────────────────────────────────────────────
  // Both very positive and very negative relationships are narratively
  // weighty; `Math.abs` collapses the sign so we keep the most dramatic
  // edges regardless of valence.
  const sa = Math.abs(a.strength);
  const sb = Math.abs(b.strength);
  if (sa !== sb) return sb - sa;

  // ── 2. "Other endpoint" id ascending ───────────────────────────────────
  // Two edges of equal magnitude — pick the one pointing to the
  // lexicographically smaller neighbour.  Using the OTHER endpoint
  // (rather than from_id or to_id) keeps the tiebreak stable when the
  // edge direction flips relative to the pivot.
  const otherA = a.from_id === pivotId ? a.to_id : a.from_id;
  const otherB = b.from_id === pivotId ? b.to_id : b.from_id;
  if (otherA !== otherB) return otherA < otherB ? -1 : 1;

  // ── 3. kind ascending ──────────────────────────────────────────────────
  // Final tiebreaker for the rare case of parallel edges between the
  // same pair (e.g. one "rival" + one "ex-teammate" edge between A and B).
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;

  // Defensive — under the (from_id, to_id, kind) PK, two parallel edges
  // with the same pivot-other relationship and the same kind can't
  // coexist, so the comparator never reaches this line.  Returning 0
  // keeps the sort total.
  return 0;
}

/**
 * Build the canonical primary-key string for an edge.  Used as the Set
 * key when deduplicating edges across hops (two different pivots can
 * both pull the same edge into their candidate lists; we only want it
 * in the output once).
 *
 * Uses a NUL separator so the components can't collide via stringly-
 * typed concatenation tricks even though Postgres UUIDs are well-formed.
 */
function edgePk(edge: EntityRelationship): string {
  return `${edge.from_id} ${edge.to_id} ${edge.kind}`;
}

// ── extractSubgraph ──────────────────────────────────────────────────────────

/**
 * Walk the indexed graph from `seedId` outward in BFS order and return
 * the bounded subgraph the viewer should render.
 *
 * ALGORITHM
 *   1. Seed the visited set with `seedId` and the frontier with `[seedId]`.
 *   2. For each hop up to `maxHops`:
 *      a. For each node in the current frontier:
 *         i.   Pull every edge incident on the node via `neighbours()`
 *              (which dedupes outgoing+incoming for us).
 *         ii.  Drop edges that fail `minStrength` / `kinds` filters.
 *         iii. Sort survivors via `compareCandidates`.
 *         iv.  Take the top `maxNeighbours`.
 *         v.   Add each surviving edge to the output (deduped by PK).
 *              For each NEW endpoint, add it to the visited set and the
 *              next-hop frontier.
 *      b. Replace the frontier with the next-hop frontier.
 *      c. Stop early if the next frontier is empty.
 *
 * INVARIANTS
 *   • The seed is always in `nodeIds`, even when it has zero edges.
 *   • The same edge never appears twice in `edges` (PK dedupe).
 *   • The same node never appears in the frontier twice across hops
 *     (a visited set prevents revisits, matching standard BFS).
 *   • Output ordering is fully deterministic for identical inputs.
 *   • `|edges| ≤ |frontier(h)| × maxNeighbours` per hop; total bounded
 *     by 1 + Σ (maxNeighbours)ⁱ across hops.
 *
 * @param graph    Indexed relationship graph from `buildGraph()`.
 * @param seedId   UUID of the entity at the centre of the subgraph.
 * @param opts     Optional filter + truncation settings; see {@link SubgraphOpts}.
 * @returns        Fresh `{ nodeIds, edges }` subgraph slice.  Always
 *                 contains at least the seed in `nodeIds`; `edges`
 *                 may be empty if the seed has no qualifying neighbours.
 */
export function extractSubgraph(
  graph:  RelationshipGraph,
  seedId: string,
  opts:   SubgraphOpts = {},
): Subgraph {
  // ── Option defaults ────────────────────────────────────────────────────
  // Resolve once up front so the inner loop doesn't re-read opts on every
  // iteration and so undefined defaults are explicit at the top of the
  // function (matches the style in relationshipGraph.ts:findPath).
  const maxHops       = opts.maxHops       ?? DEFAULT_MAX_HOPS;
  const maxNeighbours = opts.maxNeighbours ?? DEFAULT_MAX_NEIGHBOURS;
  const minStrength   = opts.minStrength   ?? 0;
  const kindsAllowed  = opts.kinds && opts.kinds.length > 0
    ? new Set(opts.kinds)
    : null;

  // ── State ──────────────────────────────────────────────────────────────
  // `nodeIds` doubles as the BFS visited set — adding a node here both
  // includes it in the output and prevents revisits.  `seenEdges` dedupes
  // the output edge list by PK across hops.  `frontier` is the current
  // hop's expansion list; `nextFrontier` accumulates the next hop and
  // becomes `frontier` at the end of each loop iteration.
  const nodeIds   = new Set<string>([seedId]);
  const seenEdges = new Set<string>();
  const edges:    EntityRelationship[] = [];
  let   frontier: string[] = [seedId];

  // ── Degenerate cases ───────────────────────────────────────────────────
  // maxHops <= 0 means "just return the seed".  We still want to return a
  // valid Subgraph object — callers shouldn't have to special-case the
  // value 0 themselves.
  if (maxHops <= 0 || maxNeighbours <= 0) {
    return { nodeIds, edges };
  }

  for (let hop = 0; hop < maxHops; hop++) {
    const nextFrontier: string[] = [];

    for (const nodeId of frontier) {
      // ── Gather incident edges ────────────────────────────────────────
      // `neighbours()` returns a fresh array unioning outgoing+incoming
      // with self-loops collapsed by PK.  We re-sort + filter it here
      // rather than passing the existing `RelationshipFilter` through
      // because that helper's `minStrength` is a SIGNED lower bound, but
      // we want |strength|.
      const incident = neighbours(graph, nodeId);

      // ── Filter ──────────────────────────────────────────────────────
      // Both filters short-circuit so a deeply-restrictive `kinds` list
      // doesn't pay the strength check for kinds it would have rejected
      // anyway.
      const filtered: EntityRelationship[] = [];
      for (const edge of incident) {
        if (kindsAllowed && !kindsAllowed.has(edge.kind)) continue;
        if (Math.abs(edge.strength) < minStrength) continue;
        filtered.push(edge);
      }

      // ── Sort + truncate ─────────────────────────────────────────────
      // Sorting allocates; we only pay it when there's more to do than
      // the cap allows.  A typical node has fewer edges than the cap so
      // most calls skip the sort and the slice both becomes a no-op.
      const ranked = filtered.length > maxNeighbours
        ? filtered.slice().sort((a, b) => compareCandidates(a, b, nodeId)).slice(0, maxNeighbours)
        : filtered.slice().sort((a, b) => compareCandidates(a, b, nodeId));

      // ── Add to output + expand the frontier ─────────────────────────
      // We iterate the sorted slice in order so the OUTPUT edge array
      // preserves the same deterministic order as the sort — important
      // because the renderer iterates `edges` for paint order.
      for (const edge of ranked) {
        const pk = edgePk(edge);
        if (!seenEdges.has(pk)) {
          seenEdges.add(pk);
          edges.push(edge);
        }
        // Determine the "other" endpoint relative to the pivot.  Self-
        // loops (from_id === to_id === nodeId) contribute no new node;
        // we leave them in `edges` but don't push the pivot back onto
        // the frontier.
        const other = edge.from_id === nodeId ? edge.to_id : edge.from_id;
        if (other === nodeId) continue;
        if (!nodeIds.has(other)) {
          nodeIds.add(other);
          nextFrontier.push(other);
        }
      }
    }

    // ── Advance to next hop ────────────────────────────────────────────
    // Empty next frontier → no more work to do.  We could break out of
    // the loop conditionally either before or after the assignment;
    // assigning then checking makes the post-loop value of `frontier`
    // self-consistent if a debugger pauses here.
    frontier = nextFrontier;
    if (frontier.length === 0) break;
  }

  return { nodeIds, edges };
}
