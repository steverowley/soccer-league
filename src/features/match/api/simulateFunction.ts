// ── features/match/api/simulateFunction.ts ──────────────────────────────────
// The remote match simulation: a Web-standard Request -> Response handler that
// runs the spatial engine for the match-worker.  scripts/build-api.mjs bundles
// it (with the engine and zod) into api/simulate.mjs, which Vercel serves as a
// Node.js function at POST /api/simulate.
//
// WHY IT EXISTS
//   A full match costs about 5 s of CPU on a Supabase edge function, whose
//   budget is about 2 s, so production killed every match with HTTP 546 right
//   after simulating and nothing completed.  The worker now claims the match,
//   builds both team inputs, mints a one-time ticket, POSTs here and awaits
//   the answer (waiting on fetch costs no edge CPU), then adapts and persists
//   exactly as before.
//
// AUTHENTICATION: ONE-TIME DATABASE TICKETS (migration 0090)
//   No secret is shared between Supabase and Vercel.  The worker (service
//   role) inserts a sim_tickets row holding sha256(token) and the match id and
//   sends {ticketId, token, matchId}.  This handler redeems the ticket through
//   the consume_sim_ticket RPC with the PUBLIC publishable key (role anon) and
//   simulates only when the RPC returns the same match id.  A ticket works
//   once, for five minutes, and only with the plain token, which never touches
//   the database.  Anyone can call this endpoint; nobody without a ticket the
//   service role minted can make it simulate.
//
// ORDER OF CHECKS (cheapest first, nothing burns a ticket before validation)
//   405 not POST -> 413 body too large -> 400 not JSON -> 401 missing or
//   malformed ticket -> 400 malformed inputs -> 403 ticket refused (503/502
//   when the ticket service itself fails) -> 200 simulated.
//
// RESPONSE
//   The complete SpatialMatchResult, JSON then gzip, as application/gzip.  A
//   real match is about 4.2 MB of JSON (3.9 MB of it replay frames), right at
//   Vercel's 4.5 MB response cap, and about 0.32 MB gzipped
//   (scripts/measure-sim-payload.ts).  The worker gunzips it and carries on
//   with the very object an in-process simulation would have returned.
//
// DETERMINISM
//   The engine receives the ORIGINAL parsed JSON (the schema only gates it), so
//   for the same inputs and seed the result is byte-identical to an in-process
//   run; simulateFunction.test.ts hashes both to prove it.

import { simulateSpatialMatch, type SpatialTeamInput } from '../logic/spatial/simulateSpatialMatch';
import {
  MAX_SIMULATE_REQUEST_BYTES,
  simulateRequestSchema,
  simulateTicketSchema,
} from './simulateRequest.schema';

// ── Configuration ──────────────────────────────────────────────────────────

/** Production Supabase project.  Public: it ships in every browser bundle. */
export const SUPABASE_URL = 'https://ddtpbipkqamuxnvupddc.supabase.co';

/**
 * The publishable (anon) key, public by design: it ships in every browser
 * bundle (src/shared/supabase/client.ts) and RLS plus the grants in migration
 * 0090 are the boundary.  Hardcoded because a Vercel function cannot read the
 * build-time VITE_ variables and no runtime env var is configured.
 */
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_bbRGJ2fM9IQ9typ5x_Kwlg_R2gtgasP';

/** How long to wait for the ticket RPC before giving up (ms). */
const TICKET_RPC_TIMEOUT_MS = 10_000;

/** Content type of a successful response: gzip of the result's JSON. */
export const SIM_RESULT_CONTENT_TYPE = 'application/gzip';

/** Header carrying the engine's wall time for the match, in ms. */
export const SIM_MS_HEADER = 'X-Sim-Ms';

export interface SimulateFunctionDeps {
  /** fetch used for the ticket RPC (injected by tests). */
  fetch:          typeof fetch;
  supabaseUrl:    string;
  publishableKey: string;
}

export const defaultSimulateFunctionDeps = (): SimulateFunctionDeps => ({
  fetch:          (input, init) => fetch(input, init),
  supabaseUrl:    SUPABASE_URL,
  publishableKey: SUPABASE_PUBLISHABLE_KEY,
});

