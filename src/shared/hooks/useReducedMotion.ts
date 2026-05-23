// ── useReducedMotion.ts ───────────────────────────────────────────────────────
// WHY: Any time the UI uses staggered reveal, drumroll, or animated transitions
// for storytelling effect, we have to honour `prefers-reduced-motion: reduce`.
// Users with vestibular sensitivity or motion-related accessibility needs see
// the same outcome — just instantly, without the choreography.
//
// This hook subscribes to the media query and re-renders when it flips, so
// callers can branch their layout in a single line:
//
//   const reduced = useReducedMotion();
//   if (reduced) return <Instant />;
//   return <Animated />;
//
// SSR: the hook returns `false` during the initial server render (the media
// query API doesn't exist in node), then re-renders with the real value once
// the component mounts in the browser. This is the same fallback every other
// CSS-media-query React hook uses; the brief flash of motion before
// suppression is acceptable for our use cases (worst-case: a 250ms fade
// completes before the hook flips).

import { useEffect, useState } from 'react';

/** The media query string. Single source of truth so CSS + JS stay aligned. */
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Subscribe to `prefers-reduced-motion: reduce`.
 *
 * @returns `true` while the user (OS or browser) is requesting reduced motion,
 *          `false` otherwise. Always `false` during SSR.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(REDUCED_MOTION_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(REDUCED_MOTION_QUERY);
    const onChange = (e: MediaQueryListEvent): void => setReduced(e.matches);
    // addEventListener path is the modern API; addListener is the deprecated
    // fallback for very old Safari. We use the former and let any browser
    // that doesn't support it stay on the initial value (no harm done).
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return reduced;
}
