// ── Components.coverage.test.ts ─────────────────────────────────────────────
// The /dev/components shelf must show every export of src/shared/ui.
//
// WHY: a design-system reference page is only useful while it is complete. A
// new primitive that never reaches the shelf is a primitive the next builder
// will not know exists, and will rebuild by hand. So every value export of
// the shared/ui barrel must either be USED on the page (imported and rendered
// or called, not just imported) or be listed in EXEMPT with the reason it
// cannot be shown on its own.
//
// Static on purpose (like pageHeadings.test.ts): the rule is about the
// source, and rendering the page needs a router, auth and a toast provider.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const BARREL = readFileSync(join(ROOT, 'src', 'shared', 'ui', 'index.ts'), 'utf8');
const PAGE = readFileSync(join(ROOT, 'src', 'pages', 'Components.tsx'), 'utf8');

/** Exports that are wiring or helpers, not something to look at. */
const EXEMPT: Record<string, string> = {
  ToastProvider: 'App-level provider mounted once in main.tsx; the shelf fires real toasts through useToast.',
  ToastViewport: 'App-level mount point in main.tsx; the toasts it renders are demoed through useToast.',
  RouteSuspenseFallback: 'The lazy-route fallback in main.tsx, composed only of Skeleton, which is on the shelf.',
  AsyncView: 'A switch over LoadingState, ErrorState and EmptyState, all three of which are on the shelf.',
  formatKickoffDate: 'A date formatter used by PreSeasonState, not a visual primitive.',
  toRoman: 'The numeral helper behind SectionHeader indexes; pages call it, it renders nothing.',
};

/** Value (non-type) export names of the barrel. */
function barrelExports(src: string): string[] {
  const names: string[] = [];
  for (const block of src.matchAll(/export\s*\{([^}]*)\}\s*from/g)) {
    for (const raw of block[1]!.split(',')) {
      const name = raw.trim();
      if (name === '' || name.startsWith('type ')) continue;
      names.push(name);
    }
  }
  return names;
}

/** The page with its shared/ui import statement removed, so an import alone does not count. */
const PAGE_BODY = PAGE.replace(/import\s*\{[^}]*\}\s*from\s*'\.\.\/shared\/ui';/, '');

const exportsList = barrelExports(BARREL);

describe('/dev/components shows every shared/ui export', () => {
  it('reads the barrel', () => {
    expect(exportsList.length).toBeGreaterThan(30);
    expect(PAGE_BODY).not.toBe(PAGE); // the import statement was found and stripped
  });

  for (const name of exportsList) {
    it(name, () => {
      if (name in EXEMPT) return;
      // Real use only: rendered (<Name), called (Name(), or passed as a value
      // ({Name / , Name). A mention inside an Entry's title string does not count.
      const used = new RegExp(`<${name}[\\s/>]|\\b${name}\\(|[{(,]\\s*${name}\\b`).test(PAGE_BODY);
      expect(
        used,
        `${name} is exported from src/shared/ui but not shown on src/pages/Components.tsx. ` +
          'Add an Entry for it, or list it in EXEMPT with the reason it cannot be shown.',
      ).toBe(true);
    });
  }

  it('has no stale exemptions', () => {
    for (const name of Object.keys(EXEMPT)) {
      expect(exportsList, `${name} is exempt but no longer exported`).toContain(name);
    }
  });
});
