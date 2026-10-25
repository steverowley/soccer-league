// scripts/sample-match.ts
// One full emergent match between two named ISL sides, as a key-event
// timeline: minute, player and what physically happened (shot distance and
// speed, the shooter's own estimate, the keeper's reach against the ball,
// how a foul was committed and why it was booked), then score and stats.
//   npx tsx scripts/sample-match.ts [--seed 20261025] [--out file.txt]
import { writeFileSync } from 'node:fs';
import { simulateSpatialMatch, type SpatialPlayerInput, type SpatialTeamInput } from '../src/features/match/logic/spatial/simulateSpatialMatch';
import type { Role, SimPlayerStats, TraceRecord } from '../src/features/match/logic/spatial/types';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const seed = Number(arg('seed') ?? 20261025);
const outPath = arg('out');

function st(b: number, o: Partial<SimPlayerStats> = {}): SimPlayerStats {
  return { shooting: b, passing: b, dribbling: b, speed: b, stamina: b, tackling: b, positioning: b, goalkeeping: b, vision: b, ...o };
}
type P = [string, Role, SimPlayerStats, string?];
function side(prefix: string, xi: P[], bench: P[]): SpatialTeamInput {
  const mk = (p: P, i: number, b: boolean): SpatialPlayerInput => ({ id: `${prefix}-${b ? 's' : ''}${i}`, name: p[0], role: p[1], stats: p[2], ...(p[3] ? { personality: p[3] } : {}) });
  return { formation: '4-4-2', players: xi.map((p, i) => mk(p, i, false)), bench: bench.map((p, i) => mk(p, i, true)) };
}
const mars = side('MAR', [
  ['Ilse Varga', 'GK', st(70, { goalkeeping: 78 })],
  ['Tomas Okafor', 'DF', st(72, { tackling: 79 })], ['Rhea Lindqvist', 'DF', st(71)], ['Dov Achterberg', 'DF', st(73, { tackling: 80 }), 'aggressive'], ['Sol Marante', 'DF', st(70, { speed: 76 })],
  ['Kiri Abeyta', 'MF', st(74, { passing: 80, vision: 79 })], ['Juno Halvorsen', 'MF', st(72), 'workhorse'], ['Pell Ostrava', 'MF', st(71)], ['Ana Ruiz-Tengo', 'MF', st(73, { dribbling: 79 })],
  ['Cass Ferreira', 'FW', st(75, { shooting: 82 }), 'selfish'], ['Bram Oduya', 'FW', st(72, { speed: 80 })],
], [['Lo Petrakis', 'GK', st(66)], ['Femi Hart', 'DF', st(68)], ['Nadia Sorel', 'MF', st(69)], ['Ezra Quill', 'MF', st(68)], ['Rook Daventry', 'FW', st(70)]]);
const venus = side('VEN', [
  ['Arlo Mbeki', 'GK', st(69, { goalkeeping: 76 })],
  ['Hana Kowalczyk', 'DF', st(70)], ['Teo Villiers', 'DF', st(72, { tackling: 78 })], ['Orsolya Fenn', 'DF', st(71)], ['Ibsen Kaur', 'DF', st(69, { speed: 75 })],
  ['Mila Strand', 'MF', st(73, { passing: 79 })], ['Gus Adeyemi', 'MF', st(71), 'cautious'], ['Lark Esposito', 'MF', st(70)], ['Yuki Brannigan', 'MF', st(72, { dribbling: 78 })],
  ['Zed Calloway', 'FW', st(74, { shooting: 80 })], ['Pia Montague', 'FW', st(71, { speed: 79 }), 'creative'],
], [['Rem Ostergaard', 'GK', st(65)], ['Wynn Achebe', 'DF', st(67)], ['Coral Dunmore', 'MF', st(68)], ['Seb Lark', 'MF', st(67)], ['Tavi Renard', 'FW', st(69)]]);

const names = new Map<string, string>();
for (const t of [mars, venus]) for (const p of [...t.players, ...(t.bench ?? [])]) names.set(p.id, p.name);
const club = (id?: string): string => (id?.startsWith('MAR') ? 'Mars United' : id?.startsWith('VEN') ? 'Venus Rovers' : '');
const who = (id?: string): string => (id ? `${names.get(id) ?? id} (${club(id)})` : 'unknown');

const recs: TraceRecord[] = [];
const r = simulateSpatialMatch(mars, venus, { seed, trace: (x) => recs.push(x) });
const lines: string[] = [];
const out = (s = ''): void => { lines.push(s); console.log(s); };
const mm = (t: number): string => `${Math.floor(t / 60) + 1}'`.padStart(4);
const f2 = (x: unknown): string => (typeof x === 'number' ? x.toFixed(2) : String(x));

