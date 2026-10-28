// ── match-worker/remoteSim.ts ────────────────────────────────────────────────
// Runs a match's simulation on Vercel (POST /api/simulate) instead of inside
// this edge function.
//
// WHY
//   Supabase edge functions get about 2 s of CPU per invocation.  A full match
//   costs about 5 s of CPU here (the edge runtime is about 3x slower than a
//   laptop), so every match was killed with HTTP 546 "CPU Time exceeded" right
//   after simulating, before anything was persisted, and was requeued forever.
//   Waiting on a fetch is I/O, not CPU, so the worker keeps claiming,
//   orchestration and persistence and only the engine moves.  The function is
//   the same engine (src/features/match/logic/spatial/, the twin of ./spatial/)
//   bundled into api/simulate.mjs.
//
// AUTHENTICATION: ONE-TIME DATABASE TICKETS (migration 0090)
//   No secret is shared with Vercel.  Per simulation the worker inserts a
//   sim_tickets row (service role) holding sha256(token) and the match id, and
//   sends the ticket id, the plain token and the match id.  The function
//   redeems it with consume_sim_ticket (single use, five minutes) and only
//   simulates when it returns this match id.
//
// FAILURE POLICY
//   Every failure THROWS, so processMatch's existing error path deletes any
//   partial rows and puts the match back to 'scheduled' for the next tick.
//   There is deliberately no in-process fallback: the engine cannot finish
//   inside the edge CPU budget, so a fallback would only reproduce the 546.
//
// Pure apart from the injected fetch and ticket store, so it runs under
// vitest (src/features/match/api/simulateFunction.test.ts drives it against
// the real handler in-process).
//
// THE REPLAY (docs/match-viewer.md, section 2B)
//   The function also records the match's v3 replay file while it simulates
//   and returns it, gzipped and base64-encoded, in one extra result field
//   (SIM_REPLAY_FIELD).  This module strips that field, so `result` stays
//   exactly what the engine returned, and hands the bytes back as `replay`
//   for replayFile.ts to upload unchanged.  The worker never builds a v3
//   replay itself: it could not within the edge CPU budget (the doc has the
//   measurements).  A response without the field (an older deployment) gives
//   `replay: null` and the worker writes its v2 replay from `frames`.

import type { SpatialTeamInput } from './spatial/simulateSpatialMatch.ts';
import type { SpatialMatchResult } from './spatial/types.ts';

/**
 * Result field carrying the gzipped v3 replay as base64.  Must match
 * SIM_REPLAY_FIELD in src/features/match/api/simulateFunction.ts.
 */
export const SIM_REPLAY_FIELD = 'replayGzipBase64';

/** Production endpoint; the worker overrides it with the SIM_URL env var. */
export const DEFAULT_SIM_URL = 'https://soccer-league-one.vercel.app/api/simulate';

/**
 * Give up on the remote simulation after this long (ms).  A match takes about
 * 1 to 2 s on Vercel; the function's own limit is 60 s (vercel.json), and the
 * edge isolate's wall clock is 150 s, so 45 s fails well inside both.
 */
export const REMOTE_SIM_TIMEOUT_MS = 45_000;

/** Where tickets are written.  The worker backs it with the service-role
 *  client: insert {match_id, token_hash} into sim_tickets, return the id. */
export interface SimTicketStore {
  insert(row: { match_id: string; token_hash: string }): Promise<string>;
}

export interface RemoteSimOptions {
  url:        string;
  fetch:      typeof fetch;
  tickets:    SimTicketStore;
  matchId:    string;
  home:       SpatialTeamInput;
  away:       SpatialTeamInput;
  seed:       number;
  timeoutMs?: number;
}

export interface RemoteSimOutcome {
  result:  SpatialMatchResult;
  /** Engine wall time reported by the function (ms), when present. */
  simMs:   number | null;
  /** Ticket insert plus the round trip plus decoding, as seen here (ms). */
  totalMs: number;
  /** Size of the gzipped response body. */
  bytes:   number;
  /**
   * The match's v3 replay file exactly as it is stored (gzip of its JSON),
   * or null when the function sent none (an older deployment, or the replay
   * could not be built): the caller then writes a v2 replay from `frames`.
   */
  replay:  Uint8Array | null;
}

/**
 * The longest replay accepted from the function (bytes, gzipped).  A v3
 * replay is about 0.35 MB; anything far larger is not one, and the free
 * plan's Storage budget assumes at most 0.6 MB a match.
 */
