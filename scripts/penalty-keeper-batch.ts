// ── scripts/penalty-keeper-batch.ts ─────────────────────────────────────────
// Where do the keepers stand while a penalty is set up?  docs/match-viewer.md
// section 2A: the keeper of the side TAKING a penalty used to run the length
// of the pitch (about 80 m) to the edge of the other box, because
// restartTarget sent only the defending keeper to his line.
//
// For a batch of full matches between real ISL squads (scripts/lib/islSquads)
// this records every penalty set-up window (from the restart being set to the
// kick, read from the engine's own trace records) and, on every tick inside
// it (frames sampled every 0.1 s, which only records and never alters the
// simulation), the distance of each keeper from his OWN goal line.  The
// whole of a keeper's own half is within 52.5 m of that line.
//
// Usage (from the repo root; shard for speed):
//   npx tsx scripts/penalty-keeper-batch.ts <matches> <firstSeed>
// Prints one JSON line per penalty and a summary line starting "SUMMARY".

import { simulateSpatialMatch } from '../src/features/match/logic/spatial/simulateSpatialMatch';
import { PITCH_LENGTH, PITCH_WIDTH, type TraceRecord } from '../src/features/match/logic/spatial/types';
import { islTeam, managerSeeds } from './lib/islSquads';

const matches = Number(process.argv[2] ?? 50);
const firstSeed = Number(process.argv[3] ?? 1);
const clubs = Object.keys(managerSeeds()).sort();

let penalties = 0;
let maxAttacking = 0;
let maxDefending = 0;
let beyondHalf = 0;

for (let m = 0; m < matches; m++) {
  const seed = firstSeed + m;
  // A deterministic spread of pairings over every club.
  const h = clubs[(seed * 7) % clubs.length]!;
  let a = clubs[(seed * 13 + 5) % clubs.length]!;
  if (a === h) a = clubs[(clubs.indexOf(h) + 1) % clubs.length]!;
  const traces: TraceRecord[] = [];
  const r = simulateSpatialMatch(islTeam(h), islTeam(a), {
    seed, frameEverySec: 0.1, trace: (t) => { if (t.kind === 'dead' || t.kind === 'restart') traces.push(t); },
  });
  const first = r.frames[0]!;
  const homeGk = first.players[0]!.id;
  const awayGk = first.players[11]!.id;
  for (let i = 0; i < traces.length; i++) {
    const t = traces[i]!;
    if (t.kind !== 'dead' || t.data.kind !== 'penalty') continue;
    const takingSide = t.data.side as 'home' | 'away';
    const end = traces.slice(i + 1).find((x) => x.kind === 'restart');
    const t1 = end ? end.tSec : t.tSec + 120;
    let att = 0;
    let def = 0;
    for (const f of r.frames) {
      if (f.tSec < t.tSec || f.tSec > t1) continue;
      for (const [id, side] of [[homeGk, 'home'], [awayGk, 'away']] as const) {
        const p = f.players.find((q) => q.id === id);
        // A keeper sent off is parked on a touchline: not standing anywhere.
        if (!p || p.y <= 0 || p.y >= PITCH_WIDTH) continue;
        const d = side === 'home' ? p.x : PITCH_LENGTH - p.x;
        if (side === takingSide) att = Math.max(att, d); else def = Math.max(def, d);
      }
    }
    penalties += 1;
    maxAttacking = Math.max(maxAttacking, att);
    maxDefending = Math.max(maxDefending, def);
    if (att > PITCH_LENGTH / 2 || def > PITCH_LENGTH / 2) beyondHalf += 1;
    console.log(JSON.stringify({ seed, home: h, away: a, tSec: t.tSec, takingSide, attackingKeeperMax: att, defendingKeeperMax: def }));
  }
}
console.log(`SUMMARY ${JSON.stringify({ matches, firstSeed, penalties, maxAttacking, maxDefending, beyondHalf })}`);
