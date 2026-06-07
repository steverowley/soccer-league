// ── features/entities/ui/relationshipGraph/RelationshipGraph.tsx ────────────
// The drop-in relationship-graph widget.  Composes the API helpers (issue
// isl-szm), the pure subgraph extractor (isl-6ub), the d3-force layout
// hook (isl-mcs), and an SVG renderer into a single self-contained
// component callers can drop onto any entity detail page.
//
// PUBLIC PROPS
//   • entityId        — UUID of the seed entity (required).
//   • maxHops         — BFS depth from the seed.  Default: 2.
//   • maxNeighbours   — Per-node cap on edges followed.  Default: 12.
//   • className       — Optional wrapper class for outer-page layout glue.
//
// INTERNAL DATA FLOW
//   1. On mount / entityId change: kick off three sequential fetches.
//      a) `getEntity(seedId)`              — needed for the centre node label
//      b) `getEntityNeighbourhood(seedId)` — the seed's edges AND its
//         neighbours' edges (two hops) so the second layer has data to render
//      c) `buildGraph(edges)` + `extractSubgraph(graph, seedId)` — pure
//      d) `getEntitiesByIds([...nodeIds])` — hydrate node metadata
//   2. Hand `nodes` + `edges` to `useForceLayout` which runs d3-force in
//      the background and publishes positions to React state per RAF.
//   3. Render the positioned snapshot as SVG.  The renderer never blocks
//      on physics — every paint shows the latest published positions.
//
// SIZING
//   The component measures its own width via a ResizeObserver and sizes
//   the SVG square at min(width, 500px) by default.  Pages that need a
//   fixed height can wrap the component in a constraint, but the
//   intrinsic behaviour is "fill the column up to a sensible cap" so
//   the layout settles cleanly on narrow team-detail sidebars too.
//
// ACCESSIBILITY
//   • The SVG carries `role="img"` with an aria-label describing the
//     graph at a glance ("Relationship graph for <name>, N connections").
//   • Nodes render as <g> wrappers with `tabIndex={0}`, `role="link"`,
//     and an aria-label of the entity's display name.  Enter/Space
//     activate the same navigation as a mouse click.
//   • Hover highlight is mirrored on focus so keyboard users see the
//     same emphasis sighted users do.
//
// PERFORMANCE
//   For the default subgraph budget (~157-node worst case at maxHops=2,
//   maxNeighbours=12) the simulation settles in well under the 1.5 s
//   acceptance budget per isl-mcs's forceConfig.

