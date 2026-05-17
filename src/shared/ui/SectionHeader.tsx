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
   * Kicker numeral or short tag rendered LEFT of the bullet ("I", "II",
   * "III", or short tag like "LIVE").  Rendered uppercase by CSS.
   */
  kicker: string;
  /**
   * Optional kicker label rendered AFTER the bullet, completing the
   * two-part kicker pattern from the Figma ("I • THE PRESENT", "II •
   * GET STARTED", "III • ROCKY INNER LEAGUE").  Omit for single-part
   * kickers that need no label.
   */
  label?: string;
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
  label,
  title,
  subtitle,
  action,
}: SectionHeaderProps): JSX.Element {
  return (
    <header style={{ marginBottom: 'var(--space-6)' }}>
      {/* ── Kicker row ──────────────────────────────────────────────────────
          Just the two-part kicker ("I • THE PRESENT"). The action slot
          lives in the subtitle row beneath the title — matches the
          2026-05 Figma which baselines "VIEW ALL MATCHES ►" against the
          subtitle prose rather than the kicker chip. */}
      <div className="section-header">
        <span className="section-header__index">{kicker}</span>
        <span className="section-header__bullet">•</span>
        {/* Label appears AFTER the bullet to complete the two-part
            kicker pattern from the Figma ("I • THE PRESENT").  When
            omitted, the bullet stands alone — useful for short
            section-headers that need only a numeral.  Uses the same
            small-caps class as the index so the two read as one
            continuous label. */}
        {label && (
          <span className="section-header__index">{label}</span>
        )}
      </div>

      {/* ── Title ───────────────────────────────────────────────────────────
          Uses the .section-header__title class which encodes the display
          weight + uppercase + tight line-height.  H2 element so the
          document outline still reads as a structured page. */}
      <h2 className="section-header__title">{title}</h2>

      {/* ── Subtitle + action row ──────────────────────────────────────────
          Two-column flex baselined on the SUBTITLE's first line.  Left
          cell is the subtitle prose (capped at --max-width-narrow via
          the .section-header__subtitle class so wrapping stays editorial).
          Right cell is the optional action slot — typically a "VIEW ALL
          MATCHES ►" tertiary link.  Both rows collapse cleanly when
          either is omitted: a subtitle-only header just shows prose; an
          action-only header shows the CTA alone right-aligned. */}
      {(subtitle || action) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 'var(--space-6)',
          }}
        >
          {subtitle ? (
            <p className="section-header__subtitle" style={{ margin: 0 }}>{subtitle}</p>
          ) : (
            // Empty placeholder so the action stays right-aligned when
            // the caller passes an action but no subtitle — flex's
            // `justify-content: space-between` needs two children.
            <span />
          )}
          {action && (
            <div style={{ flexShrink: 0, alignSelf: 'flex-end' }}>
              {action}
            </div>
          )}
        </div>
      )}

      {/* ── Trailing divider ──────────────────────────────────────────────
          Hairline that visually anchors the header and separates it from
          the section content.  Margin-top reserves a touch of breathing
          room over the subtitle row before the line lands. */}
      <hr className="divider" style={{ marginBlock: 'var(--space-3) 0' }} />
    </header>
  );
}
