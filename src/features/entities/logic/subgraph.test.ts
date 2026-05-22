// ── subgraph.test.ts ────────────────────────────────────────────────────────
// Unit tests for the pure-logic subgraph extractor (issue isl-6ub).
//
// COVERAGE AGAINST THE ISSUE'S ACCEPTANCE CRITERIA
//   • Seed with no edges returns just the seed.
//   • Bidirectional edges are deduplicated (PK collapse via neighbours()).
//   • maxHops respected — third-hop nodes never appear at maxHops=2.
//   • maxNeighbours truncates correctly — top-N by |strength|, with
//     deterministic tiebreak by "other endpoint" id then kind.
//   • minStrength filters BOTH outgoing and incoming edges by absolute
//     magnitude (not by signed bound).
//   • kinds allow-list filter.
//   • Output is deterministic — running the same call twice produces
//     identical node lists, edge lists, AND edge order.
//   • Pure — input arrays/sets are not mutated.

import { describe, it, expect } from 'vitest';

import type { EntityRelationship } from '../types';
import { buildGraph } from './relationshipGraph';
import {
  DEFAULT_MAX_HOPS,
  DEFAULT_MAX_NEIGHBOURS,
  extractSubgraph,
} from './subgraph';

// ── Fixture builders ────────────────────────────────────────────────────────

function edge(over: Partial<EntityRelationship> & { from_id: string; to_id: string }): EntityRelationship {
  return {
    from_id:  over.from_id,
    to_id:    over.to_id,
    kind:     over.kind     ?? 'rival',
    strength: over.strength ?? -40,
    meta:     over.meta     ?? {},
  };
}

// ── Constants ───────────────────────────────────────────────────────────────

describe('subgraph constants', () => {
  it('exports the documented defaults', () => {
    // These ship to UI defaults and to bounds-checking math; pin them
    // so a future tuning doesn't silently change the BFS shape.
    expect(DEFAULT_MAX_HOPS).toBe(2);
    expect(DEFAULT_MAX_NEIGHBOURS).toBe(12);
  });
});

// ── extractSubgraph ─────────────────────────────────────────────────────────

