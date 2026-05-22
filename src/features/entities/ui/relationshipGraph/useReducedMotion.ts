// ── features/entities/ui/relationshipGraph/useReducedMotion.ts ──────────────
// Reactive hook for the `prefers-reduced-motion: reduce` media query.
//
// WHY THIS LIVES HERE
//   The relationship graph is the only on-pillar surface that runs a
//   per-frame physics simulation today.  Honouring the user's reduced-
//   motion preference is most impactful here because (a) d3-force
//   produces visible "jitter" the moment it kicks off, and (b) the
//   final positioned graph is fully legible without the animation —
//   we can simply settle the simulation in one synchronous batch and
//   skip the per-tick reveal.
//
// API SHAPE
//   Returns `true` when the user has opted into reduced motion, `false`
//   otherwise.  Updates reactively when the OS preference changes
//   (Chromium fires a `change` event on the MediaQueryList; older
//   Safaris on the deprecated `addListener` / `removeListener` API —
//   both supported here).
//
// SSR / NON-BROWSER
//   `window.matchMedia` doesn't exist in jsdom by default and isn't
//   present at all under SSR.  The hook returns `false` (assume full-
//   motion) in those environments so test runs and any future SSR
//   pass paints the same animated default as the typical client.

import { useEffect, useState } from 'react';

/**
 * The media query string we watch.  Extracted into a constant so a
 * test or a debug page can match on the same exact value.
 */
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Reactive accessor for the user's `prefers-reduced-motion` preference.
 *
 * The hook keeps a single MediaQueryList alive for the component's
 * lifetime and subscribes via the modern `addEventListener('change',
 * …)` API.  Older Safari builds (< 14) expose the same surface under
 * the deprecated `addListener` / `removeListener` callbacks; we feature-
 * detect and use whichever is present so the hook works back to iOS 12
 * without an explicit polyfill.
 *
 * @returns `true` when the OS-level "reduce motion" preference is on,
 *          `false` otherwise (including environments without
 *          `window.matchMedia` such as jsdom).
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia(REDUCED_MOTION_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mql = window.matchMedia(REDUCED_MOTION_QUERY);

    // ── Modern listener API ──────────────────────────────────────────────
    // addEventListener is the canonical surface across Chrome/Firefox/
    // Edge/Safari 14+.  We pass the simplest handler signature compatible
    // with both APIs so the deprecated `addListener` cast below doesn't
    // need a wrapper.
    const handler = (ev: MediaQueryListEvent | MediaQueryList) => {
      setReduced((ev as MediaQueryList).matches);
    };

    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', handler as (e: MediaQueryListEvent) => void);
      return () => mql.removeEventListener('change', handler as (e: MediaQueryListEvent) => void);
    }

    // ── Legacy Safari fallback ───────────────────────────────────────────
    // `addListener` and `removeListener` are the pre-Safari-14 surface.
    // Cast through `any` because TS's lib.dom drops them in newer typings.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const legacy = mql as any;
    if (typeof legacy.addListener === 'function') {
      legacy.addListener(handler);
      return () => legacy.removeListener(handler);
    }
    return undefined;
  }, []);

  return reduced;
}
