// ── shared/ui/Select.tsx ─────────────────────────────────────────────────────
// WHY: The same label + select + form-group pattern used in LoginForm,
// TrainingPage, and Profile appears verbatim across the codebase. This
// wrapper eliminates the duplication and ensures the WCAG label linkage
// (htmlFor ↔ id) is never accidentally omitted.
//
// DESIGN:
//   - Deliberately thin — no custom dropdown rendering, no virtual scroll.
//     The native <select> is correct for the ISL's short option lists (< 30
//     items in every current use-case) and provides free keyboard nav and
//     screen-reader support.
//   - `id` is required for the same accessibility reason as Input.tsx.
//   - The wrapper div is always rendered even when `label` is absent so the
//     spacing is consistent with other form fields in the same column.
//
// CONSUMERS: TrainingPage (player picker), Profile (team / player pickers)

import type { ReactNode, SelectHTMLAttributes } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /**
   * Required unique id — links the `<label>` to the `<select>` for
   * accessibility and browser autofill support.
   */
  id: string;
  /** Rendered above the select as a `.isl-label` element. Omit to suppress. */
  label?: string;
  /**
   * Inline validation error shown below the select with `role="alert"`.
   * Pass `null` or omit to hide the error row.
   */
  error?: string | null;
  /** Additional CSS classes appended to the `.isl-select` element. */
  className?: string;
  /** `<option>` elements (or `<optgroup>` wrappers). */
  children: ReactNode;
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Labelled native select with optional inline error.
 *
 * Wraps the ISL `.isl-select` CSS class in a `.form-group` container so
 * standard vertical spacing between form fields is applied automatically.
 * All standard `<select>` attributes (value, onChange, disabled, multiple, …)
 * are forwarded to the underlying element.
 *
 * @example
 *   <Select id="player-pick" label="Player" value={playerId}
 *           onChange={e => setPlayerId(e.target.value)}>
 *     {players.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
 *   </Select>
 */
export function Select({ id, label, error, className = '', children, ...rest }: SelectProps) {
  const selectCls = `isl-select${className ? ` ${className}` : ''}`;

  return (
    <div className="form-group">
      {/* Label — only rendered when supplied to avoid spurious empty elements. */}
      {label !== undefined && (
        <label htmlFor={id} className="isl-label">
          {label}
        </label>
      )}

      <select id={id} className={selectCls} {...rest}>
        {children}
      </select>

      {/* Error — role="alert" triggers an immediate screen-reader announcement. */}
      {error != null && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
