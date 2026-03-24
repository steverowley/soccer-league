// ── IslTable.jsx ──────────────────────────────────────────────────────────────
import { Link } from 'react-router-dom';

// Implements the two ISL table variants defined in the design system:
//
//  DARK  – Phobos Ash (#1F1F1F) background, Lunar Dust text.
//          Used on dark-background pages for standings and stats tables.
//          Column headers are separated from rows by a 25%-opacity dust rule;
//          row separators use 8%-opacity dust so they are subtle but present.
//
//  LIGHT – Lunar Dust (#E3E0D5) background, Galactic Abyss (#111111) text.
//          Used for player stat tables (Top Scorers, Top Assists, etc.) that
//          sit against the dark page background to create contrast.
//          Same header/row separator logic but inverted for dark-on-light.
//
// Both variants use the same uppercase Space Mono column headers (11px, 0.08em
// letter-spacing) and 13px body text from the typography scale.
//
// The component accepts a generic columns/rows data model so it can render
// any tabular data without variant-specific wiring in page components.
//
// Named IslTable (not Table) to avoid shadowing the native HTML <table> element
// and to be explicit about the design-system origin.

/**
 * ISL design-system data table.
 *
 * Renders a <table> styled as either the dark or light variant.
 * The component is horizontally scrollable on narrow viewports via the
 * `.table-wrapper` container class defined in index.css.
 *
 * @param {'dark'|'light'} [variant='dark']
 *   Visual style.  'dark' uses Phobos Ash bg; 'light' uses Lunar Dust bg.
 *
 * @param {Array<{key: string, label: string, align?: 'left'|'right'|'center', linkField?: string}>} columns
 *   Column definitions in display order.
 *   - key       – matches the property name on each row data object
 *   - label     – header text (rendered uppercase by CSS)
 *   - align     – optional text alignment; defaults to 'left'
 *   - linkField – optional: when set, the cell value is rendered as a React
 *                 Router <Link> whose `to` prop is read from row[linkField].
 *                 Allows standings/stat tables to link team names to their
 *                 detail pages without requiring page components to build
 *                 custom table markup.
 *
 * @param {Array<object>} rows
 *   Array of data objects.  Each object should have a property for every
 *   column key.  A special `id` or array index is used as the React key.
 *
 * @param {string} [className='']
 *   Additional CSS classes on the outer wrapper div.
 *
 * @returns {JSX.Element}
 */
export default function IslTable({ variant = 'dark', columns, rows, className = '' }) {
  // Resolve the CSS class that applies the correct colour scheme.
  // .table-dark  → Phobos Ash background, Lunar Dust text
  // .table-light → Lunar Dust background, Galactic Abyss text
  const tableClass = variant === 'light' ? 'table-light' : 'table-dark';

  return (
    // ── Scroll wrapper ─────────────────────────────────────────────────────────
    // overflow-x: auto allows horizontal scrolling on narrow viewports without
    // breaking the fixed desktop layout.
    <div className={`table-wrapper ${className}`.trim()}>
      <table className={tableClass}>

        {/* ── Column headers ──────────────────────────────────────────────────── */}
        {/* thead is always rendered even when rows is empty so the table
            headers remain visible (e.g. before season data is loaded). */}
        <thead>
          <tr>
            {columns.map(col => (
              <th
                key={col.key}
                style={{ textAlign: col.align ?? 'left' }}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>

        {/* ── Data rows ───────────────────────────────────────────────────────── */}
        <tbody>
          {rows.length === 0 ? (
            // ── Empty state ───────────────────────────────────────────────────
            // Rendered as a single full-width cell rather than an empty tbody
            // so the table border/background still shows at correct dimensions.
            <tr>
              <td
                colSpan={columns.length}
                style={{ textAlign: 'center', opacity: 0.5, fontStyle: 'italic' }}
              >
                No data available
              </td>
            </tr>
          ) : (
            rows.map((row, rowIdx) => (
              // Use row.id when available; fall back to index as key.
              // Row index keys are acceptable here because this table is
              // non-interactive and rows are never reordered client-side.
              <tr key={row.id ?? rowIdx}>
                {columns.map(col => (
                  <td
                    key={col.key}
                    style={{ textAlign: col.align ?? 'left' }}
                  >
                    {/* ── Cell content ───────────────────────────────────────
                        When the column declares a linkField, the cell value is
                        wrapped in a React Router <Link> whose destination is
                        read from row[col.linkField].  This keeps navigation
                        wiring in the data layer (column/row definitions) rather
                        than requiring each page to build bespoke table markup.
                        Render 0 and empty string as-is; only null/undefined
                        falls back to an em-dash placeholder. */}
                    {col.linkField && row[col.linkField] ? (
                      <Link
                        to={row[col.linkField]}
                        style={{ color: 'inherit', textDecoration: 'underline', textDecorationColor: 'rgba(255,255,255,0.3)' }}
                      >
                        {row[col.key] ?? '—'}
                      </Link>
                    ) : (
                      row[col.key] ?? '—'
                    )}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
