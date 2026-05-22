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
//      a) `getEntity(seedId)`           — needed for the centre node label
//      b) `getEntityRelationships(seedId)` — every edge touching the seed
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
import { useNavigate } from 'react-router-dom';

import { COLORS } from '../../../../components/Layout';
import { useSupabase } from '../../../../shared/supabase/SupabaseProvider';

import {
  getEntitiesByIds,
  getEntity,
  getEntityRelationships,
} from '../../api/relationships';
import { buildGraph } from '../../logic/relationshipGraph';
import { extractSubgraph } from '../../logic/subgraph';
import type { Entity, EntityRelationship } from '../../types';

import { entityRoute } from './entityRoute';
import { kindColor } from './kindColor';
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
/** Radius (px) for every non-seed node. */
const NODE_RADIUS = 8;

/** Edge stroke-width clamps — pixels.  Driven by |strength|/100. */
const EDGE_STROKE_MIN = 0.5;
const EDGE_STROKE_MAX = 3;

/** Opacity applied to non-highlighted nodes/edges when something is focused. */
const DIM_OPACITY = 0.35;

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

        const edgeRows = await getEntityRelationships(db, entityId);
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

  // ── Layout ──────────────────────────────────────────────────────────
  const height = DEFAULT_HEIGHT;
  const layout = useForceLayout({
    nodes:  layoutNodes,
    edges:  layoutEdges,
    width,
    height,
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

  return (
    <div ref={wrapperRef} className={className} style={wrapperStyle}>
      <svg
        role="img"
        aria-label={`Relationship graph for ${seed.display_name ?? seed.name}, ${layout.nodes.length - 1} connections`}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ display: 'block' }}
      >
        {/* ── Edges ──────────────────────────────────────────────────── */}
        {layout.edges.map((edge) => (
          <EdgeLine
            key={edgeKey(edge)}
            edge={edge}
            focusId={focusId}
          />
        ))}

        {/* ── Nodes ──────────────────────────────────────────────────── */}
        {layout.nodes.map((node) => (
          <NodeMark
            key={node.id}
            node={node}
            isSeed={node.id === seed.id}
            focusId={focusId}
            onHoverChange={setFocusId}
            onActivate={handleNodeClick}
            onKeyDown={handleNodeKey}
          />
        ))}
      </svg>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

/**
 * Single edge line.  Stroke colour by sign of strength; stroke-width by
 * absolute magnitude clamped to [EDGE_STROKE_MIN..EDGE_STROKE_MAX].
 *
 * Highlight rules:
 *   • If nothing is focused → render at full opacity.
 *   • If this edge is incident on the focused node → emphasise (2× stroke,
 *     full opacity).
 *   • Otherwise → dim to DIM_OPACITY.
 */
function EdgeLine({
  edge,
  focusId,
}: {
  edge: PositionedEdge;
  focusId: string | null;
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

  const incidentToFocus =
    focusId !== null && (s.id === focusId || t.id === focusId);
  const opacity =
    focusId === null ? 1 : incidentToFocus ? 1 : DIM_OPACITY;
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
  focusId,
  onHoverChange,
  onActivate,
  onKeyDown,
}: {
  node: PositionedNode;
  isSeed: boolean;
  focusId: string | null;
  onHoverChange: (id: string | null) => void;
  onActivate:   (ev: MouseEvent<SVGGElement>, id: string) => void;
  onKeyDown:    (ev: KeyboardEvent<SVGGElement>, id: string) => void;
}) {
  const kindStr = typeof node.kind === 'string' ? node.kind : 'unknown';
  const name    = typeof node.name === 'string' ? node.name : '…';

  // Dim non-focused, non-seed nodes when something is focused.  The seed
  // stays at full opacity so the visual anchor never drops out.
  const isFocused = focusId === node.id;
  const opacity =
    focusId === null || isFocused || isSeed ? 1 : DIM_OPACITY;

  const radius = isSeed ? SEED_RADIUS : NODE_RADIUS;
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
      aria-label={isSeed ? undefined : name}
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
            fontFamily:    'Space Mono, monospace',
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
        fontFamily:     'Space Mono, monospace',
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
