// ── shared/ui/KeyValue.tsx ────────────────────────────────────────────────
// Horizontal "label  value" row (#378 slice 3a), now on the design tokens.
//
// WHY: inline pairs ("Stadium  Memorial Arena") repeat across team, player
// and match metadata. The label is the `label` type in the secondary tone,
// the value the `small` type; both share a baseline. The stacked form is
// StatBlock (or StatPair in dense grids).

import type { CSSProperties, ReactNode } from 'react';
import { color, space, tone, type } from '../design';

interface KeyValueProps {
  /** Label on the left (uppercase). */
  label: string;
  /** Value on the right: string, number or any node. */
  value: ReactNode;
  /** Value colour: a `color.*` token. Defaults to the primary text tone. */
  valueColor?: string;
  /** Optional layout overrides. */
  style?: CSSProperties;
  /** Optional className for legacy CSS targeting. */
  className?: string;
}

/**
 * Horizontal label and value on one baseline.
 *
 * Examples:
 *   <KeyValue label="Stadium" value="Memorial Arena" />
 *
 * @returns A flex row.
 */
export function KeyValue({
  label,
  value,
  valueColor = color.text,
  style,
  className,
}: KeyValueProps) {
  return (
    <div
      className={className}
      style={{ display: 'flex', alignItems: 'baseline', gap: space[8], ...style }}
    >
      <span style={{ ...type.label, ...tone.secondary }}>{label}</span>
      <span style={{ ...type.small, color: valueColor }}>{value}</span>
    </div>
  );
}
