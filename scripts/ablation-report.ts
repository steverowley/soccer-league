// scripts/ablation-report.ts
// Each SimConfig flag switched off against the same seeds with everything on
// (docs/emergent-engine.md 6.2), from batches written by scripts/run-batch.sh:
//   npx tsx scripts/ablation-report.ts <dir>
// expects <dir>/cal-*.jsonl (all on, std) and <dir>/off-<flag>-*.jsonl.
// Differences are paired by seed; the standard error is of the paired
// difference, so the resolution limit is about 2 SE.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type Row = Record<string, number>;
const dir = process.argv[2] ?? '.';
function load(prefix: string): Map<number, Row> {
  const out = new Map<number, Row>();
  for (const f of readdirSync(dir).filter((x) => x.startsWith(prefix + '-') && x.endsWith('.jsonl') && /-\d+\.jsonl$/.test(x) && x.slice(prefix.length + 1).match(/^\d+\.jsonl$/))) {
    for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const r = JSON.parse(line) as Row;
      out.set(r['seed']!, r);
    }
  }
  return out;
}
const on = load('cal');
const flags = ['imprecision', 'utilitySoftness', 'personality', 'confidence', 'momentum', 'scoreClockTerm', 'homeAdvantage'];
const metrics: Array<[string, (r: Row) => number]> = [
  ['goals', (r) => r['goals']!],
  ['shots', (r) => r['shots']!],
  ['passes', (r) => r['passes']!],
  ['tackles', (r) => r['tackles']!],
  ['fouls', (r) => r['fouls']!],
  ['home-away goals', (r) => r['homeGoals']! - r['awayGoals']!],
];
const lines: string[] = [];
const out = (s = ''): void => { lines.push(s); console.log(s); };
out('Emergent engine ablation: each flag OFF against ALL ON, paired by seed.');
out('Fixture: equal sides rated 60..80 (4-4-2, five-man bench), seeds 1000+, both sides per match.');
out('Cell = mean(off) - mean(on) [SE of the paired difference]; |diff| under ~2 SE is noise (resolution limit).');
out('');
const head = ['flag (off)', 'n', ...metrics.map(([n]) => n)];
out(head.map((h, i) => (i === 0 ? h.padEnd(16) : h.padStart(i === 1 ? 4 : 22))).join(''));
const onRow = ['ALL ON (mean)', String(on.size)];
for (const [, f] of metrics) {
  const xs = [...on.values()].map(f);
  onRow.push((xs.reduce((s, x) => s + x, 0) / xs.length).toFixed(2));
}
out(onRow.map((h, i) => (i === 0 ? h.padEnd(16) : h.padStart(i === 1 ? 4 : 22))).join(''));
for (const flag of flags) {
  const off = load('off-' + flag);
  const seeds = [...off.keys()].filter((s) => on.has(s));
  const cells = [flag, String(seeds.length)];
  for (const [, f] of metrics) {
    const d = seeds.map((s) => f(off.get(s)!) - f(on.get(s)!));
    const n = d.length;
    const mu = d.reduce((s, x) => s + x, 0) / Math.max(1, n);
    const v = d.reduce((s, x) => s + (x - mu) * (x - mu), 0) / Math.max(1, n - 1);
    const se = Math.sqrt(v / Math.max(1, n));
    const sig = Math.abs(mu) > 2 * se ? ' *' : '  ';
    cells.push(`${mu >= 0 ? '+' : ''}${mu.toFixed(2)} [${se.toFixed(2)}]${sig}`);
  }
  out(cells.map((h, i) => (i === 0 ? h.padEnd(16) : h.padStart(i === 1 ? 4 : 22))).join(''));
}
out('');
out('* = beyond 2 SE. Note: switching a flag off changes every later random draw, so a paired');
out('difference measures the flag plus the re-draw; only effects beyond ~2 SE are attributable.');
out('home-away goals at equal strength is the home advantage; with 40 seeds its SE is about 0.3,');
out('so the venue effect is resolved only by the 200-pair swap batch in emergent_calibration.txt.');
