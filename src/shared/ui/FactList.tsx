// ── shared/ui/FactList.tsx ────────────────────────────────────────────────
// Labelled facts and labelled lists for the people and club pages
// (docs/design-language.md, sections 2 and 6).
//
// WHY: the club dossier, the player dossier, the manager's notes and the
// character pages each drew facts and lists their own way: purple labels on
// one, dashed rules on another, browser bullets on the character page (the
// only bullets on the site, #723). Two shapes cover all of them:
//
//   FactGrid  label over value, in an auto-fitting grid. For short prose
//             values ("Blue with white trim", "The Marbles"). A bold figure
//             belongs in a StatBlock instead.
//   FactRows  an optional label over hairline-separated rows, no bullets.
//             For achievements, wants, recent beats, quotes.

import type { CSSProperties, ReactNode } from 'react';
import { color, space, tone, type } from '../design';

interface FactGridProps {
  /** [label, value] pairs; pass only non-empty values. */
  facts: ReadonlyArray<readonly [string, ReactNode]>;
  /** Minimum column width in px before the grid wraps. Defaults to 200. */
  minColumn?: number;
}

/**
 * Label-over-value pairs in an auto-fitting grid (a <dl>).
 *
 * @returns The definition list.
 */
export function FactGrid({ facts, minColumn = 200 }: FactGridProps) {
  return (
    <dl
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fill, minmax(min(${minColumn}px, 100%), 1fr))`,
        gap: space[24],
        margin: 0,
      }}
    >
      {facts.map(([label, value]) => (
        <div key={label} style={{ minWidth: 0 }}>
          <dt style={{ ...type.label, ...tone.secondary }}>{label}</dt>
          <dd style={{ ...type.small, ...tone.primary, margin: 0, marginTop: space[4], overflowWrap: 'anywhere' }}>
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

interface FactRowsProps {
  /** Optional label above the rows. */
  label?: string;
  /** One node per row. */
  items: ReadonlyArray<{ key: string; content: ReactNode; style?: CSSProperties }>;
  /** Row text: `small` (default) or `body` for prose such as quotes. */
  size?: 'small' | 'body';
}

/**
 * A list as hairline-separated rows: one list style for the whole site.
 *
 * @returns The labelled list.
 */
export function FactRows({ label, items, size = 'small' }: FactRowsProps) {
  return (
    <div>
      {label && <div style={{ ...type.label, ...tone.secondary, marginBottom: space[8] }}>{label}</div>}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxWidth: '70ch' }}>
        {items.map((item) => (
          <li
            key={item.key}
            style={{
              ...(size === 'body' ? type.body : type.small),
              ...tone.primary,
              paddingTop: space[12],
              paddingBottom: space[12],
              borderTop: `1px solid ${color.lineFaint}`,
              ...item.style,
            }}
          >
            {item.content}
          </li>
        ))}
      </ul>
    </div>
  );
}
