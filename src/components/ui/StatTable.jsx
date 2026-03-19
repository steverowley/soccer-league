// ── StatTable.jsx ─────────────────────────────────────────────────────────────
// Reusable section for the repeating "stat category + light table + SEE MORE"
// pattern that appears multiple times on both the League Detail and Team Detail
// pages.  The mockup shows:
//
//   TOP SCORERS         TOP ASSISTS
//   ┌─────────────────┐ ┌─────────────────┐
//   │ PLAYER TEAM GOALS│ │ PLAYER TEAM GOALS│
//   │  ...            │ │  ...            │
//   └─────────────────┘ └─────────────────┘
//   [SEE MORE]           [SEE MORE]
//
// Rather than duplicating this structure six times across two pages, this
// component encapsulates: section heading, IslTable (light variant), and an
// optional "SEE MORE" primary button below the table.
//
// The component does NOT manage its own data — it receives fully resolved
// columns and rows from the parent page so it stays purely presentational.

import IslTable from './IslTable';
import Button from './Button';

/**
 * Stat table section: heading + light-variant data table + optional "SEE MORE".
 *
 * Used for Top Scorers, Top Assists, Top Clean Sheets, Most Yellow Cards,
 * and Most Red Cards sections on the League Detail and Team Detail pages.
 *
 * @param {string} title
 *   Section heading text (e.g. "TOP SCORERS").  Rendered in the design
 *   system's H3-equivalent section-title style (uppercase, Space Mono bold).
 *
 * @param {Array<{key: string, label: string, align?: string}>} columns
 *   Column definitions forwarded directly to IslTable.
 *
 * @param {Array<object>} rows
 *   Data rows forwarded directly to IslTable.
 *
 * @param {boolean} [showSeeMore=true]
 *   When true (default), renders a "SEE MORE" primary button below the table.
 *   Pass false for sections where a full list is always shown.
 *
 * @param {function} [onSeeMore]
 *   Click handler for the SEE MORE button.  If omitted the button renders but
 *   does nothing — acceptable as a placeholder for future routing.
 *
 * @param {string} [className='']
 *   Additional CSS classes on the outer section wrapper.
 *
 * @returns {JSX.Element}
 */
export default function StatTable({
  title,
  columns,
  rows,
  showSeeMore = true,
  onSeeMore,
  className = '',
}) {
  return (
    <div className={`section ${className}`.trim()}>
      {/* ── Section heading ───────────────────────────────────────────────────── */}
      {/* Uses the .section-title utility class from index.css: 20px Space Mono
          bold uppercase with 0.08em letter-spacing to match the design spec. */}
      <h3 className="section-title">{title}</h3>

      {/* ── Data table ────────────────────────────────────────────────────────── */}
      {/* Always light variant for stat tables — the Lunar Dust background
          creates contrast against the Galactic Abyss page background, matching
          the design mockup exactly. */}
      <IslTable variant="light" columns={columns} rows={rows} />

      {/* ── SEE MORE button ───────────────────────────────────────────────────── */}
      {/* Rendered below the table, left-aligned, with top margin matching the
          8px spacing unit.  Absent when showSeeMore is false. */}
      {showSeeMore && (
        <div style={{ marginTop: '16px' }}>
          <Button variant="primary" onClick={onSeeMore}>
            See More
          </Button>
        </div>
      )}
    </div>
  );
}
