// ── shared/ui/Chip.tsx ────────────────────────────────────────────────────
// Second design primitive lifted into the shared UI layer for #378.
//
// WHY
// ───
// The repo has dozens of small bordered "pill" labels — "LIVE",
// "SEEDED", "TBD", "ELECTION OPEN", "ADMIN" — each hand-rolled as
// `<span style={{ border: '1px solid ...', padding: '4px 12px',
// fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase'
// }}>`. The visual is identical across all of them; the inline-style
// blocks aren't.
//
// `<Chip>` ships the canonical pill: border + small-caps text +
// configurable tone. Consumers compose any extra ornaments (live
// pulse dot, divider, value) as children.
//
// SCOPE
// ─────
// Tiny — same shape as Card. Renders a single span with a bordered
// padding box and the design-system typography defaults. No layout
// opinions, no internal grid. Future iterations can add a `size`
// prop if a smaller variant is wanted; the current 4×12 padding +
// 11 px font sits on the small-pill cadence used by MatchCard,
// StandingsTable, and the bracket TBD chips.

import type { CSSProperties, ReactNode } from 'react';
import { COLORS } from '../../components/Layout';

// ── Constants ─────────────────────────────────────────────────────────────

/**
 * Default vertical padding (px). 4 px puts the text on the same
 * vertical cadence used by every existing pill in the app.
 */
const PAD_Y = 4;

/**
 * Default horizontal padding (px). 12 px gives enough breathing room
 * for two-word labels (e.g. "ELECTION OPEN") without crowding.
 */
const PAD_X = 12;

/**
 * Default font size (px). 11 px is the editorial small-cap size used
 * across the existing copy-pasted pill blocks.
 */
const FONT_SIZE = 11;

/**
 * Default letter spacing. 0.14 em matches the cadence used by
 * StandingsTable and most pill labels; tighter than the 0.18 em used
 * for hero kickers (where the text is even smaller) and wider than
 * the 0.12 em used by section labels.
 */
const LETTER_SPACING = '0.14em';

// ── Public types ──────────────────────────────────────────────────────────

/**
 * Tone of the chip border + text colour. Mirrors `CardTone` so
 * consumers can use the same vocabulary across primitives.
 *   hairline → neutral border, DUST text (most pills)
 *   quantum  → focus / live indicator
 *   flare    → error / danger / sold-out signalling
 *   dust     → dust-coloured border, DUST text (slightly stronger contrast)
 */
export type ChipTone = 'hairline' | 'quantum' | 'flare' | 'dust';

/**
 * Map a ChipTone to its border colour. Centralised here so a palette
 * shift later updates every chip in one diff.
 */
const TONE_BORDER: Record<ChipTone, string> = {
  hairline: COLORS.hairline,
  quantum:  COLORS.quantum,
  flare:    COLORS.flare,
  dust:     COLORS.dust,
};

/**
 * Map a ChipTone to its text colour. The default for every tone is
 * DUST (light text on the abyss page bg); flare-toned chips use the
 * same flare colour for the text so an error-pill reads as a single
 * visual unit instead of two contrasting colours.
 */
const TONE_TEXT: Record<ChipTone, string> = {
  hairline: COLORS.dust,
  quantum:  COLORS.dust,
  flare:    COLORS.flare,
  dust:     COLORS.dust,
};

interface ChipProps {
  /** Pill contents — usually text, can include a leading icon / dot. */
  children: ReactNode;
  /** Border + text tone. Defaults to 'hairline'. */
  tone?: ChipTone;
  /** Optional one-off style merge — drives to zero over time. */
  style?: CSSProperties;
  /** Optional className for legacy CSS targeting. */
  className?: string;
}

// ── Chip ──────────────────────────────────────────────────────────────────

/**
 * Bordered small-caps pill — the canonical status / kicker label for
 * #378.
 *
 * Examples:
 *   <Chip>LIVE</Chip>
 *   <Chip tone="quantum"><Pulse /> Live · 67'</Chip>
 *   <Chip tone="flare">SOLD OUT</Chip>
 *
 * @param children   Pill contents.
 * @param tone       Border + text tone token. Default 'hairline'.
 * @param style      One-off CSS overrides (avoid where possible).
 * @param className  Optional className for legacy CSS targeting.
 */
export function Chip({
  children,
  tone = 'hairline',
  style,
  className,
}: ChipProps) {
  return (
    <span
      className={className}
      style={{
        display:        'inline-flex',
        alignItems:     'center',
        gap:            8,
        border:         `1px solid ${TONE_BORDER[tone]}`,
        color:          TONE_TEXT[tone],
        padding:        `${PAD_Y}px ${PAD_X}px`,
        fontSize:       FONT_SIZE,
        fontWeight:     700,
        letterSpacing:  LETTER_SPACING,
        textTransform:  'uppercase',
        fontFamily:     'Space Mono, monospace',
        ...style,
      }}
    >
      {children}
    </span>
  );
}
