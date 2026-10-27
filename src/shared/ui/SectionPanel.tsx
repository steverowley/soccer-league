// ── shared/ui/SectionPanel.tsx ────────────────────────────────────────────
// Card with a header strip (#378 slice 2), now on the design tokens.
//
// WHY: distinct from <Card> (a plain box): several surfaces repeat a
// hairline-bordered, flex-column panel whose first row is an uppercase
// label (a title on the left, optional meta on the right) over a hairline,
// with the body beneath. This owns the box and the strip; the caller owns
// the body and any footer (a bottom-pinned button via `marginTop: 'auto'`
// works because the panel is a flex column).

import type { CSSProperties, ReactNode } from 'react';
import { color, hairline, layout, space, tone, type } from '../design';

interface SectionPanelProps {
  /** Left side of the header strip. */
  title: ReactNode;
  /** Optional right-aligned meta (e.g. "Next 48h"), secondary tone. */
  meta?: ReactNode;
  /** Panel body: a list, prose, a bottom-pinned footer. */
  children: ReactNode;
  /** Padding in px. Omit for the card token (24, 16 on a phone). */
  padding?: number;
  /** One-off layout overrides. */
  style?: CSSProperties;
  /** Optional className for responsive hooks. */
  className?: string;
}

/**
 * Hairline panel with an uppercase header strip.
 *
 * Example:
 *   <SectionPanel title="Upcoming fixtures" meta="Next 48h">...list...</SectionPanel>
 *
 * @returns A flex-column div.
 */
export function SectionPanel({
  title,
  meta,
  children,
  padding,
  style,
  className,
}: SectionPanelProps) {
  return (
    <div
      className={className}
      style={{
        ...hairline(color.line),
        padding:       padding ?? layout.cardPad,
        display:       'flex',
        flexDirection: 'column',
        ...style,
      }}
    >
      <header
        style={{
          ...type.label,
          display:        'flex',
          justifyContent: 'space-between',
          alignItems:     'baseline',
          gap:            space[12],
          paddingBottom:  space[12],
          borderBottom:   `1px solid ${color.line}`,
          marginBottom:   space[16],
        }}
      >
        <span>{title}</span>
        {meta != null && <span style={tone.secondary}>{meta}</span>}
      </header>
      {children}
    </div>
  );
}
