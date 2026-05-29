// ── features/match/logic/spatial/vec2.ts ─────────────────────────────────────
// Minimal 2D vector maths for the spatial match engine.
//
// WHY A LOCAL VECTOR MODULE (not a dependency)
//   The spatial sim runs thousands of vector ops per simulated match
//   (22 players × ~10 steering forces × ~5400 ticks).  A focused, allocation-
//   light module we control beats pulling in a general-purpose maths library
//   whose API we'd use 10% of.  Every function here is pure and returns a
//   fresh Vec2 — no in-place mutation — so the engine's determinism and
//   React's diff-checking both stay sound.
//
// COORDINATE FRAME
//   x runs along the pitch length (0 = home goal line, 105 = away goal line).
//   y runs across the pitch width (0 = top touchline, 68 = bottom touchline).
//   See pitch constants in types.ts.  All distances are in metres.

/**
 * An immutable 2D point / vector in pitch-metre space.
 * `readonly` so a Vec2 handed to a steering function can never be mutated
 * underneath the caller — every operation allocates a fresh object.
 */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/** The origin / zero vector.  Reused as a safe default for stationary bodies. */
export const ZERO: Vec2 = Object.freeze({ x: 0, y: 0 });

/** Construct a Vec2.  Trivial, but reads more clearly than object literals at call sites. */
export function vec(x: number, y: number): Vec2 {
  return { x, y };
}

/** Vector addition: a + b. */
export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

/** Vector subtraction: a − b (the vector pointing from b to a). */
export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

/** Scalar multiply: a × s. */
export function scale(a: Vec2, s: number): Vec2 {
  return { x: a.x * s, y: a.y * s };
}

/**
 * Squared magnitude.  Prefer this over `len` for comparisons (e.g. "who is
 * closest to the ball") — it skips the sqrt, which matters in the per-tick
 * hot loop where we compare hundreds of distances.
 */
export function len2(a: Vec2): number {
  return a.x * a.x + a.y * a.y;
}

/** Euclidean magnitude (length) of a vector. */
export function len(a: Vec2): number {
  return Math.sqrt(len2(a));
}

/** Squared distance between two points.  Use for comparisons (no sqrt). */
export function dist2(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/** Euclidean distance between two points, in metres. */
export function dist(a: Vec2, b: Vec2): number {
  return Math.sqrt(dist2(a, b));
}

/**
 * Unit vector in the direction of `a`.  Returns ZERO for a zero-length input
 * (rather than NaN) so a stationary body that asks for its own heading gets a
 * safe, well-defined answer instead of poisoning the steering sum.
 */
export function normalize(a: Vec2): Vec2 {
  const l = len(a);
  if (l < 1e-9) return ZERO;
  return { x: a.x / l, y: a.y / l };
}

/**
 * Clamp a vector's magnitude to at most `maxLen`, preserving direction.
 * Used to cap steering forces and player velocities at their limits — a
 * defender can want to accelerate infinitely, but physics says no.
 *
 * @param a       The vector to limit.
 * @param maxLen  Maximum allowed magnitude (metres or metres/sec).
 */
export function truncate(a: Vec2, maxLen: number): Vec2 {
  if (maxLen <= 0) return ZERO;
  const l2 = len2(a);
  if (l2 <= maxLen * maxLen) return a;
  const l = Math.sqrt(l2);
  return { x: (a.x / l) * maxLen, y: (a.y / l) * maxLen };
}

/** Dot product a · b.  Used to test "is the ball moving toward this player". */
export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

/**
 * Linear interpolation from a to b by t ∈ [0,1].
 * t=0 → a, t=1 → b.  Used to ease formation anchors toward the ball.
 */
export function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * Clamp a point inside an axis-aligned box.  Keeps players and the ball on
 * (or near) the pitch — out-of-bounds is detected separately; this is the
 * safety net that stops a body drifting to infinity under a large force.
 */
export function clampToBox(
  a: Vec2,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): Vec2 {
  return {
    x: a.x < minX ? minX : a.x > maxX ? maxX : a.x,
    y: a.y < minY ? minY : a.y > maxY ? maxY : a.y,
  };
}
