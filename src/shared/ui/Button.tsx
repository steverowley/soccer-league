// ── shared/ui/Button.tsx ──────────────────────────────────────────────────
// The one button (docs/design-language.md, section 6). Three variants:
//
//   primary   → Astro Explorer (action) fill, abyss text. THE thing to do on
//               this view: at most one per view (Sign up, Watch live, Place
//               stake).
//   secondary → hairline outline, dust text. Every other boxed action.
//   tertiary  → text only with a trailing ▸ marker, no box. Link-style
//               actions ("All matches ▸").
//
// All three use the uppercase `label` type and are at least 44 px tall so
// they are a finger-sized target on a phone. Purple is never a button fill:
// it means the Architect and keyboard focus.
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
import { color, glow, glyph, hairline, type } from '../design';

/**
 * Button variants. `active` is the pre-design-language name of `primary`,
 * kept so older call sites compile; new code says `primary`.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'active';

interface VariantStyle {
  /** Resting visual treatment. */
  rest: CSSProperties;
  /** box-shadow (or text-shadow for tertiary) applied on hover/focus. */
  glow: string;
}

const PRIMARY: VariantStyle = {
  rest: { background: color.action, color: color.bg, ...hairline(color.action) },
  glow: glow.action,
};

// Per-variant resting styles and hover glow.
const VARIANTS: Record<ButtonVariant, VariantStyle> = {
  primary: PRIMARY,
  active: PRIMARY,
  secondary: {
    rest: { background: 'transparent', color: color.text, ...hairline(color.text) },
    glow: glow.outline,
  },
  tertiary: {
    rest: {
      background: 'transparent',
      color: color.text,
      ...hairline('transparent'),
      paddingLeft: 0,
      paddingRight: 0,
    },
    glow: glow.text,
  },
};

const BASE: CSSProperties = {
  ...type.label,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  fontFamily: 'inherit',
  textDecoration: 'none',
  whiteSpace: 'nowrap',
  paddingTop: 0,
  paddingBottom: 0,
  paddingLeft: 24,
  paddingRight: 24,
  minHeight: 44,
  cursor: 'pointer',
  transition: 'box-shadow 0.15s ease, text-shadow 0.15s ease',
};

interface ButtonProps {
  /** Visual variant. Defaults to 'secondary' (the quiet, repeatable one). */
  variant?: ButtonVariant;
  /** In-app router destination: renders a react-router <Link>. */
  to?: string;
  /** External destination: renders an <a> (use `to` for in-app routes). */
  href?: string;
  /** Click handler: renders a <button> when neither `to` nor `href` is set. */
  onClick?: MouseEventHandler;
  /** <button> type when rendered as a button. Defaults to 'button'. */
  type?: 'button' | 'submit' | 'reset';
  /** Disabled (button only). Dims the control and drops the hover glow. */
  disabled?: boolean;
  /** Anchor target (href only), e.g. "_blank". */
  target?: string;
  /** Accessible label override. */
  'aria-label'?: string;
  /** One-off layout overrides (margins, alignment). Never colours or type. */
  style?: CSSProperties;
  /** Optional className for responsive hooks. */
  className?: string;
  /** Button label. */
  children: ReactNode;
}

/**
 * Canonical ISL button. See the file header for the three variants.
 *
 * Examples:
 *   <Button variant="primary" to="/login">Sign up</Button>
 *   <Button onClick={save}>Save</Button>
 *   <Button variant="tertiary" to="/matches">All matches</Button>
 *
 * @returns A router link, anchor or button carrying the variant's styles.
 */
export function Button({
  variant = 'secondary',
  to,
  href,
  onClick,
  type: buttonType = 'button',
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
    ...(lit && isTertiary ? { textShadow: v.glow } : null),
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
      {isTertiary && <span aria-hidden="true">{glyph.forward}</span>}
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
      type={buttonType}
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
