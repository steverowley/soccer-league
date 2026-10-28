// ── scripts/measure-sim-payload.ts ──────────────────────────────────────────
// Measures what the remote simulation function (api/simulate.mjs) sends over
// the wire, and what the match worker then spends decoding it, for the six
// real ISL squads in scripts/fixtures/bench-teams.json, each manager's own
// game model:
//
//   request     both team inputs plus the ticket;
//   response    the full SpatialMatchResult plus, since docs/match-viewer.md
//               section 2B, the gzipped v3 replay as base64 (SIM_REPLAY_FIELD),
//               JSON then gzip, exactly as simulateFunction.ts builds it;
//   worker CPU  gunzip + JSON.parse + taking the replay off the result
//               (remoteSim.ts), against what the worker spent before v3
//               (gunzip + JSON.parse + building and gzipping its v2 replay),
//               and against the rejected alternative of the worker building
//               the v3 replay itself from denser frames (0.5 s frames and the
//               ball keyframes in the result).
//
// Vercel caps a function's request and response bodies at 4.5 MB, so this is
// the number to re-check whenever the engine starts recording more (more
// frames, more event fields). The edge runs this code about 7x slower than a
// laptop and allows about 2 s of CPU per invocation (see the
// intergalactic-soccer-league skill), so worker milliseconds here x7 is the
// production estimate.
//
// Usage: npx tsx scripts/measure-sim-payload.ts

import { simulateSpatialMatch, type SpatialTeamInput } from '../src/features/match/logic/spatial/simulateSpatialMatch';
import { toSpatialTeamInput } from '../src/features/match/logic/spatial/spatialEventAdapter';
import { createReplayRecorder, type ReplayTrack } from '../src/features/match/logic/replay/recorder';
import { encodeReplayV3 } from '../src/features/match/logic/replay/replayV3';
import { gzipText, gunzipText, bytesToBase64, SIM_REPLAY_FIELD } from '../src/features/match/api/simulateFunction';
import { takeReplay } from '../supabase/functions/match-worker/remoteSim.ts';
import { buildReplayPayload, encodeReplayFile } from '../supabase/functions/match-worker/replayFile.ts';
import type { PositionFrame } from '../src/features/match/logic/spatial/types';
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
const kb = (n: number): string => `${(n / 1024).toFixed(0)} KB`;
const EDGE_FACTOR = 7;
const rows: Array<Record<string, number>> = [];

for (const [h, a, seed] of PAIRS) {
  const home = squad(h);
  const away = squad(a);
  const matchId = crypto.randomUUID();
  const req = JSON.stringify({ matchId, ticketId: crypto.randomUUID(), token: 'x'.repeat(64), seed, home, away });

  // What the function sends since v3 (simulateFunction.ts).
  const rec = createReplayRecorder();
  const r = simulateSpatialMatch(home, away, { seed, onTick: rec.onTick });
  const track: ReplayTrack = rec.track();
  const replay = await gzipText(JSON.stringify(encodeReplayV3(matchId, track)));
  const resultJson = JSON.stringify(r);
  const before = await gzipText(resultJson);
  const nowJson = JSON.stringify({ ...r, [SIM_REPLAY_FIELD]: bytesToBase64(replay) });
  const now = await gzipText(nowJson);

  // Worker CPU before v3: decode the result, then build + gzip the v2 replay.
  const w0 = performance.now();
  const r0 = JSON.parse(await gunzipText(before)) as { frames: PositionFrame[] };
  await encodeReplayFile(buildReplayPayload(matchId, r0.frames));
  const workerBefore = performance.now() - w0;

  // Worker CPU now: decode the result and take the ready replay off it.
  const w1 = performance.now();
  const r1 = JSON.parse(await gunzipText(now)) as Record<string, unknown>;
  const bytes = takeReplay(r1);
  const workerNow = performance.now() - w1;
  if (!bytes || bytes.length !== replay.length) throw new Error('replay did not survive the round trip');

  // The rejected alternative: the worker builds v3 from denser frames.
  const dense = simulateSpatialMatch(home, away, { seed, frameEverySec: 0.5 });
  const altJson = JSON.stringify({ ...dense, ballKeys: track.ball.keys });
  const alt = await gzipText(altJson);
  const w2 = performance.now();
  const r2 = JSON.parse(await gunzipText(alt)) as { frames: PositionFrame[]; ballKeys: ReplayTrack['ball']['keys'] };
  const altTrack: ReplayTrack = {
    dtSec: 0.1, everySec: 0.5,
    frames: r2.frames.map((f) => f.players),
    ball: { dtSec: 0.1, keys: r2.ballKeys, endTick: track.ball.endTick },
  };
  await gzipText(JSON.stringify(encodeReplayV3(matchId, altTrack)));
  const workerAlt = performance.now() - w2;

  rows.push({
    req: req.length, rawBefore: resultJson.length, gzBefore: before.length, rawNow: nowJson.length, gzNow: now.length,
    replay: replay.length, rawAlt: altJson.length, gzAlt: alt.length, workerBefore, workerNow, workerAlt,
  });
  console.log(
    `${h}v${a} seed=${seed}: request ${kb(req.length)} | response before v3 raw ${kb(resultJson.length)} gzip ${kb(before.length)} | ` +
    `now raw ${kb(nowJson.length)} gzip ${kb(now.length)} (replay ${kb(replay.length)}) | ` +
    `worker-builds alternative raw ${kb(altJson.length)} gzip ${kb(alt.length)} | ` +
    `worker decode ms: before ${workerBefore.toFixed(0)}, now ${workerNow.toFixed(0)}, alternative ${workerAlt.toFixed(0)}`,
  );
}

const max = (k: string): number => Math.max(...rows.map((r) => r[k]!));
const mean = (k: string): number => rows.reduce((s, r) => s + r[k]!, 0) / rows.length;
console.log(`response gzip: before v3 max ${kb(max('gzBefore'))}, now max ${kb(max('gzNow'))} (${(max('gzNow') / 1048576).toFixed(2)} MB of the 4.5 MB cap); raw now max ${kb(max('rawNow'))}`);
console.log(`worker-builds alternative: raw max ${kb(max('rawAlt'))} (${(max('rawAlt') / 1048576).toFixed(1)} MB), gzip max ${kb(max('gzAlt'))}`);
for (const k of ['workerBefore', 'workerNow', 'workerAlt']) {
  console.log(`${k}: mean ${mean(k).toFixed(0)} ms, max ${max(k).toFixed(0)} ms on this machine, about ${(max(k) * EDGE_FACTOR).toFixed(0)} ms on the edge (x${EDGE_FACTOR})`);
}
