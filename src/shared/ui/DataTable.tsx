// ── shared/ui/DataTable.tsx ───────────────────────────────────────────────
// The DataTable styles (docs/design-language.md, section 6): `label`
// headers, `small` cells, `line-faint` row rules, tabular numbers.
//
// WHY presets and a frame rather than a column-config component: the
// tables on the club, player and standings pages each have their own cell
// content (links, crests, result tiles, card glyphs), so a generic
// `columns={[...]}` API would grow a render prop per column. What must not
// drift is the look, so that is what is shared: spread `dataHead()` into a
// <th>, `dataCell()` into a <td>, and wrap the <table> in <DataTable>.
//
// Usage:
//   <DataTable caption="Squad">
//     <thead><tr><th style={dataHead()}>Player</th></tr></thead>
//     <tbody><tr><td style={dataCell()}>Marco Delgado</td></tr></tbody>
//   </DataTable>

import type { CSSProperties, ReactNode } from 'react';
import { color, numeric, space, tone, type } from '../design';

type Align = 'left' | 'right' | 'center';

const PAD: CSSProperties = {
  paddingTop: space[12],
  paddingBottom: space[12],
  paddingLeft: space[12],
  paddingRight: space[12],
};

/**
 * Header cell style: `label` type, secondary tone, structural line below.
 *
 * @param align  Text alignment; numbers align right.
 * @param width  Optional fixed column width in px.
 * @returns      Style for a <th>.
 */
export function dataHead(align: Align = 'left', width?: number): CSSProperties {
  return {
    ...type.label,
    ...tone.secondary,
    ...PAD,
    textAlign: align,
    whiteSpace: 'nowrap',
    borderBottom: `1px solid ${color.line}`,
    ...(width != null ? { width } : null),
  };
}

/**
 * Body cell style: `small` type (inherited from the table), faint row rule.
 *
 * @param align  Text alignment; numbers align right.
 * @returns      Style for a <td>.
 */
export function dataCell(align: Align = 'left'): CSSProperties {
  return {
    ...PAD,
    textAlign: align,
    verticalAlign: 'middle',
    borderBottom: `1px solid ${color.lineFaint}`,
  };
}

interface DataTableProps {
  /** The <thead> and <tbody>. */
  children: ReactNode;
  /** Accessible table name (visually hidden). */
  caption?: string;
  /** Minimum table width in px before it scrolls inside its own box. */
  minWidth?: number;
}

/**
 * A table in the DataTable look, scrolling horizontally inside its own box
 * on a narrow screen so the page itself never overflows.
 *
 * @returns A scroll frame around a full-width collapsed table.
 */
export function DataTable({ children, caption, minWidth }: DataTableProps) {
  return (
    <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
      <table
        style={{
          ...type.small,
          ...numeric,
          width: '100%',
          borderCollapse: 'collapse',
          color: color.text,
          ...(minWidth != null ? { minWidth } : null),
        }}
      >
        {caption && (
          <caption
            style={{
              position: 'absolute',
              width: 1,
              height: 1,
              overflow: 'hidden',
              clip: 'rect(0 0 0 0)',
              whiteSpace: 'nowrap',
            }}
          >
            {caption}
          </caption>
        )}
        {children}
      </table>
    </div>
  );
}
