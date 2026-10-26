// GENERATED FILE, DO NOT EDIT. Built by `npm run build:api` (scripts/build-api.mjs)
// from src/shared/readCache/. Vercel serves it as GET /api/db/rest/v1/<resource>
// (vercel.json rewrite). readCacheBundle.test.ts fails when this file no longer
// matches its sources.

// src/shared/readCache/allowList.ts
var DAY = 86400;
var STATIC = { ttl: 300, staleWhileRevalidate: 3600, staleIfError: DAY };
var MINUTE = { ttl: 60, staleWhileRevalidate: 600, staleIfError: DAY };
var MATCH = { ttl: 30, staleWhileRevalidate: 300, staleIfError: DAY };
var LIVE = { ttl: 10, staleWhileRevalidate: 60, staleIfError: DAY };
var READ_CACHE_ALLOW_LIST = Object.freeze({
  // ── Near-static catalogue ────────────────────────────────────────────────
  teams: { ...STATIC, why: "Club pages, standings and fixture lists; edited by migrations and season rollover only." },
  players: { ...STATIC, why: "Squads and player pages; ratings move with training and elections, minutes of lag is invisible." },
  managers: { ...STATIC, why: "Manager pages; changes only at season rollover." },
  entities: { ...STATIC, why: "World, entity, player and team profile pages; seeded lore." },
  entity_traits: { ...STATIC, why: "Manager page traits; seeded." },
  entity_relationships: { ...STATIC, why: "World relationship graph; changes with narrative events, not per second." },
  entity_persona: { ...STATIC, why: "Entity pages and the viewer thoughts panel; written by seeding and elections." },
  entity_snippets: { ...STATIC, why: "Entity pages and the viewer thoughts panel; seeded voice snippets." },
  entity_memories: { ...STATIC, why: "Entity page memory list; grows a few rows per match." },
  competitions: { ...STATIC, why: "Match duration and season lookups; created at season rollover." },
  season_config: { ...STATIC, why: "Match duration lookup; written at season rollover." },
  team_supporter_count_v: { ...STATIC, why: "Supporter count on club pages; moves when a fan picks a club." },
  // ── About a minute ───────────────────────────────────────────────────────
  seasons: { ...MINUTE, why: "Season list, season pages and the season phase banner; status changes a few times a season." },
  match_player_stats: { ...MINUTE, why: "Player pages; written once per finished match." },
  match_lineups: { ...MINUTE, why: "Player recent matches; written once per match." },
  narratives: { ...MINUTE, why: "News feed and player stories; a few rows per match." },
  player_idol_score: { ...MINUTE, why: "Idol board and player rank; aggregate view." },
  match_odds: { ...MINUTE, why: "Odds on the wager widget; computed before kickoff." },
  wager_leaderboard: { ...MINUTE, why: "Public leaderboard view (aggregated, no personal rows)." },
  active_watchers_v: { ...MINUTE, why: "Cosmos-wide watcher count on match pages; the page polls it every 60 s." },
  // ── Match state and live data ────────────────────────────────────────────
  matches: { ...MATCH, why: "Fixtures, results, live list and match pages; status flips at kickoff and full time." },
  match_events: { ...LIVE, why: "Live feed and mini pitches, polled every 15 s while a match is live." }
});
function isReadCacheResource(resource) {
  return Object.prototype.hasOwnProperty.call(READ_CACHE_ALLOW_LIST, resource);
}
function cacheControlFor(policy) {
  return `public, max-age=0, s-maxage=${policy.ttl}, stale-while-revalidate=${policy.staleWhileRevalidate}, stale-if-error=${policy.staleIfError}`;
}
var READ_CACHE_SCHEMA = "public";

