// ── shared/ui/Tag.tsx ─────────────────────────────────────────────────────
// Small hairline label for categories, filters and statuses
// (docs/design-language.md, section 6).
//
// WHY one component: the review (#723) found three local FilterChip copies
// and a dozen hand-rolled pills, each with its own padding, size and
// tracking (0.12 to 0.18em). A Tag is always the `label` type in a 1 px box.
//
// Selected state (a chosen filter) is a Lunar Dust fill with Abyss text, so
// it reads without colour. Tones carry meaning only:
//   default   → line border, secondary text (categories, filters)
//   architect → purple: Architect-related categories
//   live      → red: something wrong or happening now (live uses LiveBadge)
//   success   → green: a good outcome ("Won", "Qualified")
//
// Pass `onClick` and the Tag renders a <button> with `aria-pressed` carrying
// the selected state, which is what a filter strip needs.

import type { CSSProperties, MouseEventHandler, ReactNode } from 'react';
import { color, hairline, type } from '../design';

/** What the tag's colour says. See the file header. */
export type TagTone = 'default' | 'architect' | 'live' | 'success';

const TONE: Record<TagTone, CSSProperties> = {
  default:   { ...hairline(color.line), color: color.textSecondary },
  architect: { ...hairline(color.architect), color: color.architect },
  live:      { ...hairline(color.live), color: color.live },
  success:   { ...hairline(color.success), color: color.success },
};

const SELECTED: CSSProperties = {
  ...hairline(color.text),
  background: color.text,
  color: color.bg,
};

interface TagProps {
  /** Tag text, optionally with a leading glyph. */
  children: ReactNode;
  /** Colour meaning. Defaults to 'default'. */
  tone?: TagTone;
  /** A chosen filter: Lunar Dust fill, Abyss text. */
  selected?: boolean;
  /** Makes the tag a toggle button (filters). */
  onClick?: MouseEventHandler<HTMLButtonElement>;
  /** One-off layout overrides. Never colours or type. */
  style?: CSSProperties;
  /** Optional className for responsive hooks. */
  className?: string;
}

/**
 * Hairline label, or a filter toggle when `onClick` is set.
 *
 * Examples:
 *   <Tag>Dispatch</Tag>
 *   <Tag tone="architect">Architect</Tag>
 *   <Tag selected={filter === 'all'} onClick={() => setFilter('all')}>All</Tag>
 *
 * @returns A span, or a button with aria-pressed when `onClick` is set.
 */
export function Tag({
  children,
  tone = 'default',
  selected = false,
  onClick,
  style,
  className,
}: TagProps) {
  const composed: CSSProperties = {
    ...type.label,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    paddingTop: 4,
    paddingBottom: 4,
    paddingLeft: 8,
    paddingRight: 8,
    background: 'transparent',
    whiteSpace: 'nowrap',
    ...TONE[tone],
    ...(selected ? SELECTED : null),
    ...style,
  };

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={selected}
        className={className}
        style={{ ...composed, fontFamily: 'inherit', cursor: 'pointer' }}
      >
        {children}
      </button>
    );
  }

  return (
    <span className={className} style={composed}>
      {children}
    </span>
  );
}
