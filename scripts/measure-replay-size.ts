// ── scripts/measure-replay-size.ts ──────────────────────────────────────────
// Measures the replay file stored in Supabase Storage
// (replays/<matchId>.json.gz, docs/mvp-free-tier.md decision 1) for the six
// real ISL squads in scripts/fixtures/bench-teams.json, in both formats:
//
//   v2  the worker's own builder (supabase/functions/match-worker/replayFile.ts:
//       buildReplayPayload + encodeReplayFile): players and ball every 2 s.
//       Still the fallback when a simulation response carries no replay.
//   v3  what the simulation function records and stores since
//       docs/match-viewer.md section 2B (src/features/match/logic/replay:
//       createReplayRecorder + encodeReplayV3, then the same CompressionStream
//       gzip): players every 0.5 s, the ball as keyframes, and since section 5
//       the action track (every kick, tackle, foul, dive, restart...).  The
//       file is also measured without its actions, so the action track's own
//       cost is the difference.
//
// Frame ids are 36-char UUIDs as in production, so the bytes measured here are
// the bytes production stores. It also times each build: v2 runs on the edge
// worker (budget about 2 s CPU, about 7x slower than this laptop), v3 runs on
// Vercel inside the simulation function.
//
// Usage: npx tsx scripts/measure-replay-size.ts

import { simulateSpatialMatch, type SpatialTeamInput } from '../src/features/match/logic/spatial/simulateSpatialMatch';
import { toSpatialTeamInput } from '../src/features/match/logic/spatial/spatialEventAdapter';
import { createReplayRecorder } from '../src/features/match/logic/replay/recorder';
import { encodeReplayV3, decodeReplayV3, type ReplayFileV3 } from '../src/features/match/logic/replay/replayV3';
import {
  buildReplayPayload,
  encodeReplayFile,
  gunzipBytes,
  gzipBytes,
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
const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

const v2Sizes: number[] = [];
const v2Ms: number[] = [];
const v3Sizes: number[] = [];
const v3Raw: number[] = [];
const v3Ms: number[] = [];
const v3BareSizes: number[] = [];
const v3BareMs: number[] = [];
const actionBytes: number[] = [];
const actionCounts: number[] = [];
const recordMs: number[] = [];
const keys: number[] = [];
for (const [h, a, seed] of PAIRS) {
  const home = squad(h);
  const away = squad(a);
  const matchId = crypto.randomUUID();

  // Recording overhead: the faster of three runs each way (JIT and GC noise),
  // with the whole recorder attached (tick observer and kick/dive observer).
  const timed = (record: boolean): number => {
    const t = performance.now();
    if (record) {
      const rec = createReplayRecorder();
      const res = simulateSpatialMatch(home, away, { seed, onTick: rec.onTick, observer: rec.observer });
      rec.track(res.events);
    } else {
      simulateSpatialMatch(home, away, { seed });
    }
    return performance.now() - t;
  };
  const plainMs = Math.min(timed(false), timed(false), timed(false));
  const recMs = Math.min(timed(true), timed(true), timed(true));
  recordMs.push(recMs - plainMs);
  const rec = createReplayRecorder();
  const r = simulateSpatialMatch(home, away, { seed, onTick: rec.onTick, observer: rec.observer });

  // v2, the worker's fallback path.
  const t0 = performance.now();
  const v2 = await encodeReplayFile(buildReplayPayload(matchId, r.frames));
  v2Ms.push(performance.now() - t0);
  v2Sizes.push(v2.gzipBytes);

  // v3 without the action track (as before section 5), for the difference.
  const tb = performance.now();
  const bare = await gzipBytes(new TextEncoder().encode(JSON.stringify(encodeReplayV3(matchId, rec.track()))));
  v3BareMs.push(performance.now() - tb);
  v3BareSizes.push(bare.length);

  // v3, what the simulation function stores.
  const t1 = performance.now();
  const track = rec.track(r.events);
  const file = encodeReplayV3(matchId, track);
  const raw = new TextEncoder().encode(JSON.stringify(file));
  const body = await gzipBytes(raw);
  v3Ms.push(performance.now() - t1);
  v3Sizes.push(body.length);
  v3Raw.push(raw.length);
  keys.push(file.ball.t.length);
  actionBytes.push(body.length - bare.length);
  actionCounts.push(track.actions!.length);

  // Round trip, so a size is only reported for a file that decodes.
  const back = decodeReplayV3(JSON.parse(new TextDecoder().decode(await gunzipBytes(body))) as ReplayFileV3);
  if (!back || back.frames.length !== file.frames || back.ball.keys.length !== file.ball.t.length
    || back.actions?.length !== track.actions!.length) {
    throw new Error('v3 round trip lost data');
  }
  console.log(
    `${h}v${a} seed=${seed}: v2 ${r.frames.length} frames gzip ${kb(v2.gzipBytes)} in ${v2Ms.at(-1)!.toFixed(0)} ms | ` +
    `v3 ${file.frames} frames + ${file.ball.t.length} ball keys + ${track.actions!.length} actions, roster ${file.roster.length}, ` +
    `json ${kb(raw.length)} -> gzip ${kb(body.length)} (actions ${kb(body.length - bare.length)}) in ${v3Ms.at(-1)!.toFixed(0)} ms ` +
    `(recording ${recordMs.at(-1)!.toFixed(0)} ms on a ${plainMs.toFixed(0)} ms match)`,
  );
}
console.log(
  `v2: mean gzip ${kb(mean(v2Sizes))} (max ${kb(Math.max(...v2Sizes))}), mean build+gzip ${mean(v2Ms).toFixed(0)} ms`,
);
console.log(
  `v3 without actions: mean gzip ${kb(mean(v3BareSizes))} (max ${kb(Math.max(...v3BareSizes))}), ` +
  `mean encode+gzip ${mean(v3BareMs).toFixed(0)} ms`,
);
console.log(
  `v3: mean json ${kb(mean(v3Raw))}, mean gzip ${kb(mean(v3Sizes))} (max ${kb(Math.max(...v3Sizes))}), ` +
  `mean ${mean(keys).toFixed(0)} ball keys, mean encode+gzip ${mean(v3Ms).toFixed(0)} ms, ` +
  `mean recording overhead ${mean(recordMs).toFixed(0)} ms`,
);
console.log(
  `actions: mean ${mean(actionCounts).toFixed(0)} a match, mean ${kb(mean(actionBytes))} gzip ` +
  `(max ${kb(Math.max(...actionBytes))})`,
);
for (const [name, xs] of [['v2', v2Sizes], ['v3', v3Sizes]] as const) {
  console.log(
    `${name}: 800 MB of Storage holds about ${Math.floor((800 * 1024 * 1024) / mean(xs))} replays ` +
    `(a 224-match season uses ${((224 * mean(xs)) / 1024 / 1024).toFixed(0)} MB)`,
  );
}
