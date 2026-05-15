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
 * The three ISL button variants, each mapping to a CSS class.  The visual
 * specifics live in index.css; bumping a colour means editing one CSS rule
 * rather than every consumer.
 *
 *   primary   → .btn-primary   Solar Flare orange fill, Abyss text — THE
 *                              primary CTA across the app (sign up, place
 *                              wager, browse, etc.).
 *   secondary → .btn-secondary Lunar Dust outline + text, transparent fill
 *                              — lower-weight CTAs (cancel, back, etc.).
 *   tertiary  → .btn-tertiary  Hairline outline only — inline secondary
 *                              actions that shouldn't compete with the
 *                              section's primary CTA.
 *
 * NOTE on history: pre-redesign the primary was Quantum Purple and the
 * tertiary was a purple fill.  Both were dropped in favour of the orange
 * Solar Flare lead — purple is now Architect-only.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'tertiary';

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
