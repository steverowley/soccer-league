// ── scripts/designTokens.test.ts ─────────────────────────────────────────────
// Design language guard (docs/design-language.md, section 8): no raw font
// sizes, colours, Lunar Dust opacities or letter spacings in src/. Pages use
// the tokens in src/shared/design and the components in src/shared/ui.
//
// It is a RATCHET while pages migrate group by group: the committed
// baseline (scripts/designTokens.baseline.json) records each unmigrated
// file's current counts. The test fails when
//   - any file's count of any kind rises above its baseline entry,
//   - a file not in the baseline has any raw value (every new file and every
//     migrated page must be at zero),
//   - a migrated page (MIGRATED below) is in the baseline at all, or
//   - the baseline still lists a file that is now clean or gone (so the
//     ratchet only ever tightens: regenerate it).
// After migrating a page, regenerate the baseline (it only moves down):
//   npm run design:baseline
// The guard ends at zero when the last group lands.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  countByFile,
  findRawValues,
  regressions,
  scanSource,
  total,
  type RawCounts,
} from './lib/designTokens';

/** Pages (and their private components) moved onto the tokens: must stay at zero. */
const MIGRATED = [
  'src/pages/Home.tsx',
  'src/pages/Matches.tsx',
  'src/pages/Leagues.tsx',
  'src/pages/LeagueDetail.tsx',
  'src/components/StandingsTable.tsx',
  'src/shared/ui/PageShell.tsx',
  'src/shared/ui/PageHeader.tsx',
  'src/shared/ui/SectionHeader.tsx',
  'src/shared/ui/Card.tsx',
  'src/shared/ui/Button.tsx',
  'src/shared/ui/Tag.tsx',
  'src/shared/ui/LiveBadge.tsx',
  'src/shared/ui/BackLink.tsx',
  'src/shared/ui/Breadcrumbs.tsx',
  'src/shared/ui/Crest.tsx',
  'src/shared/ui/StatBlock.tsx',
  'src/shared/ui/Chip.tsx',
  'src/shared/ui/Kicker.tsx',
  'src/shared/ui/SectionPanel.tsx',
  'src/shared/ui/EmptyState.tsx',
  'src/shared/ui/DataState.tsx',
  'src/shared/ui/Skeleton.tsx',
  'src/shared/ui/StatPair.tsx',
  'src/shared/ui/KeyValue.tsx',
  'src/shared/ui/Pip.tsx',
  // Group 2: the match page and the components only it (or it first) renders.
  'src/pages/MatchDetail.tsx',
  'src/components/TeachingStrip.tsx',
  'src/components/WagerWidget.tsx',
  // Group 3: clubs and people, and the shared pieces they introduced.
  'src/pages/Teams.tsx',
  'src/pages/TeamDetail.tsx',
  'src/pages/PlayerDetail.tsx',
  'src/shared/ui/FormStrip.tsx',
  'src/shared/ui/DataTable.tsx',
  'src/shared/ui/FactList.tsx',
];

const root = process.cwd();
const baselinePath = join(root, 'scripts', 'designTokens.baseline.json');
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as Record<string, RawCounts>;
const hits = findRawValues(root);
const current = countByFile(hits);

function describeHits(file: string): string {
  return hits
    .filter((h) => h.file === file)
    .map((h) => `  ${h.file}:${h.line}  [${h.kind}]  ${h.text}`)
    .join('\n');
}

describe('design tokens guard', () => {
  it('no file has more raw style values than its baseline (new files: none)', () => {
    const up = regressions(baseline, current);
    const report = up
      .map((r) => `${r.file} ${r.kind}: ${r.baseline} -> ${r.now}\n${describeHits(r.file)}`)
      .join('\n');
    expect(up, `\nRaw style values above the baseline. Use src/shared/design tokens:\n${report}\n`).toEqual([]);
  });

  it('migrated pages and the shared components are at zero and absent from the baseline', () => {
    for (const file of MIGRATED) {
      expect(existsSync(join(root, file)), `${file} is listed as migrated but does not exist`).toBe(true);
      expect(baseline[file], `${file} must not be in the baseline`).toBeUndefined();
      expect(total(current[file]), `${file} has raw values:\n${describeHits(file)}`).toBe(0);
    }
  });

  it('the baseline is tight: no entry for a file that is now cleaner or gone', () => {
    const stale = Object.entries(baseline)
      .filter(([file, counts]) => total(current[file]) < total(counts))
      .map(([file, counts]) => `${file}: ${total(counts)} -> ${total(current[file])}`);
    expect(stale, `\nThe baseline can shrink. Run: npm run design:baseline\n${stale.join('\n')}\n`).toEqual([]);
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
});
