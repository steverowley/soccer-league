// scripts/phase-metrics.ts
// Shape per phase of play, measured from replay frames (docs/phases-of-play.md
// section 4).  The classifier here is an OBSERVER, independent of the engine's
// own phase machine, so the same numbers can be taken from an engine that has
// no phases at all (the honest before/after):
//
//   in possession   ip_transition (first 6 s after a regain), build_up (the
//                   ball not yet past the opponent's first line), progression,
//                   final_third (ball within 35 m of the opponent's goal)
//   out of it       op_transition (first 6 s after a loss), then the block by
//                   outfield centroid from own goal (Bauer, Anzer and Shaw):
//                   high > 60 m, mid 20 to 60 m, low < 20 m
//
// Per side and class: centroid distance from own goal, team length and width
// (outfield extent), back-line height (second-deepest outfielder from own
// goal), outfielders behind the ball, time share and mean spell duration.
// When the engine reports a `phases` timeline its shares are tallied too.
//
//   MODE=std N=24 SHARD=0 SHARDS=1 OUT=x.jsonl npx tsx scripts/phase-metrics.ts
//   MODE=isl PAIRS=ceres-miners:jupiter-titans N=4 OUT=x.jsonl npx tsx scripts/phase-metrics.ts
//   MODE=cp N=24 OUT=x.jsonl npx tsx scripts/phase-metrics.ts  counter-press v recover
//   REPORT=<prefix> npx tsx scripts/phase-metrics.ts        aggregate shards
//
// Counter-press metric (per plan type, the side's manager's onLoss): every
// open-play loss (the engine's defensive_transition entry) with play still
// live 1.5 s later; the loser's outfielders within 10 m of the ball then, and
// whether the loser regained the ball in open play within 6 s.

import { appendFileSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { simulateSpatialMatch, type SpatialTeamInput } from '../src/features/match/logic/spatial/simulateSpatialMatch';
import type { EngineFlags, PositionFrame, TeamSide } from '../src/features/match/logic/spatial/types';
import { team } from './lib/engineMetrics';
import { STYLE_PRESETS, NEUTRAL_GAME_MODEL, presetFor, type GameModel } from '../src/features/match/logic/spatial/gameModel';
import { islTeam } from './lib/islSquads';

const L = 105;
const CLASSES = ['ip_transition', 'build_up', 'progression', 'final_third', 'op_transition', 'high_block', 'mid_block', 'low_block'] as const;
type Cls = typeof CLASSES[number];
const TRANSITION_SEC = 6;
const LIVE = (process.env['LIVE'] ?? '1') !== '0';

interface Acc { n: number; cent: number; len: number; wid: number; back: number; behind: number }
const acc0 = (): Acc => ({ n: 0, cent: 0, len: 0, wid: 0, back: 0, behind: 0 });

export interface SideMetrics {
  club: string;
  cls: Record<string, Acc>;
  spells: Record<string, [number, number]>;
  settled: { n: number; back: number; behind: number };
  engine: Record<string, number>;
  passes: number;
  possessions: number;
  goals: number;
  /** Counter-press metric: plan label, losses measured, sum of players within
   *  10 m of the ball 1.5 s after, regains within 6 s. */
  cp?: { plan: string; losses: number; near: number; regain6: number };
}

function planLabel(m: GameModel): string {
  return m.onLoss === 'counterpress' ? `counterpress ${m.counterpressPlayers} for ${m.counterpressSec}s` : 'recover';
}

function measureMatch(home: SpatialTeamInput, away: SpatialTeamInput, seed: number, names: [string, string], flags?: Partial<EngineFlags>): { seed: number; sides: Record<TeamSide, SideMetrics> } {
  const r = simulateSpatialMatch(home, away, { seed, frameEverySec: 0.5, ...(flags ? { flags } : {}) });
  const sideOf = new Map<string, TeamSide>();
  const gk = new Set<string>();
  for (const [s, t] of [['home', home], ['away', away]] as const) {
    for (const p of [...t.players, ...(t.bench ?? [])]) { sideOf.set(p.id, s); if (p.role === 'GK') gk.add(p.id); }
  }
  const mk = (club: string): SideMetrics => ({
    club, cls: Object.fromEntries(CLASSES.map((c) => [c, acc0()])), spells: Object.fromEntries(CLASSES.map((c) => [c, [0, 0]])) as Record<string, [number, number]>,
    settled: { n: 0, back: 0, behind: 0 }, engine: {}, passes: 0, possessions: 0, goals: 0,
  });
  const out: Record<TeamSide, SideMetrics> = { home: mk(names[0]), away: mk(names[1]) };
  for (const e of r.events) if (e.side && e.type === 'pass') out[e.side].passes++;
  const modelOf = (t: SpatialTeamInput): GameModel => (flags?.gameModel === false ? NEUTRAL_GAME_MODEL : t.gameModel ?? presetFor(t.playStyle));
  out.home.cp = { plan: planLabel(modelOf(home)), losses: 0, near: 0, regain6: 0 };
  out.away.cp = { plan: planLabel(modelOf(away)), losses: 0, near: 0, regain6: 0 };
  out.home.goals = r.finalScore[0];
  out.away.goals = r.finalScore[1];
  const phases = (r as unknown as { phases?: Record<TeamSide, Array<{ tSec: number; phase: string }>> }).phases;

  if (phases) {
    const frames = r.frames as PositionFrame[];
    for (const s of ['home', 'away'] as const) {
      const tl = phases[s];
      for (let i = 0; i < tl.length; i++) {
        if (tl[i]!.phase !== 'defensive_transition') continue;
        const t0 = tl[i]!.tSec;
        // Play must still be live 1.5 s later (no restart in between).
        if (tl.some((c) => c.tSec > t0 && c.tSec <= t0 + 1.5 && c.phase === 'set_piece')) continue;
        const f = frames.find((x) => x.tSec >= t0 + 1.5 - 1e-6);
        if (!f) continue;
        const near = f.players.filter((p) => sideOf.get(p.id) === s && !gk.has(p.id) && p.x >= 0 && Math.hypot(p.x - f.ball.x, p.y - f.ball.y) <= 10).length;
        const back = tl.some((c) => c.tSec > t0 && c.tSec <= t0 + 6 && c.phase === 'attacking_transition');
        const cp = out[s].cp!;
        cp.losses++; cp.near += near; if (back) cp.regain6++;
      }
    }
  }

  let poss: TeamSide | null = null;
  let changeAt = -100;
  const cur: Record<TeamSide, { cls: Cls | null; since: number }> = { home: { cls: null, since: 0 }, away: { cls: null, since: 0 } };
  const pIdx: Record<TeamSide, number> = { home: 0, away: 0 };
  let prevT = 0;
  for (const f of r.frames as PositionFrame[]) {
    const dt = f.tSec - prevT;
    prevT = f.tSec;
    const owner = f.ball.ownerId ? sideOf.get(f.ball.ownerId) ?? null : null;
    if (owner && owner !== poss) {
      if (poss !== null) changeAt = f.tSec;
      poss = owner;
      out[owner].possessions++;
    }
    if (!poss) continue;
    // Restarts (the engine's set_piece phase) are set plays, not blocks or
    // possession phases: with LIVE=1 (the default) they are left out, as the
    // tracking studies measure open play.  An engine with no phase timeline
    // keeps every frame.
    if (LIVE && phases && (['home', 'away'] as const).some((s) => {
      const tl = phases[s];
      let k = 0;
      while (k + 1 < tl.length && tl[k + 1]!.tSec <= f.tSec) k++;
      return tl[k]?.phase === 'set_piece';
    })) continue;
    for (const s of ['home', 'away'] as const) {
      const own = s === 'home' ? 0 : L;
      const dOwn = (x: number): number => Math.abs(x - own);
      const mine = f.players.filter((p) => sideOf.get(p.id) === s && !gk.has(p.id) && p.x >= 0);
      const theirs = f.players.filter((p) => sideOf.get(p.id) !== s && !gk.has(p.id) && p.x >= 0);
      if (mine.length < 3) continue;
      const ds = mine.map((p) => dOwn(p.x)).sort((a, b) => a - b);
      const ys = mine.map((p) => p.y);
      const cent = ds.reduce((a, b) => a + b, 0) / ds.length;
      const ballD = dOwn(f.ball.x);
      const behind = ds.filter((d) => d < ballD - 1).length;
      let cls: Cls;
      if (poss === s) {
        const opp = theirs.map((p) => dOwn(p.x)).sort((a, b) => a - b);
        const firstLine = opp[1] ?? 0;
        if (f.tSec - changeAt < TRANSITION_SEC) cls = 'ip_transition';
        else if (ballD >= 70) cls = 'final_third';
        else if (ballD <= firstLine + 1) cls = 'build_up';
        else cls = 'progression';
        if (cls !== 'ip_transition' && ballD > L / 2) { out[s].settled.n++; out[s].settled.back += (ds[0]! + ds[1]!) / 2; out[s].settled.behind += behind; }
      } else if (f.tSec - changeAt < TRANSITION_SEC) cls = 'op_transition';
      else cls = cent > 60 ? 'high_block' : cent < 20 ? 'low_block' : 'mid_block';
      const a = out[s].cls[cls]!;
      a.n++; a.cent += cent; a.len += ds[ds.length - 1]! - ds[0]!; a.wid += Math.max(...ys) - Math.min(...ys); a.back += ds[1]!; a.behind += behind;
      if (cur[s].cls !== cls) {
        if (cur[s].cls) { const sp = out[s].spells[cur[s].cls!]!; sp[0]++; sp[1] += f.tSec - cur[s].since; }
        cur[s] = { cls, since: f.tSec };
      }
      if (phases) {
        const tl = phases[s];
        while (pIdx[s] + 1 < tl.length && tl[pIdx[s] + 1]!.tSec <= f.tSec) pIdx[s]++;
        const ph = tl[pIdx[s]]?.phase ?? 'none';
        out[s].engine[ph] = (out[s].engine[ph] ?? 0) + dt;
      }
    }
  }
  return { seed, sides: out };
}

// ── Aggregation ─────────────────────────────────────────────────────────────

type Row = { seed: number; sides: Record<TeamSide, SideMetrics> };

export function load(prefix: string): Row[] {
  const dir = dirname(prefix);
  const pre = basename(prefix);
  const rows: Row[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.startsWith(pre) || !f.endsWith('.jsonl')) continue;
    for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) if (line.trim()) rows.push(JSON.parse(line) as Row);
  }
  return rows;
}

