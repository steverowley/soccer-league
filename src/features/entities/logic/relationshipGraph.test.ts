// ── relationshipGraph.test.ts ───────────────────────────────────────────────
// WHY: Unit tests for the pure graph traversal utilities. These cover the
// adjacency index, direction-aware queries, filter composition, and the
// BFS path-finder. The Architect reads these results during match prep to
// build narrative context — wrong graph math produces wrong storylines, so
// the traversals need tight coverage.

import { describe, it, expect } from 'vitest';
import {
  areConnected,
  buildGraph,
  degree,
  DEFAULT_MAX_HOPS,
  findPath,
  findRelationship,
  incoming,
  neighbourIds,
  neighbours,
  outgoing,
  totalStrength,
} from './relationshipGraph';
import type { EntityRelationship } from '../types';

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a minimal EntityRelationship for tests. Defaults strength=0 and
 * empty meta so tests only declare the fields they care about.
 */
function edge(
  from_id: string,
  to_id: string,
  kind: string,
  strength = 0,
): EntityRelationship {
  return { from_id, to_id, kind, strength, meta: {} };
}

/**
 * Build a graph over the simple fixture used across most tests:
 *
 *   a ──rival(-50)──▶ b
 *   a ──mentor(+60)─▶ c
 *   b ──friend(+30)─▶ c
 *   d                           (isolated node)
 */
function fixture() {
  return buildGraph([
    edge('a', 'b', 'rival', -50),
    edge('a', 'c', 'mentor', 60),
    edge('b', 'c', 'friend', 30),
  ]);
}

// ── buildGraph ──────────────────────────────────────────────────────────────

describe('buildGraph', () => {
  it('returns empty maps for an empty edge list', () => {
    const g = buildGraph([]);
    expect(g.edges).toEqual([]);
    expect(g.outgoing.size).toBe(0);
    expect(g.incoming.size).toBe(0);
  });

  it('indexes each edge into both outgoing and incoming maps', () => {
    const g = fixture();
    expect(g.outgoing.get('a')?.length).toBe(2);
    expect(g.outgoing.get('b')?.length).toBe(1);
    expect(g.incoming.get('b')?.length).toBe(1);
    expect(g.incoming.get('c')?.length).toBe(2);
    expect(g.outgoing.has('c')).toBe(false); // c has no outgoing edges
  });

  it('preserves the original edge list reference', () => {
    const edges = [edge('a', 'b', 'rival')];
    const g = buildGraph(edges);
    expect(g.edges).toBe(edges);
  });
});

// ── outgoing / incoming ─────────────────────────────────────────────────────

describe('outgoing', () => {
  it('returns only edges where entity is the source', () => {
    const g = fixture();
    const edges = outgoing(g, 'a');
    expect(edges.map((e) => e.to_id).sort()).toEqual(['b', 'c']);
  });

  it('returns an empty array for a node with no outgoing edges', () => {
    const g = fixture();
    expect(outgoing(g, 'c')).toEqual([]);
  });

  it('filters by kind', () => {
    const g = fixture();
    const edges = outgoing(g, 'a', { kind: 'rival' });
    expect(edges.length).toBe(1);
    expect(edges[0]?.to_id).toBe('b');
  });

  it('filters by strength range', () => {
    const g = fixture();
    const positive = outgoing(g, 'a', { minStrength: 1 });
    expect(positive.length).toBe(1);
    expect(positive[0]?.to_id).toBe('c');
  });
});

describe('incoming', () => {
  it('returns only edges where entity is the target', () => {
    const g = fixture();
    const edges = incoming(g, 'c');
    expect(edges.map((e) => e.from_id).sort()).toEqual(['a', 'b']);
  });

  it('applies kind filter', () => {
    const g = fixture();
    const edges = incoming(g, 'c', { kind: 'mentor' });
    expect(edges.length).toBe(1);
    expect(edges[0]?.from_id).toBe('a');
  });
});

// ── neighbours / neighbourIds ───────────────────────────────────────────────

describe('neighbours', () => {
  it('returns both outgoing and incoming edges', () => {
    const g = fixture();
    // b has one outgoing (→c) and one incoming (a→)
    expect(neighbours(g, 'b').length).toBe(2);
  });

  it('dedupes edges that would otherwise appear twice', () => {
    // A single edge appears once even though it lives in both adjacency
    // maps from the perspective of its other endpoint.
    const g = buildGraph([edge('a', 'b', 'rival')]);
    expect(neighbours(g, 'a').length).toBe(1);
    expect(neighbours(g, 'b').length).toBe(1);
  });

  it('applies the strength filter', () => {
    const g = fixture();
    // For node c: friend(+30) from b, mentor(+60) from a. Filter to >=50.
    const strong = neighbours(g, 'c', { minStrength: 50 });
    expect(strong.length).toBe(1);
    expect(strong[0]?.kind).toBe('mentor');
  });
});

describe('neighbourIds', () => {
  it('returns the set of connected entity IDs excluding the pivot', () => {
    const g = fixture();
    const ids = neighbourIds(g, 'a');
    expect([...ids].sort()).toEqual(['b', 'c']);
  });

  it('applies filter before extracting endpoints', () => {
    const g = fixture();
    // From c's perspective: only the positive-strength inbound edges.
    const friendlyWithC = neighbourIds(g, 'c', { minStrength: 1 });
    expect([...friendlyWithC].sort()).toEqual(['a', 'b']);
  });
});

// ── findRelationship / areConnected ─────────────────────────────────────────

