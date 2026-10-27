// ── shared/ui/SectionHeader.tsx ───────────────────────────────────────────
// The h2 that opens a section within a page (docs/design-language.md,
// sections 6 and 7).
//
// WHY: Roman numerals were used as unexplained page numbers (Login IX,
// Wagers XI, Leagues starting at II). They now index sections within one
// page, I, II, III in page order, beside a short label: "I · Now". The page
// itself is named by PageHeader's eyebrow, never by a numeral.
//
// The older `SectionHeader` in components/Layout.tsx (with `pageKicker` and
// `level`) stays only for pages not yet migrated; it is deleted with the
// other duplicates in the last migration group.
//
// Layout (docs/design-language-specimen.html `.sechead`):
//   left:  "I · Label" (label type, secondary), then the title (h2)
//   right: an optional action, usually a tertiary Button
//   bottom hairline, 24 px before the section body

import type { ReactNode } from 'react';
import { color, glyph, space, tone, type } from '../design';

interface SectionHeaderProps {
  /** Roman numeral: this section's place on the page (I, II, III). */
  index: string;
  /** Short label beside the numeral, e.g. "Now", "Standings". */
  label: string;
  /** Section title (the h2). Without one, the label line is the h2. */
  title?: ReactNode;
  /** One sentence under the title, secondary tone. */
  subtitle?: ReactNode;
  /** Right-aligned action, usually `<Button variant="tertiary">`. */
  action?: ReactNode;
}

/**
 * Section header: numeral and label, h2 title, optional action.
 *
 * @returns A <header> with a bottom hairline.
 */
export function SectionHeader({ index, label, title, subtitle, action }: SectionHeaderProps) {
  const kicker = `${index} ${glyph.middot} ${label}`;
  return (
    <header
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        gap: space[16],
        paddingBottom: space[12],
        borderBottom: `1px solid ${color.line}`,
        marginBottom: space[24],
      }}
    >
      <div style={{ minWidth: 0, flex: '1 1 280px' }}>
        {title != null ? (
          <>
            <div style={{ ...type.label, ...tone.secondary }}>{kicker}</div>
            <h2 style={{ ...type.heading, margin: 0, marginTop: space[8], overflowWrap: 'anywhere' }}>
              {title}
            </h2>
          </>
        ) : (
          <h2 style={{ ...type.label, ...tone.secondary, margin: 0 }}>{kicker}</h2>
        )}
        {subtitle != null && (
          <p style={{ ...type.small, ...tone.secondary, margin: 0, marginTop: space[8], maxWidth: '60ch' }}>
            {subtitle}
          </p>
        )}
      </div>
      {action != null && <div style={{ flex: 'none' }}>{action}</div>}
    </header>
  );
}

const ROMAN: Array<[number, string]> = [
  [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];

/**
 * Roman numeral for a section's 1-based position on its page. For pages
 * whose sections appear conditionally, so the numbering never skips.
 *
 * @param n  1-based section position (1 to 39).
 * @returns  "I", "II", "III", ...
 */
export function toRoman(n: number): string {
  let rest = Math.max(1, Math.floor(n));
  let out = '';
  for (const [value, numeral] of ROMAN) {
    while (rest >= value) {
      out += numeral;
      rest -= value;
    }
  }
  return out;
}
