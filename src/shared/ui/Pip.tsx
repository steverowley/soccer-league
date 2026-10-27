// ── shared/ui/Pip.tsx ─────────────────────────────────────────────────────
// Small filled-circle indicator (#378). Round is allowed for status dots
// only (docs/design-language.md, section 5).
//
// The colour is always the caller's, and must be a `color.*` token (or a
// club colour from data): a pip has no meaning of its own. For "live" use
// <LiveBadge>, which owns the red dot and its label.

import type { CSSProperties } from 'react';

/** Default diameter in px: the size of the live dot and form dots. */
const DEFAULT_SIZE = 8;

interface PipProps {
  /** Fill: a `color.*` token or a club colour from data. */
  color: string;
  /** Diameter in px. Defaults to 8. */
  size?: number;
  /** Optional 1 px outline colour (a `color.*` token). */
  border?: string;
  /** Optional layout overrides. */
  style?: CSSProperties;
  /** Optional className for legacy CSS targeting. */
  className?: string;
}

/**
 * Filled circular indicator. Pair it with a text label: the pip itself
 * carries no aria role.
 *
 * Examples:
 *   <Pip color={color.success} />
 *   <Pip color={team.color} size={12} border={color.line} />
 *
 * @returns An inline span.
 */
export function Pip({ color, size = DEFAULT_SIZE, border, style, className }: PipProps) {
  return (
    <span
      className={className}
      style={{
        display:      'inline-block',
        width:        size,
        height:       size,
        borderRadius: '50%',
        background:   color,
        ...(border ? { borderWidth: 1, borderStyle: 'solid', borderColor: border } : null),
        ...style,
      }}
    />
  );
}