describe('findRelationship', () => {
  it('returns the matching directed edge', () => {
    const g = fixture();
    const r = findRelationship(g, 'a', 'b', 'rival');
    expect(r).toBeDefined();
    expect(r?.strength).toBe(-50);
  });

  it('returns undefined when no such edge exists', () => {
    const g = fixture();
    expect(findRelationship(g, 'b', 'a', 'rival')).toBeUndefined();
    expect(findRelationship(g, 'a', 'b', 'friend')).toBeUndefined();
  });
});

describe('areConnected', () => {
  it('detects directed connections', () => {
    const g = fixture();
    expect(areConnected(g, 'a', 'b')).toBe(true);
  });

  it('is symmetric — direction does not matter', () => {
    const g = fixture();
    expect(areConnected(g, 'b', 'a')).toBe(true);
  });

  it('returns false for disconnected nodes', () => {
    const g = buildGraph([edge('a', 'b', 'rival'), edge('c', 'd', 'friend')]);
    expect(areConnected(g, 'a', 'd')).toBe(false);
  });

  it('respects kind restriction', () => {
    const g = fixture();
    expect(areConnected(g, 'a', 'b', 'rival')).toBe(true);
    expect(areConnected(g, 'a', 'b', 'friend')).toBe(false);
  });
});

// ── findPath ────────────────────────────────────────────────────────────────

describe('findPath', () => {
  it('returns [node] for a self-path', () => {
    const g = fixture();
    expect(findPath(g, 'a', 'a')).toEqual(['a']);
  });

  it('finds a direct one-hop connection', () => {
    const g = fixture();
    expect(findPath(g, 'a', 'b')).toEqual(['a', 'b']);
  });

  it('finds a two-hop chain via BFS', () => {
    // a ─▶ b ─▶ c ─▶ d (directed only)
    const g = buildGraph([
      edge('a', 'b', 'x'),
      edge('b', 'c', 'x'),
      edge('c', 'd', 'x'),
    ]);
    const path = findPath(g, 'a', 'd', { undirected: false });
    expect(path).toEqual(['a', 'b', 'c', 'd']);
  });

  it('returns null when nodes are disconnected', () => {
    const g = buildGraph([edge('a', 'b', 'x'), edge('c', 'd', 'x')]);
    expect(findPath(g, 'a', 'c')).toBeNull();
  });

  it('respects maxHops', () => {
    // Four-hop chain; searching with maxHops=2 should fail.
    const g = buildGraph([
      edge('a', 'b', 'x'),
      edge('b', 'c', 'x'),
      edge('c', 'd', 'x'),
      edge('d', 'e', 'x'),
    ]);
    expect(findPath(g, 'a', 'e', { maxHops: 2, undirected: false })).toBeNull();
    expect(
      findPath(g, 'a', 'e', { maxHops: 4, undirected: false }),
    ).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('defaults maxHops to DEFAULT_MAX_HOPS (4)', () => {
    expect(DEFAULT_MAX_HOPS).toBe(4);
    const g = buildGraph([
      edge('a', 'b', 'x'),
      edge('b', 'c', 'x'),
      edge('c', 'd', 'x'),
      edge('d', 'e', 'x'),
      edge('e', 'f', 'x'),
    ]);
    // 5 hops exceeds the default.
    expect(findPath(g, 'a', 'f', { undirected: false })).toBeNull();
  });

  it('uses undirected traversal by default — can walk backwards over edges', () => {
    // One-directional edge a→b, but from b we can still find a.
    const g = buildGraph([edge('a', 'b', 'x')]);
    expect(findPath(g, 'b', 'a')).toEqual(['b', 'a']);
  });

  it('restricts directed traversal to outgoing edges only', () => {
    const g = buildGraph([edge('a', 'b', 'x')]);
    expect(findPath(g, 'b', 'a', { undirected: false })).toBeNull();
  });

  it('applies edge filter during traversal', () => {
    // a →rival→ b →friend→ c. Filter to 'friend' only; no path from a to c.
    const g = buildGraph([
      edge('a', 'b', 'rival'),
      edge('b', 'c', 'friend'),
    ]);
    const friendOnly = findPath(g, 'a', 'c', { filter: { kind: 'friend' } });
    expect(friendOnly).toBeNull();

    const anyKind = findPath(g, 'a', 'c');
    expect(anyKind).toEqual(['a', 'b', 'c']);
  });
});

// ── Aggregates ──────────────────────────────────────────────────────────────

describe('totalStrength', () => {
  it('sums strengths across all incident edges', () => {
    const g = fixture();
    // c has mentor(+60) from a and friend(+30) from b → total 90
    expect(totalStrength(g, 'c')).toBe(90);
  });

  it('returns 0 for an isolated node', () => {
    const g = fixture();
    expect(totalStrength(g, 'lonely')).toBe(0);
  });

  it('applies the filter before summing', () => {
    const g = fixture();
    // a has rival(-50) and mentor(+60). Filter to positive only → 60.
    expect(totalStrength(g, 'a', { minStrength: 1 })).toBe(60);
  });
});

describe('degree', () => {
  it('counts deduplicated incident edges', () => {
    const g = fixture();
    expect(degree(g, 'a')).toBe(2);
    expect(degree(g, 'b')).toBe(2);
    expect(degree(g, 'c')).toBe(2);
  });

  it('applies filter', () => {
    const g = fixture();
    expect(degree(g, 'a', { kind: 'rival' })).toBe(1);
    expect(degree(g, 'a', { kind: 'mentor' })).toBe(1);
    expect(degree(g, 'a', { kind: 'friend' })).toBe(0);
  });
});
