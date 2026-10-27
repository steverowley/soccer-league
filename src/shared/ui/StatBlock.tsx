// ── shared/ui/StatBlock.tsx ───────────────────────────────────────────────
// Label over value (docs/design-language.md, section 6): the one way a page
// shows a single figure such as "Position 2nd" or "Ground 95,000".
//
// WHY: three local versions existed (Home's HeroStat, StatPair, KeyValue),
// each with its own label size and tone, and the hero ones put a faded 11 px
// label under a 13 px value, which reads as a caption. Here the label is the
// `label` type in the secondary tone and the value is the `subheading` size,
// bold, with tabular figures so a row of blocks lines up.

import type { CSSProperties, ReactNode } from 'react';
import { color, numeric, size, tone, type } from '../design';

/** Value colour by meaning. */
export type StatTone = 'default' | 'success' | 'live';

const VALUE_COLOR: Record<StatTone, string> = {
  default: color.text,
  success: color.success,
  live:    color.live,
};

interface StatBlockProps {
  /** Uppercase label above the value. */
  label: ReactNode;
  /** The figure or short text. */
  value: ReactNode;
  /** Value colour meaning. Defaults to 'default'. */
  valueTone?: StatTone;
  /** One-off layout overrides. */
  style?: CSSProperties;
}

/**
 * A labelled figure.
 *
 * @param label      Label text (rendered uppercase).
 * @param value      Value content.
 * @param valueTone  'success' for a good outcome, 'live' for live/error.
 * @returns          A div with the label above the value.
 */
export function StatBlock({ label, value, valueTone = 'default', style }: StatBlockProps) {
  return (
    <div style={{ minWidth: 0, ...style }}>
      <div style={{ ...type.label, ...tone.secondary }}>{label}</div>
      <div
        style={{
          ...numeric,
          fontSize: size.subheading,
          fontWeight: 700,
          lineHeight: 1.25,
          marginTop: 4,
          color: VALUE_COLOR[valueTone],
          overflowWrap: 'anywhere',
        }}
      >
        {value}
      </div>
    </div>
  );
}