const f1 = (x: number): string => (Number.isFinite(x) ? x.toFixed(1) : '-');

/** Table of shape per class over a set of side records. */
export function shapeTable(sides: SideMetrics[]): string {
  const lines = [`${'class'.padEnd(14)} ${'share'.padStart(6)} ${'spell s'.padStart(8)} ${'centroid'.padStart(9)} ${'length'.padStart(7)} ${'width'.padStart(6)} ${'backline'.padStart(9)} ${'behind'.padStart(7)}`];
  const total = sides.reduce((s, x) => s + CLASSES.reduce((t, c) => t + x.cls[c]!.n, 0), 0);
  const ipTotal = sides.reduce((s, x) => s + CLASSES.slice(0, 4).reduce((t, c) => t + x.cls[c]!.n, 0), 0);
  const opTotal = total - ipTotal;
  const group = (label: string, cs: readonly Cls[], den: number): void => {
    const a = acc0();
    let spells = 0, sec = 0;
    for (const x of sides) for (const c of cs) {
      const y = x.cls[c]!; a.n += y.n; a.cent += y.cent; a.len += y.len; a.wid += y.wid; a.back += y.back; a.behind += y.behind;
      spells += x.spells[c]![0]; sec += x.spells[c]![1];
    }
    lines.push(`${label.padEnd(14)} ${f1((100 * a.n) / Math.max(1, den)).padStart(6)} ${f1(sec / Math.max(1, spells)).padStart(8)} ${f1(a.cent / a.n).padStart(9)} ${f1(a.len / a.n).padStart(7)} ${f1(a.wid / a.n).padStart(6)} ${f1(a.back / a.n).padStart(9)} ${f1(a.behind / a.n).padStart(7)}`);
  };
  for (const c of CLASSES.slice(0, 4)) group(c, [c], ipTotal);
  group('IN POSSESSION', CLASSES.slice(0, 4), total);
  for (const c of CLASSES.slice(4)) group(c, [c], opTotal);
  group('OUT OF POSS', CLASSES.slice(4), total);
  const st = sides.reduce((s, x) => ({ n: s.n + x.settled.n, back: s.back + x.settled.back, behind: s.behind + x.settled.behind }), { n: 0, back: 0, behind: 0 });
  lines.push(`settled in opponent half: back two at ${f1(st.back / st.n)} m from own goal, ${f1(st.behind / st.n)} outfielders behind the ball`);
  const eng: Record<string, number> = {};
  for (const x of sides) for (const [k, v] of Object.entries(x.engine)) eng[k] = (eng[k] ?? 0) + v;
  const et = Object.values(eng).reduce((a, b) => a + b, 0);
  if (et > 0) lines.push('engine phase shares: ' + Object.entries(eng).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${f1((100 * v) / et)}%`).join(', '));
  const passes = sides.reduce((s, x) => s + x.passes, 0);
  const poss = sides.reduce((s, x) => s + x.possessions, 0);
  lines.push(`passes per possession ${(passes / Math.max(1, poss)).toFixed(2)}`);
  lines.push(cpTable(sides));
  return lines.join('\n');
}

/** Counter-press metric by plan type. */
export function cpTable(sides: SideMetrics[]): string {
  const by = new Map<string, { losses: number; near: number; regain6: number; n: number }>();
  for (const x of sides) {
    if (!x.cp) continue;
    const a = by.get(x.cp.plan) ?? { losses: 0, near: 0, regain6: 0, n: 0 };
    a.losses += x.cp.losses; a.near += x.cp.near; a.regain6 += x.cp.regain6; a.n++;
    by.set(x.cp.plan, a);
  }
  const lines = ['counter-press metric (open-play losses, live 1.5 s later)', `${'plan on loss'.padEnd(26)} ${'sides'.padStart(5)} ${'losses/m'.padStart(8)} ${'within10m@1.5s'.padStart(14)} ${'regain<=6s'.padStart(10)} ${'regains/m'.padStart(9)}`];
  for (const [k, a] of [...by.entries()].sort()) {
    lines.push(`${k.padEnd(26)} ${String(a.n).padStart(5)} ${(a.losses / a.n).toFixed(1).padStart(8)} ${(a.near / Math.max(1, a.losses)).toFixed(2).padStart(14)} ${(a.regain6 / Math.max(1, a.losses)).toFixed(3).padStart(10)} ${(a.regain6 / a.n).toFixed(1).padStart(9)}`);
  }
  return lines.join('\n');
}

/** Per-club summary: block centroid, lengths, settled back line, rest defence. */
export function clubTable(rows: Row[]): string {
  const by = new Map<string, SideMetrics[]>();
  for (const r of rows) for (const s of ['home', 'away'] as const) (by.get(r.sides[s].club) ?? by.set(r.sides[s].club, []).get(r.sides[s].club)!).push(r.sides[s]);
  const lines = [`${'club'.padEnd(18)} ${'n'.padStart(3)} ${'blockCent'.padStart(9)} ${'blockLen'.padStart(8)} ${'blockWid'.padStart(8)} ${'ipLen'.padStart(6)} ${'ipWid'.padStart(6)} ${'settledBack'.padStart(11)} ${'restDef'.padStart(7)} ${'pass/poss'.padStart(9)} ${'GF'.padStart(5)} engine top phases`];
  for (const [club, xs] of [...by.entries()].sort()) {
    const sum = (cs: readonly Cls[], k: keyof Acc): number => { let v = 0, n = 0; for (const x of xs) for (const c of cs) { v += x.cls[c]![k]; n += x.cls[c]!.n; } return v / Math.max(1, n); };
    const blocks = ['high_block', 'mid_block', 'low_block'] as const;
    const ip = ['build_up', 'progression', 'final_third'] as const;
    const st = xs.reduce((s, x) => ({ n: s.n + x.settled.n, back: s.back + x.settled.back, behind: s.behind + x.settled.behind }), { n: 0, back: 0, behind: 0 });
    const eng: Record<string, number> = {};
    for (const x of xs) for (const [k, v] of Object.entries(x.engine)) eng[k] = (eng[k] ?? 0) + v;
    const et = Object.values(eng).reduce((a, b) => a + b, 0);
    const top = Object.entries(eng).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${Math.round((100 * v) / Math.max(1, et))}%`).join(' ');
    lines.push(`${club.padEnd(18)} ${String(xs.length).padStart(3)} ${f1(sum(blocks, 'cent')).padStart(9)} ${f1(sum(blocks, 'len')).padStart(8)} ${f1(sum(blocks, 'wid')).padStart(8)} ${f1(sum(ip, 'len')).padStart(6)} ${f1(sum(ip, 'wid')).padStart(6)} ${f1(st.back / Math.max(1, st.n)).padStart(11)} ${f1(st.behind / Math.max(1, st.n)).padStart(7)} ${(xs.reduce((s, x) => s + x.passes, 0) / Math.max(1, xs.reduce((s, x) => s + x.possessions, 0))).toFixed(2).padStart(9)} ${(xs.reduce((s, x) => s + x.goals, 0) / xs.length).toFixed(2).padStart(5)} ${top}`);
  }
  return lines.join('\n');
}