out(`Mars United v Venus Rovers. Emergent engine, recorded seed ${seed} (same seed replays this match exactly).`);
out('Every outcome below was decided by positions, timing and physics; the only randomness is execution and');
out('perception error and the choice among near-best options.');
out('');
out('Key events:');
const timeline: Array<[number, string]> = [];
const shotGoalTimes: number[] = [];
const ev = (t: number, text: string): void => { timeline.push([t, text]); };
let lastShot: TraceRecord | null = null;
for (let i = 0; i < recs.length; i++) {
  const x = recs[i]!;
  const d = x.data;
  if (x.kind === 'shot') {
    lastShot = x;
    const header = d['header'] === true;
    const res = recs.slice(i + 1, i + 12).find((y) => ['goal', 'keeper', 'block', 'shot_end'].includes(y.kind) && y.tSec - x.tSec < 3);
    let fate = '';
    if (res?.kind === 'goal') shotGoalTimes.push(res.tSec);
    if (res?.kind === 'goal') fate = `GOAL, crossing the line at y=${f2(res.data['y'])} m, height ${f2(res.data['z'])} m`;
    else if (res?.kind === 'keeper') fate = `${res.data['action'] === 'catch' ? 'held' : 'parried'} by ${who(res.playerId)}: ball at ${f2(res.data['speed'])} m/s came ${f2(res.data['closeD'])} m from his centre`;
    else if (res?.kind === 'block') fate = `blocked by ${who(res.playerId)} at ${f2(res.data['speed'])} m/s`;
    else if (res?.kind === 'shot_end') fate = res.data['outcome'] === 'save' ? 'saved' : 'off target';
    const keeperLine = d['kAtStrike'] !== undefined ? `; on the line it actually took, the keeper's reach judgement was ${f2(d['kAtStrike'])}` : '';
    const spd = d['speed'] !== undefined ? `struck at ${f2(d['speed'])} m/s` : '';
    const err = header ? '' : `, kick error ${f2(d['angErr'] ?? 0)} rad`;
    ev(x.tSec, `${mm(x.tSec)} ${header ? 'Header' : 'Shot'} by ${who(x.playerId)} from ${f2(d['dist'])} m, ${spd}, own estimate ${f2(d['est'])}${err}${keeperLine}. ${fate}.`);
  } else if (x.kind === 'challenge' && d['outcome'] === 'foul') {
    const why = [d['fromBehind'] ? 'from behind' : '', d['dogso'] ? 'denied an obvious goal-scoring chance' : '', d['spa'] ? 'stopped a promising attack' : '', d['persistent'] ? 'persistent fouling' : ''].filter(Boolean).join(', ');
    if (d['card'] || d['inBox']) {
      ev(x.tSec, `${mm(x.tSec)} Foul by ${who(x.playerId)} (${d['how']}): severity ${f2(d['severity'])}, ball ${f2(d['ballD'])} m from the contact${why ? ', ' + why : ''}.${d['card'] ? ` ${String(d['card']).toUpperCase()} CARD.` : ''}${d['inBox'] ? ' Inside the area: PENALTY.' : ''}`);
    }
  } else if (x.kind === 'keeper_guess') {
    ev(x.tSec, `${mm(x.tSec)} Penalty: ${who(x.playerId)} commits to y=${f2(d['y'])} as it is struck.`);
  }
}
for (const e of r.events) {
  if (e.type === 'goal' && !shotGoalTimes.some((t) => Math.abs(t - e.tSec) < 0.3)) {
    const g = recs.find((y) => y.kind === 'goal' && Math.abs(y.tSec - e.tSec) < 0.3);
    ev(e.tSec, `${mm(e.tSec)} GOAL for ${e.side === 'home' ? 'Mars United' : 'Venus Rovers'}: ${e.playerId ? who(e.playerId) : 'own goal'}, the ball (last played as a ${g ? String(g.data['kick']) : 'loose ball'}, ${g && g.data['sinceShot'] !== null ? f2(g.data['sinceShot']) + ' s after the last shot' : 'no shot'}) crossing at y=${g ? f2(g.data['y']) : '?'} m.`);
  }
  if (e.type === 'substitution') ev(e.tSec, `${mm(e.tSec)} Substitution (${club(e.playerId)}): ${names.get(e.playerId ?? '') ?? e.playerId} on for ${names.get(e.otherId ?? '') ?? e.otherId}.`);
}
void lastShot;
timeline.sort((a, b) => a[0] - b[0]);
for (const [, text] of timeline) out(text);
out('');
const count = (t: string, s: 'home' | 'away'): number => r.events.filter((e) => e.type === t && e.side === s).length;
const shots = (s: 'home' | 'away'): number => recs.filter((x) => x.kind === 'shot' && x.side === s).length;
out(`Final score: Mars United ${r.finalScore[0]} - ${r.finalScore[1]} Venus Rovers`);
out('');
out('Stats                 Mars   Venus');
const row = (n: string, a: number, b: number): void => out(`${n.padEnd(20)}${String(a).padStart(6)}${String(b).padStart(8)}`);
row('Shots (incl. headers)', shots('home'), shots('away'));
row('Saves made', count('save', 'home'), count('save', 'away'));
row('Passes', count('pass', 'home'), count('pass', 'away'));
row('Tackles', count('tackle', 'home'), count('tackle', 'away'));
row('Interceptions', count('interception', 'home'), count('interception', 'away'));
row('Fouls', count('foul', 'home'), count('foul', 'away'));
row('Yellow cards', r.events.filter((e) => e.type === 'foul' && e.side === 'home' && e.card === 'yellow').length, r.events.filter((e) => e.type === 'foul' && e.side === 'away' && e.card === 'yellow').length);
row('Red cards', r.events.filter((e) => e.type === 'foul' && e.side === 'home' && e.card === 'red').length, r.events.filter((e) => e.type === 'foul' && e.side === 'away' && e.card === 'red').length);
row('Corners won', count('out_corner', 'home'), count('out_corner', 'away'));
row('Offsides', count('offside', 'home'), count('offside', 'away'));
if (outPath) writeFileSync(outPath, lines.join('\n') + '\n');
