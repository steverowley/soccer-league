// ── features/entities/ui/relationshipGraph/useForceLayout.ts ────────────────
// React hook wrapping d3-force.  Takes a node/edge list, runs the
// physics simulation in a background animation loop, and exposes
// settled-position React state for the SVG renderer to consume.
//
// WHY THIS HOOK EXISTS (rather than rendering via the d3 selection API)
//   d3-force handles physics extremely well, but its DOM-binding sister
//   modules (`d3-selection`, `d3-zoom`) clash with React's reconciliation
//   model: when both libraries write to the same SVG, transient
//   mismatches between the virtual DOM and the real DOM cause flicker.
//   Splitting concerns is the standard fix:
//     • d3 owns the SIMULATION (numeric positions over time).
//     • React owns the RENDERER (SVG <g>/<circle>/<line> output).
//   The hook is the seam — it consumes a positionless input from React,
//   runs the simulation, and returns positioned snapshots back into
//   React state.
//
// LIFECYCLE
//   1. On mount: build the simulation, kick alpha to 1, schedule an rAF
//      that publishes positions to React state.
//   2. On every tick where alpha > ALPHA_MIN: re-publish positions.
//      The simulation cools per ALPHA_DECAY (forceConfig.ts) and halts
//      itself once alpha < ALPHA_MIN.
//   3. On node/edge id-set change: tear down the old simulation, build
//      a new one from the fresh inputs.  We compare by ID set (not
//      array reference) so the renderer can pass a stable callback or
//      a re-built array of the same data without thrashing the layout.
//   4. On `paused=true`: stop the simulation (preserve positions in
//      state) — the renderer keeps rendering the last frame.  Setting
//      `paused=false` later re-warms alpha and resumes.
//   5. On unmount: stop the simulation, cancel the rAF.
//
// NO TESTS
//   The hook is intentionally untested in isolation — d3-force is the
//   trusted dependency (it has its own test suite upstream) and the
//   acceptance criterion is a visual settling test driven by the
//   `<RelationshipGraph>` component in issue 4/6.  Adding a vitest
//   harness for the hook here would require a jsdom rAF polyfill and
//   would mostly assert the d3-force API rather than our code.

import { useEffect, useRef, useState } from 'react';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';

import {
  ALPHA_DECAY,
  ALPHA_MIN,
  CENTER_STRENGTH,
  COLLIDE_ITERATIONS,
  COLLIDE_RADIUS,
  LINK_DISTANCE,
  LINK_STRENGTH,
  MANY_BODY_DISTANCE_MAX,
  MANY_BODY_STRENGTH,
} from './forceConfig';

// ── Public input/output types ────────────────────────────────────────────────

/**
 * One node hand-fed to the hook.  `id` is the only required field; any
 * other properties survive to the positioned output so the renderer can
 * carry metadata (kind, label, colour) through the simulation without
 * a parallel lookup.
 */
export interface NodeInput {
  id: string;
  /** Any extra payload the renderer wants to keep adjacent to the position. */
  [key: string]: unknown;
}

/**
 * One edge hand-fed to the hook.  `source` and `target` reference node
 * ids; d3-force will substitute the actual node objects internally
 * after the first tick, but we keep the typed wrapper around so the
 * input shape stays predictable.
 */
export interface EdgeInput {
  source: string;
  target: string;
  /** Extra payload retained on output (e.g. strength, kind). */
  [key: string]: unknown;
}

/**
 * One positioned node returned to the renderer.  d3-force populates
 * `x` / `y` after the first tick; `vx` / `vy` (velocity components)
 * are useful for debugging but the renderer typically only reads x/y.
 */
export interface PositionedNode extends NodeInput {
  x:  number;
  y:  number;
  vx: number;
  vy: number;
}

/**
 * One positioned edge.  After d3-force resolves the simulation's link
 * force, `source` / `target` are mutated from string ids to references
 * to the underlying node objects.  We surface that shape via the union
 * type so the renderer can compute line endpoints with `s.x, s.y` etc.
 */
export interface PositionedEdge {
  /** Either the original id string (pre-tick) or the resolved node object. */
  source: string | PositionedNode;
  target: string | PositionedNode;
  [key: string]: unknown;
}

/**
 * Hook input.  Width/height set the viewport into which `forceCenter`
 * pulls the layout.  `paused` lets the parent freeze the simulation
 * (e.g. while a modal is open or the tab is hidden).
 */
