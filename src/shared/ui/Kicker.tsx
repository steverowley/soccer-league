// ── shared/ui/Kicker.tsx ──────────────────────────────────────────────────
// Uppercase label primitive (#378), now on the design tokens.
//
// WHY: every page duplicated a tiny uppercase line above a header ("LIVE
// MATCH", "UPCOMING"), each with its own size (9 to 13 px), tracking (0.12
// to 0.18em) and a faded dust tone that failed contrast (dust50 is 4.28:1).
// A Kicker is the `label` type (11 px, 0.12em) in the secondary tone
// (7.7:1). Render-only: wrap it in a heading element when it needs weight.

import type { CSSProperties, ReactNode } from 'react';
import { color as tokenColor, type } from '../design';

interface KickerProps {
  /** Kicker text: rendered verbatim; the primitive applies `uppercase`. */
  children: ReactNode;
  /**
   * Text colour. Defaults to the secondary tone. Pass a `color.*` token
   * (e.g. `color.architect` for Architect content), never a raw value.
   */
  color?: string;
  /** Optional layout overrides (margins). */
  style?: CSSProperties;
  /** Optional className for legacy CSS targeting. */
  className?: string;
}

/**
 * Uppercase label rendered as a `<span>`.
 *
 * Examples:
 *   <Kicker>Live match</Kicker>
 *   <Kicker color={color.architect}>Decree</Kicker>
 *
 * @returns A span in the label type.
 */
export function Kicker({
  children,
  color = tokenColor.textSecondary,
  style,
  className,
}: KickerProps) {
  return (
    <span className={className} style={{ ...type.label, color, ...style }}>
      {children}
    </span>
  );
}
