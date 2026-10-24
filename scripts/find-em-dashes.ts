// List every em dash in fan-facing copy, grouped by file.
//   npx tsx scripts/find-em-dashes.ts          # full listing
//   npx tsx scripts/find-em-dashes.ts --count  # per-file counts only
import { findEmDashes } from './lib/fanCopy';

const hits = findEmDashes(process.cwd());
const byFile = new Map<string, typeof hits>();
for (const h of hits) byFile.set(h.file, [...(byFile.get(h.file) ?? []), h]);

if (process.argv.includes('--count')) {
  for (const [f, hs] of [...byFile].sort((a, b) => b[1].length - a[1].length)) console.log(String(hs.length).padStart(4), f);
} else {
  for (const [f, hs] of byFile) {
    console.log(`\n${f}`);
    for (const h of hs) console.log(`  ${h.line}: ${h.text}`);
  }
}
console.log(`\n${hits.length} em dash(es) in fan-facing copy across ${byFile.size} file(s).`);