export interface UseForceLayoutInput {
  nodes:   readonly NodeInput[];
  edges:   readonly EdgeInput[];
  width:   number;
  height:  number;
  paused?: boolean;
}

/**
 * Hook output.  `nodes` and `edges` are positioned snapshots that
 * update at most once per animation frame.  `restart` re-warms the
 * simulation back to alpha=1 so a tuning slider or a user-driven
 * "shake" button can re-run the layout without re-mounting the hook.
 */
export interface UseForceLayoutOutput {
  nodes: PositionedNode[];
  edges: PositionedEdge[];
  /** Re-warms the simulation to alpha=1 and resumes ticking. */
  restart: () => void;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Build a deterministic fingerprint of the input id sets so we can
 * decide whether the simulation needs a rebuild.  We deliberately do
 * NOT include the payload — the renderer is expected to pass new
 * payloads on re-render (mutable React state) without restarting the
 * layout, but new IDs DO change the graph topology and need a rebuild.
 *
 * Sorted to make the fingerprint independent of input order — two
 * arrays containing the same nodes in different orders produce the
 * same string and the simulation is left alone.
 */
function fingerprintIds(nodes: readonly NodeInput[], edges: readonly EdgeInput[]): string {
  const nodeIds = nodes.map(n => n.id).sort();
  // Edges have no PK on their own; use source|target as the unique key.
  // We don't include a `kind` field because the EdgeInput contract is
  // open and not every consumer carries kind.
  const edgeIds = edges.map(e => `${e.source}->${e.target}`).sort();
  return `n:${nodeIds.join(',')}|e:${edgeIds.join(',')}`;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * React hook that runs a d3-force simulation against the given node/
 * edge inputs and publishes settled positions to component state once
 * per animation frame.
 *
 * IMPLEMENTATION NOTES
 *   • The simulation runs in a background loop (d3 schedules ticks via
 *     its own timer).  We attach a `.on('tick', ...)` listener that
 *     uses `requestAnimationFrame` to push the latest positions into
 *     React state — this throttles state updates to one per frame
 *     even when d3 ticks more often, so React's reconciler isn't
 *     overwhelmed on large graphs.
 *   • The simulation MUTATES the input node/edge objects (d3 attaches
 *     x/y/vx/vy to each node).  We clone the inputs into a fresh
 *     working set on every rebuild so the parent never sees its
 *     props mutated.
 *   • The cleanup function stops the simulation (`.stop()`) and
 *     cancels the pending rAF.  d3 simulations do NOT free themselves
 *     when the GC reclaims the reference — without `.stop()`, the
 *     internal timer keeps ticking.
 *
 * @param input  Nodes, edges, viewport size, and an optional pause flag.
 * @returns      Positioned nodes/edges + a `restart` callback.
 */
export function useForceLayout(input: UseForceLayoutInput): UseForceLayoutOutput {
  const { nodes, edges, width, height, paused = false } = input;

  // ── Simulation ref ────────────────────────────────────────────────────
  // We hold the d3 simulation in a ref because it's not React state —
  // we don't want every tick to trigger a re-render via setState on the
  // simulation itself.  State holds only the published positions.
  const simRef = useRef<Simulation<PositionedNode, SimulationLinkDatum<PositionedNode>> | null>(null);

  // ── Pending-frame ref ─────────────────────────────────────────────────
  // We coalesce multiple d3 ticks into a single React state update via
  // requestAnimationFrame.  This ref tracks the in-flight rAF id so
  // we can cancel it on cleanup.
  const rafRef = useRef<number | null>(null);

  // ── Published positions ───────────────────────────────────────────────
  const [positionedNodes, setPositionedNodes] = useState<PositionedNode[]>([]);
  const [positionedEdges, setPositionedEdges] = useState<PositionedEdge[]>([]);

  // ── Fingerprint of the current id set ─────────────────────────────────
  // Used to decide whether a re-render counts as a topology change.
  // Recomputed on every render but only the string value matters; the
  // useEffect below depends on it.
  const idFingerprint = fingerprintIds(nodes, edges);

  // ── Build / rebuild effect ────────────────────────────────────────────
  // Fires whenever the id-set fingerprint or viewport size changes.
  // Builds a fresh simulation, lets the tick handler publish frames,
  // and tears it down on cleanup or before the next rebuild.
  useEffect(() => {
    // Clone inputs so d3's in-place mutation of x/y/vx/vy doesn't leak
    // back into the parent's prop array.  We `Object.assign` rather
    // than spread-into-new-object so the renderer-supplied payload
    // properties (kind, label, etc.) survive.
    const simNodes: PositionedNode[] = nodes.map(n => Object.assign({}, n, {
      x:  width  / 2,
      y:  height / 2,
      vx: 0,
      vy: 0,
    }) as PositionedNode);
    const simEdges = edges.map(e => Object.assign({}, e) as PositionedEdge);

    const sim = forceSimulation<PositionedNode>(simNodes)
      .alphaDecay(ALPHA_DECAY)
      .alphaMin(ALPHA_MIN)
      .force('charge', forceManyBody<PositionedNode>()
        .strength(MANY_BODY_STRENGTH)
        .distanceMax(MANY_BODY_DISTANCE_MAX))
      .force('link', forceLink<PositionedNode, SimulationLinkDatum<PositionedNode>>(simEdges as unknown as SimulationLinkDatum<PositionedNode>[])
        .id((d) => (d as PositionedNode).id)
        .distance(LINK_DISTANCE)
        .strength(LINK_STRENGTH))
      .force('center', forceCenter(width / 2, height / 2).strength(CENTER_STRENGTH))
      .force('collide', forceCollide<PositionedNode>(COLLIDE_RADIUS).iterations(COLLIDE_ITERATIONS));

    simRef.current = sim;

    // ── Tick handler ────────────────────────────────────────────────────
    // d3 fires `tick` synchronously inside its timer callback.  We
    // request a single animation frame per tick that flushes the
    // latest positions into React state.  If multiple ticks fire
    // before the rAF runs, only the LAST set of positions is
    // published — saving render thrash on faster-than-vsync ticks.
    const onTick = () => {
      if (rafRef.current !== null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        // d3 mutates the simNodes/simEdges arrays in place; we slice
        // them so React sees a new array reference and re-renders.
        setPositionedNodes(simNodes.slice());
        setPositionedEdges(simEdges.slice());
      });
    };

    const onEnd = () => {
      // Final flush — guarantees the last frame is committed even if
      // alpha crossed ALPHA_MIN between rAFs.
      setPositionedNodes(simNodes.slice());
      setPositionedEdges(simEdges.slice());
    };

    sim.on('tick', onTick);
    sim.on('end',  onEnd);

    // ── Initial paused state ────────────────────────────────────────────
    // If the caller mounted with paused=true, freeze immediately.  Otherwise
    // d3 starts ticking automatically after construction.
    if (paused) sim.stop();

    return () => {
      // Order matters: stop the sim first so no new ticks queue
      // additional rAFs, then cancel any pending rAF.
      sim.stop();
      sim.on('tick', null);
      sim.on('end',  null);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (simRef.current === sim) simRef.current = null;
    };
    // The fingerprint string subsumes nodes+edges changes; including
    // the raw arrays in deps would rebuild on every render even when
    // the topology is unchanged.
  }, [idFingerprint, width, height]);

  // ── Pause / resume effect ─────────────────────────────────────────────
  // Pause without rebuilding by toggling sim.stop()/sim.alpha().restart().
  // We do this in a separate effect (not the build one) so flipping
  // `paused` doesn't tear the whole simulation down — preserves
  // positions across the pause boundary.
  useEffect(() => {
    const sim = simRef.current;
    if (!sim) return;
    if (paused) {
      sim.stop();
    } else {
      // alpha(0.3) is a "warm" restart — not the full alpha=1 jolt that
      // a topology change deserves, but enough heat to ease into a
      // settled position if anything drifted while paused.
      sim.alpha(0.3).restart();
    }
  }, [paused]);

  // ── restart callback ──────────────────────────────────────────────────
  // Re-warms alpha to 1 without rebuilding.  Useful for a "shake"
  // affordance or for picking up a stuck layout after the user drags
  // a node manually.
  const restart = () => {
    const sim = simRef.current;
    if (!sim) return;
    sim.alpha(1).restart();
  };

  return {
    nodes: positionedNodes,
    edges: positionedEdges,
    restart,
  };
}

// Re-export d3 simulation node datum so consumers of PositionedNode can
// satisfy d3's structural constraints in their own helpers without
// having to add d3-force to their direct imports.
export type { SimulationNodeDatum };
