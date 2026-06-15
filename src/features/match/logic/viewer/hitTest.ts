// ── features/match/logic/viewer/hitTest.ts ──────────────────────────────────
// Pure click hit-testing for the viewer: given the on-screen positions of the
// dudes this frame and a click point (both in the canvas backing-store space),
// return the nearest dude within a radius — or null when the click missed.

/** A clickable dude's screen-space anchor for this frame. */
export interface HitTarget {
  id: string;
  /** Backing-store pixel position the click is measured against. */
  sx: number;
  sy: number;
}

/**
 * Return the id of the nearest target within `maxDist` pixels of (x, y), or null
 * if none is close enough (so clicking empty pitch deselects).
 *
 * @param targets  Per-dude screen anchors for the current frame.
 * @param x        Click x in backing-store pixels.
 * @param y        Click y in backing-store pixels.
 * @param maxDist  Max selectable distance in backing-store pixels.
 * @returns        Nearest dude id within range, else null.
 */
export function pickNearestId(
  targets: readonly HitTarget[],
  x: number,
  y: number,
  maxDist: number,
): string | null {
  let best: string | null = null;
  let bestD2 = maxDist * maxDist;
  for (const t of targets) {
    const dx = t.sx - x;
    const dy = t.sy - y;
    const d2 = dx * dx + dy * dy;
    if (d2 <= bestD2) {
      bestD2 = d2;
      best = t.id;
    }
  }
  return best;
}
