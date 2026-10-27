// ── shared/ui/PageHeader.tsx ──────────────────────────────────────────────
// The one page header (docs/design-language.md, section 6). Every page has
// exactly one, and it renders the page's h1.
//
// WHY: the review (#723) found five header patterns (a 40 px kicker header,
// a bespoke 56 px hero, a boxed hero card, sentence-case titles at 32 and
// 36 px, and no title at all on match pages). Index and detail pages now use
// the same component; a detail page adds a back link, crumbs, a crest and a
// row of StatBlocks.
//
// Layout, top to bottom (matches docs/design-language-specimen.html):
//   back link                  "◂ All leagues"
//   breadcrumbs                "Leagues / Rocky Inner"
//   [crest]  eyebrow           "Leagues"  (the section of the site, never a number)
//            title (h1)        40 px, 30 on a phone
//   subtitle                   body prose, secondary tone
//   meta                       a row of StatBlocks or Tags
//   actions                    buttons
//   bottom hairline

import type { ReactNode } from 'react';
import { color, space, tone, type } from '../design';
import { BackLink } from './BackLink';
import { Breadcrumbs, type Crumb } from './Breadcrumbs';

interface PageHeaderProps {
  /** The section of the site, e.g. "Leagues". Never a number. */
  eyebrow: string;
  /** Page title: rendered as the page's h1. */
  title: ReactNode;
  /** One or two sentences under the title. */
  subtitle?: ReactNode;
  /** Back link for detail pages. */
  back?: { to: string; label: string };
  /** Breadcrumb trail for detail pages. */
  crumbs?: Crumb[];
  /** A <Crest> beside the title, for club pages. */
  crest?: ReactNode;
  /** A row of StatBlocks or Tags under the subtitle. */
  meta?: ReactNode;
  /** Buttons for the page (at most one primary). */
  actions?: ReactNode;
}

/**
 * Page header with the page's h1.
 *
 * Examples:
 *   <PageHeader eyebrow="Leagues" title="The four leagues" subtitle="..." />
 *   <PageHeader eyebrow="Leagues" title="Rocky Inner League"
 *     back={{ to: '/leagues', label: 'All leagues' }}
 *     crumbs={[{ label: 'Leagues', to: '/leagues' }, { label: 'Rocky Inner' }]} />
 *
 * @returns A <header> element with a bottom hairline.
 */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  back,
  crumbs,
  crest,
  meta,
  actions,
}: PageHeaderProps) {
  const hasTop = back != null || (crumbs != null && crumbs.length > 0);
  return (
    <header
      style={{
        paddingTop: space[32],
        paddingBottom: space[24],
        borderBottom: `1px solid ${color.line}`,
      }}
    >
      {back && <BackLink to={back.to}>{back.label}</BackLink>}
      {crumbs && crumbs.length > 0 && (
        <div style={{ marginTop: back ? space[8] : 0 }}>
          <Breadcrumbs items={crumbs} />
        </div>
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: space[16],
          marginTop: hasTop ? space[16] : 0,
          minWidth: 0,
        }}
      >
        {crest}
        <div style={{ minWidth: 0 }}>
          <div style={{ ...type.label, ...tone.secondary }}>{eyebrow}</div>
          <h1
            style={{
              ...type.title,
              margin: 0,
              marginTop: space[12],
              overflowWrap: 'anywhere',
            }}
          >
            {title}
          </h1>
        </div>
      </div>

      {subtitle != null && (
        <p style={{ ...type.body, ...tone.secondary, margin: 0, marginTop: space[16], maxWidth: '60ch' }}>
          {subtitle}
        </p>
      )}

      {meta != null && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: space[24], marginTop: space[24] }}>
          {meta}
        </div>
      )}

      {actions != null && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: space[12], marginTop: space[24] }}>
          {actions}
        </div>
      )}
    </header>
  );
}
