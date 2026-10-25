// scripts/calibrate-engine.ts
// Calibration report for the emergent match engine (docs/emergent-engine.md
// sections 6 and 7).  Runs a seeded batch of equal-strength matches (sides
// rated 60..80, seeds 1000+), reports every section-7 metric as mean +- one
// standard error against its real-football band, then a strength check
// (80-rated v 60-rated, home and away swapped half the time).
//
//   npx tsx scripts/calibrate-engine.ts            # 40 matches
//   MATCHES=12 npx tsx scripts/calibrate-engine.ts # quick iteration
//   OUT=report.txt npx tsx scripts/calibrate-engine.ts
//
// RESOLUTION LIMIT: with n matches a metric's standard error is printed next
// to it.  Differences smaller than about two standard errors are noise at this
// sample size, and a verdict of NEAR means the band is within that noise.

import { writeFileSync } from 'node:fs';
import {
  standardBatch, measure, team, TARGETS, evaluate, fmt, meanSe, type MatchMetrics,
} from './lib/engineMetrics';

const MATCHES = Number(process.env['MATCHES'] ?? 40);
const STRENGTH = Number(process.env['STRENGTH'] ?? 20);
const lines: string[] = [];
const out = (s = ''): void => { lines.push(s); console.log(s); };

const t0 = Date.now();
const batch = standardBatch(MATCHES);
out(`Emergent engine calibration: ${MATCHES} matches, equal sides rated 60..80, seeds 1000..${1000 + MATCHES - 1}`);
out(`Mean simulation time: ${fmt(meanSe(batch.map((m) => m.ms)).mean, 0)} ms per match (node, full 90 minutes + stoppage)`);
out('');
out(`${'metric'.padEnd(26)}${'value'.padStart(10)}${'+-SE'.padStart(9)}   band            verdict`);
out('-'.repeat(78));
let inBand = 0;
for (const t of TARGETS) {
  const e = evaluate(t, batch);
  if (e.verdict === 'IN') inBand++;
  out(`${t.name.padEnd(26)}${fmt(e.value, 3).padStart(10)}${fmt(e.se, 3).padStart(9)}   [${t.band[0]}, ${t.band[1]}]`.padEnd(66) + e.verdict);
}
out('-'.repeat(78));
out(`${inBand} of ${TARGETS.length} metrics inside their band.`);
out('');

// Distribution detail: the whole shape, not one headline.
const goalsHist = new Map<number, number>();
for (const m of batch) goalsHist.set(m.goals, (goalsHist.get(m.goals) ?? 0) + 1);
out('Goals per match histogram: ' + [...goalsHist.entries()].sort((a, b) => a[0] - b[0]).map(([g, c]) => `${g}:${c}`).join('  '));
const sum = (f: (m: MatchMetrics) => number) => batch.reduce((s, m) => s + f(m), 0);
out(`Woodwork per match: ${fmt(sum((m) => m.woodwork) / MATCHES)}   substitutions per match: ${fmt(sum((m) => m.subs) / MATCHES)}`);
out(`Ball in play: ${fmt(sum((m) => m.inPlayMin) / MATCHES, 1)} minutes per match (real football: about 55 to 60)`);
out(`Goal conversion (goals / shots): ${fmt(sum((m) => m.goals) / Math.max(1, sum((m) => m.shots)), 3)}`);
out('');

// Strength check: an 80-rated side against a 60-rated side.
let strongW = 0, draws = 0, weakW = 0, gd = 0;
for (let i = 0; i < STRENGTH; i++) {
  const strongHome = i % 2 === 0;
  const m = strongHome ? measure(team('S', 80), team('W', 60), 500 + i) : measure(team('W', 60), team('S', 80), 500 + i);
  const s = strongHome ? m.homeGoals : m.awayGoals;
  const w = strongHome ? m.awayGoals : m.homeGoals;
  gd += s - w;
  if (s > w) strongW++; else if (s === w) draws++; else weakW++;
}
out(`Strength check (80 v 60, ${STRENGTH} matches, venue alternating): strong wins ${strongW}, draws ${draws}, weak wins ${weakW}; mean goal difference ${fmt(gd / STRENGTH)}`);
out(`Target: the 80-rated side wins clearly but not always.`);
out('');
out(`Resolution limit: at n=${MATCHES} a per-match count has SE about sd/sqrt(n); a share near 0.3 has SE about ${fmt(Math.sqrt(0.3 * 0.7 / MATCHES), 3)}.`);
out('Differences under about 2 SE are noise; NEAR means the band lies within that noise.');
out(`Total wall time ${fmt((Date.now() - t0) / 1000, 1)} s.`);

if (process.env['OUT']) writeFileSync(process.env['OUT'], lines.join('\n') + '\n');
