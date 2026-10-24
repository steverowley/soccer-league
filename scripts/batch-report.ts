// scripts/batch-report.ts
// Aggregates JSON-line shards from scripts/batch-json.ts into a report.
//   npx tsx scripts/batch-report.ts calibration <dir/prefix>   every section-7 metric, mean, SE, band, verdict
//   npx tsx scripts/batch-report.ts homeaway <dir/prefix>      venue split (home minus away goals)
//   npx tsx scripts/batch-report.ts strength <dir/prefix>      80 v 60 record from the strong side's view
//   npx tsx scripts/batch-report.ts brief <dir/prefix>         one line: the headline metrics

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { TARGETS, evaluate, meanSe, fmt, type MatchMetrics } from './lib/engineMetrics';

type Row = MatchMetrics & { pair: number; strong: string };

export function load(prefix: string): Row[] {
  const dir = dirname(prefix);
  const pre = basename(prefix);
  const rows: Row[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.startsWith(pre) || !f.endsWith('.jsonl')) continue;
    for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) if (line.trim()) rows.push(JSON.parse(line) as Row);
  }
  return rows.sort((a, b) => a.pair - b.pair || a.seed - b.seed);
}

export function calibration(rows: Row[]): string {
  const lines = [`matches ${rows.length}`, `${'metric'.padEnd(24)} ${'mean'.padStart(9)} ${'SE'.padStart(7)}  band            verdict`];
  for (const t of TARGETS) {
    const { value, se, verdict } = evaluate(t, rows);
    const d = value < 2 ? 3 : 2;
    lines.push(`${t.name.padEnd(24)} ${fmt(value, d).padStart(9)} ${fmt(se, d).padStart(7)}  ${`${t.band[0]}-${t.band[1]}`.padEnd(15)} ${verdict}`);
  }
  const ip = meanSe(rows.map((r) => r.inPlayMin));
  lines.push(`${'ball in play (min)'.padEnd(24)} ${fmt(ip.mean).padStart(9)} ${fmt(ip.se).padStart(7)}  55-60 (info)`);
  const ms = meanSe(rows.map((r) => r.ms));
  lines.push(`${'ms per match'.padEnd(24)} ${fmt(ms.mean, 0).padStart(9)}`);
  return lines.join('\n');
}

export function homeAway(rows: Row[]): string {
  const t = rows.length;
  const diff = rows.map((r) => r.homeGoals - r.awayGoals);
  const hg = rows.reduce((s, r) => s + r.homeGoals, 0);
  const ag = rows.reduce((s, r) => s + r.awayGoals, 0);
  const { mean, se } = meanSe(diff);
  // In a paired swap, the per-pair mean of (home minus away) cancels strength.
  const pairs = new Map<number, number[]>();
  for (const r of rows) (pairs.get(r.pair) ?? pairs.set(r.pair, []).get(r.pair)!).push(r.homeGoals - r.awayGoals);
  const pm = [...pairs.values()].filter((v) => v.length === 2).map((v) => (v[0]! + v[1]!) / 2);
  const ps = meanSe(pm);
  const hw = rows.filter((r) => r.homeGoals > r.awayGoals).length;
  const dr = rows.filter((r) => r.homeGoals === r.awayGoals).length;
  return [
    `matches ${t}: home goals ${hg}, away goals ${ag}`,
    `home minus away per match ${fmt(mean)} +- ${fmt(se)} (SE)` + (pm.length ? `; paired-swap estimate ${fmt(ps.mean)} +- ${fmt(ps.se)} over ${pm.length} pairs` : ''),
    `home win ${fmt(hw / t)}  draw ${fmt(dr / t)}  away win ${fmt((t - hw - dr) / t)}`,
  ].join('\n');
}

export function strength(rows: Row[]): string {
  let w = 0, d = 0, l = 0, gd = 0;
  for (const r of rows) {
    const s = r.strong === 'home' ? r.homeGoals - r.awayGoals : r.awayGoals - r.homeGoals;
    gd += s;
    if (s > 0) w++; else if (s === 0) d++; else l++;
  }
  const { se } = meanSe(rows.map((r) => (r.strong === 'home' ? r.homeGoals - r.awayGoals : r.awayGoals - r.homeGoals)));
  return `80 v 60 over ${rows.length}: ${w}W ${d}D ${l}L, strong side GD per match ${fmt(gd / rows.length)} +- ${fmt(se)}`;
}

export function brief(rows: Row[]): string {
  const keys = ['goals', 'shots', 'on target share', 'shots inside 11m share', 'saves', 'passes attempted', 'pass completion', 'tackles', 'interceptions', 'fouls', 'yellow cards', 'corners', 'throw-ins', 'offsides', 'penalties', 'home win share', 'draw share'];
  const short: Record<string, string> = { 'on target share': 'onT', 'shots inside 11m share': 'in11', 'passes attempted': 'pass', 'pass completion': 'cmp', 'yellow cards': 'yel', 'home win share': 'hw', 'draw share': 'dr', interceptions: 'int', 'throw-ins': 'thr' };
  return `n=${rows.length} ` + keys.map((k) => {
    const t = TARGETS.find((x) => x.name === k)!;
    const { value, verdict } = evaluate(t, rows);
    return `${short[k] ?? k}=${fmt(value, value < 2 ? 2 : 1)}${verdict === 'IN' ? '' : verdict.startsWith('NEAR') ? '~' : '!'}`;
  }).join(' ') + ` inPlay=${fmt(meanSe(rows.map((r) => r.inPlayMin)).mean, 1)}`;
}

if (process.argv[1]?.includes('batch-report')) {
  const [mode, prefix] = process.argv.slice(2);
  const rows = load(prefix!);
  const f = mode === 'calibration' ? calibration : mode === 'homeaway' ? homeAway : mode === 'strength' ? strength : brief;
  console.log(f(rows));
}
