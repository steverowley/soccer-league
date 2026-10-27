// ── pageHeadings.test.ts ────────────────────────────────────────────────────
// Every page names itself with exactly one top-level heading (h1): it is what
// a screen reader announces and what search engines take as the page title.
//
// Since the page-header unification (docs/design-language.md, sections 2
// and 6) that h1 comes from ONE place: the shared PageHeader in
// src/shared/ui, so every page title on the site has the same size, case,
// tracking and left edge. The rules below hold every page to it:
//
//   - every page renders <PageHeader> (which always renders the h1);
//   - Home is the one exception: its marketing hero renders its own h1 in
//     the `display` size (the only display-size type on the site);
//   - no page writes its own <h1> or opens with the legacy
//     <SectionHeader level={1}> from components/Layout, either of which
//     would bring back a second header style.
//
// Static on purpose: rendering every page needs a router, a database stub and
// auth, while the rule is about the source.
//
// A static scan cannot see branches: MatchDetail once passed it while its
// normal states rendered no h1 (only the not-found branch had one). Pages
// with state branches are therefore also checked at RUNTIME, one render per
// state, in the test files listed in RUNTIME_CHECKED (spec section 8). The
// other branching pages (loading, not found, denied) render a PageHeader in
// each branch; the captures in docs/reports/design-system/headers/ check
// them in a browser.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Resolved from the repo root (vitest's working directory): import.meta.url
// is not a file: URL under the jsdom environment.
const PAGES_DIR = join(process.cwd(), 'src', 'pages');

/** The one page whose h1 is its own hero rather than PageHeader. */
const OWN_HERO = new Set(['Home.tsx']);

/** Pages with state branches, and the test that renders each state. */
const RUNTIME_CHECKED: Record<string, string> = {
  'MatchDetail.tsx': 'MatchDetail.headings.test.tsx',
};

const pages = readdirSync(PAGES_DIR).filter((f) => f.endsWith('.tsx') && !f.includes('.test.'));

describe('every page has a main heading', () => {
  it('finds the pages', () => {
    expect(pages.length).toBeGreaterThan(20);
  });

  for (const file of pages) {
    it(file, () => {
      const src = readFileSync(join(PAGES_DIR, file), 'utf8');
      if (OWN_HERO.has(file)) {
        expect(/<h1[\s>]/.test(src), `${file} hero renders no h1`).toBe(true);
        return;
      }
      expect(src.includes('<PageHeader'), `${file} does not open with PageHeader`).toBe(true);
      expect(/<h1[\s>]/.test(src), `${file} writes its own h1 beside PageHeader`).toBe(false);
      expect(/<SectionHeader\s[^>]*level=\{1\}/.test(src), `${file} uses the legacy level-1 SectionHeader`).toBe(false);
    });
  }

  it('Home writes exactly one h1 (its hero)', () => {
    const src = readFileSync(join(PAGES_DIR, 'Home.tsx'), 'utf8');
    expect((src.match(/<h1[\s>]/g) ?? []).length).toBe(1);
  });

  it('pages with state branches have a runtime test of every state', () => {
    for (const [page, test] of Object.entries(RUNTIME_CHECKED)) {
      expect(pages, `${page} is listed but missing`).toContain(page);
      const path = join(PAGES_DIR, test);
      expect(existsSync(path), `${test} (runtime heading test for ${page}) is missing`).toBe(true);
      // The runtime test must actually count h1s.
      expect(readFileSync(path, 'utf8')).toMatch(/level:\s*1/);
    }
  });
});
