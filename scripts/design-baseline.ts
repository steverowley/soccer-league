// ── scripts/design-baseline.ts ───────────────────────────────────────────────
// Regenerate scripts/designTokens.baseline.json, the ratchet that
// scripts/designTokens.test.ts holds src/ to. ONLY DOWNWARD: it refuses to
// write when any file's count of raw style values has risen (or a file not
// in the baseline has any), because raising the baseline would turn the
// guard off for that file. Fix the new raw values instead: use the tokens in
// src/shared/design (docs/design-language.md).
//
// Run after migrating a page so its entry drops out:
//   npm run design:baseline

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { countByFile, findRawValues, regressions, total, type RawCounts } from './lib/designTokens';

const root = process.cwd();
const path = join(root, 'scripts', 'designTokens.baseline.json');
const current = countByFile(findRawValues(root));
const force = process.argv.includes('--init');

if (existsSync(path) && !force) {
  const baseline = JSON.parse(readFileSync(path, 'utf8')) as Record<string, RawCounts>;
  const up = regressions(baseline, current);
  if (up.length > 0) {
    console.error('Refusing to raise the design-token baseline. Counts went up in:');
    for (const r of up) console.error(`  ${r.file}  ${r.kind}: ${r.baseline} -> ${r.now}`);
    console.error('Replace the raw values with tokens from src/shared/design instead.');
    process.exit(1);
  }
  const before = Object.values(baseline).reduce((n, c) => n + total(c), 0);
  const after = Object.values(current).reduce((n, c) => n + total(c), 0);
  console.log(`Baseline ${before} -> ${after} raw values (${Object.keys(current).length} files).`);
}

writeFileSync(path, `${JSON.stringify(current, null, 2)}\n`);
console.log(`Wrote ${path}`);
