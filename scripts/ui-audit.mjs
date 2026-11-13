// ── scripts/ui-audit.mjs ────────────────────────────────────────────────────
// Counts hand-built UI patterns in src/ that a shared/ui component could
// replace. It feeds the Backlog table on /dev/components.
//
// WHY: the design system grows from real repetition, not from another
// library's catalogue (the #723 review counted 131 hand-built boxes, and
// that count is why Card exists). A pattern earns a component at three or
// more copies. Re-run this after each component lands and update BACKLOG in
// src/pages/Components.tsx from its output.
//
// Usage: node scripts/ui-audit.mjs            (table)
//        node scripts/ui-audit.mjs --json     (machine-readable)
//
// Scans .ts/.tsx under src/, skipping shared/ui and shared/design (the
// system itself), tests, and the generated database types. Counts are
// regex counts over source text: a good guide to scale, not an exact census.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SKIP = ['src/shared/ui/', 'src/shared/design/'];

/** Each candidate component and the source patterns it would replace. */
export const CANDIDATES = [
  { name: 'Stack', patterns: [/flexDirection:\s*['"]column['"]/g, /display:\s*['"]flex['"][^}]*gap:/g],
    note: 'Inline flex rows and columns with a gap token' },
  { name: 'Text / Label', patterns: [/\.\.\.type\.label,\s*\.\.\.tone\.(secondary|tertiary)/g],
    note: 'Inline eyebrow and meta labels (label type in a muted tone)' },
  { name: 'Grid', patterns: [/display:\s*['"]grid['"]/g],
    note: 'Inline auto-fit and fixed-column grids' },
  { name: 'Divider', patterns: [/border(Top|Bottom):\s*`1px solid/g],
    note: 'Hand-drawn hairline rules between blocks' },
  { name: 'FilterStrip', patterns: [/<Tag[^>]*onClick/g, /aria-pressed/g],
    note: 'Rows of toggle Tags and pressed buttons used as filters' },
  { name: 'ProgressBar', patterns: [/width:\s*`\$\{[^}]+\}%`/g],
    note: 'Percentage-width fill bars' },
  { name: 'Select', patterns: [/<select[\s>]/g],
    note: 'Native selects styled one by one' },
  { name: 'NumberInput / DateInput', patterns: [/type=["'](number|date|datetime-local|time|range)["']/g],
    note: 'Number, date and range inputs' },
  { name: 'Tooltip', patterns: [/<[a-z][a-z0-9]*\b[^<>]*?\btitle=/g],
    note: 'Native title attributes used as tooltips' },
  { name: 'Dialog', patterns: [/role=["']dialog["']|<dialog[\s>]/g],
    note: 'Modal overlays' },
];

/** Minimum number of files a pattern must appear in before it earns a component. */
export const THRESHOLD_FILES = 3;

function sources() {
  const out = [];
  (function walk(dir) {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!/\.tsx?$/.test(f) || /\.test\./.test(f)) continue;
      const rel = relative(ROOT, p).split('\\').join('/');
      if (SKIP.some((s) => rel.startsWith(s)) || rel === 'src/types/database.ts') continue;
      out.push([rel, readFileSync(p, 'utf8')]);
    }
  })(join(ROOT, 'src'));
  return out;
}

export function audit() {
  const files = sources();
  return CANDIDATES.map((c) => {
    let copies = 0;
    const where = new Map();
    for (const [f, s] of files) {
      let n = 0;
      for (const re of c.patterns) n += (s.match(re) || []).length;
      if (n) { copies += n; where.set(f, n); }
    }
    const top = [...where.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    return { name: c.name, copies, files: where.size, below: where.size < THRESHOLD_FILES, note: c.note, top };
  }).sort((a, b) => Number(a.below) - Number(b.below) || b.copies - a.copies);
}

if ((process.argv[1] ?? '').split('\\').join('/').endsWith('scripts/ui-audit.mjs')) {
  const rows = audit();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    for (const r of rows) {
      console.log(`${r.below ? '  below' : '  build'}  ${String(r.copies).padStart(4)} copies  ${String(r.files).padStart(3)} files  ${r.name}`);
      for (const [f, n] of r.top) console.log(`                              ${n}  ${f}`);
    }
  }
}
