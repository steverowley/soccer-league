// ── shared/ui/EmptyState.tsx ──────────────────────────────────────────────
// Third design primitive lifted into the shared UI layer for #378.
//
// WHY
// ───
// Every page in the app has at least one "empty" placeholder — "No
// match in progress", "No wagers yet", "Voting hasn't opened" — each
// hand-rolled as either an italic small-grey paragraph or a bordered
// card with the same prose. The visuals drift one pixel at a time
// across copies.
//
// `<EmptyState>` ships the canonical empty-content surface: optional
// kicker label + body line, dust-faint colour palette, no border by
// default (consumers wrap in `<Card>` if they want a bordered empty
// state, e.g. for the live-match panel fallback on Home).
//
// SCOPE
// ─────
// Intentionally minimal. The primitive owns typography + colour;
// containment is the consumer's call. Same shape as Card and Chip —
// the trio gives most "empty / loading / chrome" cases a one-import
// fix without an over-designed API.

import type { CSSProperties, ReactNode } from 'react';
import { COLORS } from '../../components/Layout';

// ── Constants ─────────────────────────────────────────────────────────────

/**
 * Default vertical padding (px). 32 px places the body text comfortably
 * inside a typical card surface; consumers that want a denser surface
 * can override via the `style` prop.
 */
const PAD_Y = 32;

/**
 * Default horizontal padding (px). 24 px keeps body text from kissing
 * a parent's edge while still feeling editorial.
 */
const PAD_X = 24;

/**
 * Body line font size (px). 13 px sits one notch below the page-level
 * body cadence (14 px) — empty states are meant to read as a quieter
 * second-class surface that doesn't fight real content for attention.
 */
const BODY_SIZE = 13;

/**
 * Kicker label font size (px). 11 px matches the small-caps cadence
 * used by Chip + the page-level kicker labels in Layout.
 */
const KICKER_SIZE = 11;

/**
 * Letter-spacing for the kicker label. 0.14 em matches Chip; tighter
 * spacings (0.12 em) read as plain text rather than a hierarchy cue.
 */
const KICKER_LETTER_SPACING = '0.14em';

// ── Public types ──────────────────────────────────────────────────────────

interface EmptyStateProps {
  /**
   * The main "nothing here" sentence. Always present — an EmptyState
   * with no body would be a blank box, which is exactly the regression
   * this primitive exists to prevent.
   */
  children: ReactNode;
  /**
   * Optional small-caps kicker label above the body — e.g. "NO MATCH",
   * "VOTING CLOSED". When omitted the empty state is just the body line.
   */
  kicker?: string;
  /**
   * Optional CTA / link sentence rendered below the body in DUST_70 so
   * it reads as "here's what to do next" without competing with the
   * primary "nothing here" line. ReactNode so consumers can pass a
   * <Link> element directly.
   */
  hint?: ReactNode;
  /** Centre the content. Defaults to true (most empty-state patterns). */
  centred?: boolean;
  /** Optional style override for one-off margins / heights. */
  style?: CSSProperties;
}

// ── EmptyState ────────────────────────────────────────────────────────────

/**
 * Canonical "nothing here" surface — italic dust-faint body line with
 * an optional small-caps kicker label and an optional CTA hint
 * underneath.
 *
 * Examples:
 *   <EmptyState>No match in progress. The cosmos rests.</EmptyState>
 *
 *   <EmptyState kicker="VOTING CLOSED">
 *     Election Night has ended. Decrees are below.
 *   </EmptyState>
 *
 *   <EmptyState
 *     kicker="NO BETS"
 *     hint={<Link to="/matches">Browse fixtures</Link>}
 *   >
 *     You haven't placed any wagers yet.
 *   </EmptyState>
 *
 * @param children  Primary body line (required).
 * @param kicker    Optional small-caps label above the body.
 * @param hint      Optional CTA / link rendered below the body.
 * @param centred   Centre the content. Default true.
 * @param style     One-off CSS overrides.
 */
export function EmptyState({
  children,
  kicker,
  hint,
  centred = true,
  style,
}: EmptyStateProps) {
  return (
    <div
      style={{
        display:        'flex',
        flexDirection:  'column',
        alignItems:     centred ? 'center' : 'flex-start',
        justifyContent: 'center',
        textAlign:      centred ? 'center' : 'left',
        gap:            8,
        padding:        `${PAD_Y}px ${PAD_X}px`,
        fontFamily:     'Space Mono, monospace',
        ...style,
      }}
    >
      {kicker && (
        <p
          style={{
            fontSize:       KICKER_SIZE,
            fontWeight:     700,
            color:          COLORS.dust50,
            letterSpacing:  KICKER_LETTER_SPACING,
            textTransform:  'uppercase',
            margin:         0,
          }}
        >
          {kicker}
        </p>
      )}
      <p
        style={{
          fontSize:   BODY_SIZE,
          fontStyle:  'italic',
          color:      COLORS.dust50,
          margin:     0,
          lineHeight: 1.5,
        }}
      >
        {children}
      </p>
      {hint && (
        <p
          style={{
            fontSize:   BODY_SIZE,
            color:      COLORS.dust70,
            margin:     0,
            marginTop:  4,
          }}
        >
          {hint}
        </p>
      )}
    </div>
  );
}
