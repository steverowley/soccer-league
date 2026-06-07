// ── shared/ui/KeyValue.tsx ────────────────────────────────────────────────
// Horizontal label : value primitive (#378 slice 3a).
//
// WHY
// ───
// Inline horizontal pairs ("Stadium: Memorial Arena", "Capacity: 42000")
// repeat across team / player / match metadata blocks. Each call site
// re-inlines the same flex-row + colon-or-fixed-width-label dance. This
// primitive enforces the canonical alignment.
//
// SCOPE
// ─────
// Single-line by default — caller-supplied wrapping happens via the
// outer container if needed. StatPair handles the stacked variant.

import type { CSSProperties, ReactNode } from 'react';
import { COLORS } from '../../components/Layout';

// ── Defaults ──────────────────────────────────────────────────────────────

/**
 * Default label font size (px). 12 sits between the Kicker baseline
 * (11) and the value cadence (13) — large enough to scan in a metadata
 * block but visually subordinate to the value text.
 */
const DEFAULT_LABEL_FONT_SIZE = 12;

/**
 * Default value font size (px). 13 matches StatPair / VALUE_STYLE so
 * inline metadata rows align with stacked stat cards on the same page.
 */
const DEFAULT_VALUE_FONT_SIZE = 13;

/**
 * Default px gap between label and value. 8 matches the spacing the
 * inline patterns in MatchDetail / PlayerDetail use today.
 */
const DEFAULT_GAP = 8;

// ── Public types ──────────────────────────────────────────────────────────

interface KeyValueProps {
  /** Label rendered on the left (uppercase mono treatment). */
  label: string;
  /** Value content on the right — string, number, or arbitrary node. */
  value: ReactNode;
  /**
   * Optional value colour override. Defaults to `COLORS.dust`. Use a
   * brand token (quantum / terraNova / flare) when the value carries
   * status meaning.
   */
  valueColor?: string;
  /** Optional style overrides for margin / width / etc. */
  style?: CSSProperties;
  /** Optional className for legacy CSS targeting. */
  className?: string;
}

// ── KeyValue ──────────────────────────────────────────────────────────────

/**
 * Horizontal label : value row. Use for compact metadata blocks where
 * each line carries one labelled value (stadium info, manager
 * profile, season header pills).
 *
 * Examples:
 *   <KeyValue label="Stadium" value="Memorial Arena" />
 *   <KeyValue label="Status"  value="Live" valueColor={COLORS.quantum} />
 *
 * @param label       Label text (rendered uppercase).
 * @param value       Value content.
 * @param valueColor  Optional value colour override.
 * @param style       Optional CSS overrides.
 * @param className   Optional className for legacy CSS targeting.
 */
export function KeyValue({
  label,
  value,
  valueColor = COLORS.dust,
  style,
  className,
}: KeyValueProps) {
  return (
    <div
      className={className}
      style={{
        display:    'flex',
        alignItems: 'baseline',
        gap:        DEFAULT_GAP,
        ...style,
      }}
    >
      <span
        style={{
          fontSize:      DEFAULT_LABEL_FONT_SIZE,
          fontWeight:    700,
          textTransform: 'uppercase',
          letterSpacing: '0.12em',
          color:         COLORS.dust50,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize:   DEFAULT_VALUE_FONT_SIZE,
          fontWeight: 400,
          color:      valueColor,
        }}
      >
        {value}
      </span>
    </div>
  );
}
