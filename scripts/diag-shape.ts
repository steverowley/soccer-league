// scripts/diag-shape.ts
// Diagnostic for the pass / tackle / interception / corner / offside budget:
// where passes go (length, kind), where tackles come from (lunge or steal),
// what happens after a parry or a block, and how often runners are flagged.
//   npx tsx scripts/diag-shape.ts --seeds 1000,1001,1002 --base 70

import { simulateSpatialMatch } from '../src/features/match/logic/spatial/simulateSpatialMatch';
import type { TraceRecord } from '../src/features/match/logic/spatial/types';
import { team } from './lib/engineMetrics';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const seedArg = arg('seeds') ?? '1000-1007';
const seeds = seedArg.includes('-')
  ? (() => { const [a, b] = seedArg.split('-').map(Number); const s: number[] = []; for (let x = a!; x <= b!; x++) s.push(x); return s; })()
  : seedArg.split(',').map(Number);
const base = Number(arg('base') ?? 70);
const c = new Map<string, number>();
const add = (k: string, v = 1): void => { c.set(k, (c.get(k) ?? 0) + v); };

for (const seed of seeds) {
  const recs: TraceRecord[] = [];
  const r = simulateSpatialMatch(team('H', base), team('A', base), { seed, trace: (x: TraceRecord) => { recs.push(x); } });
  for (const e of r.events) add('ev.' + e.type);
  // Shape, sampled from the stored frames while someone has the ball.
  for (const f of r.frames ?? []) {
    if (!f.ball.ownerId) continue;
    const owner = f.players.find((p) => p.id === f.ball.ownerId);
    if (!owner) continue;
    const sideOf = (id: string): string => id.split('-')[0] ?? '';
    const atk = f.players.filter((p) => sideOf(p.id) === sideOf(owner.id) && !/-0$/.test(p.id) && p.x >= 0);
    const def = f.players.filter((p) => sideOf(p.id) !== sideOf(owner.id) && p.x >= 0);
    const span = (ps: typeof atk, k: 'x' | 'y'): number => Math.max(...ps.map((p) => p[k])) - Math.min(...ps.map((p) => p[k]));
    const near = (ps: typeof atk, r0: number): number => ps.filter((p) => p.id !== owner.id && Math.hypot(p.x - owner.x, p.y - owner.y) < r0).length;
    add('shape.n');
    add('shape.atkDepth', span(atk, 'x'));
    add('shape.atkWidth', span(atk, 'y'));
    add('shape.defDepth', span(def.filter((p) => !/-0$/.test(p.id)), 'x'));
    add('shape.defWidth', span(def, 'y'));
    add('shape.atkWithin10', near(atk, 10));
    add('shape.defWithin10', near(def, 10));
    add('shape.defWithin5', near(def, 5));
  }
  for (let i = 0; i < recs.length; i++) {
    const x = recs[i]!;
    const d = x.data;
    if (x.kind === 'pass' && d['restart'] === 'open') {
      const dd = Number(d['dist']);
      const bin = dd < 10 ? '<10' : dd < 20 ? '10-20' : dd < 30 ? '20-30' : dd < 45 ? '30-45' : '45+';
      add('pass.len.' + bin);
      add('pass.kind.' + String(d['kind']));
      if (d['offside']) add('pass.offsideFlagged');
    }
    if (x.kind === 'pass_end') {
      add('passEnd.' + String(d['outcome']));
      for (let j = i - 1; j >= 0 && x.tSec - recs[j]!.tSec < 6; j--) {
        const y = recs[j]!;
        if (y.kind === 'pass' && y.playerId === x.playerId) {
          const dd = Number(y.data['dist']);
          add('passEndLen.' + String(d['outcome']) + (dd < 10 ? '.<10' : dd < 20 ? '.10-20' : '.20+'));
          break;
        }
      }
    }
    if (x.kind === 'control' && typeof d['pressure'] === 'number') add('control.pressure', Number(d['pressure']));
    if (x.kind === 'control') add('control.n');
    if (x.kind === 'challenge') add('challenge.' + String(d['outcome']));
    if (x.kind === 'steal') add('steal');
    if (x.kind === 'lunge') add('lunge');
    if (x.kind === 'decide') add('decide.' + String(d['action']));
    if (x.kind === 'clear') add('clear');
    if (x.kind === 'keeper' || x.kind === 'block') {
      const tag = x.kind === 'keeper' ? 'keeper.' + String(d['action']) : 'block';
      add(tag);
      // What became of the ball: the next restart / control within 4 s.
      let fate = 'play';
      for (let j = i + 1; j < recs.length && recs[j]!.tSec - x.tSec < 4; j++) {
        const y = recs[j]!;
        if (y.kind === 'goal') { fate = 'goal'; break; }
        if (y.kind === 'restart') { fate = String(y.data['kind']); break; }
        if (y.kind === 'control') { fate = y.side === x.side ? 'ours' : 'theirs'; break; }
      }
      add(tag + '->' + fate);
    }
    if (x.kind === 'header') add('header.' + (d['toMate'] ? 'mate' : 'away'));
  }
}
const n = seeds.length;
for (const [k, v] of [...c.entries()].sort()) console.log(`${k.padEnd(36)} ${(v / n).toFixed(2)}`);
