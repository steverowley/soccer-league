// ── shared/ui/LiveBadge.tsx ───────────────────────────────────────────────
// The only way "live" is shown (docs/design-language.md, sections 4 and 6).
//
// WHY: live used to be purple in code (a comment called red an "error"
// signal) while the brand spec said red; the owner decided red means live.
// The badge is a hairline tag with a RED dot and NEUTRAL text, "Live · 37'",
// so the colour is a small, unmistakable signal rather than a red label.
// Once the match is over it reads "Full time" in the secondary tone, with no
// dot: nothing is happening any more.

import type { CSSProperties } from 'react';
import { color, glyph, hairline, numeric, type } from '../design';

interface LiveBadgeProps {
  /** Match minute to show ("Live · 37'"); null or 0 shows just "Live". */
  minute?: number | null;
  /** The match has reached full time: shows "Full time" without the dot. */
  fullTime?: boolean;
  /** One-off layout overrides (alignment). Never colours or type. */
  style?: CSSProperties;
  /** Optional className for responsive hooks. */
  className?: string;
}

/**
 * Red dot plus "Live · 37'", or "Full time" once the match is over.
 *
 * @param minute    Minute of play, when known.
 * @param fullTime  True once the final whistle has gone.
 * @returns         A hairline badge span.
 */
export function LiveBadge({ minute = null, fullTime = false, style, className }: LiveBadgeProps) {
  const text = fullTime
    ? 'Full time'
    : minute != null && minute > 0
      ? `Live ${glyph.middot} ${minute}'`
      : 'Live';
  return (
    <span
      className={className}
      data-live={fullTime ? 'full-time' : 'live'}
      style={{
        ...type.label,
        ...numeric,
        ...hairline(color.line),
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        paddingTop: 4,
        paddingBottom: 4,
        paddingLeft: 8,
        paddingRight: 8,
        whiteSpace: 'nowrap',
        color: fullTime ? color.textSecondary : color.text,
        ...style,
      }}
    >
      {!fullTime && (
        <span
          aria-hidden="true"
          data-live-dot=""
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: color.live,
            display: 'inline-block',
            flex: 'none',
          }}
        />
      )}
      {text}
    </span>
  );
}
