// ── shared/ui/StatPair.tsx ────────────────────────────────────────────────
// Label-above-value pair (#378 slice 3a), now on the design tokens.
//
// SUPERSEDED by <StatBlock> (docs/design-language.md, section 6) for page
// headers and stat rows; StatPair stays for the dense grids (roster cards,
// admin dashboards) that want the smaller `small` value, and is folded into
// StatBlock when those pages migrate.

import type { CSSProperties, ReactNode } from 'react';
import { color, space, tone, type } from '../design';

interface StatPairProps {
  /** Uppercase label rendered above the value. */
  label: string;
  /** Value: string, number or any node. */
  value: ReactNode;
  /**
   * Value colour. Defaults to the primary text tone; pass a `color.*`
   * token when the value carries meaning (success, live).
   */
  valueColor?: string;
  /** Optional layout overrides. */
  style?: CSSProperties;
  /** Optional className for legacy CSS targeting. */
  className?: string;
}

/**
 * A labelled stat: label type over a `small` value.
 *
 * Examples:
 *   <StatPair label="Goals" value={42} />
 *   <StatPair label="Status" value="Won" valueColor={color.success} />
 *
 * @returns A div with two paragraphs.
 */
export function StatPair({
  label,
  value,
  valueColor = color.text,
  style,
  className,
}: StatPairProps) {
  return (
    <div className={className} style={style}>
      <p style={{ ...type.label, ...tone.secondary, margin: `0 0 ${space[4]}px 0` }}>
        {label}
      </p>
      <p style={{ ...type.small, color: valueColor, margin: 0 }}>
        {value}
      </p>
    </div>
  );
}
