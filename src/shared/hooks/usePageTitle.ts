import { useEffect } from 'react';

// ── usePageTitle ──────────────────────────────────────────────────────────────
// WHY: Without per-route titles, every browser tab and every shared link looks
// like the same generic "Intergalactic Soccer League". That hurts navigation
// (multi-tab users can't tell tabs apart) and SEO (search engines weight the
// <title> heavily; one identical title across 11 routes signals a thin site).
//
// The hook updates document.title on mount and restores the previous title on
// unmount, so back/forward navigation cleans up after itself rather than
// stacking " - X - Y - Z" suffixes.
//
// SUFFIX: every page is suffixed with " | Intergalactic Soccer League" so the
// brand stays visible. Callers pass the page-specific prefix only.

/** Default suffix appended to every page title. Edit here to rebrand globally. */
const SUFFIX = ' | Intergalactic Soccer League';

/** Title shown while no specific page has set one (used by the index.html fallback). */
const DEFAULT_TITLE = 'Intergalactic Soccer League';

/**
 * Sets `document.title` to `${title}${SUFFIX}` while the component is mounted,
 * restoring the previous title on unmount.
 *
 * Pass `null` or an empty string to use the default brand title (useful for
 * loading states where you don't yet know the page-specific name).
 *
 * @example
 * usePageTitle('Pluto FC Wanderers');         // "Pluto FC Wanderers | Intergalactic Soccer League"
 * usePageTitle(team ? team.name : null);     // brand-only fallback while loading
 */
export function usePageTitle(title: string | null | undefined): void {
  useEffect(() => {
    const previous = document.title;
    document.title = title ? `${title}${SUFFIX}` : DEFAULT_TITLE;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
