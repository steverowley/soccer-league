// ── shared/ui/Card.tsx ────────────────────────────────────────────────────
// The hairline box (docs/design-language.md, sections 5 and 6).
//
// WHY: the review (#723) counted 19 <Card>s against about 131 hand-built
// `<div style={{ border: '1px solid ...' }}>` boxes, each a chance for the
// look to drift one pixel at a time. This is the one box: 1 px `line`
// border, no fill, no radius, padding 24 (16 on a phone, via the
// --isl-pad-card token). No layout opinions: children decide whether they
// are a column, a grid or prose.
//
// Tones carry meaning, never decoration:
//   default   → structural hairline (almost every card)
//   architect → purple border and resting glow: Architect content only
//   live      → red border: a match happening now
//
// NOT A REACT.MEMO: one div, cheap to re-render.

import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { color, glow, hairline, layout } from '../design';

// ── Public types ──────────────────────────────────────────────────────────

/** What the card's border says. See the file header. */
export type CardTone = 'default' | 'architect' | 'live';

const TONE: Record<CardTone, CSSProperties> = {
  default:   hairline(color.line),
  architect: { ...hairline(color.architect), boxShadow: glow.architect },
  live:      hairline(color.live),
};

interface CardProps {
  /** Card body. */
  children: ReactNode;
  /**
   * Internal padding in px. Omit for the token default (24, 16 on a
   * phone); pass `0` for an edge-to-edge card whose rows carry their own
   * padding.
   */
  padding?: number;
  /** Border tone. Defaults to 'default'. */
  tone?: CardTone;
  /** One-off layout overrides (flex, min-height). Never colours or type. */
  style?: CSSProperties;
  /** Optional className for responsive hooks. */
  className?: string;
  /**
   * When set, the whole card becomes a react-router <Link> to this path:
   * the click target for a league, club or match card. Text keeps the
   * default tone with no underline.
   */
  to?: string;
  /** Accessible label, primarily useful when the card renders as a link. */
  'aria-label'?: string;
}

// ── Card ──────────────────────────────────────────────────────────────────

/**
 * Hairline-bordered container.
 *
 * Examples:
 *   <Card>Just text in a card.</Card>
 *   <Card tone="live">...a live match...</Card>
 *   <Card padding={0}><Rows /></Card>
 *
 * @returns A div, or a router link when `to` is set.
 */
export function Card({
  children,
  padding,
  tone = 'default',
  style,
  className,
  to,
  'aria-label': ariaLabel,
}: CardProps) {
  const composed: CSSProperties = {
    ...TONE[tone],
    background: 'transparent',
    padding: padding ?? layout.cardPad,
    ...(to != null ? { color: color.text, textDecoration: 'none', display: 'block' } : null),
    ...style,
  };

  if (to != null) {
    return (
      <Link to={to} aria-label={ariaLabel} className={className} style={composed}>
        {children}
      </Link>
    );
  }

  return (
    <div className={className} style={composed}>
      {children}
    </div>
  );
}