import {
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

// ── Tooltip sizing constants ─────────────────────────────────────────────────
/** Fixed pixel width of the hover detail panel.
 *  228 px fits the longest single-line meta value (party names, employer slugs)
 *  without wrapping at typical graph sidebar widths. */
const TOOLTIP_WIDTH      = 228;

/** Conservative upper-bound on the tooltip's rendered height (px).
 *  Used only for viewport-edge clamping — the actual card is shorter when
 *  few meta fields exist.  Over-estimating is safe; under-estimating clips. */
const TOOLTIP_HEIGHT_EST = 210;

/** Gap (px) between the node circle edge and the nearest tooltip edge.
 *  Keeps the panel from overlapping the node label text. */
const TOOLTIP_GAP        = 14;

/** Maximum character length for the description excerpt shown in the tooltip.
 *  Anything longer is truncated with an ellipsis so the panel stays compact. */
const TOOLTIP_DESC_MAX   = 110;

/**
 * Meta field keys rendered in the tooltip, in display priority order.
 * These cover all world-building entity kinds (politician, journalist, pundit,
 * sports_writer, referee, managing_staff, media_company, etc.).  Only keys
 * that are actually present on the entity's meta object are shown — missing
 * keys are silently skipped.  `description` is excluded here because it gets
 * its own styled excerpt block below the divider.
 */
const TOOLTIP_META_KEYS: readonly string[] = [
  'role', 'party', 'homeworld', 'employer', 'beat',
  'specialty', 'era', 'style', 'corps', 'format',
];
import { useNavigate } from 'react-router-dom';

import { COLORS } from '../../../../components/Layout';
import { useSupabase } from '../../../../shared/supabase/SupabaseProvider';

import {
  getEntitiesByIds,
  getEntity,
  getEntityNeighbourhood,
} from '../../api/relationships';
import { buildGraph } from '../../logic/relationshipGraph';
import { extractSubgraph } from '../../logic/subgraph';
import type { Entity, EntityRelationship } from '../../types';

import { entityRoute } from './entityRoute';
import { kindColor } from './kindColor';
import { useReducedMotion } from './useReducedMotion';
import {
  useForceLayout,
  type EdgeInput,
  type NodeInput,
  type PositionedEdge,
  type PositionedNode,
} from './useForceLayout';

// ── Visual constants ─────────────────────────────────────────────────────────
// Each constant carries (a) its visible effect and (b) the design intent.

/** Default SVG viewport height (px) — cap so the graph never dominates a page. */
const DEFAULT_HEIGHT = 460;

/** Min width before the component renders a fallback "too narrow" surface. */
const MIN_VIEWPORT_WIDTH = 160;

/** Radius (px) for the seed node.  1.5× the regular node per spec. */
const SEED_RADIUS = 12;
/** Radius (px) for every direct (first-hop) node. */
const NODE_RADIUS = 8;

// ── Second-layer (friends-of-friends) recession ──────────────────────────────
// The subgraph always pulls two hops: hop 1 = direct ties (the inner ring),
// hop 2 = friends-of-friends (the outer ring).  To make the two layers read as
// distinct — the way a hub-and-spoke "web of influence" should — second-hop
// nodes and the edges between them are deliberately recessed: smaller, fainter.
// The seed and its direct ties stay full-size and full-opacity so the eye
// lands on the centre first and treats the outer ring as context.

/** Radius (px) for second-hop nodes — noticeably smaller than a direct tie. */
const SECOND_HOP_RADIUS = 5;
/** Resting opacity for a second-hop NODE when nothing is hovered. */
const SECOND_HOP_OPACITY = 0.55;
/** Resting opacity for a second-layer EDGE (one that does not touch the seed). */
const SECOND_LAYER_EDGE_OPACITY = 0.4;

/** Edge stroke-width clamps — pixels.  Driven by |strength|/100. */
const EDGE_STROKE_MIN = 0.5;
const EDGE_STROKE_MAX = 3;

/** Opacity applied to non-highlighted nodes/edges when something is focused. */
const DIM_OPACITY = 0.35;

// ── Legend data ──────────────────────────────────────────────────────────────
// Defined at module scope so they're shared across renders without
// re-allocation.  COLORS is safe to reference here because ES module imports
// are hoisted to the top of the module regardless of source position.

/**
 * Edge-colour legend entries (link strength tiers).
 * dust50 stands in for `hairline` in the legend swatch — hairline is 18%
 * opacity, which is near-invisible as a 2 px colour sample on abyss.
 */
const EDGE_LEGEND = [
  { color: COLORS.terraNova, label: 'Allied'  },
  { color: COLORS.dust50,    label: 'Neutral' },
  { color: COLORS.flare,     label: 'Rival'   },
] as const;

/**
 * Node-colour legend entries (entity kind tiers, one entry per visual tier).
 * Labels are intentionally concise — the tooltip reveals the exact kind on hover.
 */
const NODE_LEGEND = [
  { color: COLORS.dust,      label: 'Player'      },
  { color: COLORS.astro,     label: 'Manager / Team' },
  { color: COLORS.quantum,   label: 'Media'       },
  { color: COLORS.terraNova, label: 'Governance'  },
  { color: COLORS.flare,     label: 'Disruption'  },
  { color: COLORS.dust70,    label: 'Place'       },
] as const;

/**
 * Visually-hidden style for the aria-live announcement (sr-only pattern).
 * Renders the live region into the accessibility tree but keeps it
 * fully off-screen visually — screen readers pick it up, sighted users
 * don't see a stray paragraph at the top of the graph.  Avoids the
 * `display: none` trap, which would hide the region from assistive
 * tech as well.
 */
const SR_ONLY_STYLE: CSSProperties = {
  position:   'absolute',
  width:      1,
  height:     1,
  padding:    0,
  margin:     -1,
  overflow:   'hidden',
  clip:       'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border:     0,
};

// ── Public props ─────────────────────────────────────────────────────────────

/**
 * Props for `<RelationshipGraph>`.  `entityId` is required; everything else
 * defaults to the BFS budget chosen by the subgraph extractor.
 */
export interface RelationshipGraphProps {
  /** UUID of the seed entity — the centre of the graph. */
  entityId: string;
  /** Override BFS depth.  Defaults to the extractor's own default (2). */
  maxHops?: number;
  /** Override per-node neighbour cap.  Defaults to the extractor's default (12). */
  maxNeighbours?: number;
  /** Optional wrapper class for outer-page glue (margins, etc.). */
  className?: string;
}

// ── Component ────────────────────────────────────────────────────────────────

/**
 * Self-contained relationship-graph widget.  Mounts a Supabase fetch
 * pipeline, runs a d3-force simulation, and paints the SVG.  Renders
 * standalone — no portal, no outer-page knowledge required.
 *
 * Lifecycle highlights:
 *   • Re-fetches when `entityId` changes.
 *   • Uses a `cancelled` flag in the effect so an in-flight fetch
 *     doesn't overwrite state for a more recent entityId.
 *   • Halts the simulation cleanly on unmount via the hook's own
 *     useEffect cleanup.
 */
export function RelationshipGraph({
  entityId,
  maxHops,
  maxNeighbours,
  className,
}: RelationshipGraphProps) {
  const db       = useSupabase();
  const navigate = useNavigate();

  // ── Wrapper sizing ───────────────────────────────────────────────────
  // Measure the wrapper's clientWidth with ResizeObserver so the SVG
  // can fill a parent column at any breakpoint.  Falls back to
  // MIN_VIEWPORT_WIDTH while the observer is still resolving on first
  // mount — d3-force tolerates the small viewport for one tick and the
  // ResizeObserver will fire almost immediately afterwards.
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number>(MIN_VIEWPORT_WIDTH);
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? MIN_VIEWPORT_WIDTH;
      // Round to integer to avoid sub-pixel jitter triggering the
      // useForceLayout fingerprint check (width is a dep there).
      setWidth(Math.max(MIN_VIEWPORT_WIDTH, Math.round(next)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Fetch state machine ──────────────────────────────────────────────
  // One discriminated union covers every render branch.  The `entityId`
  // field on every variant lets the render path detect a stale result
  // (an in-flight fetch for an older entityId that resolved AFTER the
  // prop changed) and treat it as still-loading without a setState
  // ping-pong inside the effect body.
  type FetchState =
    | { kind: 'loading';   entityId: string }
    | { kind: 'not_found'; entityId: string }
    | { kind: 'error';     entityId: string; message: string }
    | {
        kind:    'loaded';
        entityId: string;
        seed:    Entity;
        edges:   EntityRelationship[];
        nodeMap: Map<string, Entity>;
      };

  // Lazy initialiser ties the initial state to the FIRST entityId so a
  // render that arrives before the fetch effect can paint the loading
  // surface for the right id straight away.
  const [fetchState, setFetchState] = useState<FetchState>(() => ({
    kind: 'loading',
    entityId,
  }));

  // Treat any persisted state whose entityId no longer matches the
  // prop as "loading" — derived, so the effect body itself never has
  // to call setState synchronously when the prop changes.  Wrapped in
  // useMemo so downstream hooks that depend on `effective` don't
  // rebuild on every render when nothing material has changed.
  const effective: FetchState = useMemo(
    () =>
      fetchState.entityId === entityId
        ? fetchState
        : { kind: 'loading', entityId },
    [fetchState, entityId],
  );

  // ── Fetch effect ─────────────────────────────────────────────────────
  // Three sequential calls: seed → edges → bulk node metadata.  We can't
  // run them in parallel because the third call needs the subgraph
  // result which depends on the first two.  The whole chain is gated by
  // a `cancelled` flag so a fast tap-through to another entity doesn't
  // race the older fetch to completion.
  //
  // setState happens ONLY inside the async closure, AFTER at least one
  // await — which keeps the react-hooks/set-state-in-effect linter
  // happy (the rule allows setState from callbacks reacting to
  // external-system events; an async resolution counts).
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const seedRow = await getEntity(db, entityId);
        if (cancelled) return;
        if (!seedRow) {
          setFetchState({ kind: 'not_found', entityId });
          return;
        }

        // Two-hop fetch: the seed's edges PLUS its neighbours' edges, so the
        // extractor below has the friends-of-friends needed to render a real
        // second layer (a single-hop fetch can only ever yield a 1-hop star).
        const edgeRows = await getEntityNeighbourhood(db, entityId);
        if (cancelled) return;

        // Run the extractor inline here so we know which entity ids
        // the bulk metadata fetch needs.  The render path below also
        // re-runs the extractor (via useMemo) — duplicating the work
        // beats threading the result through state.
        const graph = buildGraph(edgeRows);
        const sub   = extractSubgraph(graph, entityId, {
          ...(maxHops       !== undefined && { maxHops }),
          ...(maxNeighbours !== undefined && { maxNeighbours }),
        });
        const otherIds = Array.from(sub.nodeIds).filter(id => id !== entityId);
        const hydrated = otherIds.length > 0
          ? await getEntitiesByIds(db, otherIds)
          : [];
        if (cancelled) return;

        // Build the lookup map including the seed so the renderer can
        // index any node id uniformly.
        const map = new Map<string, Entity>();
        map.set(seedRow.id, seedRow);
        for (const e of hydrated) map.set(e.id, e);

        setFetchState({
          kind:    'loaded',
          entityId,
          seed:    seedRow,
          edges:   edgeRows,
          nodeMap: map,
        });
      } catch (err: unknown) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setFetchState({ kind: 'error', entityId, message: msg });
      }
    })();

    return () => { cancelled = true; };
  }, [db, entityId, maxHops, maxNeighbours]);

  // Render-time projections of the state machine.  Wrapped in useMemo
  // so the references stay stable across renders that don't change the
  // fetch state — otherwise the downstream useMemos rebuild every paint.
  const seed = effective.kind === 'loaded' ? effective.seed : null;
  const edges = useMemo<EntityRelationship[]>(
    () => (effective.kind === 'loaded' ? effective.edges : []),
    [effective],
  );
  const nodeMap = useMemo<Map<string, Entity>>(
    () => (effective.kind === 'loaded' ? effective.nodeMap : new Map()),
    [effective],
  );
  const loading = effective.kind === 'loading';
  const error   = effective.kind === 'error'  ? effective.message : null;

  // ── Subgraph memo (drives the render) ────────────────────────────────
  // Re-runs whenever the fetched edges change.  Pure + cheap — the
  // extractor's worst case at default budget is ~157 nodes which is
  // well under a single frame.
  const subgraph = useMemo(() => {
    if (!seed) return { nodeIds: new Set<string>(), edges: [] };
    const graph = buildGraph(edges);
    return extractSubgraph(graph, seed.id, {
      ...(maxHops       !== undefined && { maxHops }),
      ...(maxNeighbours !== undefined && { maxNeighbours }),
    });
  }, [seed, edges, maxHops, maxNeighbours]);

  // ── Hook input prep ─────────────────────────────────────────────────
  // Convert the subgraph node/edge lists into the typed shapes
  // useForceLayout expects.  We carry the entity reference inside the
  // node payload so the renderer can index colour/label/click target
  // without a parallel map lookup.
  const layoutNodes: NodeInput[] = useMemo(() => {
    if (!seed) return [];
    const out: NodeInput[] = [];
    for (const id of subgraph.nodeIds) {
      const e = nodeMap.get(id);
      // A node id may show up in subgraph.nodeIds before the bulk
      // metadata fetch resolves — render those as anonymous "loading"
      // entities so layout positions still settle.  Once the fetch
      // lands, the memo re-runs and labels appear.
      out.push({
        id,
        kind:    e?.kind ?? 'unknown',
        name:    e?.display_name ?? e?.name ?? '…',
        isSeed:  id === seed.id,
      });
    }
    return out;
  }, [subgraph.nodeIds, nodeMap, seed]);

  const layoutEdges: EdgeInput[] = useMemo(() => {
    return subgraph.edges.map(e => ({
      source:   e.from_id,
      target:   e.to_id,
      strength: e.strength,
      kind:     e.kind,
    }));
  }, [subgraph.edges]);

  // ── Motion + visibility gating (isl-7hp polish) ────────────────────
  // `reducedMotion` honours the OS-level `prefers-reduced-motion`
  // preference — when set, we keep the simulation paused so the user
  // sees a static layout instead of the d3-force settle animation.
  // `tabHidden` mirrors document.visibilityState so the per-frame
  // physics loop halts when the tab loses focus, preventing wasted
  // CPU on background tabs.
  const reducedMotion = useReducedMotion();
  const [tabHidden,    setTabHidden]    = useState<boolean>(() =>
    typeof document !== 'undefined' && document.visibilityState === 'hidden',
  );
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVis = () => setTabHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // ── Layout ──────────────────────────────────────────────────────────
  // `paused` aggregates the two motion-gate signals.  d3-force still
  // settles in the background when the page becomes visible again
  // (alpha resumes from its mid-flight value), so the user lands on a
  // graph that finishes its layout silently rather than re-running it.
  const height = DEFAULT_HEIGHT;
  const layout = useForceLayout({
    nodes:  layoutNodes,
    edges:  layoutEdges,
    width,
    height,
    paused: reducedMotion || tabHidden,
  });

  // ── Hover/focus state ───────────────────────────────────────────────
  // A single string (the id) is enough to drive both the node highlight
  // and the edge dim/emphasis pass.  Hover and focus share the state so
  // keyboard and mouse users get the same visual cue.
  const [focusId, setFocusId] = useState<string | null>(null);

  // ── Render branches ─────────────────────────────────────────────────
  const wrapperStyle: CSSProperties = {
    position: 'relative',
    width:    '100%',
    height,
    background: COLORS.abyss,
    border:     `1px solid ${COLORS.hairline}`,
    boxSizing:  'border-box',
  };

  if (error) {
    return (
      <div ref={wrapperRef} className={className} style={wrapperStyle}>
        <Centered text="GRAPH UNAVAILABLE" />
      </div>
    );
  }

  if (loading) {
    return (
      <div ref={wrapperRef} className={className} style={wrapperStyle}>
        <Centered text="PLOTTING CONNECTIONS…" pulse />
      </div>
    );
  }

  if (!seed) {
    return (
      <div ref={wrapperRef} className={className} style={wrapperStyle}>
        <Centered text="ENTITY NOT FOUND" />
      </div>
    );
  }

  // After loading completes, subgraph may legitimately have only the
  // seed in nodeIds (no edges).  Show the empty-state copy in that case.
  const hasConnections = layout.nodes.length > 1;
  if (!hasConnections) {
    return (
      <div ref={wrapperRef} className={className} style={wrapperStyle}>
        <Centered text="NO KNOWN CONNECTIONS" />
      </div>
    );
  }

  // ── Click / keyboard activation ─────────────────────────────────────
  // Both handlers route through `entityRoute(entity)` so behaviour stays
  // consistent across input modes.  Seed clicks are no-ops (the user is
  // already on this entity's page).
  const activateNode = (nodeId: string) => {
    if (nodeId === seed.id) return;
    const entity = nodeMap.get(nodeId);
    if (!entity) return;
    navigate(entityRoute(entity));
  };

  const handleNodeKey = (ev: KeyboardEvent<SVGGElement>, nodeId: string) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      activateNode(nodeId);
    }
  };

  const handleNodeClick = (ev: MouseEvent<SVGGElement>, nodeId: string) => {
    ev.stopPropagation();
    activateNode(nodeId);
  };

  // ── Screen-reader announcement (isl-7hp polish) ─────────────────────
  // Visually hidden live region — screen readers announce the count
  // once the layout has settled.  `polite` so the announcement queues
  // behind any in-flight speech rather than interrupting; `atomic` so
  // the whole sentence is read together each time it updates.
  const seedName = seed.display_name ?? seed.name;
  const connectionCount = layout.nodes.length - 1;
  const announcement = `Showing ${connectionCount} ${connectionCount === 1 ? 'connection' : 'connections'} for ${seedName}.`;

  // ── Per-node a11y description map (isl-7hp polish) ──────────────────
  // For each non-seed node we surface "NAME, KIND, relationship to
  // seed: KIND, strength: N" via aria-label so screen-reader users
  // hear the same context sighted users get from hover.  We pick the
  // FIRST edge linking the node to the seed (the subgraph extractor
  // already sorted by |strength| desc, so first wins on parallel
  // edges).  Non-adjacent nodes (second-hop satellites) get just
  // "NAME, KIND" — no direct relationship label.
  //
  // Built from `subgraph.edges` (the RENDERED edges), not the full fetched
  // set: with the two-hop fetch, a weak seed→X edge can be pruned by
  // `maxNeighbours` while X still appears in the graph via a kept neighbour.
  // Deriving adjacency from the rendered subgraph keeps the layer styling
  // (first vs second hop) and the relationship label honest — a node is only
  // "direct" if its seed edge actually survived into the visible graph.
  const seedAdjacency = new Map<string, { kind: string; strength: number }>();
  for (const edge of subgraph.edges) {
    if (edge.from_id === seed.id && !seedAdjacency.has(edge.to_id)) {
      seedAdjacency.set(edge.to_id, { kind: edge.kind, strength: edge.strength });
    } else if (edge.to_id === seed.id && !seedAdjacency.has(edge.from_id)) {
      seedAdjacency.set(edge.from_id, { kind: edge.kind, strength: edge.strength });
    }
  }

  // ── Tooltip data derivation ─────────────────────────────────────────
  // Derive the hovered node's position and entity data from existing
  // state — no extra useState needed.  `hoveredNode` gives us the SVG
  // (x, y) coords which map 1:1 to CSS pixel offsets within the wrapper
  // because the SVG fills the container exactly.  Both values are null
  // when nothing is hovered so the tooltip renders nothing.
  const hoveredNode   = focusId ? layout.nodes.find(n => n.id === focusId) ?? null : null;
  const hoveredEntity = focusId ? (nodeMap.get(focusId) ?? null)               : null;

  // ── Outer container: graph box + legend ─────────────────────────────
  // The outer div carries `ref` (for ResizeObserver width measurement) and
  // `className` (caller's layout glue).  The inner graph box keeps
  // `position: relative` so the NodeTooltip HTML overlay can be absolutely
  // positioned within it without affecting the legend below.
  return (
    <div ref={wrapperRef} className={className} style={{ width: '100%' }}>
      {/* ── Graph SVG box ──────────────────────────────────────────────── */}
      <div style={wrapperStyle}>
        {/* ── aria-live announcement ──────────────────────────────────────
            Off-screen but still in the accessibility tree.  Updates as
            the connection count changes (e.g. when the user navigates
            to a different entity via a node click). */}
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          style={SR_ONLY_STYLE}
        >
          {announcement}
        </div>

        <svg
          role="img"
          aria-label={`Relationship graph for ${seedName}, ${connectionCount} connections`}
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          // `touch-action: none` so pinch + double-tap on the SVG area
          // don't accidentally trigger the browser's page zoom (most
          // common pain point on mobile Safari).  Pan / tap still work —
          // the property only suppresses the gesture handler the
          // browser would otherwise own.
          style={{ display: 'block', touchAction: 'none' }}
        >
          {/* ── Edges ──────────────────────────────────────────────────── */}
          {layout.edges.map((edge) => (
            <EdgeLine
              key={edgeKey(edge)}
              edge={edge}
              focusId={focusId}
              seedId={seed.id}
            />
          ))}

          {/* ── Nodes ──────────────────────────────────────────────────── */}
          {/* A node is second-hop when it is neither the seed nor a direct
              neighbour of it (seedAdjacency holds exactly the first-hop ties),
              which drives the outer-ring recession. */}
          {layout.nodes.map((node) => (
            <NodeMark
              key={node.id}
              node={node}
              isSeed={node.id === seed.id}
              isSecondHop={node.id !== seed.id && !seedAdjacency.has(node.id)}
              focusId={focusId}
              relationshipToSeed={seedAdjacency.get(node.id) ?? null}
              onHoverChange={setFocusId}
              onActivate={handleNodeClick}
              onKeyDown={handleNodeKey}
            />
          ))}
        </svg>

        {/* ── Hover detail panel ─────────────────────────────────────────
            HTML overlay (not SVG foreignObject) so we get full CSS layout,
            overflow clipping, and font rendering for free.  Positioned
            absolutely within the `position: relative` wrapper; SVG coords
            map 1:1 to CSS pixel offsets here.  Renders nothing when no
            node is hovered. */}
        {hoveredNode && hoveredEntity && focusId !== seed.id && (
          <NodeTooltip
            entity={hoveredEntity}
            nodeX={hoveredNode.x}
            nodeY={hoveredNode.y}
            nodeRadius={NODE_RADIUS}
            containerWidth={width}
            containerHeight={height}
            relationshipToSeed={seedAdjacency.get(focusId!) ?? null}
            seedName={seedName}
          />
        )}
      </div>

      {/* ── Legend ─────────────────────────────────────────────────────── */}
      <GraphLegend />
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

/**
 * Single edge line.  Stroke colour by sign of strength; stroke-width by
 * absolute magnitude clamped to [EDGE_STROKE_MIN..EDGE_STROKE_MAX].
 *
 * Layer rules (resting state, nothing focused):
 *   • "Spoke" edges — those touching the seed — render at full opacity as the
 *     first layer.
 *   • "Second-layer" edges — between two non-seed nodes (friends-of-friends) —
 *     render at SECOND_LAYER_EDGE_OPACITY so the outer web recedes.
 *
 * Highlight rules (something focused):
 *   • If this edge is incident on the focused node → emphasise (2× stroke,
 *     full opacity) regardless of layer.
 *   • Otherwise → dim to DIM_OPACITY.
 *
 * @param seedId  The id of the centre node, used to classify spoke vs
 *                second-layer edges.  An edge is a spoke iff either endpoint
 *                is the seed.
 */
function EdgeLine({
  edge,
  focusId,
  seedId,
}: {
  edge: PositionedEdge;
  focusId: string | null;
  seedId: string;
}) {
  // d3-force mutates `source`/`target` from string id to the node object
  // after the first tick — guard both shapes so the first paint doesn't
  // crash if React renders before d3 has settled.
  const s = typeof edge.source === 'string' ? null : edge.source;
  const t = typeof edge.target === 'string' ? null : edge.target;
  if (!s || !t) return null;

  const strength = typeof edge.strength === 'number' ? edge.strength : 0;
  const magnitude = Math.min(Math.abs(strength) / 100, 1);
  const baseWidth =
    EDGE_STROKE_MIN + magnitude * (EDGE_STROKE_MAX - EDGE_STROKE_MIN);
  const stroke =
    strength > 5  ? COLORS.terraNova :
    strength < -5 ? COLORS.flare     :
                    COLORS.hairline;

  // A spoke touches the seed (first layer); everything else is the outer web.
  const isSpoke = s.id === seedId || t.id === seedId;
  const incidentToFocus =
    focusId !== null && (s.id === focusId || t.id === focusId);
  const opacity =
    focusId !== null
      ? (incidentToFocus ? 1 : DIM_OPACITY)
      : (isSpoke ? 1 : SECOND_LAYER_EDGE_OPACITY);
  const strokeWidth = incidentToFocus ? baseWidth * 2 : baseWidth;

  return (
    <line
      x1={s.x}
      y1={s.y}
      x2={t.x}
      y2={t.y}
      stroke={stroke}
      strokeWidth={strokeWidth}
      opacity={opacity}
      // Pointer-events off so hover targets stay on the node circles —
      // edge hover would be hard to hit at narrow widths.
      pointerEvents="none"
    />
  );
}

/**
 * Single node mark with a circle, optional ring (for the seed), and a
 * conditional label.  Wrapped in a focusable <g> so keyboard users can
 * tab through nodes and activate them with Enter/Space.
 *
 * Label visibility rules:
 *   • Seed node → label always visible.
 *   • Non-seed nodes → label only when hovered or focused.
 */
function NodeMark({
  node,
  isSeed,
  isSecondHop,
  focusId,
  relationshipToSeed,
  onHoverChange,
  onActivate,
  onKeyDown,
}: {
  node: PositionedNode;
  isSeed: boolean;
  /**
   * True when this node is a second-hop satellite (friend-of-a-friend) — i.e.
   * not the seed and with no direct edge to it.  Drives the outer-ring
   * recession (smaller radius + lower resting opacity) so the two layers of
   * the web read distinctly.
   */
  isSecondHop: boolean;
  focusId: string | null;
  /**
   * The first-hop relationship from the seed to this node, if one
   * exists.  Composed into the per-node aria-label so screen readers
   * hear "NAME, KIND, relationship to seed: KIND, strength: N" in
   * the same single utterance hover surfaces visually.  Null for
   * the seed itself and for second-hop satellites.
   */
  relationshipToSeed: { kind: string; strength: number } | null;
  onHoverChange: (id: string | null) => void;
  onActivate:   (ev: MouseEvent<SVGGElement>, id: string) => void;
  onKeyDown:    (ev: KeyboardEvent<SVGGElement>, id: string) => void;
}) {
  const kindStr = typeof node.kind === 'string' ? node.kind : 'unknown';
  const name    = typeof node.name === 'string' ? node.name : '…';

  /**
   * Compose the full aria-label string per the isl-7hp spec.  Seed
   * nodes don't get an aria-label (they aren't focusable links — the
   * user is already on that entity's page).
   */
  const ariaLabel = isSeed
    ? undefined
    : relationshipToSeed
      ? `${name}, ${kindStr}, relationship to seed: ${relationshipToSeed.kind}, strength: ${relationshipToSeed.strength}`
      : `${name}, ${kindStr}`;

  // Resting state recesses second-hop nodes to SECOND_HOP_OPACITY; when
  // something is focused, the focused node (and seed) stay full while every
  // other node dims to DIM_OPACITY.  The seed is never recessed.
  const isFocused = focusId === node.id;
  const opacity =
    focusId !== null
      ? (isFocused || isSeed ? 1 : DIM_OPACITY)
      : (isSecondHop ? SECOND_HOP_OPACITY : 1);

  const radius = isSeed
    ? SEED_RADIUS
    : isSecondHop ? SECOND_HOP_RADIUS : NODE_RADIUS;
  const fill   = isSeed ? COLORS.dust : kindColor(kindStr);

  // Show the label for the seed always; non-seed only on hover/focus
  // so the canvas doesn't drown in text at default zoom.
  const showLabel = isSeed || isFocused;

  return (
    <g
      transform={`translate(${node.x},${node.y})`}
      opacity={opacity}
      tabIndex={isSeed ? -1 : 0}
      role={isSeed ? undefined : 'link'}
      aria-label={ariaLabel}
      style={{ cursor: isSeed ? 'default' : 'pointer', outline: 'none' }}
      onMouseEnter={() => onHoverChange(node.id)}
      onMouseLeave={() => onHoverChange(null)}
      onFocus={() => onHoverChange(node.id)}
      onBlur={() => onHoverChange(null)}
      onClick={(ev) => onActivate(ev, node.id)}
      onKeyDown={(ev) => onKeyDown(ev, node.id)}
    >
      {/* Ring for the seed node — a 1.5 px quantum outline at 1.4× radius. */}
      {isSeed && (
        <circle
          r={radius + 4}
          fill="none"
          stroke={COLORS.quantum}
          strokeWidth={1.5}
        />
      )}
      <circle r={radius} fill={fill} />

      {showLabel && (
        <text
          x={0}
          y={radius + 14}
          textAnchor="middle"
          style={{
            fontSize:      11,
            fontWeight:    700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            fontVariantNumeric: 'tabular-nums',
            fill:          COLORS.dust,
            // Stop the label from intercepting hover on adjacent nodes.
            pointerEvents: 'none',
            // Faint shadow so the label reads against dust-coloured
            // edges crossing behind it.
            paintOrder: 'stroke',
            stroke: COLORS.abyss,
            strokeWidth: 3,
          }}
        >
          {name}
        </text>
      )}
    </g>
  );
}

// ── Tooltip helpers ──────────────────────────────────────────────────────────

/**
 * Format a relationship strength value as a signed string with a colour hint.
 * Returns e.g. "+55" (terraNova) for positive, "−45" (flare) for negative,
 * "0" (dust50) for neutral.  The Architect uses strength to encode how
 * tightly two entities are bound; showing the raw number lets curious users
 * read the lore tension at a glance.
 */
function formatStrength(strength: number): { label: string; color: string } {
  if (strength >  5) return { label: `+${strength}`, color: COLORS.terraNova };
  if (strength < -5) return { label: `−${Math.abs(strength)}`, color: COLORS.flare };
  return { label: String(strength), color: COLORS.dust50 };
}

/**
 * Humanise a snake_case relationship kind for display in the tooltip.
 * e.g. "affiliated_with" → "affiliated with", "family_of" → "family of".
 * Keeps labels legible without a large lookup table.
 */
function humaniseKind(kind: string): string {
  return kind.replace(/_/g, ' ');
}

/**
 * Floating detail panel that appears when the user hovers or focuses a node
 * in the relationship graph.  Mirrors the "Node Details" pattern from the
 * Mirofish reference but uses the ISL retro-minimalist design language
 * (Space Mono, COLORS tokens, hairline borders).
 *
 * POSITIONING LOGIC
 * -----------------
 * The panel defaults to the right of the node with a small upward offset.
 * Three guards prevent it from escaping the wrapper:
 *   • Horizontal flip  — if right edge exceeds container width, place left.
 *   • Left-edge clamp  — after a flip, Math.max(MARGIN, x) so a narrow
 *                        container (< ~260 px) never pushes the panel off
 *                        the left edge.
 *   • Vertical clamp   — pin to top/bottom margin if the panel would clip.
 * SVG node coordinates equal CSS pixel offsets within the `position: relative`
 * wrapper, so no coordinate-space conversion is needed.
 *
 * CONTENT STRATEGY
 * ----------------
 * 1. Kind badge — colour-coded dot + kind label (same palette as the node).
 * 2. Display name — the entity's human-readable name in larger type.
 * 3. Relationship row — direct-hop kind + signed strength, or "indirect"
 *    indicator for second-hop nodes.  Absent for the seed node (suppressed
 *    upstream by the caller's `focusId !== seed.id` guard).
 * 4. Meta key-value rows — up to 3 priority fields from TOOLTIP_META_KEYS
 *    (role, homeworld, employer, etc.).  Kind-agnostic: only present keys
 *    are shown, so the panel is compact for sparse entities.
 * 5. Description excerpt — truncated at TOOLTIP_DESC_MAX chars with an
 *    ellipsis; rendered in italics to visually distinguish prose from data.
 *
 * @param entity            - Hydrated entity row for the hovered node.
 * @param nodeX             - Node centre x in SVG / container-relative px.
 * @param nodeY             - Node centre y in SVG / container-relative px.
 * @param nodeRadius        - Circle radius (px) — used to offset the gap.
 * @param containerWidth    - Wrapper pixel width for horizontal flip logic.
 * @param containerHeight   - Wrapper pixel height for vertical clamp logic.
 * @param relationshipToSeed - Direct edge from seed to this node, or null
 *                            if the node is a second-hop satellite.
 * @param seedName          - Display name of the seed for the "→ SEED" label.
 */
function NodeTooltip({
  entity,
  nodeX,
  nodeY,
  nodeRadius,
  containerWidth,
  containerHeight,
  relationshipToSeed,
  seedName,
}: {
  entity:             Entity;
  nodeX:              number;
  nodeY:              number;
  nodeRadius:         number;
  containerWidth:     number;
  containerHeight:    number;
  relationshipToSeed: { kind: string; strength: number } | null;
  seedName:           string;
}) {
  // ── Position calculation ────────────────────────────────────────────
  // Default: place the tooltip TOOLTIP_GAP px to the right of the node
  // edge, slightly above centre so the node circle aligns near the panel
  // header rather than disappearing behind the middle of the panel.
  let x = nodeX + nodeRadius + TOOLTIP_GAP;
  let y = nodeY - 32; // -32 aligns the panel header near the node centre

  // Horizontal flip + left-edge clamp.
  // If the right edge overflows the container, place the panel LEFT of the
  // node.  Then clamp to MARGIN so a narrow container (e.g. 300 px, node at
  // x=150) doesn't produce a negative x that hides the panel off-screen.
  // Example: 300 px wide, nodeX=150 → unguarded = 150−8−14−228 = −100;
  //          clamped → MARGIN (8 px).
  const MARGIN = 8;
  if (x + TOOLTIP_WIDTH > containerWidth - MARGIN) {
    x = Math.max(MARGIN, nodeX - nodeRadius - TOOLTIP_GAP - TOOLTIP_WIDTH);
  }
  if (y < MARGIN) y = MARGIN;
  if (y + TOOLTIP_HEIGHT_EST > containerHeight - MARGIN) {
    y = containerHeight - TOOLTIP_HEIGHT_EST - MARGIN;
  }

  // ── Meta field extraction ───────────────────────────────────────────
  // Pull up to 3 of the priority keys from entity.meta in the order
  // defined by TOOLTIP_META_KEYS.  Skip nullish values so we never
  // render an empty row.
  const meta = (entity.meta ?? {}) as Record<string, unknown>;
  const metaRows: Array<{ key: string; value: string }> = [];
  for (const key of TOOLTIP_META_KEYS) {
    if (metaRows.length >= 3) break;
    const val = meta[key];
    if (val !== null && val !== undefined && val !== '') {
      metaRows.push({ key, value: String(val) });
    }
  }

  // Description excerpt — omit from TOOLTIP_META_KEYS list; shown below
  // a divider in italic prose style to distinguish it from structured data.
  const rawDesc = typeof meta['description'] === 'string' ? meta['description'] : '';
  const desc = rawDesc.length > TOOLTIP_DESC_MAX
    ? rawDesc.slice(0, TOOLTIP_DESC_MAX).trimEnd() + '…'
    : rawDesc;

  // ── Kind badge colour ───────────────────────────────────────────────
  const kindStr  = entity.kind ?? 'unknown';
  const dotColor = kindColor(kindStr);

  // ── Strength badge (only for direct edges) ──────────────────────────
  const rel = relationshipToSeed
    ? { ...relationshipToSeed, ...formatStrength(relationshipToSeed.strength) }
    : null;

  // ── Shared style fragments ──────────────────────────────────────────
  const monoBase: CSSProperties = {
    letterSpacing: '0.04em',
  };
  const labelStyle: CSSProperties = {
    ...monoBase,
    fontSize:      9,
    fontWeight:    700,
    textTransform: 'uppercase',
    letterSpacing: '0.12em',
    color:         COLORS.dust50,
  };
  const hairline: CSSProperties = {
    borderBottom: `1px solid ${COLORS.hairline}`,
    margin:       '6px 0',
  };

  return (
    <div
      // `pointer-events: none` so the tooltip itself never swallows the
      // mouse-leave event that would hide it — hover stays on the SVG node.
      style={{
        position:      'absolute',
        left:          x,
        top:           y,
        width:         TOOLTIP_WIDTH,
        background:    COLORS.phobosAsh,
        border:        `1px solid ${COLORS.hairline}`,
        boxShadow:     '0 4px 24px rgba(0,0,0,0.55)',
        padding:       '10px 12px',
        boxSizing:     'border-box',
        pointerEvents: 'none',
        zIndex:        10,
        // Prevent the panel from causing layout jitter as the simulation
        // moves nodes — `will-change` tells the compositor to composite
        // this layer independently.
        willChange:    'left, top',
      }}
      role="tooltip"
      aria-hidden="true"
    >
      {/* ── Kind badge ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
        <span
          style={{
            display:      'inline-block',
            width:        7,
            height:       7,
            borderRadius: '50%',
            background:   dotColor,
            flexShrink:   0,
          }}
        />
        <span style={labelStyle}>{kindStr.replace(/_/g, ' ')}</span>
      </div>

      {/* ── Display name ───────────────────────────────────────────── */}
      <div
        style={{
          ...monoBase,
          fontSize:   12,
          fontWeight: 700,
          color:      COLORS.dust,
          lineHeight: 1.3,
          marginBottom: 6,
          // Wrap long names rather than truncating — the tooltip is wide
          // enough to hold two lines for even the longest entity names.
          wordBreak: 'break-word',
        }}
      >
        {entity.display_name ?? entity.name}
      </div>

      <div style={hairline} />

      {/* ── Relationship to seed ────────────────────────────────────── */}
      {rel ? (
        <div style={{ marginBottom: 6 }}>
          {/* Arrow + seed name label */}
          <div style={{ ...labelStyle, marginBottom: 2 }}>
            {'→ '}{seedName}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {/* Relationship kind */}
            <span
              style={{
                ...monoBase,
                fontSize:      10,
                fontWeight:    700,
                color:         COLORS.dust70,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}
            >
              {humaniseKind(rel.kind)}
            </span>
            {/* Strength badge */}
            <span
              style={{
                ...monoBase,
                fontSize:   10,
                fontWeight: 700,
                color:      rel.color,
              }}
            >
              {rel.label}
            </span>
          </div>
        </div>
      ) : (
        // Second-hop node — no direct edge to the seed.  Show a subtle
        // "indirect" label so the user knows why there's no strength score.
        <div style={{ ...labelStyle, marginBottom: 6, color: COLORS.dust50 }}>
          indirect connection
        </div>
      )}

      {/* ── Meta key-value rows ─────────────────────────────────────── */}
      {metaRows.length > 0 && (
        <>
          <div style={hairline} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: desc ? 6 : 0 }}>
            {metaRows.map(({ key, value }) => (
              <div key={key} style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                <span style={{ ...labelStyle, flexShrink: 0, minWidth: 56 }}>
                  {key.replace(/_/g, ' ')}
                </span>
                <span
                  style={{
                    ...monoBase,
                    fontSize:   10,
                    color:      COLORS.dust70,
                    overflow:   'hidden',
                    whiteSpace: 'nowrap',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {value}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Description excerpt ─────────────────────────────────────── */}
      {desc && (
        <>
          <div style={hairline} />
          <div
            style={{
              ...monoBase,
              fontSize:   10,
              fontStyle:  'italic',
              color:      COLORS.dust50,
              lineHeight: 1.5,
            }}
          >
            {desc}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Centered status text used by the loading / empty / error branches.
 *
 * `pulse=true` adds a quantum-coloured cursor block next to the label
 * for the loading branch so the surface doesn't read as inert.
 */
function Centered({ text, pulse }: { text: string; pulse?: boolean }) {
  return (
    <div
      style={{
        position:       'absolute',
        inset:          0,
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        color:          COLORS.dust50,
        fontSize:       12,
        fontWeight:     700,
        letterSpacing:  '0.18em',
        textTransform:  'uppercase',
        gap:            10,
      }}
    >
      <span>{text}</span>
      {pulse && (
        <span
          aria-hidden="true"
          style={{
            display:     'inline-block',
            width:       8,
            height:      14,
            background:  COLORS.quantum,
            animation:   'isl-graph-pulse 1.2s steps(2) infinite',
          }}
        />
      )}
      <style>{`
        @keyframes isl-graph-pulse {
          0%, 50%   { opacity: 1; }
          50.01%, 100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}

// ── Legend ───────────────────────────────────────────────────────────────────

/**
 * Compact colour-key rendered below the relationship graph SVG.
 *
 * Three row groups:
 *   1. LINKS — edge strength tiers: allied (teal) / neutral (dim) / rival (red).
 *      Stroke weight also encodes magnitude, but colour encodes the sign — this
 *      legend surfaces the sign mapping so the graph is readable at a glance.
 *   2. NODES — entity kind tiers: Player, Manager/Team, Media, Governance,
 *      Disruption, Place.  Intentionally coarse — the hover tooltip reveals the
 *      exact kind.  One entry per visual tier rather than one per `kind` value
 *      keeps the legend scannable (6 rows vs 20+).
 *   3. WEB — the two layers: a full-size dot = a direct tie (first hop), a
 *      smaller faint dot = a 2nd-degree tie (friend-of-a-friend).  Explains the
 *      deliberate size/opacity recession applied to the outer ring.
 *
 * Shares the border treatment (left/right/bottom hairline on abyss) with the
 * SVG box above so the two render as a single integrated panel.
 */
function GraphLegend() {
  const swatchBase: CSSProperties = {
    display:      'block',
    flexShrink:   0,
  };
  const rowStyle: CSSProperties = {
    display:     'flex',
    alignItems:  'center',
    flexWrap:    'wrap',
    gap:         '6px 12px',
  };
  const entryStyle: CSSProperties = {
    display:     'flex',
    alignItems:  'center',
    gap:          5,
  };
  const sectionLabel: CSSProperties = {
    color:         COLORS.dust70,
    marginRight:   4,
    letterSpacing: '0.14em',
  };

  return (
    <div style={{
      display:       'flex',
      flexWrap:      'wrap',
      gap:           '6px 28px',
      padding:       '8px 12px',
      borderLeft:    `1px solid ${COLORS.hairline}`,
      borderRight:   `1px solid ${COLORS.hairline}`,
      borderBottom:  `1px solid ${COLORS.hairline}`,
      background:    COLORS.abyss,
      fontFamily:    '"Space Mono", monospace',
      fontSize:       9,
      letterSpacing: '0.10em',
      textTransform: 'uppercase',
      color:          COLORS.dust50,
      userSelect:    'none',
    }}>
      {/* Edge (link) colour tier */}
      <div style={rowStyle}>
        <span style={sectionLabel}>Links</span>
        {EDGE_LEGEND.map(({ color, label }) => (
          <span key={label} style={entryStyle}>
            <span style={{ ...swatchBase, width: 18, height: 2, background: color, borderRadius: 1 }} />
            {label}
          </span>
        ))}
      </div>

      {/* Node (entity kind) colour tier */}
      <div style={rowStyle}>
        <span style={sectionLabel}>Nodes</span>
        {NODE_LEGEND.map(({ color, label }) => (
          <span key={label} style={entryStyle}>
            <span style={{ ...swatchBase, width: 8, height: 8, borderRadius: '50%', background: color }} />
            {label}
          </span>
        ))}
      </div>

      {/* Web (layer) tier — mirrors the size/opacity recession on the canvas:
          a full dot is a direct tie, a smaller faint dot is a 2nd-degree tie. */}
      <div style={rowStyle}>
        <span style={sectionLabel}>Web</span>
        <span style={entryStyle}>
          <span style={{ ...swatchBase, width: 8, height: 8, borderRadius: '50%', background: COLORS.dust70 }} />
          Direct
        </span>
        <span style={entryStyle}>
          <span style={{ ...swatchBase, width: 5, height: 5, borderRadius: '50%', background: COLORS.dust70, opacity: SECOND_HOP_OPACITY }} />
          2nd degree
        </span>
      </div>
    </div>
  );
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Stable React key for an edge.  Two parallel edges between the same
 * pair of entities can carry different `kind` values, so we include
 * the kind in the key — the underlying graph PK is `(from, to, kind)`.
 */
function edgeKey(edge: PositionedEdge): string {
  const s = typeof edge.source === 'string' ? edge.source : edge.source.id;
  const t = typeof edge.target === 'string' ? edge.target : edge.target.id;
  const k = typeof edge.kind   === 'string' ? edge.kind   : '';
  return `${s}|${t}|${k}`;
}
