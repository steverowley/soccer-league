// ── shared/readCache/readCacheFunction.ts ───────────────────────────────────
// The read cache (docs/read-cache.md): a Web-standard Request -> Response
// handler that forwards a fan's public PostgREST read to Supabase and marks a
// successful answer cacheable on Vercel's CDN.  scripts/build-api.mjs bundles
// it into api/db.mjs; vercel.json rewrites /api/db/rest/v1/<resource> to it.
//
// WHY IT EXISTS
//   The project runs on Supabase's free Nano instance, whose CPU is shared and
//   burst-credited.  About 1,400 public page reads in 15 minutes tipped it over
//   for hours (#712).  Through this proxy, identical reads inside the TTL are
//   answered by the CDN and never reach the function or the database, so
//   database load grows with the number of distinct queries per minute
//   instead of with the number of fans.
//
// RULES (each one is tested in readCacheBundle.test.ts)
//   - GET and HEAD only (405 otherwise); only allow-listed resources (404).
//   - The query string is forwarded byte for byte (PostgREST filters live in
//     it and the CDN keys on it).
//   - Only accept, accept-profile (must be `public`), range and the count
//     token of prefer are forwarded.  Never Authorization, never cookies: the
//     upstream request always runs as anon with the publishable key, so a
//     cached body can never hold one user's personal rows.
//   - 200 -> Cache-Control public with s-maxage, stale-while-revalidate and
//     stale-if-error from the allow-list.  Anything else -> no-store, so an
//     error, an empty single-row miss (406) or a partial range is never cached.
//   - The upstream gets 8 s; a timeout answers 504, a network failure 502.

import {
  READ_CACHE_ALLOW_LIST,
  READ_CACHE_SCHEMA,
  cacheControlFor,
  isReadCacheResource,
} from './allowList';

// ── Configuration ──────────────────────────────────────────────────────────

/** Production Supabase project.  Public: it ships in every browser bundle. */
export const SUPABASE_URL = 'https://ddtpbipkqamuxnvupddc.supabase.co';

/**
 * The publishable (anon) key, public by design (it ships in every browser
 * bundle; RLS is the boundary).  Hardcoded because a Vercel function cannot
 * read the build-time VITE_ variables and no runtime env var is configured.
 * PostgREST accepts it in the `apikey` header.
 */
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_bbRGJ2fM9IQ9typ5x_Kwlg_R2gtgasP';

/** How long the upstream may take before the proxy answers 504 (ms). */
export const UPSTREAM_TIMEOUT_MS = 8_000;

/** Longest query string the proxy forwards (PostgREST URLs here are short). */
export const MAX_QUERY_LENGTH = 8_192;

/**
 * Query parameter the vercel.json rewrite uses to pass the resource name
 * (`/api/db/rest/v1/:resource` -> `/api/db?__resource=:resource`).  Stripped
 * before forwarding, so PostgREST never sees it as a filter.
 */
export const RESOURCE_PARAM = '__resource';

/** Path prefix the client uses: supabase-js appends /rest/v1/<resource>. */
const PATH_RE = /^\/api\/db\/rest\/v1\/([^/]+)\/?$/;

/** A PostgREST resource name: a plain identifier. */
const RESOURCE_RE = /^[a-z_][a-z0-9_]*$/;

/** `prefer` tokens worth forwarding: only the count request. */
const COUNT_TOKEN_RE = /^count=(exact|planned|estimated)$/;

/** Response header naming the resource, so a curl shows which policy applied. */
export const RESOURCE_HEADER = 'X-Read-Cache-Resource';

/**
 * Request headers that change the body: Accept (object vs array), the schema
 * and the count.  Vercel keys on Accept by default; naming it is harmless.
 */
const VARY = 'Accept, Accept-Profile, Prefer';

export interface ReadCacheDeps {
  /** fetch used for the upstream call (injected by tests). */
  fetch:          typeof fetch;
  supabaseUrl:    string;
  publishableKey: string;
  timeoutMs:      number;
}

export const defaultReadCacheDeps = (): ReadCacheDeps => ({
  fetch:          (input, init) => fetch(input, init),
  supabaseUrl:    SUPABASE_URL,
  publishableKey: SUPABASE_PUBLISHABLE_KEY,
  timeoutMs:      UPSTREAM_TIMEOUT_MS,
});

// ── Helpers ────────────────────────────────────────────────────────────────

/** A small JSON answer that is never cached. */
function refuse(status: number, error: string, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra },
  });
}

