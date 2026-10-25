// ── scripts/cpu-profile-summary.mjs ─────────────────────────────────────────
// Summarise a V8 .cpuprofile (node --cpu-prof) as self and inclusive time per
// function, so engine hotspots can be compared before and after a change.
//
// Usage:
//   NODE_OPTIONS="--cpu-prof --cpu-prof-dir=<dir>" npx tsx scripts/bench-engine.ts
//   node scripts/cpu-profile-summary.mjs <dir-or-file> [topN]
// With a directory, the largest profile in it is used (tsx spawns helpers).

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

const arg = process.argv[2];
const topN = Number(process.argv[3] ?? 25);
let file = arg;
if (statSync(arg).isDirectory()) {
  const files = readdirSync(arg).filter((f) => f.endsWith('.cpuprofile'))
    .map((f) => join(arg, f)).sort((a, b) => statSync(b).size - statSync(a).size);
  file = files[0];
}
const prof = JSON.parse(readFileSync(file, 'utf8'));
const byId = new Map(prof.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of prof.nodes) for (const c of n.children ?? []) parent.set(c, n.id);

// Sample counts per node id, weighted by the time delta to the next sample.
const selfUs = new Map();
for (let i = 0; i < prof.samples.length; i++) {
  const dt = prof.timeDeltas[i + 1] ?? 0;
  selfUs.set(prof.samples[i], (selfUs.get(prof.samples[i]) ?? 0) + dt);
}
const total = [...selfUs.values()].reduce((a, b) => a + b, 0);
const key = (n) => `${n.callFrame.functionName || '(anon)'} ${basename(n.callFrame.url || '')}:${n.callFrame.lineNumber + 1}`;

const self = new Map();
const incl = new Map();
for (const [id, us] of selfUs) {
  const n = byId.get(id);
  self.set(key(n), (self.get(key(n)) ?? 0) + us);
  // Inclusive: credit each distinct function once per sample stack.
  const seen = new Set();
  for (let cur = id; cur !== undefined; cur = parent.get(cur)) {
    const k = key(byId.get(cur));
    if (seen.has(k)) continue;
    seen.add(k);
    incl.set(k, (incl.get(k) ?? 0) + us);
  }
}
const show = (title, m) => {
  console.log(`\n${title} (total ${(total / 1000).toFixed(0)} ms)`);
  [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN)
    .forEach(([k, us]) => console.log(`${((100 * us) / total).toFixed(1).padStart(5)}%  ${(us / 1000).toFixed(0).padStart(6)} ms  ${k}`));
};
console.log(`profile: ${file}`);
show('SELF', self);
show('INCLUSIVE', incl);
