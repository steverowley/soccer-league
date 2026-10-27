// ── shared/ui/Skeleton.tsx ────────────────────────────────────────────────
// WHY: #383. Lazy routes used `<Suspense fallback={null}>`, painting a blank
// viewport while the route chunk downloads (200 to 800 ms of "is this
// broken?" on a slow connection). A skeleton gives immediate feedback
// without the flash of a spinner on fast connections.
//
// PRIMITIVE
// ─────────
// `<Skeleton height={N} />` renders a flat block in the faint line colour.
// No shimmer: the design system is quiet, and a static block respects
// prefers-reduced-motion by default.
//
// COMPOSED FALLBACK
// ─────────────────
// `<RouteSuspenseFallback />` is the app-wide Suspense fallback: an eyebrow
// bar, a title block and two body lines, sized like a PageHeader so the
// page width and top rhythm are stable across the chunk-load.

import type { CSSProperties } from 'react';

import { Container } from '../../components/Layout';
import { color, space } from '../design';

/** Default block height in px: one line of small text. */
const DEFAULT_SKELETON_HEIGHT = 14;

/**
 * Flat loading placeholder, full width unless constrained.
 *
 * @param height  Block height in px. Defaults to 14 (one small-text line).
 * @param width   Optional width. Defaults to 100%.
 * @param style   Optional layout overrides.
 * @returns       A decorative (aria-hidden) div.
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
        background: color.lineFaint,
        ...style,
      }}
    />
  );
}

/**
 * App-wide `<Suspense fallback>` content for the lazy-route boundary in
 * main.tsx (#383): structural cues instead of a blank viewport. Every block
 * is aria-hidden; the route's real heading announces when the chunk lands.
 *
 * @returns Skeleton blocks shaped like a page header.
 */
export function RouteSuspenseFallback() {
  return (
    <Container>
      <div
        style={{
          paddingTop:    space[48],
          paddingBottom: space[48],
          display:       'flex',
          flexDirection: 'column',
          gap:           space[16],
        }}
      >
        <Skeleton height={12} width={120} />
        <Skeleton height={42} width="60%" />
        <Skeleton height={14} width="92%" />
        <Skeleton height={14} width="78%" />
      </div>
    </Container>
  );
}
