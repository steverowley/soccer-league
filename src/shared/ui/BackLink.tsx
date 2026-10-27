// ── shared/ui/BackLink.tsx ────────────────────────────────────────────────
// "◂ All clubs" (docs/design-language.md, section 6).
//
// WHY: detail pages had three back-link spellings ("◂ ALL CLUBS",
// "◂ ← HOME" with two arrows, "◂ EARTH UNITED FC"). This is the one: a
// single ◂ glyph and the destination, in the `label` type and secondary
// tone, padded to a finger-sized tap target without looking bigger.

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { glyph, tone, type } from '../design';

interface BackLinkProps {
  /** Destination route. */
  to: string;
  /** The destination's name, e.g. "All clubs". */
  children: ReactNode;
}

/**
 * Back-to-listing link for the top of a detail page.
 *
 * @param to        Route to go back to.
 * @param children  Destination name.
 * @returns         A router link.
 */
export function BackLink({ to, children }: BackLinkProps) {
  return (
    <Link
      to={to}
      style={{
        ...type.label,
        ...tone.secondary,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        minHeight: 44,
        textDecoration: 'none',
      }}
    >
      <span aria-hidden="true">{glyph.back}</span>
      <span>{children}</span>
    </Link>
  );
}
