// ── shared/ui/Kicker.tsx ──────────────────────────────────────────────────
// Uppercase mono kicker label primitive (#378 slice 3a).
//
// WHY
// ───
// Every page in the app duplicates the same kicker pattern — a tiny
// uppercase mono line above a header ("LIVE MATCH", "UPCOMING",
// "SEASON 1"). The inline-style fingerprint is identical across
// 30+ usages: 11px Space Mono, 700 weight, 0.14em letter-spacing,
// uppercase, dust-50 colour. This primitive consolidates them.
//
// SCOPE
// ─────
// Render-only — no semantic role beyond a styled `<span>`. Pages that
// need a Kicker that's a heading (h2/h3) keep using their own elements
// and the styling layer separately; this is the standalone label case.

import type { CSSProperties, ReactNode } from 'react';
import { COLORS } from '../../components/Layout';

// ── Defaults ──────────────────────────────────────────────────────────────

/**
 * Default font size (px). 11 matches the long-standing Layout `LABEL_STYLE`
 * cadence and the admin primitives — small enough to read as secondary
 * metadata above a heading without competing with it.
 */
const DEFAULT_FONT_SIZE = 11;

/**
 * Default letter-spacing — the kerning that turns ordinary mono caps into
 * a recognisable "kicker" label. 0.14em matches the existing inline
 * fingerprint across the codebase.
 */
const DEFAULT_LETTER_SPACING = '0.14em';

// ── Public types ──────────────────────────────────────────────────────────

interface KickerProps {
  /** Kicker text — rendered verbatim; the primitive applies `uppercase`. */
  children: ReactNode;
  /**
   * Optional colour override. Defaults to `COLORS.dust50` — the secondary
   * dust tone used for metadata labels. Pass a brand token (e.g.
   * `COLORS.quantum`) to signal a live / focused state.
   */
  color?: string;
  /** Optional style overrides for one-off margins / cursor / etc. */
  style?: CSSProperties;
  /** Optional className for legacy CSS targeting. */
  className?: string;
}

// ── Kicker ────────────────────────────────────────────────────────────────

/**
 * Uppercase mono label rendered as a `<span>`. Consumers wrap it in a
 * heading element if they need semantic weight (h2/h3) — the primitive
 * is intentionally tag-agnostic so it works in flex rows, table cells,
 * card chrome, etc.
 *
 * Examples:
 *   <Kicker>Live Match</Kicker>
 *   <Kicker color={COLORS.quantum}>Now</Kicker>
 *
 * @param children   Label text.
 * @param color      Optional text colour override.
 * @param style      Optional CSS overrides for one-off margins / cursor.
 * @param className  Optional className for legacy CSS targeting.
 */
export function Kicker({
  children,
  color = COLORS.dust50,
  style,
  className,
}: KickerProps) {
  return (
    <span
      className={className}
      style={{
        fontFamily:     'Space Mono, monospace',
        fontSize:       DEFAULT_FONT_SIZE,
        fontWeight:     700,
        textTransform:  'uppercase',
        letterSpacing:  DEFAULT_LETTER_SPACING,
        color,
        ...style,
      }}
    >
      {children}
    </span>
  );
}
