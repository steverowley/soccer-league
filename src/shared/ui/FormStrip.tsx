// ── shared/ui/FormStrip.tsx ───────────────────────────────────────────────
// Recent results as a row of square W / D / L tiles
// (docs/design-language.md, sections 4 and 6).
//
// WHY one component: the standings table, the club directory, the club page
// and the player page each drew their own tiles, and three of the four made
// a loss red. Red means live or went wrong, never a result, so here:
//   W    → success border and letter (a good outcome)
//   D    → line border, secondary letter
//   L    → line border, tertiary letter
//   none → faint border, tertiary dash (a slot not played yet)
//
// `FormPip` is a single tile (a player's result in one match); `FormStrip`
// is a row of them, most recent first, optionally padded to a fixed number
// of slots so every row in a table is the same width.

import type { CSSProperties } from 'react';
import { color, hairline, space, tone, type } from '../design';

/** One match result from the club's (or player's) side. */
export type FormResult = 'W' | 'D' | 'L';

/** Tile edge in px. */
const PIP_SIZE = 24;

const LOOK: Record<FormResult | 'none', CSSProperties> = {
  W:    { ...hairline(color.success), color: color.success },
  D:    { ...hairline(color.line), ...tone.secondary },
  L:    { ...hairline(color.line), ...tone.tertiary },
  none: { ...hairline(color.lineFaint), ...tone.tertiary },
};

const WORD: Record<FormResult, string> = { W: 'Won', D: 'Drawn', L: 'Lost' };

/**
 * One result tile.
 *
 * @param result  W, D or L; null or undefined draws the empty slot.
 * @returns       A 24 px square span with the letter (or a dash).
 */
export function FormPip({ result }: { result?: FormResult | null | undefined }) {
  const key = result ?? 'none';
  return (
    <span
      title={result ? WORD[result] : undefined}
      style={{
        ...type.label,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: 'none',
        width: PIP_SIZE,
        height: PIP_SIZE,
        lineHeight: 1,
        ...LOOK[key],
      }}
    >
      {result ?? '\u2014'}
    </span>
  );
}

interface FormStripProps {
  /** Results, most recent first. */
  form: readonly FormResult[] | null | undefined;
  /**
   * Fixed number of tiles: missing results become empty slots. Omit to draw
   * exactly the results given (and one empty slot when there are none, so
   * the row never collapses to nothing).
   */
  slots?: number;
}

/**
 * A row of result tiles, most recent first.
 *
 * @returns An inline-flex span of FormPips with an accessible summary.
 */
export function FormStrip({ form, slots }: FormStripProps) {
  const results: readonly FormResult[] = form ?? [];
  const count = slots ?? Math.max(results.length, 1);
  const label = results.length > 0
    ? `Form, most recent first: ${results.map((r) => WORD[r]).join(', ')}`
    : 'No results yet';
  return (
    <span role="img" aria-label={label} style={{ display: 'inline-flex', gap: space[4] }}>
      {Array.from({ length: count }, (_, i) => (
        <FormPip key={i} result={results[i]} />
      ))}
    </span>
  );
}
