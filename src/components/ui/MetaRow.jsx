// ── MetaRow.jsx ───────────────────────────────────────────────────────────────
// Shared "LABEL: value" metadata row used in team cards and team detail pages.
//
// Teams listing (Teams.jsx) uses a compact 11px size to fit inside small cards.
// Team detail (TeamDetail.jsx) uses a larger 13px size for the prominent info
// card at the top of the page.  The `fontSize` prop makes the intent explicit
// instead of duplicating the component with a hardcoded difference.

/**
 * Single "LABEL: value" metadata row.
 *
 * Renders the label bold-uppercase and the value in normal weight, matching
 * the structured info block style used throughout the ISL mockup.
 *
 * @param {string} label    - Field name (e.g. "Location"), rendered uppercase bold.
 * @param {string} value    - Field value (e.g. "Mercury").
 * @param {string} [fontSize='13px'] - CSS font-size for both label and value.
 *                                     Pass '11px' for compact team listing cards,
 *                                     '13px' (default) for team detail info cards.
 * @returns {JSX.Element}
 */
export default function MetaRow({ label, value, fontSize = '13px' }) {
  return (
    <p style={{ fontSize, lineHeight: 1.6 }}>
      <strong style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}:
      </strong>{' '}
      {value}
    </p>
  );
}
