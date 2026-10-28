// @vitest-environment node
// ── features/match/api/simulateFunction.test.ts ─────────────────────────────
// The remote simulation function (api/simulate.mjs): request validation, the
// one-time ticket gate, and byte-identical results.
//
// The equivalence tests drive the WHOLE chain in-process: the match-worker's
// simulateRemotely (ticket mint, POST, gunzip, parse) talks to this handler
// through an injected fetch, the handler redeems the ticket against a fake
// consume_sim_ticket, simulates and gzips, and the result must equal an
// in-process simulateSpatialMatch for the same inputs and seed byte for byte.
// Node environment: jsdom's Blob lacks stream(), which the gzip helpers need.

import { createHash } from 'node:crypto';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import {
  handleSimulateRequest, gunzipText, SIM_RESULT_CONTENT_TYPE, SIM_MS_HEADER,
  SIM_REPLAY_FIELD, SIM_REPLAY_MS_HEADER,
  SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, type SimulateFunctionDeps,
} from './simulateFunction';
import { simulateRequestSchema, MAX_SIMULATE_REQUEST_BYTES } from './simulateRequest.schema';
import { simulateSpatialMatch, type SpatialTeamInput } from '../logic/spatial/simulateSpatialMatch';
import { toSpatialTeamInput } from '../logic/spatial/spatialEventAdapter';
import { applyTeamTraits } from '../logic/spatial/traitModifiers';
import type { SpatialMatchResult } from '../logic/spatial/types';
import { simulateRemotely, sha256Hex, type SimTicketStore } from '../../../../supabase/functions/match-worker/remoteSim.ts';
import squads from '../../../../scripts/fixtures/bench-teams.json';

// ── Fixtures ────────────────────────────────────────────────────────────────

const PERSONALITIES = ['selfish', 'team_player', 'aggressive', 'cautious', 'creative', 'lazy', 'workhorse', 'balanced'];

/** Deterministic UUID-shaped id (production player ids are UUIDs). */
const uuidFor = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/**
 * A real ISL squad built the way the worker builds it: DB-shaped rows through
 * toSpatialTeamInput, then applyTeamTraits with personalities, so the request
 * carries every optional field the worker can send (bench, playStyle,
 * gameModel, personality).
 */
function workerInput(i: number): SpatialTeamInput {
  const t = (squads as any[])[i];
  const players = (t.ps as unknown[][]).map((p, j) => ({
    id: uuidFor(i * 100 + j), name: String(p[0]), position: String(p[1]), starter: Boolean(p[2]), team_id: t.id,
    attacking: Number(p[3]), defending: Number(p[4]), mental: Number(p[5]), athletic: Number(p[6]), technical: Number(p[7]),
  }));
  const base = toSpatialTeamInput({
    managers: [{ preferred_formation: t.f, style: t.s, game_model: t.gm }],
    players,
  });
  const personalities = new Map(players.map((p, j) => [p.id, j % 3 === 0 ? PERSONALITIES[j % PERSONALITIES.length] : null]));
  return applyTeamTraits(base, personalities);
}

const MATCH_ID = '6f1c1a52-6a43-4d0e-9a1f-3b6d5f0c9e21';
const TICKET_ID = 'a3b1f1e2-1111-4c2d-8e9f-0123456789ab';
const TOKEN = 'ab'.repeat(32);

let HOME: SpatialTeamInput;
let AWAY: SpatialTeamInput;
beforeAll(() => {
  HOME = workerInput(0);
  AWAY = workerInput(2);
});

const validBody = (over: Record<string, unknown> = {}) => ({
  matchId: MATCH_ID, ticketId: TICKET_ID, token: TOKEN, seed: 1000, home: HOME, away: AWAY, ...over,
});