/**
 * The resource a request is for: from the path when the function sees the
 * original URL, otherwise from the rewrite's query parameter.  Null when
 * neither names one.
 */
export function resolveResource(url: URL): string | null {
  const m = PATH_RE.exec(url.pathname);
  let raw: string | null = m ? m[1]! : null;
  if (raw === null && /^\/api\/db\/?$/.test(url.pathname)) raw = url.searchParams.get(RESOURCE_PARAM);
  if (raw === null) return null;
  try {
    raw = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return RESOURCE_RE.test(raw) ? raw : null;
}

/**
 * The query string to forward: the original, byte for byte, minus the
 * rewrite's resource parameter.  Keeps the leading `?` (or is empty).
 */
export function forwardedQuery(url: URL): string {
  const search = url.search.startsWith('?') ? url.search.slice(1) : url.search;
  if (search === '') return '';
  const kept = search
    .split('&')
    .filter((part) => part !== '' && !part.startsWith(`${RESOURCE_PARAM}=`) && part !== RESOURCE_PARAM);
  return kept.length > 0 ? `?${kept.join('&')}` : '';
}

/**
 * The headers sent upstream: the safe subset of the client's, plus the
 * publishable key.  Returns null when the client asked for another schema.
 */
export function upstreamHeaders(request: Request, publishableKey: string): Headers | null {
  const out = new Headers();
  const accept = request.headers.get('accept');
  if (accept) out.set('Accept', accept);
  const profile = request.headers.get('accept-profile');
  if (profile !== null) {
    if (profile.trim() !== READ_CACHE_SCHEMA) return null;
    out.set('Accept-Profile', READ_CACHE_SCHEMA);
  }
  const range = request.headers.get('range');
  if (range) out.set('Range', range);
  const prefer = request.headers.get('prefer');
  if (prefer) {
    const count = prefer
      .split(',')
      .map((t) => t.trim())
      .find((t) => COUNT_TOKEN_RE.test(t));
    if (count) out.set('Prefer', count);
  }
  out.set('apikey', publishableKey);
  return out;
}

// ── Handler ────────────────────────────────────────────────────────────────

/**
 * Serve one read-cache request.
 *
 * @param request  The incoming Web Request (GET or HEAD).
 * @param deps     Upstream fetch, URL, key and timeout (tests inject these).
 * @returns        The upstream body with cache headers, or a no-store refusal.
 */
export async function handleReadCacheRequest(
  request: Request,
  deps: ReadCacheDeps = defaultReadCacheDeps(),
): Promise<Response> {
  const method = request.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    return refuse(405, 'method not allowed', { Allow: 'GET, HEAD' });
  }

  const url = new URL(request.url);
  const resource = resolveResource(url);
  if (resource === null || !isReadCacheResource(resource)) {
    return refuse(404, 'not in the read cache allow-list');
  }
  const policy = READ_CACHE_ALLOW_LIST[resource]!;

  const query = forwardedQuery(url);
  if (query.length > MAX_QUERY_LENGTH) return refuse(414, 'query too long');

  const headers = upstreamHeaders(request, deps.publishableKey);
  if (headers === null) return refuse(400, 'only the public schema is served');

  let upstream: Response;
  try {
    upstream = await deps.fetch(`${deps.supabaseUrl}/rest/v1/${resource}${query}`, {
      method,
      headers,
      signal: AbortSignal.timeout(deps.timeoutMs),
    });
  } catch (err) {
    const name = (err as { name?: string } | null)?.name;
    if (name === 'TimeoutError' || name === 'AbortError') return refuse(504, 'database timed out');
    return refuse(502, 'database unreachable');
  }

  let body: ArrayBuffer | null = null;
  if (method !== 'HEAD') {
    try {
      body = await upstream.arrayBuffer();
    } catch (err) {
      const name = (err as { name?: string } | null)?.name;
      if (name === 'TimeoutError' || name === 'AbortError') return refuse(504, 'database timed out');
      return refuse(502, 'database response failed');
    }
  }

  const out = new Headers({
    'Content-Type':  upstream.headers.get('content-type') ?? 'application/json; charset=utf-8',
    'Cache-Control': upstream.status === 200 ? cacheControlFor(policy) : 'no-store',
    Vary:            VARY,
    [RESOURCE_HEADER]: resource,
  });
  const contentRange = upstream.headers.get('content-range');
  if (contentRange) out.set('Content-Range', contentRange);

  return new Response(body, { status: upstream.status, headers: out });
}
