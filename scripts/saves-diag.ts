// scripts/saves-diag.ts
// Why do on-target shots beat keepers, and why are there so few on-target
// shots to save?  One row per open-play shot, captured AT THE STRIKE from the
// live world: shooter, keeper (position, depth off his line, lateral offset
// from the ball-to-goal-centre line, lateral speed), the defenders in the
// shooting cone (ball to both posts) and goal-side of the ball, then what
// physically happened (blocked, off target, caught, parried, goal) and, for
// on-target balls, how far the keeper had to move and how long he had.
//
//   MODE=run N=60 SHARD=0 SHARDS=1 OUT=x.jsonl npx tsx scripts/saves-diag.ts
//   MODE=report PREFIX=dir/x npx tsx scripts/saves-diag.ts
//
// Fixture: the standard calibration batch (equal 4-4-2 sides rated 60..80,
// seeds 1000+), so the rows describe the matches the calibration reports.

import { appendFileSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { simulateSpatialMatch } from '../src/features/match/logic/spatial/simulateSpatialMatch';
import type { SimWorld, SimPlayer, TraceRecord } from '../src/features/match/logic/spatial/types';
import { team } from './lib/engineMetrics';
import { estimateShot, pressureAt, shotWindup } from '../src/features/match/logic/spatial/evaluate';
import { errorScale } from '../src/features/match/logic/spatial/execution';
import { shotAppetite } from '../src/features/match/logic/spatial/possession';

interface GoalRow { type: 'goal'; seed: number; kick: string; kickBy: boolean; ownGoal: boolean; sinceShot: number; clean: boolean }
interface DecRow { type: 'decide'; seed: number; dGoal: number; pressure: number; action: string; u: number; top: string; shotP: number; shotF: number; shotB: number; shotC: number; appetite: number; e: number }
const goalRows: GoalRow[] = [];
const decRows: DecRow[] = [];

const GOAL_HALF = 7.32 / 2;
const MID_Y = 68 / 2;

interface ShotRow {
  seed: number; t: number; restart: string; header: boolean; placed: boolean; role: string;
  dist: number; ang: number; pressure: number; est: number; pF: number; pB: number; pCl: number;
  onT: boolean; laneD: number; laneBlk: number; kAtStrike: number;
  kDepth: number; kOff: number; kVy: number; kSpeed: number; kGoalSide: number;
  cone: number; goalSide: number; nearest: number; speed: number; crossY: number;
  out: string; tOut: number; need: number; dive: number; diveDelay: number; closeD: number; missX: number; missY: number; missZ: number; errScale: number; angErr: number; aimY: number; aimZ: number; vz: number;
}

function run(): void {
  const n = Number(process.env['N'] ?? 40);
  const shard = Number(process.env['SHARD'] ?? 0);
  const shards = Number(process.env['SHARDS'] ?? 1);
  const out = process.env['OUT'] ?? 'saves-diag.jsonl';
  const seedBase = Number(process.env['SEED_BASE'] ?? 1000);
  writeFileSync(out, '');
  for (let m = shard; m < n; m += shards) {
    const seed = seedBase + m;
    const base = 60 + (m % 21);
    let world: SimWorld | null = null;
    let cur: (ShotRow & { t0: number; gx: number }) | null = null;
    const rows: ShotRow[] = [];
    const onTrace = (r: TraceRecord): void => {
      if (r.kind === 'goal') {
        goalRows.push({ type: 'goal', seed, kick: String(r.data['kick']), kickBy: r.data['kickBy'] === true, ownGoal: r.data['ownGoal'] === true,
          sinceShot: Number(r.data['sinceShot'] ?? NaN), clean: cur !== null && cur.out === '?' });
      }
      if (r.kind === 'decide' && world) {
        // The carrier's decision near goal: his best shot (judged with the
        // engine's own estimate, pure) against what he chose.
        const w = world;
        const c = [...w.home, ...w.away].find((p) => p.id === r.playerId);
        if (c) {
          const gx = c.side === 'home' ? 105 : 0;
          const dGoal = Math.hypot(gx - r.ball.x, MID_Y - r.ball.y);
          if (dGoal < 30) {
            const opp = (c.side === 'home' ? w.away : w.home).filter((o) => !o.sentOff);
            const keeper = opp.find((o) => o.role === 'GK');
            const pressure = pressureAt(w.ball.pos, opp);
            const e = errorScale(c, c.stats.shooting, w, { pressure, awkward: 0 });
            const power = 21 + 10 * (c.stats.shooting / 100);
            let best = 0, bestF = 0, bestB = 0, bestC = 0;
            for (const gy of [MID_Y - GOAL_HALF + 0.45, MID_Y - GOAL_HALF + 1.7, MID_Y + GOAL_HALF - 1.7, MID_Y + GOAL_HALF - 0.45]) {
              for (const gz of [0.25, 1.75]) {
                const est = estimateShot(w.ball.pos, c.side, gy, gz, gz < 1 ? power * 0.94 : power, e, keeper, opp, shotWindup(c));
                if (est.p > best) { best = est.p; bestF = est.pFrame; bestB = est.pBeat; bestC = est.pClear; }
              }
            }
            decRows.push({ type: 'decide', seed, dGoal, pressure, action: String(r.data['action']), u: Number(r.data['u']), top: String(r.data['top']),
              shotP: best, shotF: bestF, shotB: bestB, shotC: bestC, appetite: shotAppetite(c, w), e });
          }
        }
      }
      if (r.kind === 'shot') {
        cur = null;
        if (!world) return;
        const w = world;
        const shooter = [...w.home, ...w.away].find((p) => p.id === r.playerId);
        if (!shooter) return;
        const defSide = shooter.side === 'home' ? w.away : w.home;
        const gx = shooter.side === 'home' ? 105 : 0;
        const k = defSide.find((p) => p.role === 'GK' && !p.sentOff) as SimPlayer | undefined;
        const bx = r.ball.x, by = r.ball.y;
        const d = Number(r.data['dist']);
        const ang = Math.abs(Math.atan2(by - MID_Y, Math.abs(gx - bx))) * 180 / Math.PI;
        // Keeper: depth off his line, lateral distance from the ball-to-goal-centre line.
        let kDepth = NaN, kOff = NaN, kVy = NaN, kSpeed = NaN, kGoalSide = 0;
        if (k) {
          kDepth = Math.abs(k.pos.x - gx);
          const ux = gx - bx, uy = MID_Y - by;
          const L = Math.hypot(ux, uy);
          kOff = Math.abs((k.pos.x - bx) * uy - (k.pos.y - by) * ux) / L;
          kVy = k.vel.y;
          kSpeed = Math.hypot(k.vel.x, k.vel.y);
          kGoalSide = Math.abs(k.pos.x - gx) < Math.abs(bx - gx) ? 1 : 0;
        }
        // Outfield defenders in the triangle ball / near post / far post, and goal-side within 3 m of the lane.
        let cone = 0, goalSide = 0, nearest = 99;
        for (const o of defSide) {
          if (o.sentOff || o.role === 'GK') continue;
          nearest = Math.min(nearest, Math.hypot(o.pos.x - bx, o.pos.y - by));
          if (inTriangle(o.pos.x, o.pos.y, bx, by, gx, MID_Y - GOAL_HALF, gx, MID_Y + GOAL_HALF)) cone++;
          if (Math.abs(o.pos.x - gx) < Math.abs(bx - gx)) goalSide++;
        }
        const vx = w.ball.vel.x, vy = w.ball.vel.y;
        const crossY = Math.abs(vx) > 1e-6 ? by + vy * ((gx - bx) / vx) : by;
        cur = {
          seed, t: r.tSec, restart: String(r.data['restart'] ?? 'open'), header: r.data['header'] === true, placed: r.data['placed'] === true, role: shooter.role,
          dist: d, ang, pressure: Number(r.data['pressure'] ?? 0), est: Number(r.data['est']),
          pF: Number(r.data['pF']), pB: Number(r.data['pB']), pCl: Number(r.data['pCl']),
          onT: r.data['onTarget'] === true, laneD: Number(r.data['laneD'] ?? 99), laneBlk: Number(r.data['laneBlk'] ?? 0),
          kAtStrike: Number(r.data['kAtStrike'] ?? NaN),
          kDepth, kOff, kVy, kSpeed, kGoalSide, cone, goalSide, nearest, speed: Math.hypot(vx, vy), crossY,
          out: '?', tOut: NaN, need: k ? Math.abs(crossY - k.pos.y) : NaN, dive: 0, diveDelay: NaN, closeD: NaN, missX: NaN, missY: NaN, missZ: NaN, errScale: Number(r.data['errScale'] ?? NaN), angErr: Number(r.data['angErr'] ?? NaN), aimY: Number(r.data['aimY'] ?? NaN), aimZ: Number(r.data['aimZ'] ?? NaN), vz: w.ball.vz,
          t0: r.tSec, gx,
        };
        rows.push(cur);
        return;
      }
      // resolveShot traces shot_end BEFORE the block / keeper record of the
      // same touch, so a 'miss' stamped this tick is re-labelled by them.
      if (cur && cur.out === 'miss' && r.tSec - cur.t0 === cur.tOut) {
        if (r.kind === 'block') { cur.out = 'block'; return; }
        if (r.kind === 'keeper') { cur.out = 'kOffT'; return; }
      }
      if (!cur || cur.out !== '?') return;
      if (r.kind === 'dive' && !cur.dive) { cur.dive = 1; cur.diveDelay = r.tSec - cur.t0; return; }
      if (r.kind === 'block' && r.tSec - cur.t0 < 1.5) { cur.out = 'block'; cur.tOut = r.tSec - cur.t0; return; }
      if (r.kind === 'keeper') { cur.out = String(r.data['action']); cur.tOut = r.tSec - cur.t0; cur.closeD = Number(r.data['closeD']); return; }
      if (r.kind === 'goal') { cur.out = 'goal'; cur.tOut = r.tSec - cur.t0; return; }
      if (r.kind === 'shot_end') {
        const o = String(r.data['outcome']);
        if (o !== 'save') { cur.out = o === 'shot' ? 'miss' : o; cur.tOut = r.tSec - cur.t0; cur.missZ = r.ball.z; cur.missY = r.ball.y; cur.missX = r.ball.x; }
      }
    };
    simulateSpatialMatch(team('H', base), team('A', base), {
      seed, matchSeconds: 90 * 60, frameEverySec: 60,
      onTick: (w) => { world = w as SimWorld; },
      trace: onTrace,
    });
    for (const r of rows) {
      const { t0: _a, gx: _b, ...rest } = r as ShotRow & { t0?: number; gx?: number };
      appendFileSync(out, JSON.stringify(rest) + '\n');
    }
    for (const g of goalRows.splice(0)) appendFileSync(out, JSON.stringify(g) + '\n');
    for (const d of decRows.splice(0)) appendFileSync(out, JSON.stringify(d) + '\n');
  }
}

function tallyBy(xs: string[]): Record<string, number> {
  const t: Record<string, number> = {};
  for (const x of xs) t[x] = (t[x] ?? 0) + 1;
  return t;
}

function inTriangle(px: number, py: number, ax: number, ay: number, bx: number, by: number, cx: number, cy: number): boolean {
  const s1 = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  const s2 = (cx - bx) * (py - by) - (cy - by) * (px - bx);
  const s3 = (ax - cx) * (py - cy) - (ay - cy) * (px - cx);
  return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
}

function report(): void {
  const prefix = process.env['PREFIX']!;
  const dir = dirname(prefix), pre = basename(prefix);
  const rows: ShotRow[] = [];
  const goals: GoalRow[] = [];
  const decs: DecRow[] = [];
  const seeds = new Set<number>();
  for (const f of readdirSync(dir)) {
    if (!f.startsWith(pre) || !f.endsWith('.jsonl')) continue;
    for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const r = JSON.parse(line) as ShotRow & { type?: string };
      seeds.add(r.seed);
      if (r.type === 'goal') goals.push(r as unknown as GoalRow);
      else if (r.type === 'decide') decs.push(r as unknown as DecRow);
      else rows.push(r);
    }
  }
  const M = Number(process.env['MATCHES'] ?? seeds.size);
  const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const pct = (a: number, b: number): string => (100 * a / Math.max(1, b)).toFixed(0).padStart(3) + '%';
  if (goals.length) {
    const t: Record<string, number> = {};
    for (const g of goals) { const k = `${g.kick}${g.kickBy ? '' : '(def)'}${g.ownGoal ? ' OG' : ''}${g.clean ? ' clean' : ''}`; t[k] = (t[k] ?? 0) + 1; }
    console.log(`goals ${goals.length} (${(goals.length / M).toFixed(2)}/m) by last kick:`, JSON.stringify(Object.entries(t).sort((a, b) => b[1] - a[1])));
  }
  if (decs.length) {
    console.log('\ndecisions within 30 m of goal (open play): band, decisions/m, shot chosen %, mean best-shot est, pressure, share of decisions with best est > 0.08 and how often those shot');
    const db: Array<[string, (d: DecRow) => boolean]> = [['<11', (d) => d.dGoal < 11], ['11-18', (d) => d.dGoal >= 11 && d.dGoal < 18], ['18-25', (d) => d.dGoal >= 18 && d.dGoal < 25], ['25-30', (d) => d.dGoal >= 25]];
    for (const [name, f] of db) {
      const b = decs.filter(f);
      for (const [pn, pf] of [['press<0.3', (d: DecRow) => d.pressure < 0.3], ['press>=0.3', (d: DecRow) => d.pressure >= 0.3]] as const) {
        const c = b.filter(pf);
        if (!c.length) continue;
        const shot = c.filter((d) => d.action === 'shoot');
        const good = c.filter((d) => d.shotP > 0.08);
        console.log(`${name.padEnd(6)} ${pn.padEnd(10)} ${(c.length / M).toFixed(1).padStart(5)}/m shoot ${pct(shot.length, c.length)} est ${mean(c.map((d) => d.shotP)).toFixed(3)} (F ${mean(c.map((d) => d.shotF)).toFixed(2)} B ${mean(c.map((d) => d.shotB)).toFixed(2)} C ${mean(c.map((d) => d.shotC)).toFixed(2)}) shotU ${mean(c.map((d) => d.shotP * d.appetite * 1000)).toFixed(1)} chosenU ${mean(c.map((d) => d.u)).toFixed(1)} | est>0.08 ${(good.length / M).toFixed(2)}/m shoot ${pct(good.filter((d) => d.action === 'shoot').length, good.length)}; acts ${JSON.stringify(tallyBy(c.map((d) => d.action)))}`);
      }
    }
  }
  console.log(`matches ${M}, shot records ${rows.length} (${(rows.length / M).toFixed(1)}/match)`);
  const tally = (rs: ShotRow[]): Record<string, number> => { const t: Record<string, number> = {}; for (const r of rs) t[r.out] = (t[r.out] ?? 0) + 1; return t; };
  console.log('outcomes', JSON.stringify(tally(rows)));
  const bands: Array<[string, (r: ShotRow) => boolean]> = [['<11', (r) => r.dist < 11], ['11-18', (r) => r.dist >= 11 && r.dist < 18], ['18-25', (r) => r.dist >= 18 && r.dist < 25], ['25+', (r) => r.dist >= 25]];
  console.log('band   n/m  est   block  offT  onT(of unblocked)  conv(goal/onT)  saved  kDepth kOff  cone goalSide pressure');
  for (const [name, f] of bands) {
    const b = rows.filter(f);
    if (!b.length) continue;
    const blk = b.filter((r) => r.out === 'block');
    const unb = b.filter((r) => r.out !== 'block');
    const onT = unb.filter((r) => r.out === 'goal' || r.out === 'catch' || r.out === 'parry');
    const goals = onT.filter((r) => r.out === 'goal');
    console.log(`${name.padEnd(6)} ${(b.length / M).toFixed(1).padStart(4)} ${mean(b.map((r) => r.est)).toFixed(3)} ${pct(blk.length, b.length)}  ${pct(unb.length - onT.length, unb.length)}  ${pct(onT.length, unb.length)}            ${pct(goals.length, onT.length)} (${(goals.length / M).toFixed(2)}/m)  ${(( onT.length - goals.length) / M).toFixed(2)}/m  ${mean(b.map((r) => r.kDepth)).toFixed(1)}  ${mean(b.map((r) => r.kOff)).toFixed(2)}  ${mean(b.map((r) => r.cone)).toFixed(2)}  ${mean(b.map((r) => r.goalSide)).toFixed(1)}  ${mean(b.map((r) => r.pressure)).toFixed(2)}`);
  }
  // On-target balls: goals v saves by how far the keeper had to go and how long he had.
  const onT = rows.filter((r) => r.out === 'goal' || r.out === 'catch' || r.out === 'parry');
  console.log(`\non target ${onT.length} (${(onT.length / M).toFixed(2)}/m): goals ${onT.filter((r) => r.out === 'goal').length}, catches ${onT.filter((r) => r.out === 'catch').length}, parries ${onT.filter((r) => r.out === 'parry').length}`);
  const g = onT.filter((r) => r.out === 'goal'), s = onT.filter((r) => r.out !== 'goal');
  const row = (label: string, rs: ShotRow[]): void => console.log(`${label.padEnd(8)} n ${String(rs.length).padStart(4)} dist ${mean(rs.map((r) => r.dist)).toFixed(1)} ang ${mean(rs.map((r) => r.ang)).toFixed(0)} speed ${mean(rs.map((r) => r.speed)).toFixed(1)} need ${mean(rs.map((r) => r.need)).toFixed(2)} kDepth ${mean(rs.map((r) => r.kDepth)).toFixed(1)} kOff ${mean(rs.map((r) => r.kOff)).toFixed(2)} kSpeed ${mean(rs.map((r) => r.kSpeed)).toFixed(2)} dive ${pct(rs.filter((r) => r.dive).length, rs.length)} diveDelay ${mean(rs.filter((r) => r.dive).map((r) => r.diveDelay)).toFixed(2)} tOut ${mean(rs.map((r) => r.tOut)).toFixed(2)} cone ${mean(rs.map((r) => r.cone)).toFixed(2)} goalSide ${mean(rs.map((r) => r.goalSide)).toFixed(1)} nearest ${mean(rs.map((r) => r.nearest)).toFixed(1)} pB ${mean(rs.map((r) => r.pB)).toFixed(2)} kAt ${mean(rs.map((r) => r.kAtStrike).filter((x) => !Number.isNaN(x))).toFixed(2)}`);
  row('goals', g); row('saves', s);
  // Situation: one-v-one (no outfielder in the cone and none within 3 m) versus covered.
  const sit: Array<[string, (r: ShotRow) => boolean]> = [
    ['clear 1v1 (cone 0, nearest>3)', (r) => r.cone === 0 && r.nearest > 3],
    ['cone 0, pressed', (r) => r.cone === 0 && r.nearest <= 3],
    ['cone 1', (r) => r.cone === 1],
    ['cone 2+', (r) => r.cone >= 2],
  ];
  console.log('\nsituation                          n/m  dist  block  onT/unbl  conv  goals/m  saves/m');
  for (const [name, f] of sit) {
    const b = rows.filter(f);
    const unb = b.filter((r) => r.out !== 'block');
    const ot = unb.filter((r) => r.out === 'goal' || r.out === 'catch' || r.out === 'parry');
    const gg = ot.filter((r) => r.out === 'goal');
    console.log(`${name.padEnd(34)} ${(b.length / M).toFixed(1).padStart(4)} ${mean(b.map((r) => r.dist)).toFixed(1).padStart(5)} ${pct(b.length - unb.length, b.length)}  ${pct(ot.length, unb.length)}     ${pct(gg.length, ot.length)}  ${(gg.length / M).toFixed(2)}  ${((ot.length - gg.length) / M).toFixed(2)}`);
  }
  // Off-target and blocked: were they heading on target at the strike?
  const isOn = (r: ShotRow): boolean => r.out === 'goal' || r.out === 'catch' || r.out === 'parry';
  console.log('\nstrike heading on target (onT at strike) v what happened, by band:');
  for (const [name, f] of bands) {
    const b = rows.filter(f);
    const strikeOn = b.filter((r) => r.onT);
    const blkOn = strikeOn.filter((r) => r.out === 'block').length;
    const missOn = strikeOn.filter((r) => r.out === 'miss' || r.out === 'woodwork').length;
    const kOffT = b.filter((r) => r.out === 'kOffT').length;
    console.log(`${name.padEnd(6)} strike on target ${pct(strikeOn.length, b.length)} of shots; of those blocked ${pct(blkOn, strikeOn.length)}, still missed ${pct(missOn, strikeOn.length)}, reached keeper/goal ${pct(strikeOn.filter(isOn).length, strikeOn.length)}; keeper touched off-target ${kOffT}`);
  }
  const misses = rows.filter((r) => r.out === 'miss' && !r.onT);
  const over = misses.filter((r) => r.missZ > 2.2).length;
  console.log(`off-target misses ${misses.length}: over the bar ${pct(over, misses.length)}, wide ${pct(misses.length - over, misses.length)}; mean |y-34| at exit ${mean(misses.map((r) => Math.abs(r.missY - MID_Y))).toFixed(1)}`);
  const blocks = rows.filter((r) => r.out === 'block');
  console.log(`blocks ${blocks.length} (${(blocks.length / M).toFixed(2)}/m): laneBlk(leg thrown) ${pct(blocks.filter((r) => r.laneBlk).length, blocks.length)}, mean laneD ${mean(blocks.map((r) => r.laneD)).toFixed(2)}, mean dist ${mean(blocks.map((r) => r.dist)).toFixed(1)}, est ${mean(blocks.map((r) => r.est)).toFixed(3)} pCl ${mean(blocks.map((r) => r.pCl)).toFixed(2)}, pressure ${mean(blocks.map((r) => r.pressure)).toFixed(2)}`);
  const unb = rows.filter((r) => r.out !== 'block');
  console.log(`unblocked: est ${mean(unb.map((r) => r.est)).toFixed(3)} pCl ${mean(unb.map((r) => r.pCl)).toFixed(2)}; est calibration: est sum ${rows.reduce((s, r) => s + r.est, 0).toFixed(0)} v goals ${rows.filter((r) => r.out === 'goal').length}`);
  console.log('\nfoot v header (open play), by band: n/m, est, pF (est frame), strike onT, goal, errScale, |angErr| deg, pressure, |aimY-34|, aimZ');
  for (const hdr of [false, true]) for (const [name, f] of bands) {
    const b = rows.filter((r) => f(r) && r.header === hdr && r.restart === 'open');
    if (!b.length) continue;
    console.log(`${hdr ? 'head' : 'foot'} ${name.padEnd(6)} ${(b.length / M).toFixed(2)} est ${mean(b.map((r) => r.est)).toFixed(3)} pF ${mean(b.map((r) => r.pF)).toFixed(2)} strikeOn ${pct(b.filter((r) => r.onT).length, b.length)} block ${pct(b.filter((r) => r.out === 'block').length, b.length)} goal ${pct(b.filter((r) => r.out === 'goal').length, b.length)} e ${mean(b.map((r) => r.errScale)).toFixed(2)} angErr ${mean(b.map((r) => Math.abs(r.angErr) * 57.3)).toFixed(1)} pr ${mean(b.map((r) => r.pressure)).toFixed(2)} aimOff ${mean(b.map((r) => Math.abs(r.aimY - MID_Y))).toFixed(2)} aimZ ${mean(b.map((r) => r.aimZ)).toFixed(2)} vz ${mean(b.map((r) => r.vz)).toFixed(1)}`);
  }
  // Where saves come from: foot shots and headers apart, by band, with how
  // unblocked balls end (on target, over the bar, wide) and the shooter's
  // estimate against the outcome, component by component (lane clear v
  // not blocked, frame v struck on target, keeper beaten v goals per
  // on-target ball).  An estimate far above the outcome means shooters
  // judge chances better than the physics plays them.
  console.log('\nby kind and band (open play): n/m, blocked, unblocked onT / miss (share over the bar), saves/m goals/m | est v outcome: pCl v clear, pF v strikeOn, pB v beat, est v goal');
  for (const hdr of [false, true]) for (const [name, f] of bands) {
    const b = rows.filter((r) => f(r) && r.header === hdr && r.restart === 'open');
    if (!b.length) continue;
    const unb = b.filter((r) => r.out !== 'block');
    const on = unb.filter(isOn);
    const gl = on.filter((r) => r.out === 'goal');
    const miss = unb.filter((r) => r.out === 'miss' || r.out === 'woodwork' || r.out === 'kOffT');
    const over = miss.filter((r) => r.missZ > 2.2).length;
    console.log(`${hdr ? 'head' : 'foot'} ${name.padEnd(6)} ${(b.length / M).toFixed(2)}/m block ${pct(b.length - unb.length, b.length)} | onT ${pct(on.length, unb.length)} miss ${pct(miss.length, unb.length)} (over ${pct(over, miss.length)}) | saves ${((on.length - gl.length) / M).toFixed(2)} goals ${(gl.length / M).toFixed(2)} | pCl ${mean(b.map((r) => r.pCl)).toFixed(2)} v ${(unb.length / b.length).toFixed(2)}, pF ${mean(b.map((r) => r.pF)).toFixed(2)} v ${(b.filter((r) => r.onT).length / b.length).toFixed(2)}, pB ${mean(on.map((r) => r.pB)).toFixed(2)} v ${(gl.length / Math.max(1, on.length)).toFixed(2)}, est ${mean(b.map((r) => r.est)).toFixed(3)} v ${(gl.length / b.length).toFixed(3)}`);
  }
  // Driven against placed (side-foot) foot shots in open play, by band.
  console.log('\nfoot shots, drive v placed (open play): n/m, blocked, unblocked on target, goal per shot, saves/m');
  for (const [name, f] of bands) for (const pl of [false, true]) {
    const b = rows.filter((r) => f(r) && !r.header && r.restart === 'open' && r.placed === pl);
    if (!b.length) continue;
    const unb = b.filter((r) => r.out !== 'block');
    const on = unb.filter(isOn);
    const gl = on.filter((r) => r.out === 'goal');
    console.log(`${name.padEnd(6)} ${pl ? 'placed' : 'drive '} ${(b.length / M).toFixed(2)}/m block ${pct(b.length - unb.length, b.length)} onT ${pct(on.length, unb.length)} goal ${pct(gl.length, b.length)} saves ${((on.length - gl.length) / M).toFixed(2)}/m`);
  }
  const sp = rows.filter((r) => r.restart !== 'open');
  console.log(`set-piece shots ${(sp.length / M).toFixed(2)}/m ${JSON.stringify(tallyBy(sp.map((r) => r.restart)))}`);
  // Keeper depth histogram for on-target shots by distance.
  console.log('\nkeeper depth off line at strike (on-target, open play), by shot distance: mean [p25 p50 p75]');
  for (const [name, f] of bands) {
    const b = onT.filter(f).map((r) => r.kDepth).sort((a, c) => a - c);
    if (!b.length) continue;
    const q = (p: number): string => b[Math.floor(p * (b.length - 1))]!.toFixed(1);
    console.log(`${name.padEnd(6)} ${mean(b).toFixed(1)} [${q(0.25)} ${q(0.5)} ${q(0.75)}]  goal share ${pct(onT.filter(f).filter((r) => r.out === 'goal').length, b.length)}`);
  }
}

if ((process.env['MODE'] ?? 'run') === 'run') run(); else report();
