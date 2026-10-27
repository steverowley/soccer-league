// ── shared/ui/Prose.tsx ───────────────────────────────────────────────────
// The one prose style for long-form copy (docs/design-language.md, sections
// 2 and 5): About, Privacy and Terms.
//
//   Prose          the column: body type in the default text tone, capped at
//                  the reading measure (`layout.measure`, 70 characters) so
//                  a line never runs the full 1248 px container.
//   ProseSection   one numbered section: a SectionHeader (Roman numeral and
//                  the section name as the h2) above its paragraphs.
//   Paragraph      a body paragraph (no stray margins: the section spaces
//                  its paragraphs).
//   TextLink       an inline link in running text: default tone, underlined
//                  with a tertiary rule, never a colour of its own.
//
// WHY shared: the three legal pages each carried a private copy of the same
// Article / H2 / P / A helpers with raw sizes and the retired 70% dust, and
// their header comments already said "promote to src/shared/ui". The forms
// (Login, Welcome) use TextLink for their inline links too.
//
// Numbering: the PAGE numbers its sections (`index={toRoman(++n)}` or fixed
// literals), never the section itself, so conditional sections cannot come
// out of order (see SectionHeader).

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { color, layout, space, tone, type } from '../design';
import { SectionHeader } from './SectionHeader';

/**
 * The prose column.
 *
 * @param children  ProseSection elements.
 * @returns         An <article> at the reading measure.
 */
export function Prose({ children }: { children: ReactNode }) {
  return (
    <article
      style={{
        ...type.body,
        ...tone.primary,
        maxWidth: layout.measure,
        display: 'flex',
        flexDirection: 'column',
        gap: layout.sectionGap,
        minWidth: 0,
      }}
    >
      {children}
    </article>
  );
}

interface ProseSectionProps {
  /** Roman numeral, assigned by the page in reading order. */
  index: string;
  /** Section name: rendered as the h2 beside the numeral. */
  title: string;
  /** Paragraphs. */
  children: ReactNode;
}

/**
 * A numbered prose section.
 *
 * @returns A <section> with its SectionHeader and paragraphs.
 */
export function ProseSection({ index, title, children }: ProseSectionProps) {
  return (
    <section>
      <SectionHeader index={index} label={title} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: space[16] }}>{children}</div>
    </section>
  );
}

/** A body paragraph inside a ProseSection. */
export function Paragraph({ children }: { children: ReactNode }) {
  return <p style={{ margin: 0 }}>{children}</p>;
}

interface TextLinkProps {
  /** In-app route (router link; the base path is applied). */
  to?: string;
  /** External URL. */
  href?: string;
  /** Open in a new tab (adds rel="noopener noreferrer"). */
  newTab?: boolean;
  children: ReactNode;
}

const LINK_STYLE = {
  color: color.text,
  textDecoration: 'underline',
  textDecorationColor: color.textTertiary,
  textUnderlineOffset: 3,
} as const;

/**
 * Inline link in running text.
 *
 * @returns A router <Link> for `to`, otherwise an <a>.
 */
export function TextLink({ to, href, newTab = false, children }: TextLinkProps) {
  const tab = newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {};
  if (to != null) {
    return (
      <Link to={to} style={LINK_STYLE} {...tab}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} style={LINK_STYLE} {...tab}>
      {children}
    </a>
  );
}
