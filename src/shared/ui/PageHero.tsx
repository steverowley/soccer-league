// ── shared/ui/PageHero.tsx ───────────────────────────────────────────────────
// WHY: Every top-level ISL page opens with the same structure:
//   <div class="page-hero">
//     <div class="container">
//       <div class="page-hero__title-row"><h1>…</h1> [badge]</div>
//       <hr class="divider" />
//       [subtitle paragraph]
//     </div>
//   </div>
//
// Before this component, that markup was duplicated verbatim in Login, Profile,
// LeagueTable, NewsFeedPage, and TrainingPage. A change to the hero structure
// (e.g. adding a breadcrumb row) required editing five files. This wrapper
// reduces that to one.
//
// DESIGN CONSTRAINTS:
//   - `.page-hero` owns the 100px desktop / 70px mobile top padding defined in
//     index.css. Do NOT add extra top padding on calling pages.
//   - The `badge` slot is rendered inside `.page-hero__title-row` to the right
//     of the h1. Pass null/undefined to suppress.
//   - `children` is a catch-all slot below the divider for pages that need
//     extra hero content (e.g. a filter strip, a CTA button row).
//
// CONSUMERS: NewsFeedPage, Login, Profile, LeagueTable, TrainingPage

import type { ReactNode } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PageHeroProps {
  /** Primary heading text — rendered inside `<h1>`. */
  title: ReactNode;
  /**
   * Optional badge rendered to the right of the `<h1>` inside the title row.
   * Typically a `<Badge variant="architect">` or a tier pill.
   * Pass nothing/undefined to suppress the slot entirely.
   */
  badge?: ReactNode;
  /**
   * Short descriptive line rendered as `<p class="subtitle">` below the
   * divider. Pass nothing/undefined to suppress.
   */
  subtitle?: string;
  /**
   * Additional hero content rendered below the subtitle (e.g. a filter strip,
   * tab row, or CTA buttons). Rare — most pages don't need it.
   */
  children?: ReactNode;
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Standard ISL page hero banner.
 *
 * Renders the `.page-hero > .container > .page-hero__title-row + divider +
 * subtitle` structure that every top-level page uses. Props control which
 * optional slots appear; the surrounding markup is always identical.
 *
 * The component owns no padding of its own — all top-spacing comes from
 * the `.page-hero` CSS class (100px desktop, 70px mobile).
 *
 * @example
 *   <PageHero
 *     title="Galaxy Dispatch"
 *     badge={<Badge variant="architect">Architect</Badge>}
 *     subtitle="Transmissions from across the solar system."
 *   />
 */
export function PageHero({ title, badge, subtitle, children }: PageHeroProps) {
  return (
    <div className="page-hero">
      <div className="container">

        {/* ── Title row ──────────────────────────────────────────────────────
            Flex row: h1 on the left, optional badge on the right.
            `.page-hero__title-row` in index.css handles the flex layout so
            the badge always aligns to the h1 baseline regardless of length. */}
        <div className="page-hero__title-row">
          <h1>{title}</h1>
          {badge}
        </div>

        {/* Retro divider — matches the full-width rule used on every page. */}
        <hr className="divider" />

        {/* Subtitle — rendered only when provided to avoid an empty <p>. */}
        {subtitle !== undefined && (
          <p className="subtitle">{subtitle}</p>
        )}

        {/* Optional extra hero content slot (filter strip, CTA row, etc.). */}
        {children}

      </div>
    </div>
  );
}
