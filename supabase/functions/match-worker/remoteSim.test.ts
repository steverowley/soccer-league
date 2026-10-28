// @vitest-environment node
// ── match-worker/remoteSim.test.ts ───────────────────────────────────────────
// The worker half of the remote simulation: ticket minting and the failure
// policy (every failure throws so processMatch requeues the match; there is no
// in-process fallback).  The happy path, end to end against the real Vercel
// handler, lives in src/features/match/api/simulateFunction.test.ts.

import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { describe, it, expect, vi } from 'vitest';
import {
  mintSimTicket, newTicketToken, sha256Hex, simulateRemotely, takeReplay,
  DEFAULT_SIM_URL, REMOTE_SIM_TIMEOUT_MS, SIM_REPLAY_FIELD, MAX_REPLAY_BYTES, type SimTicketStore,
} from './remoteSim.ts';
import { SIM_REPLAY_FIELD as FUNCTION_REPLAY_FIELD } from '../../../src/features/match/api/simulateFunction.ts';
import type { SpatialTeamInput } from './spatial/simulateSpatialMatch.ts';

const MATCH_ID = '6f1c1a52-6a43-4d0e-9a1f-3b6d5f0c9e21';
const TEAM: SpatialTeamInput = { formation: '4-4-2', players: [] };

function store(): SimTicketStore & { rows: Array<{ match_id: string; token_hash: string }> } {
  const rows: Array<{ match_id: string; token_hash: string }> = [];
  return {
    rows,
    async insert(row) {
      rows.push(row);
      return `00000000-0000-4000-8000-${String(rows.length).padStart(12, '0')}`;
    },
  };
}

const okResult = { finalScore: [2, 1], events: [{ tSec: 0, minute: 1, type: 'kickoff' }], frames: [{ tSec: 0, players: [], ball: { x: 0, y: 0, ownerId: null } }] };
const gz = (v: unknown) => new Uint8Array(gzipSync(Buffer.from(JSON.stringify(v))));

describe('tickets', () => {
  it('sha256Hex matches Node crypto (and so the SQL encode(sha256(...), hex))', async () => {
    for (const s of ['', 'abc', 'ab'.repeat(32), 'unicode \u00e9']) {
      expect(await sha256Hex(s)).toBe(createHash('sha256').update(s, 'utf8').digest('hex'));
    }
  });

  it('tokens are 64 lowercase hex characters and never repeat', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const t = newTicketToken();
      expect(t).toMatch(/^[0-9a-f]{64}$/);
      seen.add(t);
    }
    expect(seen.size).toBe(200);
  });

  it('stores only the hash and the match id; the plain token is returned to the caller', async () => {
    const s = store();
    const { ticketId, token } = await mintSimTicket(s, MATCH_ID);
    expect(ticketId).toMatch(/^0{8}-/);
    expect(s.rows).toEqual([{ match_id: MATCH_ID, token_hash: await sha256Hex(token) }]);
    expect(JSON.stringify(s.rows)).not.toContain(token);
  });
});

