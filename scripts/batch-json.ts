// scripts/batch-json.ts
// One shard of a measured batch, written as JSON lines (one MatchMetrics per
// line) so several shards can run in parallel and be aggregated afterwards
// by scripts/batch-report.ts.
//
//   MODE=std   equal sides rated 60..80 (the standard calibration batch)
//   MODE=swap  paired venue swap: seed m plays X(home) v Y(away) and then
//              Y(home) v X(away), with X and Y of different ratings, so team
//              strength cancels and only the venue differs within a pair
//   MODE=str   strength check: an 80-rated side v a 60-rated side, venue
//              alternating by seed
//
//   MODE=std N=40 SHARD=0 SHARDS=8 OFF=confidence OUT=x.jsonl npx tsx scripts/batch-json.ts

import { appendFileSync, writeFileSync } from 'node:fs';
import { measure, team } from './lib/engineMetrics';
import type { EngineFlags } from '../src/features/match/logic/spatial/types';

const mode = process.env['MODE'] ?? 'std';
const n = Number(process.env['N'] ?? 40);
const shard = Number(process.env['SHARD'] ?? 0);
const shards = Number(process.env['SHARDS'] ?? 1);
const seedBase = Number(process.env['SEED_BASE'] ?? 1000);
const out = process.env['OUT'] ?? 'batch.jsonl';
const off = (process.env['OFF'] ?? '').split(',').filter(Boolean);
const flags: Partial<EngineFlags> = {};
for (const f of off) (flags as Record<string, boolean>)[f] = false;

writeFileSync(out, '');
for (let m = shard; m < n; m += shards) {
  const seed = seedBase + m;
  const rows: Record<string, unknown>[] = [];
  if (mode === 'std') {
    const base = 60 + (m % 21);
    rows.push({ ...measure(team('H', base), team('A', base), seed, flags), pair: m, strong: 'none' });
  } else if (mode === 'swap') {
    const bx = 60 + (m % 21);
    const by = 60 + ((m * 7 + 5) % 21);
    rows.push({ ...measure(team('X', bx), team('Y', by), seed, flags), pair: m, strong: bx >= by ? 'home' : 'away', bx, by });
    rows.push({ ...measure(team('Y', by), team('X', bx), seed, flags), pair: m, strong: by >= bx ? 'home' : 'away', bx: by, by: bx });
  } else {
    const strongHome = m % 2 === 0;
    const r = strongHome ? measure(team('S', 80), team('W', 60), seed, flags) : measure(team('W', 60), team('S', 80), seed, flags);
    rows.push({ ...r, pair: m, strong: strongHome ? 'home' : 'away' });
  }
  for (const r of rows) appendFileSync(out, JSON.stringify(r) + '\n');
}
