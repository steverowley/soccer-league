// ── shared/ui/Button.tsx ──────────────────────────────────────────────────
// The canonical button, modelled directly on the Figma design system's
// "Buttons" section. Four variants, each with a hover glow:
//
//   primary   → Galactic Abyss fill, 1px Lunar Dust border, dust text.
//               The quiet default (e.g. "View league").
//   secondary → Lunar Dust fill, abyss text. A medium-weight light button.
//   active    → Astro Explorer (#FF6637) fill, abyss text. THE loud call to
//               action (Sign Up, Log In, Place Wager, Watch Live).
//   tertiary  → text-only with a trailing ► glyph, no box. Link-style action
//               ("View all matches ►").
//
// Quantum Purple is deliberately NOT a button fill: per the design system it
// is the *focus* colour (focus rings, live indicators), not an action colour.
//
// Polymorphic: pass `to` for an in-app router link, `href` for an external
// anchor, or neither (with `onClick`/`type`) for a plain <button>. The visual
// treatment is identical across all three.
//
// Hover/focus glow is applied via local state rather than a stylesheet so the
// primitive stays self-contained (the codebase styles inline throughout). The
// glow is suppressed when disabled and honours the global reduced-motion reset
// in index.css (it only animates box-shadow).

import { useState, type CSSProperties, type ReactNode, type MouseEventHandler } from 'react';
import { Link } from 'react-router-dom';
import { COLORS } from '../../components/Layout';

export type ButtonVariant = 'primary' | 'secondary' | 'active' | 'tertiary';

interface VariantStyle {
  /** Resting visual treatment. */
  rest: CSSProperties;
  /** box-shadow applied on hover/focus (the design's "glow"). */
  glow: string;
}

// Per-variant resting styles + hover glow, lifted from the Figma spec.
const VARIANTS: Record<ButtonVariant, VariantStyle> = {
  primary: {
    rest: { background: COLORS.abyss, color: COLORS.dust, borderColor: COLORS.dust },
    glow: '0 0 18px rgba(227, 224, 213, 0.28)',
  },
  secondary: {
    rest: { background: COLORS.dust, color: COLORS.abyss, borderColor: COLORS.dust },
    glow: '0 0 18px rgba(227, 224, 213, 0.40)',
  },
  active: {
    rest: { background: COLORS.astro, color: COLORS.abyss, borderColor: COLORS.astro },
    glow: '0 0 20px rgba(255, 102, 55, 0.55)',
  },
  tertiary: {
    rest: {
      background: 'transparent',
      color: COLORS.dust,
      borderColor: 'transparent',
      padding: 0,
    },
    glow: '0 0 0 transparent', // tertiary glows via text-shadow instead (see below)
  },
};

const BASE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  fontFamily: 'inherit',
  fontSize: 13,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.12em',
  textDecoration: 'none',
  whiteSpace: 'nowrap',
  padding: '14px 24px',
  minHeight: 44,
  border: '1px solid transparent',
  cursor: 'pointer',
  transition: 'box-shadow 0.15s ease, text-shadow 0.15s ease',
};

interface ButtonProps {
  /** Visual variant. Defaults to 'primary'. */
  variant?: ButtonVariant;
  /** In-app router destination — renders a react-router <Link>. */
  to?: string;
  /** External destination — renders an <a> (use `to` for in-app routes). */
  href?: string;
  /** Click handler — renders a <button> when neither `to` nor `href` is set. */
  onClick?: MouseEventHandler;
  /** <button> type when rendered as a button. Defaults to 'button'. */
  type?: 'button' | 'submit' | 'reset';
  /** Disabled (button only). Dims the control and drops the hover glow. */
  disabled?: boolean;
  /** Anchor target (href only), e.g. "_blank". */
  target?: string;
  /** Accessible label override. */
  'aria-label'?: string;
  /** One-off style overrides (used sparingly during migration). */
  style?: CSSProperties;
  /** Optional className for legacy CSS targeting / responsive hooks. */
  className?: string;
  /** Button label. */
  children: ReactNode;
}

/**
 * Canonical ISL button. See the file header for the four variants.
 *
 * Examples:
 *   <Button variant="active" to="/login">Sign Up</Button>
 *   <Button variant="secondary" onClick={save}>Save</Button>
 *   <Button variant="tertiary" to="/matches">View all matches</Button>
 */
export function Button({
  variant = 'primary',
  to,
  href,
  onClick,
  type = 'button',
  disabled = false,
  target,
  'aria-label': ariaLabel,
  style,
  className,
  children,
}: ButtonProps) {
  const [hovered, setHovered] = useState(false);
  const v = VARIANTS[variant];
  const isTertiary = variant === 'tertiary';
  const lit = hovered && !disabled;

  const composed: CSSProperties = {
    ...BASE,
    ...v.rest,
    ...(disabled ? { opacity: 0.45, cursor: 'not-allowed' } : null),
    // Tertiary glows the text; the boxed variants glow their outline.
    ...(lit && isTertiary ? { textShadow: '0 0 10px rgba(227, 224, 213, 0.75)' } : null),
    ...(lit && !isTertiary ? { boxShadow: v.glow } : null),
    ...style,
  };

  const interaction = {
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
    onFocus: () => setHovered(true),
    onBlur: () => setHovered(false),
  };

  const content = (
    <>
      {children}
      {isTertiary && <span aria-hidden="true">►</span>}
    </>
  );

  if (to) {
    return (
      <Link to={to} aria-label={ariaLabel} className={className} style={composed} {...interaction}>
        {content}
      </Link>
    );
  }

  if (href) {
    return (
      <a
        href={href}
        target={target}
        rel={target === '_blank' ? 'noopener noreferrer' : undefined}
        aria-label={ariaLabel}
        className={className}
        style={composed}
        {...interaction}
      >
        {content}
      </a>
    );
  }

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={className}
      style={composed}
      {...interaction}
    >
      {content}
    </button>
  );
}