describe('simulateRemotely', () => {
  it('defaults to production with a 45 s timeout', () => {
    expect(DEFAULT_SIM_URL).toBe('https://soccer-league-one.vercel.app/api/simulate');
    expect(REMOTE_SIM_TIMEOUT_MS).toBe(45_000);
  });

  it('sends the ticket, the match id, the seed and both inputs, and decodes the gzip body', async () => {
    const s = store();
    const fetchMock = vi.fn(async () => new Response(gz(okResult) as BodyInit, { status: 200, headers: { 'X-Sim-Ms': '1234' } }));
    const out = await simulateRemotely({ url: 'https://x.test/api/simulate', fetch: fetchMock as unknown as typeof fetch, tickets: s, matchId: MATCH_ID, home: TEAM, away: TEAM, seed: 99 });
    expect(out.result).toEqual(okResult);
    expect(out.simMs).toBe(1234);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://x.test/api/simulate');
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({ matchId: MATCH_ID, ticketId: '00000000-0000-4000-8000-000000000001', token: expect.stringMatching(/^[0-9a-f]{64}$/), seed: 99, home: TEAM, away: TEAM });
    expect(s.rows[0]!.token_hash).toBe(await sha256Hex(body.token));
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('throws (so the match is requeued) on a non-200, with the status in the message', async () => {
    for (const status of [401, 403, 500, 503]) {
      const f = vi.fn(async () => new Response(JSON.stringify({ error: 'nope' }), { status }));
      await expect(simulateRemotely({ url: 'u', fetch: f as unknown as typeof fetch, tickets: store(), matchId: MATCH_ID, home: TEAM, away: TEAM, seed: 1 }))
        .rejects.toThrow(`HTTP ${status}`);
    }
  });

  it('throws on a network error, a timeout, a body that is not gzip, and a malformed result', async () => {
    const run = (f: unknown, timeoutMs?: number) => simulateRemotely({
      url: 'u', fetch: f as typeof fetch, tickets: store(), matchId: MATCH_ID, home: TEAM, away: TEAM, seed: 1, ...(timeoutMs ? { timeoutMs } : {}),
    });
    await expect(run(async () => { throw new TypeError('fetch failed'); })).rejects.toThrow('request failed');
    const hang = (_u: string, init: RequestInit) => new Promise<Response>((_, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
    });
    await expect(run(hang, 20)).rejects.toThrow('request failed');
    await expect(run(async () => new Response('{"finalScore":[1,0]}', { status: 200 }))).rejects.toThrow('could not be decoded');
    for (const bad of [{}, { ...okResult, finalScore: [1] }, { ...okResult, events: [] }, { ...okResult, frames: 'x' }, null]) {
      await expect(run(async () => new Response(gz(bad) as BodyInit, { status: 200 }))).rejects.toThrow('malformed result');
    }
  });

  it('throws without calling the function when the ticket cannot be created', async () => {
    const f = vi.fn();
    const failing: SimTicketStore = { insert: async () => { throw new Error('creating sim ticket failed: relation does not exist'); } };
    await expect(simulateRemotely({ url: 'u', fetch: f as unknown as typeof fetch, tickets: failing, matchId: MATCH_ID, home: TEAM, away: TEAM, seed: 1 }))
      .rejects.toThrow('creating sim ticket failed');
    expect(f).not.toHaveBeenCalled();
  });
});

describe('the replay carried by the response (docs/match-viewer.md 2B)', () => {
  const replayGz = gz({ format: 'isl-replay', v: 3 });
  const b64 = Buffer.from(replayGz).toString('base64');
  const run = (body: unknown) => simulateRemotely({
    url: 'u', fetch: (async () => new Response(gz(body) as BodyInit, { status: 200 })) as unknown as typeof fetch,
    tickets: store(), matchId: MATCH_ID, home: TEAM, away: TEAM, seed: 1,
  });

  it('uses the same field name as the function', () => {
    expect(SIM_REPLAY_FIELD).toBe(FUNCTION_REPLAY_FIELD);
  });

  it('strips the replay off the result and returns its exact bytes', async () => {
    const out = await run({ ...okResult, [SIM_REPLAY_FIELD]: b64 });
    expect(out.result).toEqual(okResult);
    expect(SIM_REPLAY_FIELD in out.result).toBe(false);
    expect(out.replay).toEqual(replayGz);
  });

  it('gives null (the worker writes v2) when an older function sends none', async () => {
    expect((await run(okResult)).replay).toBeNull();
  });

  it('drops, never throws on, a replay that is not gzip or not a string', async () => {
    for (const bad of [Buffer.from('{"v":3}').toString('base64'), 42, '%%%not base64%%%']) {
      const out = await run({ ...okResult, [SIM_REPLAY_FIELD]: bad });
      expect(out.replay).toBeNull();
      expect(out.result).toEqual(okResult);
    }
  });

  it('drops a replay larger than the cap', () => {
    const big = 'A'.repeat(Math.ceil((MAX_REPLAY_BYTES * 4) / 3) + 100);
    expect(takeReplay({ [SIM_REPLAY_FIELD]: big })).toBeNull();
  });
});