// ── Helpers ────────────────────────────────────────────────────────────────

function json(status: number, body: Record<string, unknown>, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra },
  });
}

/** gzip a string with the Web Streams API (Node 18+, Deno, browsers). */
export async function gzipText(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Inverse of gzipText. */
export async function gunzipText(bytes: Uint8Array | ArrayBuffer): Promise<string> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

type TicketOutcome = 'accepted' | 'rejected' | 'unavailable' | 'failed';

/**
 * Redeem a ticket through `consume_sim_ticket`.  'accepted' only when the RPC
 * returns exactly `matchId`; a null or a different id is 'rejected'.
 * 'unavailable' means the RPC does not exist (migration 0090 not applied).
 */
async function redeemTicket(
  deps: SimulateFunctionDeps,
  ticket: { ticketId: string; token: string; matchId: string },
): Promise<TicketOutcome> {
  let res: Response;
  try {
    res = await deps.fetch(`${deps.supabaseUrl}/rest/v1/rpc/consume_sim_ticket`, {
      method:  'POST',
      headers: { apikey: deps.publishableKey, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ p_id: ticket.ticketId, p_token: ticket.token }),
      signal:  AbortSignal.timeout(TICKET_RPC_TIMEOUT_MS),
    });
  } catch {
    return 'failed';
  }
  if (res.status === 404) return 'unavailable';
  if (!res.ok) return 'failed';
  const returned: unknown = await res.json().catch(() => undefined);
  return returned === ticket.matchId ? 'accepted' : 'rejected';
}

// ── Handler ────────────────────────────────────────────────────────────────

/**
 * Handle one POST /api/simulate.
 *
 * @param request  The incoming request.
 * @param deps     fetch + Supabase coordinates for the ticket RPC.
 */
export async function handleSimulateRequest(
  request: Request,
  deps: SimulateFunctionDeps = defaultSimulateFunctionDeps(),
): Promise<Response> {
  if (request.method !== 'POST') {
    return json(405, { error: 'method not allowed' }, { Allow: 'POST' });
  }

  // Size: refuse early on the declared length, then on the bytes actually read
  // (a client may omit or understate Content-Length).
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_SIMULATE_REQUEST_BYTES) {
    return json(413, { error: `body exceeds ${MAX_SIMULATE_REQUEST_BYTES} bytes` });
  }
  const raw = await request.arrayBuffer();
  if (raw.byteLength > MAX_SIMULATE_REQUEST_BYTES) {
    return json(413, { error: `body exceeds ${MAX_SIMULATE_REQUEST_BYTES} bytes` });
  }

  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return json(400, { error: 'body is not valid JSON' });
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return json(400, { error: 'body must be a JSON object' });
  }

  const ticket = simulateTicketSchema.safeParse(body);
  if (!ticket.success) {
    return json(401, { error: 'missing or malformed ticket' });
  }

  const parsed = simulateRequestSchema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`);
    return json(400, { error: 'malformed simulation inputs', issues });
  }

  const outcome = await redeemTicket(deps, ticket.data);
  if (outcome === 'unavailable') return json(503, { error: 'ticket service unavailable' });
  if (outcome === 'failed') return json(502, { error: 'ticket check failed' });
  if (outcome === 'rejected') return json(403, { error: 'ticket rejected' });

  // Simulate the ORIGINAL object, not Zod's output: the schema gates, it never
  // reshapes, so the engine sees what the worker built (see the file header).
  const input = body as { home: SpatialTeamInput; away: SpatialTeamInput; seed: number };
  const t0 = performance.now();
  let encoded: Uint8Array;
  try {
    const result = simulateSpatialMatch(input.home, input.away, { seed: input.seed });
    encoded = await gzipText(JSON.stringify(result));
  } catch (err) {
    return json(500, { error: `simulation failed: ${(err as Error)?.message ?? String(err)}` });
  }
  const ms = Math.round(performance.now() - t0);

  return new Response(encoded as BodyInit, {
    status: 200,
    headers: {
      'Content-Type':  SIM_RESULT_CONTENT_TYPE,
      'Cache-Control': 'no-store',
      [SIM_MS_HEADER]: String(ms),
    },
  });
}
