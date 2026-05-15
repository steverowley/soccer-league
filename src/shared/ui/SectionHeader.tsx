// ── shared/ui/SectionHeader.tsx ──────────────────────────────────────────────
// Editorial section header — the defining new pattern in the redesign.
//
// Renders a roman-numeral kicker row, the section title, an optional
// one-line subtitle, and a hairline divider.  Used at the top of every
// major section on every page from PR 2 onward.
//
//   Visual structure
//   ────────────────
//   I  •  THE PRESENT                           ← kicker (small-caps, faint)
//   LIVE FROM THE VOID                          ← title (display weight)
//   Matches in progress. Position …             ← subtitle (one line, faint)
//   ────────────────────────────────────────    ← hairline divider
//
// CSS lives in index.css under .section-header — this component is the
// thin React wrapper that keeps callsites consistent.

import type { ReactNode } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

export interface SectionHeaderProps {
  /**
   * Kicker label rendered above the title.  Convention is a roman numeral
   * ("I", "II", "III") or a thematic short tag ("LIVE", "PRESS ROOM").
   * Rendered uppercase by CSS — pass mixed-case if you want.
   */
  kicker: string;
  /**
   * Section title.  Rendered uppercase by CSS at display weight.
   */
  title: string;
  /**
   * Optional one-line subtitle that explains what the section is about.
   * When omitted, the divider sits directly below the title for tighter
   * sections.
   */
  subtitle?: string;
  /**
   * Optional right-aligned slot for a CTA (typically "View All Matches →"
   * or similar).  Sits in the kicker row to keep the title row clean.
   */
  action?: ReactNode;
}

// ── Component ────────────────────────────────────────────────────────────────

/**
 * Render an editorial section header with a kicker, title, optional
 * subtitle, and trailing hairline.  Drop in at the top of every major
 * section on a page; the consistent rhythm is what makes the redesign
 * read as a single publication rather than a bundle of components.
 *
 * @example
 *   <SectionHeader
 *     kicker="I"
 *     title="Live From The Void"
 *     subtitle="Matches in progress. Position updates every ninety seconds."
 *     action={<Link to="/matches" className="nav-link">View All Matches →</Link>}
 *   />
 *
 * @returns JSX.Element
 */
export function SectionHeader({
  kicker,
  title,
  subtitle,
  action,
}: SectionHeaderProps): JSX.Element {
  return (
    <header style={{ marginBottom: 'var(--space-6)' }}>
      {/* ── Kicker row ──────────────────────────────────────────────────────
          Two-column flex: left is the kicker label (roman numeral + bullet
          + label), right is the optional action slot.  When `action` is
          omitted the layout collapses cleanly because the right cell is
          empty rather than missing — keeps spacing consistent across
          sections with and without CTAs. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 'var(--space-3)',
        }}
      >
        <div className="section-header">
          <span className="section-header__index">{kicker}</span>
          <span className="section-header__bullet">•</span>
        </div>
        {action && (
          <div style={{ flexShrink: 0 }}>
            {action}
          </div>
        )}
      </div>

      {/* ── Title ───────────────────────────────────────────────────────────
          Uses the .section-header__title class which encodes the display
          weight + uppercase + tight line-height.  H2 element so the
          document outline still reads as a structured page. */}
      <h2 className="section-header__title">{title}</h2>

      {/* ── Optional subtitle ──────────────────────────────────────────────
          One-line explanation of what the section is about.  Capped at
          --max-width-narrow so it never spans the full content well at
          large viewport widths — that would feel like body copy rather
          than a kicker line. */}
      {subtitle && <p className="section-header__subtitle">{subtitle}</p>}

      {/* ── Trailing divider ──────────────────────────────────────────────
          Hairline that visually anchors the header and separates it from
          the section content.  Margin-block 0 because the kicker/title
          stack already provides the vertical rhythm above. */}
      <hr className="divider" style={{ marginBlock: 0 }} />
    </header>
  );
}
