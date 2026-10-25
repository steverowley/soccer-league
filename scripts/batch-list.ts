// scripts/batch-list.ts
// One line per match of the standard calibration batch: quick outlier hunt.
//   MATCHES=10 npx tsx scripts/batch-list.ts
//   MATCHES=10 FLAGS=confidence=false,momentum=false npx tsx scripts/batch-list.ts

import { standardBatch } from './lib/engineMetrics';
import type { EngineFlags } from '../src/features/match/logic/spatial/types';

const n = Number(process.env['MATCHES'] ?? 10);
const flags: Partial<EngineFlags> = {};
for (const kv of (process.env['FLAGS'] ?? '').split(',').filter(Boolean)) {
  const [k, v] = kv.split('=');
  (flags as Record<string, boolean>)[k!] = v === 'true';
}
let h = 0;
let a = 0;
for (const m of standardBatch(n, flags)) {
  h += m.homeGoals;
  a += m.awayGoals;
  console.log(`seed ${m.seed} base ${60 + ((m.seed - 1000) % 21)}: ${m.homeGoals}-${m.awayGoals} shots ${m.shots} onT ${m.onTarget} saves ${m.saves} passes ${m.passes} tackles ${m.tackles} int ${m.interceptions} fouls ${m.fouls} corners ${m.corners} throws ${m.throws} inPlay ${m.inPlayMin.toFixed(1)} ${m.ms.toFixed(0)}ms`);
}
console.log(`home goals ${h}, away goals ${a}`);