describe('extractSubgraph', () => {
  // ── Degenerate inputs ─────────────────────────────────────────────────

  it('returns just the seed when the entity has no incident edges', () => {
    const graph = buildGraph([]);
    const sub = extractSubgraph(graph, 'lonely');
    expect([...sub.nodeIds]).toEqual(['lonely']);
    expect(sub.edges).toEqual([]);
  });

  it('returns just the seed when maxHops is 0', () => {
    const graph = buildGraph([
      edge({ from_id: 'seed', to_id: 'b', strength: 90 }),
    ]);
    const sub = extractSubgraph(graph, 'seed', { maxHops: 0 });
    expect([...sub.nodeIds]).toEqual(['seed']);
    expect(sub.edges).toEqual([]);
  });

  it('returns just the seed when maxNeighbours is 0', () => {
    const graph = buildGraph([
      edge({ from_id: 'seed', to_id: 'b', strength: 90 }),
    ]);
    const sub = extractSubgraph(graph, 'seed', { maxNeighbours: 0 });
    expect([...sub.nodeIds]).toEqual(['seed']);
    expect(sub.edges).toEqual([]);
  });

  // ── Bidirectional / dedupe ────────────────────────────────────────────

  it('deduplicates bidirectional edges (self-loop case) via PK', () => {
    // A self-edge appears in both outgoing and incoming adjacency lists;
    // the underlying `neighbours()` helper already collapses by PK, and
    // the extractor's PK dedupe at the output layer is a belt-and-braces
    // guarantee.  Verify the edge appears exactly once.
    const graph = buildGraph([
      edge({ from_id: 'seed', to_id: 'seed', kind: 'narcissism', strength: 100 }),
    ]);
    const sub = extractSubgraph(graph, 'seed');
    expect(sub.edges).toHaveLength(1);
    expect(sub.edges[0]?.kind).toBe('narcissism');
    // Self-loop doesn't expand the node set.
    expect([...sub.nodeIds]).toEqual(['seed']);
  });

  it('treats outgoing and incoming edges as equally followable', () => {
    // Seed has one outgoing and one incoming edge.  Both endpoints
    // should appear in nodeIds, both rows in edges (deduped by PK).
    const graph = buildGraph([
      edge({ from_id: 'seed', to_id: 'out', kind: 'mentor',  strength: 60 }),
      edge({ from_id: 'in',   to_id: 'seed', kind: 'admires', strength: 50 }),
    ]);
    const sub = extractSubgraph(graph, 'seed');
    expect([...sub.nodeIds].sort()).toEqual(['in', 'out', 'seed']);
    expect(sub.edges.map(e => `${e.from_id}->${e.to_id}`).sort()).toEqual([
      'in->seed',
      'seed->out',
    ]);
  });

  // ── maxHops ───────────────────────────────────────────────────────────

  it('respects maxHops=1: never visits friends-of-friends', () => {
    // Three-hop chain: seed - a - b - c.  At maxHops=1 we should only
    // reach `a`; `b` and `c` should not appear.
    const graph = buildGraph([
      edge({ from_id: 'seed', to_id: 'a', strength: 50 }),
      edge({ from_id: 'a',    to_id: 'b', strength: 50 }),
      edge({ from_id: 'b',    to_id: 'c', strength: 50 }),
    ]);
    const sub = extractSubgraph(graph, 'seed', { maxHops: 1 });
    expect([...sub.nodeIds].sort()).toEqual(['a', 'seed']);
    expect(sub.edges.map(e => `${e.from_id}->${e.to_id}`)).toEqual(['seed->a']);
  });

  it('respects maxHops=2: pulls friends-of-friends but stops there', () => {
    const graph = buildGraph([
      edge({ from_id: 'seed', to_id: 'a', strength: 50 }),
      edge({ from_id: 'a',    to_id: 'b', strength: 50 }),
      edge({ from_id: 'b',    to_id: 'c', strength: 50 }),
    ]);
    const sub = extractSubgraph(graph, 'seed', { maxHops: 2 });
    expect([...sub.nodeIds].sort()).toEqual(['a', 'b', 'seed']);
    // The b->c edge is NEVER walked because `b` only becomes the frontier
    // at hop 2, and we expand hops [0..maxHops), so it's the final hop.
    expect(sub.edges.map(e => `${e.from_id}->${e.to_id}`).sort()).toEqual([
      'a->b',
      'seed->a',
    ]);
  });

  // ── maxNeighbours ─────────────────────────────────────────────────────

  it('truncates to maxNeighbours by |strength| descending', () => {
    // Seed has 5 candidate edges with varying |strength|; cap at 3.
    // Expect to keep the THREE with the largest absolute strength:
    //   strong-pos=80, strong-neg=-70, mid=50.  Drop weak=10, neutral=0.
    const graph = buildGraph([
      edge({ from_id: 'seed', to_id: 'strong-pos', strength: 80 }),
      edge({ from_id: 'seed', to_id: 'strong-neg', strength: -70 }),
      edge({ from_id: 'seed', to_id: 'mid',        strength: 50 }),
      edge({ from_id: 'seed', to_id: 'weak',       strength: 10 }),
      edge({ from_id: 'seed', to_id: 'neutral',    strength: 0 }),
    ]);
    const sub = extractSubgraph(graph, 'seed', { maxHops: 1, maxNeighbours: 3 });
    expect(sub.edges).toHaveLength(3);
    expect(sub.edges.map(e => e.to_id)).toEqual(['strong-pos', 'strong-neg', 'mid']);
  });

  it('breaks |strength| ties by "other endpoint" id ascending', () => {
    // Three edges with equal |strength|; ids c, a, b should sort a, b, c.
    const graph = buildGraph([
      edge({ from_id: 'seed', to_id: 'c', strength: 50, kind: 'k' }),
      edge({ from_id: 'seed', to_id: 'a', strength: 50, kind: 'k' }),
      edge({ from_id: 'seed', to_id: 'b', strength: 50, kind: 'k' }),
    ]);
    const sub = extractSubgraph(graph, 'seed', { maxHops: 1, maxNeighbours: 3 });
    expect(sub.edges.map(e => e.to_id)).toEqual(['a', 'b', 'c']);
  });

  it('breaks (|strength|, other-id) ties by kind ascending', () => {
    // Two edges seed->x but with different kinds — same magnitude.
    // Sort key on kind: 'mentor' < 'rival' lexicographically.
    const graph = buildGraph([
      edge({ from_id: 'seed', to_id: 'x', strength: 50, kind: 'rival' }),
      edge({ from_id: 'seed', to_id: 'x', strength: 50, kind: 'mentor' }),
    ]);
    const sub = extractSubgraph(graph, 'seed', { maxHops: 1, maxNeighbours: 5 });
    expect(sub.edges.map(e => e.kind)).toEqual(['mentor', 'rival']);
  });

  // ── minStrength ───────────────────────────────────────────────────────

  it('minStrength filters by |strength| (works for both positive and negative edges)', () => {
    // minStrength=30 must keep both the +35 friendly edge AND the -50
    // hostile edge, while dropping the +15 neutral one.
    const graph = buildGraph([
      edge({ from_id: 'seed', to_id: 'friend',  strength: 35 }),
      edge({ from_id: 'seed', to_id: 'enemy',   strength: -50 }),
      edge({ from_id: 'seed', to_id: 'meh',     strength: 15 }),
    ]);
    const sub = extractSubgraph(graph, 'seed', { maxHops: 1, minStrength: 30 });
    expect([...sub.nodeIds].sort()).toEqual(['enemy', 'friend', 'seed']);
  });

  it('minStrength applies to incoming edges too (filter operates in both directions)', () => {
    // Two incoming edges; only the strong one should pass minStrength=30.
    const graph = buildGraph([
      edge({ from_id: 'a',  to_id: 'seed', strength: 80 }),
      edge({ from_id: 'b',  to_id: 'seed', strength: 5  }),
    ]);
    const sub = extractSubgraph(graph, 'seed', { maxHops: 1, minStrength: 30 });
    expect([...sub.nodeIds].sort()).toEqual(['a', 'seed']);
    expect(sub.edges).toHaveLength(1);
    expect(sub.edges[0]?.from_id).toBe('a');
  });

  // ── kinds allow-list ──────────────────────────────────────────────────

  it('kinds allow-list filters to the listed relationship kinds', () => {
    const graph = buildGraph([
      edge({ from_id: 'seed', to_id: 'a', kind: 'rival',   strength: 50 }),
      edge({ from_id: 'seed', to_id: 'b', kind: 'mentor',  strength: 50 }),
      edge({ from_id: 'seed', to_id: 'c', kind: 'sibling', strength: 50 }),
    ]);
    const sub = extractSubgraph(graph, 'seed', { maxHops: 1, kinds: ['mentor', 'sibling'] });
    expect([...sub.nodeIds].sort()).toEqual(['b', 'c', 'seed']);
    expect(sub.edges.map(e => e.kind).sort()).toEqual(['mentor', 'sibling']);
  });

  it('empty kinds array is ignored (treated as "no kind filter")', () => {
    // A literal `kinds: []` would otherwise mean "no kinds match → empty
    // subgraph", which is rarely what callers want.  We treat empty as
    // "unspecified" so the default UX (no filter) survives a defaulted
    // useState([]).
    const graph = buildGraph([
      edge({ from_id: 'seed', to_id: 'a', kind: 'rival', strength: 50 }),
    ]);
    const sub = extractSubgraph(graph, 'seed', { maxHops: 1, kinds: [] });
    expect([...sub.nodeIds].sort()).toEqual(['a', 'seed']);
  });

  // ── Determinism + purity ──────────────────────────────────────────────

  it('returns identical output across repeated invocations on the same inputs', () => {
    // Build a moderately complex graph and run the extractor twice.
    // Stringify the result so we compare structurally — the Set is
    // serialised via [...nodeIds] for deterministic ordering.
    const graph = buildGraph([
      edge({ from_id: 'seed', to_id: 'a', kind: 'rival',   strength: 70 }),
      edge({ from_id: 'seed', to_id: 'b', kind: 'mentor',  strength: -60 }),
      edge({ from_id: 'a',    to_id: 'c', kind: 'rival',   strength: 40 }),
      edge({ from_id: 'b',    to_id: 'd', kind: 'sibling', strength: 30 }),
      edge({ from_id: 'c',    to_id: 'd', kind: 'rival',   strength: 90 }),
    ]);
    const opts = { maxHops: 2, maxNeighbours: 5, minStrength: 10 };
    const first  = extractSubgraph(graph, 'seed', opts);
    const second = extractSubgraph(graph, 'seed', opts);

    expect([...first.nodeIds]).toEqual([...second.nodeIds]);
    expect(first.edges).toEqual(second.edges);
  });

  it('is pure: does not mutate the input edge array or the indexed graph', () => {
    const input = [
      edge({ from_id: 'seed', to_id: 'a', strength: 90 }),
      edge({ from_id: 'a',    to_id: 'b', strength: 80 }),
    ];
    // Defensive: snapshot the input ARRAY (not its members — the entities
    // expose strength/kind that the comparator reads but never mutates).
    const snapshot = input.map(e => ({ ...e }));
    const graph = buildGraph(input);
    extractSubgraph(graph, 'seed', { maxHops: 2, maxNeighbours: 1 });
    expect(input).toEqual(snapshot);
  });

  // ── Output bound ──────────────────────────────────────────────────────

  it('node count never exceeds 1 + Σ (maxNeighbours)ⁱ across hops', () => {
    // Pathological star graph: seed has 50 first-hop neighbours; cap at 3.
    // Each first-hop node has 50 of its own; cap at 3.  Expected nodes:
    //   seed + 3 first-hop + (3 × 3 = 9) second-hop = up to 13.
    // Some second-hop nodes may collide if shared; bound is an upper
    // limit so anything ≤ 13 passes.
    const edges: EntityRelationship[] = [];
    for (let i = 0; i < 50; i++) {
      edges.push(edge({ from_id: 'seed', to_id: `f${i}`, strength: 80 - i }));
      for (let j = 0; j < 50; j++) {
        edges.push(edge({ from_id: `f${i}`, to_id: `g${i}-${j}`, strength: 80 - j }));
      }
    }
    const graph = buildGraph(edges);
    const sub = extractSubgraph(graph, 'seed', { maxHops: 2, maxNeighbours: 3 });
    // 1 (seed) + 3 (first hop) + 3*3 (second hop, all distinct here) = 13
    expect(sub.nodeIds.size).toBeLessThanOrEqual(13);
    // The per-hop cap means we never followed more than 3 from the seed.
    const fromSeed = sub.edges.filter(e => e.from_id === 'seed' || e.to_id === 'seed');
    expect(fromSeed.length).toBeLessThanOrEqual(3);
  });

  // ── Composed filters ──────────────────────────────────────────────────

  it('combines kinds + minStrength + maxNeighbours correctly', () => {
    // Mix of kinds and strengths; the result must satisfy all three
    // constraints simultaneously.
    const graph = buildGraph([
      edge({ from_id: 'seed', to_id: 'mentor-strong', kind: 'mentor', strength: 80 }),
      edge({ from_id: 'seed', to_id: 'mentor-weak',   kind: 'mentor', strength: 5  }),
      edge({ from_id: 'seed', to_id: 'rival-strong',  kind: 'rival',  strength: -70 }),
      edge({ from_id: 'seed', to_id: 'rival-mid',     kind: 'rival',  strength: -40 }),
      edge({ from_id: 'seed', to_id: 'sibling',       kind: 'sibling', strength: 90 }),
    ]);
    const sub = extractSubgraph(graph, 'seed', {
      maxHops: 1,
      maxNeighbours: 2,
      minStrength: 30,
      kinds: ['mentor', 'rival'],
    });
    // After kinds + strength: { mentor-strong (80), rival-strong (-70),
    // rival-mid (-40) }.  Cap at 2 → top two by |strength|:
    // mentor-strong (80) and rival-strong (70).
    expect(sub.edges.map(e => e.to_id)).toEqual(['mentor-strong', 'rival-strong']);
  });
});