export const MAX_REPLAY_BYTES = 2 * 1024 * 1024;

// ── Tickets ─────────────────────────────────────────────────────────────────

/** Lowercase hex SHA-256 of a UTF-8 string (matches the SQL side's
 *  encode(sha256(convert_to(token, 'UTF8')), 'hex')). */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** A fresh 256-bit token as 64 lowercase hex characters. */
export function newTicketToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Mint a one-time ticket for one match.  Only the hash is stored; the plain
 * token goes to the function and nowhere else.
 */
export async function mintSimTicket(
  tickets: SimTicketStore,
  matchId: string,
): Promise<{ ticketId: string; token: string }> {
  const token = newTicketToken();
  const ticketId = await tickets.insert({ match_id: matchId, token_hash: await sha256Hex(token) });
  return { ticketId, token };
}

// ── Result decoding ─────────────────────────────────────────────────────────

/** Inverse of the function's gzip encoding. */
async function gunzipText(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}

/** Shape check: enough to fail loudly here rather than deep in persistence. */
function assertSpatialResult(v: unknown): asserts v is SpatialMatchResult {
  const r = v as Partial<SpatialMatchResult> | null;
  const ok = !!r && typeof r === 'object'
    && Array.isArray(r.finalScore) && r.finalScore.length === 2
    && r.finalScore.every((n) => Number.isInteger(n) && n >= 0)
    && Array.isArray(r.events) && r.events.length > 0
    && Array.isArray(r.frames) && r.frames.length > 0;
  if (!ok) throw new Error('remote simulation returned a malformed result');
}

/**
 * Take the replay field off a parsed result (so the result is exactly the
 * engine's) and decode it.  A missing, malformed or oversized replay is
 * dropped with a warning, never thrown: the replay is cosmetic and the
 * caller falls back to v2.
 */
export function takeReplay(result: Record<string, unknown>): Uint8Array | null {
  const b64 = result[SIM_REPLAY_FIELD];
  delete result[SIM_REPLAY_FIELD];
  if (typeof b64 !== 'string') return null;
  try {
    if (b64.length > (MAX_REPLAY_BYTES * 4) / 3 + 4) throw new Error(`replay larger than ${MAX_REPLAY_BYTES} bytes`);
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    // gzip magic (RFC 1952): the function sends the file exactly as stored.
    if (bytes.length < 2 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) throw new Error('replay is not gzip');
    return bytes;
  } catch (err) {
    console.warn('[remoteSim] replay from the function ignored:', (err as Error)?.message ?? err);
    return null;
  }
}

// ── Remote simulation ───────────────────────────────────────────────────────

/**
 * Simulate one match on Vercel and return the very SpatialMatchResult an
 * in-process `simulateSpatialMatch(home, away, { seed })` would have.
 *
 * @throws on any failure: ticket insert, network, timeout, non-200, bad body.
 */
export async function simulateRemotely(opts: RemoteSimOptions): Promise<RemoteSimOutcome> {
  const t0 = Date.now();
  const { ticketId, token } = await mintSimTicket(opts.tickets, opts.matchId);

  let res: Response;
  try {
    res = await opts.fetch(opts.url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/gzip' },
      body:    JSON.stringify({
        matchId: opts.matchId, ticketId, token, seed: opts.seed, home: opts.home, away: opts.away,
      }),
      signal:  AbortSignal.timeout(opts.timeoutMs ?? REMOTE_SIM_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(`remote simulation request failed: ${(err as Error)?.message ?? String(err)}`);
  }

  if (res.status !== 200) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(`remote simulation returned HTTP ${res.status}: ${detail}`);
  }

  const bytes = new Uint8Array(await res.arrayBuffer());
  let result: unknown;
  try {
    result = JSON.parse(await gunzipText(bytes));
  } catch (err) {
    throw new Error(`remote simulation body could not be decoded: ${(err as Error)?.message ?? String(err)}`);
  }
  assertSpatialResult(result);
  const replay = takeReplay(result as unknown as Record<string, unknown>);

  const simMsHeader = Number(res.headers.get('x-sim-ms'));
  return {
    result,
    simMs:   Number.isFinite(simMsHeader) && res.headers.has('x-sim-ms') ? simMsHeader : null,
    totalMs: Date.now() - t0,
    bytes:   bytes.byteLength,
    replay,
  };
}
