// ── scripts/measure-sim-payload.ts ──────────────────────────────────────────
// Measures what the remote simulation function (api/simulate.mjs) sends over
// the wire: the request (both team inputs plus the ticket) and the response
// (the full SpatialMatchResult, raw JSON and gzipped) for the six real ISL
// squads in scripts/fixtures/bench-teams.json, each manager's own game model.
//
// Vercel caps a function's request and response bodies at 4.5 MB, so this is
// the number to re-check whenever the engine starts recording more (more
// frames, more event fields).
//
// Usage: npx tsx scripts/measure-sim-payload.ts

import { gzipSync } from 'node:zlib';
import { simulateSpatialMatch, type SpatialTeamInput } from '../src/features/match/logic/spatial/simulateSpatialMatch';
import { toSpatialTeamInput } from '../src/features/match/logic/spatial/spatialEventAdapter';
import squads from './fixtures/bench-teams.json';

function squad(i: number): SpatialTeamInput {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = (squads as any[])[i];
  const row = {
    id: t.id, name: t.name,
    managers: [{ preferred_formation: t.f, style: t.s, game_model: t.gm }],
    // Production frame ids are entity UUIDs (36 chars): use the same length so
    // the measured frame payload matches production byte for byte.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    players: t.ps.map((p: any[]) => ({
      id: crypto.randomUUID(), entity_id: crypto.randomUUID(), name: p[0], position: p[1], starter: p[2], team_id: t.id,
      attacking: p[3], defending: p[4], mental: p[5], athletic: p[6], technical: p[7],
    })),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return toSpatialTeamInput(row as any);
}

const PAIRS: Array<[number, number, number]> = [[0, 2, 1000], [4, 1, 1001], [3, 5, 1002], [2, 0, 2026], [1, 3, 31337], [5, 4, 7]];
const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;
let maxRaw = 0;
let maxGz = 0;
for (const [h, a, seed] of PAIRS) {
  const home = squad(h);
  const away = squad(a);
  const req = JSON.stringify({ matchId: crypto.randomUUID(), ticketId: crypto.randomUUID(), token: 'x'.repeat(64), seed, home, away });
  const r = simulateSpatialMatch(home, away, { seed });
  const raw = Buffer.from(JSON.stringify(r));
  const gz = gzipSync(raw);
  maxRaw = Math.max(maxRaw, raw.length);
  maxGz = Math.max(maxGz, gz.length);
  console.log(
    `${String(h)}v${String(a)} seed=${seed}: request ${kb(req.length)}, response raw ${kb(raw.length)} ` +
    `(events ${kb(JSON.stringify(r.events).length)}, frames ${kb(JSON.stringify(r.frames).length)}, ` +
    `phases ${kb(JSON.stringify(r.phases ?? null).length)}), gzip ${kb(gz.length)}`,
  );
}
console.log(`max raw ${kb(maxRaw)} (${(maxRaw / 1048576).toFixed(2)} MB), max gzip ${kb(maxGz)} (${(maxGz / 1048576).toFixed(2)} MB)`);
