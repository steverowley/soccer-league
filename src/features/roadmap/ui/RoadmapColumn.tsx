// ── roadmap/ui/RoadmapColumn.tsx ────────────────────────────────────────────
// One vertical kanban column (Ideas / Planned / In Progress / Shipped).
//
// Renders a column header with the human-readable label, an item count,
// and (for admins) a "+ New Idea" button that opens the editor modal
// seeded with `status = <this column>`.  Below the header sits the
// vertical card stack, already sorted by priority by the parent board.
//
// EMPTY STATE: when the column has zero items, we render a thin "Empty"
// placeholder rather than collapsing — the four-column rhythm is part of
// the visual at-a-glance signal, so empty columns must still take space.

import type { ReactNode } from 'react';
import { COLORS } from '../../../components/Layout';
import { STATUS_LABELS, type RoadmapStatus } from '../types';

// ── Style tokens ───────────────────────────────────────────────────────────

/** Hairline border used for column edges and the header divider. */
const BORDER = COLORS.hairline;

/** Small all-caps mono shared by the column header and count badge. */
const HEADER_FONT = {
  fontFamily: 'Space Mono, monospace',
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.14em',
  textTransform: 'uppercase' as const,
};

interface RoadmapColumnProps {
  /** Which kanban column this is — drives label + new-item seed status. */
  status: RoadmapStatus;
  /** Number of items in the column (rendered as a small badge). */
  count: number;
  /** Whether the viewer can add new items.  Hides the "+ New Idea" button when false. */
  isAdmin: boolean;
  /** Open the editor modal pre-seeded with `status` set to this column. */
  onAddItem: () => void;
  /** Card list — rendered as-is so the column is layout-only. */
  children: ReactNode;
}

/**
 * Render a single kanban column.  Layout is column-direction flex so the
 * card list expands vertically without scrolling within the column.
 *
 * @returns A column container ready to drop into the board's grid.
 */
export function RoadmapColumn({ status, count, isAdmin, onAddItem, children }: RoadmapColumnProps) {
  return (
    <section
      aria-labelledby={`roadmap-col-${status}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        border: `1px solid ${BORDER}`,
        padding: 12,
        background: COLORS.abyss,
        minHeight: 280,
      }}
    >
      {/* ── Column header ───────────────────────────────────────────── */}
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h2 id={`roadmap-col-${status}`} style={{ ...HEADER_FONT, color: COLORS.dust, margin: 0 }}>
            {STATUS_LABELS[status]}
          </h2>
          <span
            style={{
              ...HEADER_FONT,
              fontSize: 10,
              color: COLORS.dust50,
              border: `1px solid ${BORDER}`,
              padding: '2px 6px',
              fontVariantNumeric: 'tabular-nums',
            }}
            aria-label={`${count} item${count === 1 ? '' : 's'}`}
          >
            {count}
          </span>
        </div>

        {isAdmin && (
          <button
            type="button"
            onClick={onAddItem}
            style={{
              ...HEADER_FONT,
              fontSize: 10,
              color: COLORS.dust,
              background: 'transparent',
              border: `1px solid ${COLORS.dust}`,
              padding: '4px 8px',
              cursor: 'pointer',
              minHeight: 28,
            }}
          >
            + New
          </button>
        )}
      </header>

      <hr style={{ border: 0, height: 1, background: BORDER, margin: 0 }} />

      {/* ── Card stack ──────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {count === 0 ? (
          <p
            style={{
              ...HEADER_FONT,
              fontSize: 11,
              color: COLORS.dust50,
              margin: 0,
              padding: '16px 0',
              textAlign: 'center',
            }}
          >
            Empty
          </p>
        ) : (
          children
        )}
      </div>
    </section>
  );
}
