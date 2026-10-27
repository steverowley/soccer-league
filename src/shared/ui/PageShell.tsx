// ── shared/ui/PageShell.tsx ───────────────────────────────────────────────
// Every page's frame (docs/design-language.md, sections 5 and 6): the site
// header, a `main` landmark holding the page, and the footer.
//
// WHY: each page used to paint its own wrapper (background, min-height,
// Header, Container, Footer), so the footer floated mid-screen with black
// below it on short pages (#723 finding 12). The shell is a full-height
// flex column: `main` grows, so the footer sits at the bottom of the
// viewport on a short page and after the content on a long one.
//
// `main` is the container (max 1248 px, gutter 24 px, 16 px on a phone) and
// stacks its children with the section gap (48 px, 32 px on a phone), so a
// page is just: <PageShell><PageHeader /><section>...</section></PageShell>.

import type { ReactNode } from 'react';
import Header from '../../components/Header';
import { Footer } from '../../components/Layout';
import { color, layout, space } from '../design';

interface PageShellProps {
  /** The page: a PageHeader (or Home's hero) then its sections. */
  children: ReactNode;
}

/**
 * Header, main content column, footer.
 *
 * @param children  Page content, stacked with the section gap.
 * @returns         The full-height page frame.
 */
export function PageShell({ children }: PageShellProps) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: color.bg,
        color: color.text,
      }}
    >
      <Header />
      <main
        style={{
          flex: '1 0 auto',
          width: '100%',
          maxWidth: layout.container,
          marginLeft: 'auto',
          marginRight: 'auto',
          paddingLeft: layout.gutter,
          paddingRight: layout.gutter,
          paddingBottom: space[64],
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          gap: layout.sectionGap,
          minWidth: 0,
        }}
      >
        {children}
      </main>
      <Footer />
    </div>
  );
}
