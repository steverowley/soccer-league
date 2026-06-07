// ── shared/ui/SectionPanel.tsx ────────────────────────────────────────────
// Bordered panel with a header strip — #378 slice 2.
//
// WHY
// ───
// Distinct from <Card> (a plain bordered container): several surfaces repeat
// the same chrome of a hairline-bordered, flex-column panel whose first row is
// an uppercase mono header (a left title + an optional right-aligned meta),
// underlined by a hairline, with the body beneath. Home's UpcomingPanel,
// MatchDetail's side panels, and PlayerDetail's stat panels all hand-roll this.
// This primitive owns the container + header chrome; the caller supplies the
// body (and any footer — e.g. a bottom-pinned CTA via `marginTop: auto`, which
// works because the panel is flex-column).
//
// The styles below are lifted verbatim from Home's UpcomingPanel so existing
// call-sites migrate pixel-for-pixel.

import type { CSSProperties, ReactNode } from 'react';
import { COLORS } from '../../components/Layout';

/** Default container padding (px) — matches Card / the existing panels. */
const DEFAULT_PADDING = 24;

interface SectionPanelProps {
  /** Left side of the header strip (rendered inside the uppercase mono row). */
  title: ReactNode;
  /**
   * Optional right-aligned header meta (e.g. "Next 48h"). Rendered in the
   * secondary dust-70 tone. Omit for a title-only header.
   */
  meta?: ReactNode;
  /** Panel body — list, prose, a bottom-pinned footer, etc. */
  children: ReactNode;
  /** Container padding in px. Default 24. */
  padding?: number;
  /** One-off container style overrides (avoid where possible). */
  style?: CSSProperties;
  /** Optional className for legacy CSS targeting / responsive hooks. */
  className?: string;
}

/**
 * Hairline-bordered, flex-column panel with an uppercase mono header strip.
 *
 * Examples:
 *   <SectionPanel title="Upcoming Fixtures" meta="Next 48h">…list…</SectionPanel>
 *   <SectionPanel title="Match Facts">…body…</SectionPanel>
 *
 * @param title      Left header content.
 * @param meta       Optional right-aligned header meta (dust-70).
 * @param children   Panel body.
 * @param padding    Container padding in px. Default 24.
 * @param style      One-off container overrides.
 * @param className  Optional className.
 */
export function SectionPanel({
  title,
  meta,
  children,
  padding = DEFAULT_PADDING,
  style,
  className,
}: SectionPanelProps) {
  return (
    <div
      className={className}
      style={{
        border:        `1px solid ${COLORS.hairline}`,
        padding,
        display:       'flex',
        flexDirection: 'column',
        ...style,
      }}
    >
      <header
        style={{
          display:        'flex',
          justifyContent: 'space-between',
          alignItems:     'baseline',
          paddingBottom:  12,
          borderBottom:   `1px solid ${COLORS.hairline}`,
          marginBottom:   16,
          fontSize:       11,
          letterSpacing:  '0.14em',
          textTransform:  'uppercase',
        }}
      >
        <span>{title}</span>
        {meta != null && <span style={{ color: COLORS.dust70 }}>{meta}</span>}
      </header>
      {children}
    </div>
  );
}
