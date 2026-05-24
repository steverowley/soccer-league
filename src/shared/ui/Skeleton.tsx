// ── shared/ui/Skeleton.tsx ────────────────────────────────────────────────
// WHY: #383 — the app uses `<Suspense fallback={null}>` for every lazy
// route, which paints a blank viewport while the route chunk downloads.
// On a slow connection that's 200-800 ms of "is this thing broken?"
// uncertainty. A skeleton placeholder gives the user immediate feedback
// without the flash-cost of a spinner on fast connections.
//
// PRIMITIVE
// ─────────
// `<Skeleton height={N} />` renders a flat dust-faint block. No
// shimmer animation — the design system is intentionally retro-
// minimalist, and animation would feel out of place. A static block
// is more honest about "we're waiting", and respects
// prefers-reduced-motion by default.
//
// COMPOSED FALLBACK
// ─────────────────
// `<RouteSuspenseFallback />` is the app-wide Suspense fallback shape:
// a kicker chip + a primary heading block + a body block, sized to
// roughly match what most pages render at first paint. Sits inside
// the existing Container so the page width is stable across the
// chunk-load → real-content transition.
//
// PRIOR ART
// ─────────
// `features/admin/ui/primitives.tsx` already exports a `Skeleton({ height })`
// component used by the admin season-controls / fixture-browser panels.
// This file ports that pattern up to `shared/ui/` so public pages can
// consume the same primitive without reaching into a feature barrel.

import type { CSSProperties } from 'react';

import { Container, COLORS } from '../../components/Layout';

// ── Skeleton primitive ────────────────────────────────────────────────────

/**
 * Default block height in pixels when a caller doesn't specify one.
 * 14 px matches the dust-text line-height; a single Skeleton at this
 * height feels like a placeholder line of body copy.
 */
const DEFAULT_SKELETON_HEIGHT = 14;

/**
 * Flat loading placeholder.  Renders a dust-faint block at the given
 * height, full-width unless wrapped in a constraining container.
 *
 * Intentionally non-animated: the design system is retro-minimalist
 * and a shimmer pulse would clash. A static block also automatically
 * respects `prefers-reduced-motion` (no animation, no override needed).
 *
 * @param height       Pixel height of the block. Defaults to 14 px
 *                     (one body-text line). Pass larger values for
 *                     heading / hero placeholders.
 * @param width        Optional explicit width. Defaults to `100%` so
 *                     skeletons stretch to their container.
 * @param style        Optional style override for one-off margins.
 */
export function Skeleton({
  height,
  width,
  style,
}: {
  height?: number;
  width?:  number | string;
  style?:  CSSProperties;
}) {
  return (
    <div
      aria-hidden="true"
      style={{
        height:     height ?? DEFAULT_SKELETON_HEIGHT,
        width:      width  ?? '100%',
        background: COLORS.dustFaint,
        ...style,
      }}
    />
  );
}

// ── Route suspense fallback ───────────────────────────────────────────────

/**
 * Vertical gap between skeleton blocks inside the route fallback, in
 * pixels. Tuned to roughly match the editorial spacing used by
 * `SectionHeader` so a page swapping from skeleton to real content
 * doesn't jump-shift its baseline.
 */
const ROUTE_FALLBACK_GAP = 16;

/**
 * App-wide `<Suspense fallback>` content for the lazy-route boundary in
 * main.tsx.  Replaces the previous `fallback={null}` (#383) so the user
 * sees structural cues during the chunk-download window instead of a
 * blank viewport.
 *
 * Why not a spinner: a spinner flashes too briefly on fast connections
 * (jarring) and would force a reduced-motion override.  The skeleton
 * is honest about "structure is coming", aligns with the design
 * system's minimalism, and needs no a11y/motion gating.
 *
 * `aria-hidden` is set on every block so a screen reader treats the
 * whole fallback as decorative — the route's real heading will
 * announce as soon as the chunk resolves.
 */
export function RouteSuspenseFallback() {
  return (
    <Container>
      <div
        style={{
          paddingTop:    48,
          paddingBottom: 48,
          display:       'flex',
          flexDirection: 'column',
          gap:           ROUTE_FALLBACK_GAP,
        }}
      >
        {/* Kicker chip — short, dust-faint pill that signals "section
            label is loading". */}
        <Skeleton height={12} width={120} />
        {/* Primary heading block — wide, tall placeholder for the
            page's H1. */}
        <Skeleton height={42} width="60%" />
        {/* Two body lines so the fallback feels like content, not just
            chrome. */}
        <Skeleton height={14} width="92%" />
        <Skeleton height={14} width="78%" />
      </div>
    </Container>
  );
}