// ── Main ──────────────────────────────────────────────────────────────────

const report = process.env['REPORT'];
if (report) {
  const rows = load(report);
  console.log(`matches ${rows.length}`);
  console.log(shapeTable(rows.flatMap((r) => [r.sides.home, r.sides.away])));
  if (rows.some((r) => r.sides.home.club !== 'H')) { console.log(''); console.log(clubTable(rows)); }
} else {
  const mode = process.env['MODE'] ?? 'std';
  const n = Number(process.env['N'] ?? 8);
  const shard = Number(process.env['SHARD'] ?? 0);
  const shards = Number(process.env['SHARDS'] ?? 1);
  const out = process.env['OUT'] ?? 'phase.jsonl';
  const off = (process.env['OFF'] ?? '').split(',').filter(Boolean);
  const flags: Partial<EngineFlags> = {};
  for (const f of off) (flags as Record<string, boolean>)[f] = false;
  writeFileSync(out, '');
  const jobs: Array<() => Row> = [];
  if (mode === 'cp') {
    // Same sides, same ratings; one manager counter-presses (four men for
    // five seconds), the other recovers into the block.  Venue alternates.
    const bal = STYLE_PRESETS['Balanced']!;
    const press: GameModel = { ...bal, onLoss: 'counterpress', counterpressPlayers: 4, counterpressSec: 5 };
    const drop: GameModel = { ...bal, onLoss: 'recover' };
    for (let m = 0; m < n; m++) {
      const base = 60 + (m % 21);
      const P = { ...team('P', base), gameModel: press };
      const R = { ...team('R', base), gameModel: drop };
      jobs.push(() => (m % 2 === 0 ? measureMatch(P, R, 1000 + m, ['P', 'R'], flags) : measureMatch(R, P, 1000 + m, ['R', 'P'], flags)));
    }
  } else if (mode === 'std') {
    for (let m = 0; m < n; m++) {
      const base = 60 + (m % 21);
      jobs.push(() => measureMatch(team('H', base), team('A', base), 1000 + m, ['H', 'A'], flags));
    }
  } else {
    const pairs = (process.env['PAIRS'] ?? '').split(',').filter(Boolean).map((p) => p.split(':') as [string, string]);
    pairs.forEach(([a, b], pi) => {
      for (let m = 0; m < n; m++) {
        const seed = 5000 + pi * 100 + m;
        const [h, w] = m % 2 === 0 ? [a, b] : [b, a];
        jobs.push(() => measureMatch(islTeam(h), islTeam(w), seed, [h, w], flags));
      }
    });
  }
  for (let i = shard; i < jobs.length; i += shards) appendFileSync(out, JSON.stringify(jobs[i]!()) + '\n');
}
