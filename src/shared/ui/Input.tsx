// ── shared/ui/Input.tsx ──────────────────────────────────────────────────────
// WHY: Collocates the label + input + error trio that appears on every ISL
// form into a single component. Before this existed, all three elements were
// duplicated inline in every form (LoginForm, SignupForm, TrainingPage stake
// inputs, etc.) — any styling change had to be hunted down and applied in
// multiple places. This wrapper eliminates that duplication while staying
// deliberately thin: it owns no validation logic, only layout.
//
// DESIGN CONSTRAINTS:
//   - The `id` prop is required (not optional) because an `<input>` without a
//     matching `<label htmlFor>` violates WCAG 2.1 SC 1.3.1. Callers must
//     supply a stable, unique id.
//   - Error messages use `role="alert"` so screen readers announce them
//     immediately on insertion without requiring focus to move.
//   - The wrapping `.form-group` div provides the standard 16px bottom margin
//     defined in index.css. Do not add extra margin on the call site.
//
// CONSUMERS: LoginForm, SignupForm, WagerWidget (stake field), FocusCard

import type { InputHTMLAttributes, ReactNode } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /**
   * Required unique id — links the `<label>` to the `<input>` for
   * accessibility and browser autofill support.
   */
  id: string;
  /** Rendered above the input as a `.isl-label` element. Omit to suppress. */
  label?: string;
  /**
   * Inline validation error shown below the input with `role="alert"`.
   * Pass `null` or omit to hide the error row entirely (avoids layout shift
   * from a conditionally-rendered element taking up space while empty).
   */
  error?: string | null;
  /** Extra content rendered after the error line (e.g. helper text). */
  hint?: ReactNode;
  /** Additional CSS classes appended to the `.isl-input` element. */
  className?: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Labelled text input with optional inline error message.
 *
 * Wraps the ISL `.isl-input` CSS class in a `.form-group` container so the
 * standard 16px spacing between fields is applied automatically. The `label`
 * and `error` props are both optional — omitting `label` renders a bare input
 * (still accessible if the caller provides `aria-label`).
 *
 * All standard `<input>` attributes (type, value, onChange, disabled, …) are
 * forwarded to the underlying element.
 *
 * @example
 *   <Input id="login-email" type="email" label="Email" value={email}
 *          onChange={e => setEmail(e.target.value)} error={fieldError} />
 */
export function Input({ id, label, error, hint, className = '', ...rest }: InputProps) {
  const inputCls = `isl-input${className ? ` ${className}` : ''}`;

  return (
    <div className="form-group">
      {/* Label — only rendered when supplied so label-less inputs don't emit
          an empty <label> element that confuses assistive technology. */}
      {label !== undefined && (
        <label htmlFor={id} className="isl-label">
          {label}
        </label>
      )}

      <input id={id} className={inputCls} {...rest} />

      {/* Error — role="alert" triggers an immediate screen-reader announcement
          when the element is inserted into the DOM (e.g. after a failed submit). */}
      {error != null && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {hint}
    </div>
  );
}
