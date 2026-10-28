// ── features/match/logic/replay/replayV3.test.ts ─────────────────────────────
// The v3 replay end to end on a real simulated match (docs/match-viewer.md,
// section 2B): record while the engine runs, encode, gzip, serve from a fake
// Storage, read back through getMatchPositions, sample with sampleFrames.
//
// What a fan would notice, asserted on EVERY engine tick of a full match:
//   - the ball the viewer draws is within 0.1 m (and its height within
//     0.1 m) of where the engine had it, and the viewer names the same
//     player in possession;
//   - every player is where the engine had him at each 0.5 s frame (0.1 m
//     rounding), including after the substitutions;
//   - recording changes nothing: the match is byte-identical with and
//     without the recorder attached;
//   - the file fits the free-tier budget (at most 0.6 MB gzipped).

import { describe, it, expect, beforeAll } from 'vitest';
import {
  simulateSpatialMatch, type SpatialTeamInput, type SpatialPlayerInput,
} from '../spatial/simulateSpatialMatch';
import type { Role, SimPlayerStats } from '../spatial/types';
import { createReplayRecorder, type ReplayTrack } from './recorder';
import { encodeReplayV3, decodeReplayV3 } from './replayV3';
import { getMatchPositions, type PositionSnapshot } from '../../api/matchPositions';
import { sampleFrames } from '../viewer/playback';
import { gzipBytes } from '../../../../../supabase/functions/match-worker/replayFile.ts';

const XI: Role[] = ['GK', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'FW', 'FW'];
const BENCH: Role[] = ['GK', 'DF', 'MF', 'MF', 'FW'];

function stats(base: number, role: Role): SimPlayerStats {
  return {
    shooting: base, passing: base, dribbling: base, speed: base, stamina: base,
    tackling: base, positioning: base, goalkeeping: role === 'GK' ? base + 10 : 40, vision: base,
  };
}

/** A side with a bench, so the engine's substitutions are in the replay. */
function team(prefix: string, base: number): SpatialTeamInput {
  const mk = (role: Role, i: number, tag: string): SpatialPlayerInput => ({
    // Production ids are 36-character UUIDs; the size check needs the same.
    id: `${prefix}-${tag}-${i}`.padEnd(36, '0'), name: `${prefix} ${tag}${i}`, role, stats: stats(base, role),
  });
  return { formation: '4-4-2', players: XI.map((r, i) => mk(r, i, 's')), bench: BENCH.map((r, i) => mk(r, i, 'b')) };
}

const SEED = 4242;

interface Tick { x: number; y: number; z: number; ownerId: string | null }

let track: ReplayTrack;
let ticks: Tick[] = [];
let players: Array<Map<string, { x: number; y: number }>> = [];
let plain = '';
let recorded = '';
let gz: Uint8Array;
let snaps: PositionSnapshot[] = [];

beforeAll(async () => {
  const rec = createReplayRecorder();
  ticks = [];
  players = [];
  const r = simulateSpatialMatch(team('H', 72), team('A', 68), {
    seed: SEED,
    onTick: (w) => {
      rec.onTick(w);
      ticks.push({ x: w.ball.pos.x, y: w.ball.pos.y, z: w.ball.z, ownerId: w.ball.ownerId });
      if ((ticks.length - 1) % 5 === 0) {
        players.push(new Map([...w.home, ...w.away].map((p) => [p.id, { x: p.pos.x, y: p.pos.y }])));
      }
    },
  });
  recorded = JSON.stringify(r);
  plain = JSON.stringify(simulateSpatialMatch(team('H', 72), team('A', 68), { seed: SEED }));
  track = rec.track();
  gz = await gzipBytes(new TextEncoder().encode(JSON.stringify(encodeReplayV3('m1', track))));
  const url = 'https://storage.test/replays/m1.json.gz';
  const db = {
    storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: url } }) }) },
    from: () => {
      throw new Error('the legacy tables must not be read when the replay file exists');
    },
  } as unknown as Parameters<typeof getMatchPositions>[0];
  const fetch = async (input: string) =>
    input === url ? new Response(gz.slice(), { status: 200 }) : new Response(null, { status: 404 });
  snaps = await getMatchPositions(db, 'm1', { fetch });
}, 180_000);

describe('v3 replay of a full simulated match', () => {
  it('recording never alters the match', () => {
    expect(recorded).toBe(plain);
  });

  it('decodes to one snapshot per 0.5 s frame sharing one ball track', () => {
    expect(snaps.length).toBe(track.frames.length);
    expect(snaps.length).toBe(Math.floor((ticks.length - 1) / 5) + 1);
    expect(snaps[1]!.tSec).toBe(0.5);
    expect(snaps[0]!.ballTrack).toBeDefined();
    expect(snaps.every((s) => s.ballTrack === snaps[0]!.ballTrack)).toBe(true);
    expect(snaps[0]!.ballTrack!.keys.length).toBe(track.ball.keys.length);
  });

  it('replays the ball within 0.1 m of the engine on every tick, with the same owner', () => {
    let worst = 0;
    let worstZ = 0;
    let ownerMisses = 0;
    for (let i = 0; i < ticks.length; i++) {
      const t = ticks[i]!;
      const s = sampleFrames(snaps, Math.round(i * track.dtSec * 1000) / 1000).ball!;
      worst = Math.max(worst, Math.hypot(s.x - t.x, s.y - t.y));
      worstZ = Math.max(worstZ, Math.abs(s.z - t.z));
      if (s.ownerId !== t.ownerId) ownerMisses += 1;
    }
    expect(ticks.length).toBeGreaterThan(54_000);
    expect(worst).toBeLessThan(0.1);
    expect(worstZ).toBeLessThan(0.1);
    expect(ownerMisses).toBe(0);
  });

  it('the ball really flies: heights above a metre are replayed', () => {
    const high = ticks.filter((t) => t.z > 1).length;
    expect(high).toBeGreaterThan(50);
  });

  it('draws every player where the engine had him at each frame, through the substitutions', () => {
    let worst = 0;
    let checked = 0;
    for (let f = 0; f < players.length; f++) {
      const s = sampleFrames(snaps, f * 0.5).players;
      expect(s.size).toBe(players[f]!.size);
      for (const [id, p] of players[f]!) {
        const q = s.get(id);
        expect(q, `frame ${f} player ${id}`).toBeDefined();
        worst = Math.max(worst, Math.abs(q!.x - p.x), Math.abs(q!.y - p.y));
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(200_000);
    expect(worst).toBeLessThanOrEqual(0.05 + 1e-9);
    const ids = new Set(players.flatMap((m) => [...m.keys()]));
    expect(ids.size).toBeGreaterThan(22);
  });

  it('decodes back to the recorded ball keyframes exactly', () => {
    const back = decodeReplayV3(encodeReplayV3('m1', track))!;
    expect(back.ball.keys).toEqual(track.ball.keys);
    expect(back.ball.endTick).toBe(track.ball.endTick);
  });

  it('fits the free-tier budget: at most 0.6 MB gzipped', () => {
    expect(gz.length).toBeLessThan(0.6 * 1024 * 1024);
  });
});
