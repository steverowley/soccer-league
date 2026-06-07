// ── shared/ui/StatPair.tsx ────────────────────────────────────────────────
// Label-above-value stat primitive (#378 slice 3a).
//
// WHY
// ───
// Stat cards across MatchDetail / PlayerDetail / TeamDetail / Admin
// dashboards all render the same vertical pair: a small uppercase mono
// kicker followed by a larger value. The admin feature's `StatCell`
// already encodes this pattern but is feature-private. This primitive
// promotes the surface to shared/ui so every page can lean on it.
//
// SCOPE
// ─────
// Two-line layout (label on top, value below). Caller decides the value
// type — string, number, or any node. For grid placement the host
// component owns the layout container; StatPair only owns the inner
// pair styling.

import type { CSSProperties, ReactNode } from 'react';
import { COLORS } from '../../components/Layout';

// ── Defaults ──────────────────────────────────────────────────────────────

/**
 * Default label font size (px). 11 matches the Kicker primitive and
 * Layout.LABEL_STYLE cadence — readable secondary metadata that doesn't
 * compete with the value below it.
 */
const DEFAULT_LABEL_FONT_SIZE = 11;

/**
 * Default value font size (px). 13 matches Layout.VALUE_STYLE and the
 * admin StatCell cadence — large enough to scan in a grid, small enough
 * that 6+ pairs fit per row on a TeamDetail roster card.
 */
const DEFAULT_VALUE_FONT_SIZE = 13;

/**
 * Default px gap between label and value. 4 is tight enough that the
 * pair reads as one unit but loose enough that the label doesn't
 * crowd the value's baseline.
 */
const DEFAULT_GAP = 4;

// ── Public types ──────────────────────────────────────────────────────────

interface StatPairProps {
  /** Uppercase label rendered above the value. */
  label: string;
  /** Value node — string, number, or any React node (chip / pip / link). */
  value: ReactNode;
  /**
   * Optional value colour override. Defaults to `COLORS.dust` (primary
   * dust tone). Pass a brand token (quantum / terraNova / flare) when
   * the value carries a status meaning (live, win, loss, error).
   */
  valueColor?: string;
  /** Optional style overrides for grid placement / margin. */
  style?: CSSProperties;
  /** Optional className for legacy CSS targeting. */
  className?: string;
}

// ── StatPair ──────────────────────────────────────────────────────────────

/**
 * Render a labelled stat — uppercase mono kicker above a value line.
 * Pair-level styling only: the caller's parent owns the surrounding
 * grid / flex container.
 *
 * Examples:
 *   <StatPair label="GOALS" value={42} />
 *   <StatPair label="STADIUM" value="Memorial Arena" />
 *   <StatPair label="STATUS" value="Live" valueColor={COLORS.quantum} />
 *
 * @param label       Uppercase label text.
 * @param value       Value content (string, number, or any node).
 * @param valueColor  Optional value text colour token.
 * @param style       Optional CSS overrides.
 * @param className   Optional className for legacy CSS targeting.
 */
export function StatPair({
  label,
  value,
  valueColor = COLORS.dust,
  style,
  className,
}: StatPairProps) {
  return (
    <div className={className} style={style}>
      <p
        style={{
          fontSize:      DEFAULT_LABEL_FONT_SIZE,
          fontWeight:    700,
          textTransform: 'uppercase',
          letterSpacing: '0.14em',
          color:         COLORS.dust50,
          margin:        `0 0 ${DEFAULT_GAP}px 0`,
        }}
      >
        {label}
      </p>
      <p
        style={{
          fontSize:   DEFAULT_VALUE_FONT_SIZE,
          fontWeight: 400,
          color:      valueColor,
          margin:     0,
        }}
      >
        {value}
      </p>
    </div>
  );
}
