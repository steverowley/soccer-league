// ── scripts/measure-replay-size.ts ──────────────────────────────────────────
// Measures the replay file the match worker uploads to Supabase Storage
// (replays/<matchId>.json.gz, docs/mvp-free-tier.md decision 1) for the six
// real ISL squads in scripts/fixtures/bench-teams.json.
//
// It builds the payload through the worker's own code path
// (supabase/functions/match-worker/replayFile.ts: buildReplayPayload, then
// encodeReplayFile, which is JSON plus CompressionStream gzip), so the bytes
// measured here are the bytes production stores. Frame ids are 36-char UUIDs
// as in production. It also times the encode step, which is the only new CPU
// the worker spends on the edge (budget about 2 s per invocation).
//
// Usage: npx tsx scripts/measure-replay-size.ts

import { simulateSpatialMatch, type SpatialTeamInput } from '../src/features/match/logic/spatial/simulateSpatialMatch';
import { toSpatialTeamInput } from '../src/features/match/logic/spatial/spatialEventAdapter';
import {
  buildReplayPayload,
  encodeReplayFile,
  gunzipBytes,
} from '../supabase/functions/match-worker/replayFile.ts';
import squads from './fixtures/bench-teams.json';

function squad(i: number): SpatialTeamInput {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = (squads as any[])[i];
  const row = {
    id: t.id, name: t.name,
    managers: [{ preferred_formation: t.f, style: t.s, game_model: t.gm }],
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

const sizes: number[] = [];
const raws: number[] = [];
const encodeMs: number[] = [];
for (const [h, a, seed] of PAIRS) {
  const r = simulateSpatialMatch(squad(h), squad(a), { seed });
  const matchId = crypto.randomUUID();
  const t0 = performance.now();
  const file = buildReplayPayload(matchId, r.frames);
  const enc = await encodeReplayFile(file);
  const ms = performance.now() - t0;
  // Round trip, so a size is only reported for a file that decodes.
  const back = JSON.parse(new TextDecoder().decode(await gunzipBytes(enc.body)));
  if (back.frames.length !== file.frames.length) throw new Error('round trip lost frames');
  sizes.push(enc.gzipBytes);
  raws.push(enc.rawBytes);
  encodeMs.push(ms);
  console.log(
    `${h}v${a} seed=${seed}: ${file.frames.length} frames, roster ${file.roster.length}, ` +
    `json ${kb(enc.rawBytes)} -> gzip ${kb(enc.gzipBytes)} (${((enc.gzipBytes / enc.rawBytes) * 100).toFixed(1)}%), ` +
    `build+encode ${ms.toFixed(0)} ms`,
  );
}
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
console.log(
  `mean json ${kb(mean(raws))}, mean gzip ${kb(mean(sizes))} (max ${kb(Math.max(...sizes))}), ` +
  `mean build+encode ${mean(encodeMs).toFixed(0)} ms (max ${Math.max(...encodeMs).toFixed(0)} ms)`,
);
console.log(
  `800 MB of Storage holds about ${Math.floor((800 * 1024 * 1024) / mean(sizes))} replays ` +
  `(a 224-match season uses ${((224 * mean(sizes)) / 1024 / 1024).toFixed(0)} MB)`,
);
