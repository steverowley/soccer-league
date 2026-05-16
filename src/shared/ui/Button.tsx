// ── shared/ui/Button.tsx ─────────────────────────────────────────────────────
// WHY: Promotes the legacy Button.jsx to a fully-typed TypeScript component
// under src/shared/ui/ so every feature can import it without reaching into
// src/components/ui/ (which bypasses the ESLint no-restricted-imports rule).
//
// The three-variant system (primary / secondary / tertiary) maps 1-to-1 with
// the CSS classes defined in src/index.css. No style logic lives here — this
// component is purely a type-safe thin wrapper.
//
// CONSUMERS: LoginForm, SignupForm, WagerWidget, TrainingPage, VotingPage, …

import type { ButtonHTMLAttributes, ReactNode } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Four ISL button variants, each mapping to a CSS class in index.css.
 * The semantic mapping comes from Frame 19 of the design language file
 * — bumping a colour means editing one CSS rule rather than every
 * consumer.
 *
 *   primary   → .btn-primary   Abyss fill + Dust 1 px border + Dust
 *                              text.  THE standard CTA (View League,
 *                              Browse Leagues, Watch Live Match, etc.).
 *   secondary → .btn-secondary Dust fill + Abyss text.  Inverted
 *                              emphasis (rare; use when paired with a
 *                              primary on a dark hero).
 *   active    → .btn-active    Quantum Purple fill + Dust text.  The
 *                              header auth CTA (SIGN UP / LOG IN) and
 *                              any "currently selected" button-group
 *                              state.
 *   tertiary  → .btn-tertiary  Borderless text + ► chevron.  Inline
 *                              "View All Matches →" actions next to
 *                              SectionHeader titles.
 *
 * NOTE on history: pre-second-foundation-pass the primary was the
 * Astro Explorer orange.  Frame 40 + Frame 19 show that orange is the
 * SECONDARY focus accent, not the primary CTA — primary is the dark-
 * outline pattern above.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'active' | 'tertiary';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style. Defaults to 'primary'. */
  variant?: ButtonVariant;
  /** Additional CSS classes appended after the variant class. */
  className?: string;
  children: ReactNode;
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * ISL design-system button.
 *
 * Renders a `<button>` element styled to one of the three ISL variants.
 * All standard button props (onClick, disabled, type, aria-*, …) are
 * forwarded to the underlying element unchanged.
 *
 * @example
 *   <Button onClick={handleSubmit}>Place Wager</Button>
 *   <Button variant="secondary" disabled={loading}>Cancel</Button>
 *   <Button variant="tertiary" type="submit">Create Account</Button>
 */
export function Button({ variant = 'primary', className = '', children, ...rest }: ButtonProps) {
  const cls = `btn btn-${variant}${className ? ` ${className}` : ''}`;
  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  );
}
