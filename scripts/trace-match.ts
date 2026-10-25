// scripts/trace-match.ts
// Human-readable trace of one emergent match (docs/emergent-engine.md 6.1).
// Physics bugs look like plausible output: read traces, not just totals.
//
//   npx tsx scripts/trace-match.ts                    # key-event timeline, seed 1000, both sides 70
//   npx tsx scripts/trace-match.ts --seed 7 --base 75
//   npx tsx scripts/trace-match.ts --window 600-660   # every trace record in that window
//   npx tsx scripts/trace-match.ts --out file.txt
//
// Each key event is printed with the ball position and height at that moment
// and the numbers that decided it (shot distance, the shooter's estimate, the
// realised kick error; for a challenge, how far the foot was from ball and
// man; for a keeper, the incoming speed and how close the ball came).

import { writeFileSync } from 'node:fs';
import { simulateSpatialMatch } from '../src/features/match/logic/spatial/simulateSpatialMatch';
import type { SimEvent, TraceRecord } from '../src/features/match/logic/spatial/types';
import { team } from './lib/engineMetrics';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const seed = Number(arg('seed') ?? 1000);
const base = Number(arg('base') ?? 70);
const windowArg = arg('window');
const outPath = arg('out');

const records: TraceRecord[] = [];
const home = team('H', base);
const away = team('A', base);
const t0 = Date.now();
const r = simulateSpatialMatch(home, away, { seed, trace: (rec) => records.push(rec) });
const ms = Date.now() - t0;

const lines: string[] = [];
const out = (s = ''): void => { lines.push(s); console.log(s); };
const clock = (t: number): string => {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};
const kv = (d: Record<string, unknown>): string =>
  Object.entries(d).map(([k, v]) => `${k}=${typeof v === 'number' ? Math.round(v * 100) / 100 : String(v)}`).join(' ');

out(`Seed ${seed}, both sides rated ${base} (4-4-2, five-man bench). Final score ${r.finalScore[0]}-${r.finalScore[1]}. ${r.events.length} events, ${records.length} trace records, ${ms} ms.`);
out('');

if (windowArg) {
  const [a, b] = windowArg.split('-').map(Number);
  out(`All trace records between ${clock(a!)} and ${clock(b!)}:`);
  for (const rec of records) {
    if (rec.tSec < a! || rec.tSec > b!) continue;
    out(`${clock(rec.tSec)} ${rec.kind.padEnd(12)} ${(rec.playerId ?? '').padEnd(8)} ball(${rec.ball.x},${rec.ball.y},z${rec.ball.z}) ${kv(rec.data)}`);
  }
  out('');
  out('Events in the window:');
  for (const e of r.events) if (e.tSec >= a! && e.tSec <= b!) out(`${clock(e.tSec)} ${e.type} ${e.side ?? ''} ${e.playerId ?? ''} ${e.otherId ?? ''} ${e.card ?? ''}`);
} else {
  const KEY = new Set(['goal', 'shot', 'save', 'woodwork', 'foul', 'penalty', 'offside', 'out_corner', 'substitution']);
  // The deciding record for an event: the latest matching trace at or before it.
  const decidingKinds: Record<string, string[]> = {
    goal: ['shot'], shot: ['shot'], save: ['shot'], woodwork: ['shot'],
    foul: ['challenge'], penalty: ['challenge'], offside: ['pass'],
  };
  const find = (e: SimEvent): TraceRecord | undefined => {
    const kinds = decidingKinds[e.type];
    if (!kinds) return undefined;
    const who = e.type === 'save' ? e.otherId : e.playerId;
    for (let i = records.length - 1; i >= 0; i--) {
      const rec = records[i]!;
      if (rec.tSec > e.tSec + 0.05) continue;
      if (e.tSec - rec.tSec > 8) break;
      if (!kinds.includes(rec.kind)) continue;
      if (e.type === 'offside') { if (rec.data['target'] === e.playerId) return rec; continue; }
      if (!who || rec.playerId === who) return rec;
    }
    return undefined;
  };
  const keeperRec = (e: SimEvent): TraceRecord | undefined => records.find((rec) => rec.kind === 'keeper' && Math.abs(rec.tSec - e.tSec) < 0.15);
  out('Key-event timeline (clock, event, side, players; ball position and height; deciding numbers):');
  let score = [0, 0];
  for (const e of r.events) {
    if (!KEY.has(e.type)) continue;
    if (e.type === 'goal') score = e.side === 'home' ? [score[0]! + 1, score[1]!] : [score[0]!, score[1]! + 1];
    const d = find(e);
    const kr = e.type === 'save' ? keeperRec(e) : undefined;
    const who = [e.playerId, e.otherId].filter(Boolean).join(' v ');
    let line = `${clock(e.tSec)} ${e.type.toUpperCase().padEnd(13)} ${(e.side ?? '').padEnd(5)} ${who.padEnd(14)}`;
    if (e.card) line += ` [${e.card}]`;
    if (d) line += ` | at ${clock(d.tSec)} ball(${d.ball.x},${d.ball.y},z${d.ball.z}) ${kv(d.data)}`;
    if (kr) line += ` | keeper ${kv(kr.data)}`;
    if (e.type === 'goal') line += `  (score ${score[0]}-${score[1]})`;
    out(line);
  }
}

if (outPath) writeFileSync(outPath, lines.join('\n') + '\n');
