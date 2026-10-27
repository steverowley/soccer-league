// ── shared/ui/Breadcrumbs.tsx ─────────────────────────────────────────────
// "Leagues / Rocky Inner / Earth United" (docs/design-language.md,
// sections 6 and 7).
//
// WHY: breadcrumbs were spelled three ways ("TEAMS · ROCKY INNER LEAGUE ·
// EARTH", "LEAGUES / RCL", "MANAGERS / EARTH UNITED FC"). The convention is
// now fixed: a slash between crumbs, the middot is for items in a row. The
// last crumb is the current page and is not a link.

import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { glyph, tone, type } from '../design';

/** One crumb: a label, linked unless it is the current page. */
export interface Crumb {
  label: string;
  /** Route; omit for the current page (the last crumb). */
  to?: string;
}

/**
 * Breadcrumb trail.
 *
 * @param items  Crumbs from the top of the site down to this page.
 * @returns      A nav landmark labelled "Breadcrumb".
 */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" style={{ ...type.label, ...tone.tertiary }}>
      {items.map((crumb, i) => {
        const last = i === items.length - 1;
        return (
          <Fragment key={`${crumb.label}-${i}`}>
            {i > 0 && <span aria-hidden="true" style={{ margin: '0 8px' }}>{glyph.crumb}</span>}
            {crumb.to && !last ? (
              <Link to={crumb.to} style={{ ...tone.secondary, textDecoration: 'none' }}>
                {crumb.label}
              </Link>
            ) : (
              <span aria-current={last ? 'page' : undefined}>{crumb.label}</span>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
