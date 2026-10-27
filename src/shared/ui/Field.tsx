// ── shared/ui/Field.tsx ───────────────────────────────────────────────────
// The one form-field style (docs/design-language.md, sections 4 and 6):
// label above, hairline control on the raised surface, help text in the
// secondary tone, error text in red announced with role="alert".
//
// WHY one shared field: Login, Reset password, Profile, the delete-account
// dialog, Voting and the notification settings each drew their own inputs
// (three label sizes, two backgrounds, a purple and an orange submit). A
// fan moving between them saw a different form every time. The focus ring
// is not drawn here: the global `*:focus-visible` rule in index.css paints
// the architect-purple ring on every control, which is the spec's one
// non-Architect use of purple.
//
// Usage:
//   <Field id="email" label="Email" hint="We never show it.">
//     <input id="email" type="email" style={inputStyle} ... />
//   </Field>
//   <CheckField id="age" checked={ok} onChange={setOk}>I am 18 or older.</CheckField>
//   {error && <FormError>{error}</FormError>}

import type { CSSProperties, ReactNode } from 'react';
import { color, hairline, space, tone, type } from '../design';

/**
 * Style for every text input, number input and select: the raised surface
 * (something you type into), a hairline border, body type, and a 44 px
 * minimum height so the control is a finger-sized target on a phone.
 */
export const inputStyle: CSSProperties = {
  ...type.body,
  ...hairline(color.line),
  background: color.surfaceRaised,
  color: color.text,
  fontFamily: 'inherit',
  minHeight: 44,
  paddingTop: space[8],
  paddingBottom: space[8],
  paddingLeft: space[12],
  paddingRight: space[12],
  borderRadius: 0,
  width: '100%',
  maxWidth: '100%',
  boxSizing: 'border-box',
};

interface FieldProps {
  /** Id of the control inside, so the label is tied to it (htmlFor). */
  id: string;
  /** Short label above the control (rendered uppercase). */
  label: ReactNode;
  /** Help text under the control, secondary tone. */
  hint?: ReactNode | undefined;
  /** Field-level error under the control, red, announced (role="alert"). */
  error?: ReactNode | undefined;
  /** The control: an <input> or <select> styled with `inputStyle`. */
  children: ReactNode;
  /** One-off layout overrides (width, margins). Never colours or type. */
  style?: CSSProperties;
}

/**
 * Label above a control, with optional help and error lines.
 *
 * @returns A flex column: label, control, hint, error.
 */
export function Field({ id, label, hint, error, children, style }: FieldProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: space[8], minWidth: 0, ...style }}>
      <label htmlFor={id} style={{ ...type.label, ...tone.secondary }}>
        {label}
      </label>
      {children}
      {hint != null && <span style={{ ...type.small, ...tone.secondary }}>{hint}</span>}
      {error != null && <FormError>{error}</FormError>}
    </div>
  );
}

interface CheckFieldProps {
  /** Checkbox id. */
  id: string;
  /** Checked state (controlled). */
  checked: boolean;
  /** Called with the new checked state. */
  onChange: (next: boolean) => void;
  /** Disable the checkbox (the row dims). */
  disabled?: boolean;
  /** The sentence beside the box. May contain links. */
  children: ReactNode;
  /** Optional help line under the sentence, secondary tone. */
  hint?: ReactNode;
}

/**
 * A checkbox with its sentence. The whole row is the <label>, so a tap
 * anywhere on the text toggles the box; on a phone the label carries the
 * 44 px floor from index.css.
 *
 * @returns A label wrapping the checkbox and its text.
 */
export function CheckField({ id, checked, onChange, disabled = false, children, hint }: CheckFieldProps) {
  return (
    <label
      htmlFor={id}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: space[12],
        minHeight: 44,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{
          width: 18,
          height: 18,
          margin: 0,
          marginTop: space[4],
          flex: 'none',
          accentColor: color.text,
          cursor: 'inherit',
        }}
      />
      <span style={{ display: 'flex', flexDirection: 'column', gap: space[4], minWidth: 0 }}>
        <span style={{ ...type.small, ...tone.primary }}>{children}</span>
        {hint != null && <span style={{ ...type.small, ...tone.secondary }}>{hint}</span>}
      </span>
    </label>
  );
}

/**
 * Form or field error: red (`live`, which means "went wrong" as well as
 * "happening now"), small type, announced to assistive tech.
 *
 * @returns A paragraph with role="alert".
 */
export function FormError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" style={{ ...type.small, color: color.live, margin: 0 }}>
      {children}
    </p>
  );
}
