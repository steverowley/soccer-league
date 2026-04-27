// ── shared/ui/Badge.tsx ──────────────────────────────────────────────────────
// WHY: The codebase has two badge patterns:
//   1. `.badge--architect` — the purple pill used in NewsFeedPage and on any
//      surface where the Architect's presence should be signalled.
//   2. Ad-hoc inline `<span>` tags styled via className in one-off places.
//
// This component unifies both into a single typed surface so badge variants
// are never invented in-place. Adding a new variant here propagates everywhere
// rather than requiring a grep across the codebase.
//
// CONSUMERS: NewsFeedPage (Architect badge), AccountMenu (credits badge),
//            NarrativeCard (kind label pill — future), VotingPage (tier badges)

import type { CSSProperties, ReactNode } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Named badge variants.
 *
 *   architect — `.badge--architect`: Quantum Purple pill. Reserved for surfaces
 *               where the Cosmic Architect's influence is being signalled.
 *               Over-use dilutes the "cosmic disturbance" feeling.
 *
 *   default   — no badge class: caller supplies full styling via `className`
 *               or `style`. Use for one-off cases that don't fit a named variant.
 */
export type BadgeVariant = 'architect' | 'default';

export interface BadgeProps {
  children: ReactNode;
  /**
   * Named visual style. Defaults to 'default' (unstyled — callers must add
   * their own className or style). Use 'architect' for the Quantum Purple pill.
   */
  variant?: BadgeVariant;
  /** Additional CSS classes appended after the variant class. */
  className?: string;
  /** Inline style overrides — use sparingly; prefer tokens. */
  style?: CSSProperties;
}

// ── Variant → CSS class map ───────────────────────────────────────────────────

/**
 * Maps each named variant to its CSS class. Centralised here so a rename
 * only requires changing one line rather than every call site.
 *
 *   architect → .badge--architect  (Quantum Purple pill, defined in index.css)
 *   default   → ''                 (no automatic class — caller owns styling)
 */
const VARIANT_CLASS: Record<BadgeVariant, string> = {
  architect: 'badge--architect',
  default:   '',
};

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Inline pill badge for status labels, kind indicators, and Architect branding.
 *
 * Renders a `<span>` with the appropriate variant class. Additional classes
 * and inline styles can be passed for one-off overrides without forking the
 * component.
 *
 * @example
 *   // Architect purple pill
 *   <Badge variant="architect">Architect</Badge>
 *
 *   // Custom colour via style (kind-label badges in NewsFeedPage)
 *   <Badge style={{ color, borderColor: color }}>Pundit</Badge>
 */
export function Badge({ variant = 'default', className = '', style, children }: BadgeProps) {
  const base = VARIANT_CLASS[variant];
  const cls  = [base, className].filter(Boolean).join(' ') || undefined;

  return (
    <span className={cls} style={style}>
      {children}
    </span>
  );
}
