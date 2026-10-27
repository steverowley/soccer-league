// ── shared/ui/Chip.tsx ────────────────────────────────────────────────────
// Bordered small-caps pill, from the first design-primitive pass (#378).
//
// SUPERSEDED by <Tag> (docs/design-language.md, section 6), which has the
// design language's tone names and a selected state. Chip stays, restyled
// on the tokens, so call sites outside the migrated pages keep compiling and
// looking the same; it is deleted with the other duplicates in the last
// migration group. New code uses Tag; live state uses LiveBadge.

import type { CSSProperties, ReactNode } from 'react';
import { color, hairline, type } from '../design';

/**
 * Tone of the chip border and text colour.
 *   hairline → neutral border, dust text (most pills)
 *   quantum  → purple border: Architect / focus
 *   flare    → red border and text: error or danger
 *   dust     → dust border, dust text (slightly stronger contrast)
 */
export type ChipTone = 'hairline' | 'quantum' | 'flare' | 'dust';

const TONE: Record<ChipTone, CSSProperties> = {
  hairline: { ...hairline(color.line), color: color.text },
  quantum:  { ...hairline(color.architect), color: color.text },
  flare:    { ...hairline(color.live), color: color.live },
  dust:     { ...hairline(color.text), color: color.text },
};

interface ChipProps {
  /** Pill contents: usually text, can include a leading icon or dot. */
  children: ReactNode;
  /** Border and text tone. Defaults to 'hairline'. */
  tone?: ChipTone;
  /** One-off layout overrides. */
  style?: CSSProperties;
  /** Optional className for legacy CSS targeting. */
  className?: string;
}

/**
 * Bordered small-caps pill. Prefer <Tag> in new code.
 *
 * @deprecated Use Tag (or LiveBadge for live state).
 * @returns A span.
 */
export function Chip({ children, tone = 'hairline', style, className }: ChipProps) {
  return (
    <span
      className={className}
      style={{
        ...type.label,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        paddingTop: 4,
        paddingBottom: 4,
        paddingLeft: 12,
        paddingRight: 12,
        ...TONE[tone],
        ...style,
      }}
    >
      {children}
    </span>
  );
}