// src/shared/readCache/readCacheFunction.ts
var SUPABASE_URL = "https://ddtpbipkqamuxnvupddc.supabase.co";
var SUPABASE_PUBLISHABLE_KEY = "sb_publishable_bbRGJ2fM9IQ9typ5x_Kwlg_R2gtgasP";
var UPSTREAM_TIMEOUT_MS = 8e3;
var MAX_QUERY_LENGTH = 8192;
var RESOURCE_PARAM = "__resource";
var PATH_RE = /^\/api\/db\/rest\/v1\/([^/]+)\/?$/;
var RESOURCE_RE = /^[a-z_][a-z0-9_]*$/;
var COUNT_TOKEN_RE = /^count=(exact|planned|estimated)$/;
var RESOURCE_HEADER = "X-Read-Cache-Resource";
var VARY = "Accept, Accept-Profile, Prefer";
var defaultReadCacheDeps = () => ({
  fetch: (input, init) => fetch(input, init),
  supabaseUrl: SUPABASE_URL,
  publishableKey: SUPABASE_PUBLISHABLE_KEY,
  timeoutMs: UPSTREAM_TIMEOUT_MS
});
function refuse(status, error, extra = {}) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra }
  });
}
function resolveResource(url) {
  const m = PATH_RE.exec(url.pathname);
  let raw = m ? m[1] : null;
  if (raw === null && /^\/api\/db\/?$/.test(url.pathname)) raw = url.searchParams.get(RESOURCE_PARAM);
  if (raw === null) return null;
  try {
    raw = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return RESOURCE_RE.test(raw) ? raw : null;
}
function forwardedQuery(url) {
  const search = url.search.startsWith("?") ? url.search.slice(1) : url.search;
  if (search === "") return "";
  const kept = search.split("&").filter((part) => part !== "" && !part.startsWith(`${RESOURCE_PARAM}=`) && part !== RESOURCE_PARAM);
  return kept.length > 0 ? `?${kept.join("&")}` : "";
}
function upstreamHeaders(request, publishableKey) {
  const out = new Headers();
  const accept = request.headers.get("accept");
  if (accept) out.set("Accept", accept);
  const profile = request.headers.get("accept-profile");
  if (profile !== null) {
    if (profile.trim() !== READ_CACHE_SCHEMA) return null;
    out.set("Accept-Profile", READ_CACHE_SCHEMA);
  }
  const range = request.headers.get("range");
  if (range) out.set("Range", range);
  const prefer = request.headers.get("prefer");
  if (prefer) {
    const count = prefer.split(",").map((t) => t.trim()).find((t) => COUNT_TOKEN_RE.test(t));
    if (count) out.set("Prefer", count);
  }
  out.set("apikey", publishableKey);
  return out;
}
async function handleReadCacheRequest(request, deps = defaultReadCacheDeps()) {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return refuse(405, "method not allowed", { Allow: "GET, HEAD" });
  }
  const url = new URL(request.url);
  const resource = resolveResource(url);
  if (resource === null || !isReadCacheResource(resource)) {
    return refuse(404, "not in the read cache allow-list");
  }
  const policy = READ_CACHE_ALLOW_LIST[resource];
  const query = forwardedQuery(url);
  if (query.length > MAX_QUERY_LENGTH) return refuse(414, "query too long");
  const headers = upstreamHeaders(request, deps.publishableKey);
  if (headers === null) return refuse(400, "only the public schema is served");
  let upstream;
  try {
    upstream = await deps.fetch(`${deps.supabaseUrl}/rest/v1/${resource}${query}`, {
      method,
      headers,
      signal: AbortSignal.timeout(deps.timeoutMs)
    });
  } catch (err) {
    const name = err?.name;
    if (name === "TimeoutError" || name === "AbortError") return refuse(504, "database timed out");
    return refuse(502, "database unreachable");
  }
  let body = null;
  if (method !== "HEAD") {
    try {
      body = await upstream.arrayBuffer();
    } catch (err) {
      const name = err?.name;
      if (name === "TimeoutError" || name === "AbortError") return refuse(504, "database timed out");
      return refuse(502, "database response failed");
    }
  }
  const out = new Headers({
    "Content-Type": upstream.headers.get("content-type") ?? "application/json; charset=utf-8",
    "Cache-Control": upstream.status === 200 ? cacheControlFor(policy) : "no-store",
    Vary: VARY,
    [RESOURCE_HEADER]: resource
  });
  const contentRange = upstream.headers.get("content-range");
  if (contentRange) out.set("Content-Range", contentRange);
  return new Response(body, { status: upstream.status, headers: out });
}

// src/shared/readCache/readCacheFunction.entry.ts
function createReadCacheHandler(deps = {}) {
  const bound = { ...defaultReadCacheDeps(), ...deps };
  return (request) => handleReadCacheRequest(request, bound);
}
function GET(request) {
  return handleReadCacheRequest(request);
}
function HEAD(request) {
  return handleReadCacheRequest(request);
}
var POST = GET;
var PUT = GET;
var PATCH = GET;
var DELETE = GET;
var OPTIONS = GET;
export {
  DELETE,
  GET,
  HEAD,
  OPTIONS,
  PATCH,
  POST,
  PUT,
  READ_CACHE_ALLOW_LIST,
  SUPABASE_URL,
  UPSTREAM_TIMEOUT_MS,
  createReadCacheHandler
};
