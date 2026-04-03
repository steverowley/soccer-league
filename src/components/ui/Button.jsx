// ── Button.jsx ────────────────────────────────────────────────────────────────
// Implements the three ISL button variants defined in the design system:
//
//  PRIMARY   – dark background, 1px Lunar Dust border, Lunar Dust text.
//              Used for the main call-to-action on any given screen.
//              Example: "VIEW LEAGUE", "SEE MORE"
//
//  SECONDARY – Lunar Dust background, dark text.
//              Used for lower-priority actions alongside a primary button.
//              Example: "UPCOMING MATCHES" next to "VIEW LEAGUES"
//
//  TERTIARY  – Quantum Purple (#9A5CF4) background, Lunar Dust text.
//              Used for highlighted or accent calls-to-action.
//              Example: "UPCOMING MATCHES" hero CTA, "CREATE ACCOUNT"
//
// All variants share the same uppercase Space Mono label and 10px/20px padding
// from the spacing scale (multiples of 4/8).  Focus state uses a dashed
// Quantum Purple outline (2px, 2px offset) per the accessibility spec.
//
// The component forwards all standard <button> / <a> props via rest spread,
// supporting both onClick handlers and href/Link usage.

/**
 * ISL design-system button.
 *
 * Renders a <button> element styled according to the requested variant.
 * All additional props (onClick, disabled, type, aria-*, etc.) are forwarded
 * to the underlying element.
 *
 * @param {'primary'|'secondary'|'tertiary'} [variant='primary']
 *   Visual style of the button.  Defaults to 'primary'.
 * @param {string} [className='']
 *   Additional CSS classes appended after the variant class.
 * @param {React.ReactNode} children
 *   Button label content.  Should be plain text per the design spec, but
 *   icons are also accepted.
 * @param {object} rest
 *   Any other props forwarded to the <button> element (onClick, disabled, etc.)
 * @returns {JSX.Element}
 */
export default function Button({ variant = 'primary', className = '', children, ...rest }) {
  // Map the variant prop to the corresponding CSS class defined in index.css.
  // 'primary' → .btn-primary  |  'secondary' → .btn-secondary  |  'tertiary' → .btn-tertiary
  const variantClass = `btn-${variant}`;

  return (
    <button className={`btn ${variantClass} ${className}`.trim()} {...rest}>
      {children}
    </button>
  );
}
