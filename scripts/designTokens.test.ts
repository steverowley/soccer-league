// ── scripts/designTokens.test.ts ─────────────────────────────────────────────
// Design language guard (docs/design-language.md, section 8): no raw font
// sizes, colours, Lunar Dust opacities or letter spacings anywhere in src/.
// Pages use the tokens in src/shared/design and the components in
// src/shared/ui; a <canvas> uses the canvas palette (`canvasColor`).
//
// A HARD ZERO. While pages migrated group by group this test was a ratchet
// against a per-file baseline (scripts/designTokens.baseline.json, lowered
// by `npm run design:baseline`). The last group (5b) took every file to
// zero, so the baseline, its script and the per-page MIGRATED list were
// deleted: any raw value in any scanned file now fails, new file or old.
//
// What is scanned and why the few exclusions exist (test files, the token
// files, generated database types, the club colours in leagueData.ts) is
// documented in scripts/lib/designTokens.ts, next to the rules.

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  SKIP_DIRS,
  SKIP_PATHS,
  countByFile,
  findRawValues,
  scanSource,
  violationReport,
  type RawHit,
} from './lib/designTokens';

const root = process.cwd();

/**
 * The guard itself, as a function so it can be run against a fixture: it
 * throws with the report when there is any raw value.
 *
 * @param hits  Raw values found.
 */
function assertNoRawValues(hits: readonly RawHit[]): void {
  const report = violationReport(hits);
  if (report != null) throw new Error(report);
}

describe('design tokens guard (hard zero)', () => {
  it('src/ has no raw font sizes, colours, dust opacities or letter spacings', () => {
    const hits = findRawValues(root);
    expect(countByFile(hits), violationReport(hits) ?? '').toEqual({});
    expect(() => assertNoRawValues(hits)).not.toThrow();
  });

  it('the ratchet is gone: no baseline file and no baseline script', () => {
    expect(existsSync(join(root, 'scripts', 'designTokens.baseline.json'))).toBe(false);
    expect(existsSync(join(root, 'scripts', 'design-baseline.ts'))).toBe(false);
  });

  it('excludes only the token files, generated types and the club colour data', () => {
    expect(SKIP_DIRS).toEqual(['src/shared/design/']);
    expect([...SKIP_PATHS].sort()).toEqual(['src/data/leagueData.ts', 'src/types/database.ts']);
    for (const p of [...SKIP_DIRS, ...SKIP_PATHS]) expect(existsSync(join(root, p)), `${p} is excluded but missing`).toBe(true);
  });
});

describe('the guard fails on a new raw value (fixture)', () => {
  // A component someone might add tomorrow: one raw colour, one raw size.
  const fixture = [
    `import { type } from '../shared/design';`,
    `export function Promo() {`,
    `  return <p style={{ ...type.body, fontSize: 14, color: '#FF0000' }}>Buy now</p>;`,
    `}`,
  ].join('\n');
  const hits: RawHit[] = scanSource('src/pages/Promo.tsx', fixture).map((h) => ({ file: 'src/pages/Promo.tsx', ...h }));

  it('finds the raw colour and the raw font size', () => {
    expect(hits.map((h) => h.kind).sort()).toEqual(['colour', 'fontSize']);
    expect(hits.every((h) => h.line === 3)).toBe(true);
  });

  it('the hard-zero assertion throws and names the file and line', () => {
    expect(() => assertNoRawValues(hits)).toThrow(/src\/pages\/Promo\.tsx:3 {2}\[(colour|fontSize)\]/);
  });

  it('the same component on tokens passes', () => {
    const clean = fixture.replace('fontSize: 14, color: \'#FF0000\'', 'color: color.action');
    expect(() => assertNoRawValues(scanSource('src/pages/Promo.tsx', clean).map((h) => ({ file: 'x', ...h })))).not.toThrow();
  });
});

describe('the scanner itself', () => {
  // Guards the guard: a broken scanner would make the tests above pass
  // vacuously, so check it against a planted file.
  const src = [
    `// fontSize: 13, color '#FFFFFF' in a comment is never counted`,
    `import { color, size } from './design';`,
    `export const a = { fontSize: 13, letterSpacing: '0.14em', color: '#E3E0D5' };`,
    `export const b = { fontSize: size.label, letterSpacing: 'var(--isl-tracking-label)', color: color.text };`,
    `export const c = { color: 'rgba(227, 224, 213, 0.5)', boxShadow: '0 0 6px rgba(154, 92, 244, 0.5)' };`,
    `export const d = (x: boolean) => ({ fontSize: x ? 11 : 13, letterSpacing: 0 });`,
    `export const css = \`.x { font-size: 36px !important; letter-spacing: 0.1em; color: #fff; }\`;`,
    `export const ok = \`.y { font-size: var(--isl-size-score); }\`;`,
    `export const Svg = () => <text fontSize={12} fill="#4169E1">x</text>;`,
    `export const shade = (r: number, g: number, b: number) => \`rgb(\${r},\${g},\${b})\`;`,
    `export const fade = (a: number) => \`rgba(227, 224, 213, \${a})\`;`,
    `export const mixed = (r: number) => \`rgb(10,10,10) rgb(\${r},0,0)\`;`,
  ].join('\n');
  const found = scanSource('probe.tsx', src);
  const by = (line: number) => found.filter((h) => h.line === line).map((h) => h.kind).sort();

  it('flags raw sizes, spacings, colours and dust opacities', () => {
    expect(by(3)).toEqual(['colour', 'fontSize', 'letterSpacing']);
    expect(by(5)).toEqual(['colour', 'dust']);
    expect(by(6)).toEqual(['fontSize']);
    expect(by(7)).toEqual(['colour', 'fontSize', 'letterSpacing']);
    expect(by(9)).toEqual(['colour', 'fontSize']);
  });

  it('ignores comments, tokens and var() references', () => {
    expect(by(1)).toEqual([]);
    expect(by(4)).toEqual([]);
    expect(by(8)).toEqual([]);
  });

  it('counts a colour computed from interpolated channels as computed, not raw', () => {
    expect(by(10)).toEqual([]);
  });

  it('still flags a literal channel next to an interpolation', () => {
    expect(by(11)).toEqual(['dust']);
    expect(by(12)).toEqual(['colour']);
  });
});
