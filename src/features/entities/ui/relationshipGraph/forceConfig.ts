// ── features/entities/ui/relationshipGraph/forceConfig.ts ───────────────────
// Tunable physics constants for the relationship-graph d3-force simulation.
//
// Why a separate file from `useForceLayout.ts`
//   The hook should stay focused on the lifecycle (mount/restart/cleanup);
//   knob-twiddling for visual tuning happens here.  Designers can riff on
//   the numbers without touching the hook implementation, and Storybook /
//   the actual relationship-graph component can A/B different configs by
//   importing the named exports.
//
// Style guide for the constants
//   • Every value has a short comment naming the d3-force concept it maps
//     to (https://github.com/d3/d3-force) and the user-visible effect
//     ("nodes pull together / fly apart / stop wobbling / etc.").
//   • Threshold-style numbers (alpha decay, cool-off cutoff) include the
//     "what changes when this fires" annotation per the project doc style.

/**
 * d3-force per-tick decay applied to the simulation's alpha (temperature).
 * Each tick multiplies the remaining "heat" by (1 - decay).  Higher values
 * cool the layout faster, lower values let it wander longer.
 *
 * At 0.0228 (the d3 default) a simulation reaches the default min-alpha
 * (0.001) after ~300 ticks ≈ 5 seconds at 60 fps.  We bump it slightly to
 * 0.04 so the relationship graph settles in well under our 1.5 s budget
 * (acceptance criterion) at ~80 ticks.
 */
export const ALPHA_DECAY = 0.04;

/**
 * Hard floor at which the simulation halts itself.  Below this value the
 * positions are visually stable — further ticks would move nodes <1 px and
 * just burn CPU.  We use the d3 default of 0.001 but expose it here so the
 * hook can drive its `useEffect` cleanup logic against the same constant
 * (no implicit shared knowledge between hook + d3 internals).
 */
export const ALPHA_MIN = 0.001;

/**
 * Strength of the many-body (charge) repulsion between every pair of
 * nodes.  Negative = repulsion; the larger the magnitude the further
 * apart unrelated nodes drift.  At -180 a 20-node graph settles into a
 * cluster the width of our typical viewport (480 px) without any nodes
 * overlapping.  Push it more negative for sparser layouts, less negative
 * to draw clusters closer together.
 */
export const MANY_BODY_STRENGTH = -180;

/**
 * Cap on the many-body force's distance reach.  d3 walks every pair by
 * default which is O(n²); the `theta`-approximation + a `distanceMax`
 * keeps the per-tick cost reasonable on larger graphs (the subgraph
 * extractor caps us at ~157 nodes worst case but the renderer may
 * receive smaller subgraphs too).
 *
 * 320 px ≈ 2× the viewport's shorter dimension — far enough that nodes
 * stop "feeling" each other before the simulation thinks they should.
 */
export const MANY_BODY_DISTANCE_MAX = 320;

/**
 * Ideal edge length in pixels for `forceLink`.  Edges shorter than this
 * are stretched; longer ones are pulled in.  60 px gives readable label
 * spacing at our default node radius (≈14 px) without producing a
 * spaghetti tangle when the graph is dense.
 */
export const LINK_DISTANCE = 60;

/**
 * Strength of the link force — how aggressively edges pull their two
 * endpoints together.  d3 defaults to 1 / min(degree(a), degree(b))
 * which auto-weakens for hub nodes, but our subgraphs are seed-centred
 * so we override with a flat 0.4 to keep first-hop satellites at a
 * consistent radius regardless of how many second-hop edges they
 * collected.
 */
export const LINK_STRENGTH = 0.4;

/**
 * Radius (px) used by `forceCollide`.  Nodes are repelled if their
 * centres come within 2× this distance.  18 px is a comfortable buffer
 * around a 14 px-radius node label so adjacent nodes never overlap.
 */
export const COLLIDE_RADIUS = 18;

/**
 * Number of iterations the collision solver runs per tick.  Higher
 * iteration counts produce stricter no-overlap guarantees at the cost
 * of CPU per tick.  Two iterations is enough to clear most overlaps in
 * a settled layout; we bump to 2 (from the d3 default of 1) because
 * the acceptance criterion calls out "nodes don't overlap".
 */
export const COLLIDE_ITERATIONS = 2;

/**
 * `forceCenter` strength.  d3-force defaults to 1 (snap to centre every
 * tick).  We lower to 0.5 so the layout has freedom to find its own
 * shape; the centre still acts as a gentle attractor that keeps the
 * graph inside the SVG viewport without dominating the topology.
 */
export const CENTER_STRENGTH = 0.5;