const post = (body: unknown, headers: Record<string, string> = {}): Request =>
  new Request('https://example.test/api/simulate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

/** Deps whose ticket RPC answers with `answer` (a JSON value) and `status`. */
function rpcDeps(answer: unknown, status = 200): SimulateFunctionDeps & { fetch: ReturnType<typeof vi.fn> } {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(answer), { status }));
  return { fetch: fetchMock as unknown as typeof fetch & ReturnType<typeof vi.fn>, supabaseUrl: SUPABASE_URL, publishableKey: SUPABASE_PUBLISHABLE_KEY };
}

async function errorOf(res: Response): Promise<string> {
  return ((await res.json()) as { error: string }).error;
}

/** Same canonical form as scripts/engine-fingerprint.ts: sorted keys. */
function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') {
    if (typeof v === 'number' && !Number.isFinite(v)) return `"${String(v)}"`;
    return JSON.stringify(v) ?? 'null';
  }
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
}
const sha = (s: string): string => createHash('sha256').update(s).digest('hex');

// ── Validation and authentication ───────────────────────────────────────────

describe('simulate function: refusals', () => {
  it('405 for anything but POST', async () => {
    const deps = rpcDeps(MATCH_ID);
    const res = await handleSimulateRequest(new Request('https://example.test/api/simulate'), deps);
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it('413 for a declared or actual body over the limit', async () => {
    const deps = rpcDeps(MATCH_ID);
    const big = JSON.stringify({ pad: 'x'.repeat(MAX_SIMULATE_REQUEST_BYTES) });
    expect((await handleSimulateRequest(post(big), deps)).status).toBe(413);
    expect((await handleSimulateRequest(post('{}', { 'Content-Length': String(MAX_SIMULATE_REQUEST_BYTES + 1) }), deps)).status).toBe(413);
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it('400 for a body that is not a JSON object', async () => {
    const deps = rpcDeps(MATCH_ID);
    for (const body of ['not json', '[1,2]', 'null', '42']) {
      const res = await handleSimulateRequest(post(body), deps);
      expect(res.status, body).toBe(400);
    }
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it('401 without a well-formed ticket, before any database call', async () => {
    const deps = rpcDeps(MATCH_ID);
    const cases = [
      { seed: 1, home: {}, away: {} },
      validBody({ ticketId: undefined }),
      validBody({ token: undefined }),
      validBody({ matchId: undefined }),
      validBody({ ticketId: 'not-a-uuid' }),
      validBody({ token: 'short' }),
      validBody({ token: 'Z'.repeat(64) }),
    ];
    for (const body of cases) {
      const res = await handleSimulateRequest(post(body), deps);
      expect(res.status).toBe(401);
      expect(await errorOf(res)).toBe('missing or malformed ticket');
    }
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it('400 for malformed inputs with a valid-looking ticket, and the ticket is NOT redeemed', async () => {
    const deps = rpcDeps(MATCH_ID);
    const badPlayer = { ...HOME, players: [{ ...HOME.players[0], role: 'XX' }] };
    const nanStats = { ...HOME, players: [{ ...HOME.players[0], stats: { ...HOME.players[0]!.stats, speed: 'fast' } }] };
    const cases = [
      validBody({ seed: -1 }),
      validBody({ seed: 1.5 }),
      validBody({ seed: 2 ** 32 }),
      validBody({ home: undefined }),
      validBody({ away: { formation: '4-4-2', players: [] } }),
      validBody({ home: badPlayer }),
      validBody({ home: nanStats }),
      validBody({ home: { ...HOME, players: Array.from({ length: 23 }, () => HOME.players[0]) } }),
      validBody({ home: { ...HOME, gameModel: { tempo: { nested: true } } } }),
    ];
    for (const body of cases) {
      const res = await handleSimulateRequest(post(body), deps);
      expect(res.status).toBe(400);
    }
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it('redeems the ticket with the publishable key only, and 403 when it is refused', async () => {
    const deps = rpcDeps(null);
    const res = await handleSimulateRequest(post(validBody()), deps);
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toBe('ticket rejected');
    expect(deps.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = deps.fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${SUPABASE_URL}/rest/v1/rpc/consume_sim_ticket`);
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['apikey']).toBe(SUPABASE_PUBLISHABLE_KEY);
    expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain('authorization');
    expect(JSON.parse(String(init.body))).toEqual({ p_id: TICKET_ID, p_token: TOKEN });
  });

  it('403 when the ticket belongs to a different match', async () => {
    const res = await handleSimulateRequest(post(validBody()), rpcDeps('11111111-1111-4111-8111-111111111111'));
    expect(res.status).toBe(403);
  });

  it('503 when the ticket RPC does not exist (migration not applied), 502 on other failures', async () => {
    expect((await handleSimulateRequest(post(validBody()), rpcDeps({ code: 'PGRST202' }, 404))).status).toBe(503);
    expect((await handleSimulateRequest(post(validBody()), rpcDeps({ message: 'boom' }, 500))).status).toBe(502);
    const throwing: SimulateFunctionDeps = {
      fetch: (async () => { throw new Error('network down'); }) as typeof fetch,
      supabaseUrl: SUPABASE_URL, publishableKey: SUPABASE_PUBLISHABLE_KEY,
    };
    expect((await handleSimulateRequest(post(validBody()), throwing)).status).toBe(502);
  });
});

// ── The payload schema accepts what the worker really sends ─────────────────

describe('simulate request schema', () => {
  it('accepts the worker-built inputs of every real squad after a JSON round trip', () => {
    for (let i = 0; i < (squads as unknown[]).length; i++) {
      const body = JSON.parse(JSON.stringify(validBody({ home: workerInput(i), away: workerInput((i + 1) % 6) })));
      const parsed = simulateRequestSchema.safeParse(body);
      expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [])).toBe(true);
    }
  });

  it('fits a real request well inside the size limit', () => {
    expect(JSON.stringify(validBody()).length).toBeLessThan(MAX_SIMULATE_REQUEST_BYTES / 4);
  });
});

// ── Byte-identical results, worker to function to worker ─────────────────────

describe('remote simulation equals in-process simulation', () => {
  /** A fake sim_tickets table + consume_sim_ticket with the SQL semantics. */
  function fakeTicketDb() {
    const rows = new Map<string, { match_id: string; token_hash: string; used: boolean }>();
    let n = 0;
    const store: SimTicketStore = {
      async insert(row) {
        const id = uuidFor(900000 + ++n);
        rows.set(id, { ...row, used: false });
        return id;
      },
    };
    const consume = async (id: string, token: string): Promise<string | null> => {
      const r = rows.get(id);
      if (!r || r.used || r.token_hash !== (await sha256Hex(token))) return null;
      r.used = true;
      return r.match_id;
    };
    return { rows, store, consume };
  }

  /** fetch that routes the RPC to the fake DB and the function URL to the handler. */
  function wire(db: ReturnType<typeof fakeTicketDb>, record?: (body: string) => void): typeof fetch {
    const handlerDeps: SimulateFunctionDeps = {
      supabaseUrl: SUPABASE_URL, publishableKey: SUPABASE_PUBLISHABLE_KEY,
      fetch: (async (_url: string, init: RequestInit) => {
        const { p_id, p_token } = JSON.parse(String(init.body)) as { p_id: string; p_token: string };
        return new Response(JSON.stringify(await db.consume(p_id, p_token)), { status: 200 });
      }) as unknown as typeof fetch,
    };
    return (async (url: string, init: RequestInit) => {
      record?.(String(init.body));
      return handleSimulateRequest(new Request(url, init), handlerDeps);
    }) as unknown as typeof fetch;
  }

  const SIM_URL = 'https://example.test/api/simulate';

  it.each([
    { name: 'earth v jupiter', h: 0, a: 2, seed: 1000 },
    { name: 'pluto v ceres', h: 5, a: 4, seed: 4294967295 },
  ])('$name: identical result through the ticketed round trip', async ({ h, a, seed }) => {
    const home = workerInput(h);
    const away = workerInput(a);
    const local: SpatialMatchResult = simulateSpatialMatch(home, away, { seed });

    const db = fakeTicketDb();
    const sent: string[] = [];
    const remote = await simulateRemotely({
      url: SIM_URL, fetch: wire(db, (b) => sent.push(b)), tickets: db.store,
      matchId: MATCH_ID, home, away, seed,
    });

    // Byte-identical JSON (key order included) and the same canonical hash
    // as scripts/engine-fingerprint.ts would compute.
    expect(JSON.stringify(remote.result)).toBe(JSON.stringify(local));
    expect(sha(canonical(remote.result))).toBe(sha(canonical(local)));
    expect(remote.result.finalScore).toEqual(local.finalScore);
    expect(remote.simMs).not.toBeNull();
    expect(remote.bytes).toBeGreaterThan(0);

    // The v3 replay recorded during the same simulation, stripped off the
    // result above and handed back as the exact bytes to store.
    expect(remote.replay).not.toBeNull();
    const file = JSON.parse(await gunzipText(remote.replay!)) as { format: string; v: number; matchId: string; frames: number };
    expect(file.format).toBe('isl-replay');
    expect(file.v).toBe(3);
    expect(file.matchId).toBe(MATCH_ID);
    expect(file.frames).toBeGreaterThan(3.9 * local.frames.length);

    // The ticket: one row, stored as a hash (never the plain token), now used.
    expect(db.rows.size).toBe(1);
    const [row] = [...db.rows.values()];
    const body = JSON.parse(sent[0]!) as { token: string; ticketId: string; matchId: string };
    expect(row!.match_id).toBe(MATCH_ID);
    expect(row!.token_hash).toBe(await sha256Hex(body.token));
    expect(row!.token_hash).not.toContain(body.token);
    expect(row!.used).toBe(true);
    expect(body.matchId).toBe(MATCH_ID);
  }, 180_000);

  it('a replayed request is refused: tickets are single use', async () => {
    const db = fakeTicketDb();
    const sent: string[] = [];
    const fetchImpl = wire(db, (b) => sent.push(b));
    await simulateRemotely({ url: SIM_URL, fetch: fetchImpl, tickets: db.store, matchId: MATCH_ID, home: workerInput(1), away: workerInput(3), seed: 7 });
    const replay = await fetchImpl(SIM_URL, { method: 'POST', body: sent[0]!, headers: { 'Content-Type': 'application/json' } });
    expect(replay.status).toBe(403);
  }, 180_000);

  it('the 200 response is gzip of the result JSON plus the replay, with the timing headers', async () => {
    const db = fakeTicketDb();
    const ticketId = await db.store.insert({ match_id: MATCH_ID, token_hash: await sha256Hex(TOKEN) });
    const res = await wire(db)(SIM_URL, { method: 'POST', body: JSON.stringify(validBody({ ticketId, seed: 21 })) });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe(SIM_RESULT_CONTENT_TYPE);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(Number(res.headers.get(SIM_MS_HEADER))).toBeGreaterThanOrEqual(0);
    expect(Number(res.headers.get(SIM_REPLAY_MS_HEADER))).toBeGreaterThanOrEqual(0);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b]);
    const sent = JSON.parse(await gunzipText(bytes)) as Record<string, unknown>;
    expect(typeof sent[SIM_REPLAY_FIELD]).toBe('string');
    delete sent[SIM_REPLAY_FIELD];
    expect(JSON.stringify(sent)).toBe(JSON.stringify(simulateSpatialMatch(HOME, AWAY, { seed: 21 })));
    // Vercel caps a response at 4.5 MB: the gzipped result must be far below.
    expect(bytes.byteLength).toBeLessThan(1.5 * 1024 * 1024);
  }, 180_000);
});
