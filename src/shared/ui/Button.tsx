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
 * The three ISL button variants, each mapping to a CSS class:
 *   primary   → .btn-primary   dark background, Lunar Dust border + text
 *   secondary → .btn-secondary Lunar Dust background, dark text
 *   tertiary  → .btn-tertiary  Quantum Purple background, Lunar Dust text
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
