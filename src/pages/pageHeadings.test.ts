// ── pageHeadings.test.ts ────────────────────────────────────────────────────
// Every page names itself with exactly one top-level heading (h1): it is what
// a screen reader announces and what search engines take as the page title.
// Eighteen pages had none, because the shared <SectionHeader> always rendered
// an h2; the page-opening header now passes `level={1}`.
//
// Static on purpose: rendering every page needs a router, a database stub and
// auth, while the rule is about the source.  A page passes when it renders an
// <h1> itself, opens with <SectionHeader level={1}>, or uses a hero component
// that renders the h1 (listed below). PageHeader (shared/ui, the design
// language's one page header) always renders the page's h1.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Resolved from the repo root (vitest's working directory): import.meta.url
// is not a file: URL under the jsdom environment.
const PAGES_DIR = join(process.cwd(), 'src', 'pages');

/** Components that render the page's h1 themselves. */
const H1_HEROES = ['<AdminPageHero', '<PageHeader'];

const pages = readdirSync(PAGES_DIR).filter((f) => f.endsWith('.tsx') && !f.includes('.test.'));

describe('every page has a main heading', () => {
  it('finds the pages', () => {
    expect(pages.length).toBeGreaterThan(20);
  });

  for (const file of pages) {
    it(file, () => {
      const src = readFileSync(join(PAGES_DIR, file), 'utf8');
      const hasH1 = /<h1[\s>]/.test(src)
        || /<SectionHeader\s[^>]*level=\{1\}/.test(src)
        || H1_HEROES.some((hero) => src.includes(hero));
      expect(hasH1, `${file} renders no h1`).toBe(true);
    });
  }

  it('a page opens with at most one level-1 SectionHeader', () => {
    for (const file of pages) {
      const src = readFileSync(join(PAGES_DIR, file), 'utf8');
      const count = (src.match(/<SectionHeader\s[^>]*level=\{1\}/g) ?? []).length;
      expect(count, file).toBeLessThanOrEqual(1);
    }
  });
});
