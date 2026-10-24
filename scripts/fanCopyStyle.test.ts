// ── scripts/fanCopyStyle.test.ts ─────────────────────────────────────────────
// House style: no em dashes in anything a fan can read. Use a colon, comma,
// brackets or a new sentence instead.
//
// The scanner (scripts/lib/fanCopy.ts) parses every source file under src/ and
// supabase/functions/ with the TypeScript compiler and inspects only real text
// (string literals, template text, JSX text), so comments never trip it. A
// string that is only a dash, used as an empty-value placeholder, is allowed.
//
// If this fails, list the offenders with:
//   npx tsx scripts/find-em-dashes.ts
// and rewrite each sentence with the punctuation it actually needs. A blind
// swap for a comma reads badly ("No surface, football is played..." when a
// colon was meant), so do not script the replacement.

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { findEmDashes, EM_DASH } from './lib/fanCopy';

describe('fan-facing copy', () => {
  it('contains no em dashes', () => {
    const hits = findEmDashes(process.cwd());
    const report = hits.map((h) => `${h.file}:${h.line}  ${h.text}`).join('\n');
    expect(hits.length, `\n${hits.length} em dash(es) in fan-facing copy:\n${report}\n`).toBe(0);
  });
});

describe('the scanner itself', () => {
  // Guards the guard. If the scanner silently stopped reading files (a wrong
  // root, a broken filter), the test above would pass vacuously. So plant a
  // tiny fake repo and check it catches exactly what it should.
  const root = mkdtempSync(join(tmpdir(), 'fancopy-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const D = EM_DASH;

  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'supabase', 'functions', 'w'), { recursive: true });
  writeFileSync(join(root, 'src', 'copy.tsx'), [
    `// a comment ${D} never flagged`,
    `export const line = 'Corner to the home side ${D} watch the back post';`,
    `export const empty = '${D}';`,
    `export const tpl = (n: string) => \`\${n} scores ${D} what a strike\`;`,
    `export const Jsx = () => <p>Nothing is explained ${D} you learn by watching.</p>;`,
    `console.warn('dev log ${D} not fan copy');`,
  ].join('\n'));
  writeFileSync(join(root, 'src', 'copy.test.ts'), `export const t = 'test file ${D} skipped';`);
  writeFileSync(join(root, 'supabase', 'functions', 'w', 'pool.ts'), `export const pool = ['the keeper ${D} again'];`);

  const hits = findEmDashes(root);

  it('flags string literals, template text and JSX text in both roots', () => {
    const lines = hits.map((h) => `${h.file}:${h.line}`).sort();
    expect(lines).toEqual(['src/copy.tsx:2', 'src/copy.tsx:4', 'src/copy.tsx:5', 'supabase/functions/w/pool.ts:1']);
  });

  it('ignores comments, the lone placeholder, console calls and test files', () => {
    expect(hits.some((h) => h.text.includes('comment'))).toBe(false);
    expect(hits.some((h) => h.text === D)).toBe(false);
    expect(hits.some((h) => h.text.includes('dev log'))).toBe(false);
    expect(hits.some((h) => h.file.endsWith('.test.ts'))).toBe(false);
  });
});
