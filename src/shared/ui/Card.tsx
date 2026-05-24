// ── shared/ui/Card.tsx ────────────────────────────────────────────────────
// First content-primitive lifted into the shared UI layer for #378.
//
// WHY
// ───
// The repo has dozens of ad-hoc card containers — `<div style={{ border:
// `1px solid ${HAIRLINE}`, background: ABYSS, ... }}>` repeated with
// minor differences across Home, MatchDetail, PlayerDetail, etc. Each
// copy is a chance for the design system to drift one pixel at a time.
//
// `<Card>` is the canonical container: hairline-bordered, abyss-filled,
// padding-configurable. No layout opinions — children decide whether
// they're a single column, a grid, or arbitrary content.
//
// SCOPE
// ─────
// Intentionally tiny. The first slice of #378 ships the primitive plus
// one or two migration call-sites; later PRs will expand consumption
// across Home, MatchDetail, PlayerDetail without touching the primitive
// again. The acceptance criterion "2 pages migrated, zero behavioural
// regression" is split across follow-up PRs per the user's stated
// "one slice per PR" preference.
//
// NOT A REACT.MEMO
// ───────────────
// `<Card>` re-renders cheaply (one div). Wrapping in React.memo would
// add prop-comparison overhead with no real-world payoff at the volumes
// this app renders (≤ 20 cards visible on any page).

import type { CSSProperties, ReactNode } from 'react';
import { COLORS } from '../../components/Layout';

// ── Defaults ──────────────────────────────────────────────────────────────

/**
 * Default padding inside a `<Card>` when the caller doesn't specify one.
 * 24 px matches the cadence used by MatchCard / StandingsTable / the
 * editorial cards on Home, so an un-customised Card visually matches
 * the existing surface.
 */
const DEFAULT_PADDING = 24;

// ── Public types ──────────────────────────────────────────────────────────

/**
 * Tone of the card border. The design system's tokens cover three
 * meaningful surface variants:
 *   hairline → default neutral border (most cards)
 *   quantum  → focus / live indicator (current match, primary CTA wrapper)
 *   flare    → error / danger (the GDPR Danger Zone wrapper, etc.)
 * Adding new tones means adding a token mapping below — no consumer
 * touches inline colour literals.
 */
export type CardTone = 'hairline' | 'quantum' | 'flare';

/**
 * Map a CardTone to its border colour. Centralised so a future palette
 * shift (e.g. hairline becoming lighter on dark mode) updates every
 * card surface in one diff.
 */
const TONE_BORDER: Record<CardTone, string> = {
  hairline: COLORS.hairline,
  quantum:  COLORS.quantum,
  flare:    COLORS.flare,
};

interface CardProps {
  /** Card body. */
  children: ReactNode;
  /**
   * Internal padding. Pass `0` to draw an edge-to-edge card; pass a
   * number to override the default (24 px). Defaults to DEFAULT_PADDING.
   */
  padding?: number;
  /** Border tone — see CardTone for the three options. Defaults to 'hairline'. */
  tone?: CardTone;
  /**
   * Optional style merge for one-off overrides during migration.
   * Anything passed here takes precedence over the primitive's own
   * styles. Use sparingly — the goal of #378 is to drive these to
   * zero over time.
   */
  style?: CSSProperties;
  /** Optional className for legacy CSS targeting. */
  className?: string;
}

// ── Card ──────────────────────────────────────────────────────────────────

/**
 * Hairline-bordered, abyss-filled container — the canonical card
 * surface for #378. Consumers compose layout inside children; this
 * primitive only owns the chrome.
 *
 * Examples:
 *   <Card>Just text in a card.</Card>
 *   <Card padding={32} tone="quantum">Featured!</Card>
 *   <Card padding={0}><FullBleedImage /></Card>
 *
 * @param children   Body content.
 * @param padding    Internal padding in pixels. Default 24.
 * @param tone       Border tone token. Default 'hairline'.
 * @param style      One-off CSS overrides (avoid where possible).
 * @param className  Optional className for legacy CSS targeting.
 */
export function Card({
  children,
  padding = DEFAULT_PADDING,
  tone = 'hairline',
  style,
  className,
}: CardProps) {
  return (
    <div
      className={className}
      style={{
        border:     `1px solid ${TONE_BORDER[tone]}`,
        background: COLORS.abyss,
        padding,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
