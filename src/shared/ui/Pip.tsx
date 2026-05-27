// ── shared/ui/Pip.tsx ─────────────────────────────────────────────────────
// Small filled-circle indicator primitive (#378 slice 3a).
//
// WHY
// ───
// Pip pattern repeats across status surfaces — live-match dot next to
// the minute marker, form ribbons on team cards (W/D/L coloured dots),
// betting status indicators. Each call site re-inlines a 8×8 div with
// borderRadius:'50%' plus a background colour token. This primitive
// consolidates them.
//
// SCOPE
// ─────
// Visual only — no aria role; pair with a sibling text label if the
// indicator carries meaning for assistive tech. Square / rounded-square
// variants would be additive (`shape?: 'circle' | 'square'`) when the
// codebase actually needs them.

import type { CSSProperties } from 'react';

// ── Defaults ──────────────────────────────────────────────────────────────

/**
 * Default Pip diameter in px. 8 matches the existing form-ribbon dots and
 * live-match indicators. Caller can pass `size` for larger / smaller
 * variants (e.g. 12 for status badges, 6 for inline list bullets).
 */
const DEFAULT_SIZE = 8;

// ── Public types ──────────────────────────────────────────────────────────

interface PipProps {
  /**
   * Fill colour for the pip. No default — every meaningful pip carries a
   * semantic colour (quantum=live, terraNova=win, flare=loss, etc.) so
   * the caller MUST opt into a token rather than rely on a fallback.
   */
  color: string;
  /** Diameter in px. Defaults to DEFAULT_SIZE (8). */
  size?: number;
  /**
   * Optional border colour — useful when the pip sits on a background
   * that matches its fill (e.g. a quantum-tinted card with a quantum pip
   * needs a hairline outline to remain visible).
   */
  border?: string;
  /** Optional style overrides for margin / vertical-align / etc. */
  style?: CSSProperties;
  /** Optional className for legacy CSS targeting. */
  className?: string;
}

// ── Pip ───────────────────────────────────────────────────────────────────

/**
 * Filled circular indicator rendered inline. Pair with a sibling text
 * label for accessibility; the pip itself carries no aria role.
 *
 * Examples:
 *   <Pip color={COLORS.quantum} />
 *   <Pip color={COLORS.terraNova} size={12} />
 *   <Pip color={COLORS.flare} border={COLORS.hairline} />
 *
 * @param color      Required fill colour token.
 * @param size       Diameter in px. Defaults to 8.
 * @param border     Optional 1px border colour for outline contrast.
 * @param style      Optional CSS overrides.
 * @param className  Optional className for legacy CSS targeting.
 */
export function Pip({
  color,
  size = DEFAULT_SIZE,
  border,
  style,
  className,
}: PipProps) {
  return (
    <span
      className={className}
      style={{
        display:      'inline-block',
        width:        size,
        height:       size,
        borderRadius: '50%',
        background:   color,
        border:       border ? `1px solid ${border}` : undefined,
        ...style,
      }}
    />
  );
}

// ── Default export of the COLORS namespace omitted intentionally ──────────
// Pip never owns a default colour — semantic intent lives with the
// caller. Re-exporting COLORS here would tempt callers to import it
// indirectly and add another path to the colour-token graph.
