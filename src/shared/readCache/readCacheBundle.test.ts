// @vitest-environment node
// ── shared/readCache/readCacheBundle.test.ts ────────────────────────────────
// api/db.mjs (the read cache, docs/read-cache.md) is a committed esbuild
// bundle of readCacheFunction.entry.ts.  These tests import THAT FILE, the one
// Vercel deploys, and run it against a local fake PostgREST (a tiny node http
// server on 127.0.0.1), so nothing here ever talks to the production
// database.  Node environment: esbuild's JS API refuses to run under jsdom.
//
// Covered: bundle freshness and self-containment, allow-list (404), methods
// (405), TTL per resource, query forwarded byte for byte, only safe headers
// forwarded (never Authorization or cookies), the publishable key added,
// no-store on every non-200, timeout (504) and unreachable upstream (502),
// content-type and content-range passed through, HEAD with a count.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildApiBundle,
  READ_CACHE_BUNDLE_PATH,
} from '../../../scripts/lib/apiBundle.mjs';
import { READ_CACHE_ALLOW_LIST, cacheControlFor } from './allowList';
import { createPublicReadClient } from '../supabase/publicReadClient';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

interface BundleModule {
  GET:  (r: Request) => Promise<Response>;
  HEAD: (r: Request) => Promise<Response>;
  POST: (r: Request) => Promise<Response>;
  DELETE: (r: Request) => Promise<Response>;
  SUPABASE_URL: string;
  createReadCacheHandler: (deps: Record<string, unknown>) => (r: Request) => Promise<Response>;
}

/** What the fake PostgREST saw. */
interface Seen { method: string; url: string; headers: IncomingMessage['headers'] }

const seen: Seen[] = [];
let server: Server;
let upstreamUrl = '';
let mod: BundleModule;
let handler: (r: Request) => Promise<Response>;

/** Fake PostgREST: answers by resource name so each test can pick a status. */
function fakePostgrest(req: IncomingMessage, res: ServerResponse): void {
  seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers });
  const path = (req.url ?? '').split('?')[0] ?? '';
  const resource = path.replace(/^\/rest\/v1\//, '');
  if (resource === 'matches' && /status=eq\.slow/.test(req.url ?? '')) {
    setTimeout(() => { res.writeHead(200).end('[]'); }, 1_500);
    return;
  }
  if (resource === 'seasons' && /id=eq\.missing/.test(req.url ?? '')) {
    res.writeHead(406, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ code: 'PGRST116', message: 'no rows' }));
    return;
  }
  if (resource === 'narratives') {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'statement timeout' }));
    return;
  }
  res.writeHead(200, {
    'Content-Type':  'application/json; charset=utf-8',
    'Content-Range': '0-1/2',
    'Set-Cookie':    'should-not=leak',
  });
  res.end(req.method === 'HEAD' ? undefined : JSON.stringify([{ id: 1, resource }, { id: 2, resource }]));
}

beforeAll(async () => {
  server = createServer(fakePostgrest);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  upstreamUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  mod = (await import(/* @vite-ignore */ pathToFileURL(`${repoRoot}${READ_CACHE_BUNDLE_PATH}`).href)) as BundleModule;
  handler = mod.createReadCacheHandler({ supabaseUrl: upstreamUrl, timeoutMs: 400 });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  seen.length = 0;
});

const SITE = 'https://soccer-league-one.vercel.app';

describe('api/db.mjs bundle', () => {
  it('matches a fresh build of its sources (run npm run build:api if this fails)', async () => {
    const fresh = await buildApiBundle(repoRoot, READ_CACHE_BUNDLE_PATH);
    const committed = readFileSync(`${repoRoot}${READ_CACHE_BUNDLE_PATH}`, 'utf8').replace(/\r\n/g, '\n');
    expect(committed.length).toBe(fresh.length);
    expect(committed === fresh).toBe(true);
  }, 60_000);

  it('is self-contained: no relative or bare imports Vercel would have to resolve', () => {
    const committed = readFileSync(`${repoRoot}${READ_CACHE_BUNDLE_PATH}`, 'utf8');
    const specifiers = [...committed.matchAll(/^\s*import\s[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
    expect(specifiers.filter((s) => !s!.startsWith('node:'))).toEqual([]);
    expect(committed).toMatch(/export\s*\{[^}]*\bGET\b/);
    expect(committed).toMatch(/export\s*\{[^}]*\bHEAD\b/);
  });

  it('the default handler targets the production project (fetch stubbed, nothing sent)', async () => {
    const stub = vi.fn(async () => new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', stub);
    try {
      const res = await mod.GET(new Request(`${SITE}/api/db/rest/v1/teams?select=id`));
      expect(res.status).toBe(200);
      expect(String((stub.mock.calls[0] as unknown as [string])[0])).toBe(`${mod.SUPABASE_URL}/rest/v1/teams?select=id`);
      expect(mod.SUPABASE_URL).toBe('https://ddtpbipkqamuxnvupddc.supabase.co');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('read cache: allow-list and methods', () => {
  it('404s a resource that is not on the allow-list, without calling upstream', async () => {
    for (const path of ['profiles', 'wagers', 'push_subscriptions', 'focus_votes', 'rpc/place_wager', 'Teams', '..%2Fprofiles']) {
      const res = await handler(new Request(`${SITE}/api/db/rest/v1/${path}?select=*`));
      expect(res.status, path).toBe(404);
      expect(res.headers.get('cache-control'), path).toBe('no-store');
    }
    expect(seen).toHaveLength(0);
  });

  it('405s every method except GET and HEAD, without calling upstream', async () => {
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS']) {
      const res = await handler(new Request(`${SITE}/api/db/rest/v1/teams`, { method, body: method === 'OPTIONS' ? null : '{}' }));
      expect(res.status, method).toBe(405);
      expect(res.headers.get('allow')).toBe('GET, HEAD');
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
    // The exported non-GET entry points refuse too.
    expect((await mod.POST(new Request(`${SITE}/api/db/rest/v1/teams`, { method: 'POST', body: '{}' }))).status).toBe(405);
    expect((await mod.DELETE(new Request(`${SITE}/api/db/rest/v1/teams`, { method: 'DELETE' }))).status).toBe(405);
    expect(seen).toHaveLength(0);
  });

  it('accepts the resource from the vercel.json rewrite parameter and strips it before forwarding', async () => {
    const res = await handler(new Request(`${SITE}/api/db?select=id%2Cname&__resource=teams&order=name.asc`));
    expect(res.status).toBe(200);
    expect(seen[0]!.url).toBe('/rest/v1/teams?select=id%2Cname&order=name.asc');
  });
});

describe('read cache: forwarding', () => {
  it('forwards the query string byte for byte', async () => {
    const q = '?select=id,home_team:teams!matches_home_team_id_fkey(name)&status=in.(live,scheduled)&order=scheduled_at.asc&limit=20&offset=0';
    await handler(new Request(`${SITE}/api/db/rest/v1/matches${q}`));
    expect(seen[0]!.url).toBe(`/rest/v1/matches${q}`);
  });

  it('forwards only accept, accept-profile, range and the prefer count; never Authorization or cookies', async () => {
    await handler(new Request(`${SITE}/api/db/rest/v1/teams?select=*`, {
      headers: {
        Authorization:    'Bearer user.jwt.here',
        Cookie:           'sb-access-token=secret',
        apikey:           'client-supplied',
        Accept:           'application/vnd.pgrst.object+json',
        'Accept-Profile': 'public',
        Range:            '0-9',
        Prefer:           'return=representation, count=exact, tx=commit',
        'X-Client-Info':  'supabase-js-web/2',
        'X-Forwarded-For': '1.2.3.4',
      },
    }));
    const h = seen[0]!.headers;
    expect(h.authorization).toBeUndefined();
    expect(h.cookie).toBeUndefined();
    expect(h['x-client-info']).toBeUndefined();
    expect(h['x-forwarded-for']).toBeUndefined();
    expect(h.apikey).toBe('sb_publishable_bbRGJ2fM9IQ9typ5x_Kwlg_R2gtgasP');
    expect(h.accept).toBe('application/vnd.pgrst.object+json');
    expect(h['accept-profile']).toBe('public');
    expect(h.range).toBe('0-9');
    expect(h.prefer).toBe('count=exact');
  });

  it('refuses another schema with 400 and no-store', async () => {
    const res = await handler(new Request(`${SITE}/api/db/rest/v1/teams`, { headers: { 'Accept-Profile': 'private' } }));
    expect(res.status).toBe(400);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(seen).toHaveLength(0);
  });

  it('returns the upstream body, content-type and content-range; drops set-cookie', async () => {
    const res = await handler(new Request(`${SITE}/api/db/rest/v1/players?select=id`));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('content-range')).toBe('0-1/2');
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(res.headers.get('x-read-cache-resource')).toBe('players');
    expect(await res.json()).toEqual([{ id: 1, resource: 'players' }, { id: 2, resource: 'players' }]);
  });

  it('serves HEAD (count requests) with no body and the content-range', async () => {
    const res = await handler(new Request(`${SITE}/api/db/rest/v1/matches?select=*`, { method: 'HEAD', headers: { Prefer: 'count=exact' } }));
    expect(res.status).toBe(200);
    expect(seen[0]!.method).toBe('HEAD');
    expect(res.headers.get('content-range')).toBe('0-1/2');
    expect(await res.text()).toBe('');
  });
});

describe('read cache: cache headers', () => {
  it('marks every allow-listed 200 public with its own TTL, swr and stale-if-error', async () => {
    for (const [resource, policy] of Object.entries(READ_CACHE_ALLOW_LIST)) {
      if (resource === 'narratives') continue; // the fake answers 503 for it (tested below)
      const res = await handler(new Request(`${SITE}/api/db/rest/v1/${resource}?select=*`));
      expect(res.status, resource).toBe(200);
      expect(res.headers.get('cache-control'), resource).toBe(cacheControlFor(policy));
      expect(res.headers.get('cache-control'), resource).toMatch(
        new RegExp(`^public, max-age=0, s-maxage=${policy.ttl}, stale-while-revalidate=${policy.staleWhileRevalidate}, stale-if-error=${policy.staleIfError}$`),
      );
      expect(res.headers.get('vary'), resource).toBe('Accept, Accept-Profile, Prefer');
    }
  });

  it('live data is short and catalogue data long (the tiers of docs/read-cache.md)', () => {
    expect(READ_CACHE_ALLOW_LIST['match_events']!.ttl).toBeLessThanOrEqual(15);
    expect(READ_CACHE_ALLOW_LIST['matches']!.ttl).toBeLessThanOrEqual(60);
    expect(READ_CACHE_ALLOW_LIST['teams']!.ttl).toBeGreaterThanOrEqual(120);
    for (const p of Object.values(READ_CACHE_ALLOW_LIST)) {
      expect(p.staleWhileRevalidate).toBeGreaterThan(p.ttl);
      expect(p.staleIfError).toBeGreaterThan(p.staleWhileRevalidate);
    }
  });

  it('never caches an upstream error (503) or a single-row miss (406)', async () => {
    const err = await handler(new Request(`${SITE}/api/db/rest/v1/narratives?select=*`));
    expect(err.status).toBe(503);
    expect(err.headers.get('cache-control')).toBe('no-store');
    const miss = await handler(new Request(`${SITE}/api/db/rest/v1/seasons?id=eq.missing`, { headers: { Accept: 'application/vnd.pgrst.object+json' } }));
    expect(miss.status).toBe(406);
    expect(miss.headers.get('cache-control')).toBe('no-store');
  });

  it('answers 504 no-store when the upstream is slower than the timeout', async () => {
    const res = await handler(new Request(`${SITE}/api/db/rest/v1/matches?status=eq.slow`));
    expect(res.status).toBe(504);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('answers 502 no-store when the upstream is unreachable', async () => {
    const dead = mod.createReadCacheHandler({ supabaseUrl: 'http://127.0.0.1:9', timeoutMs: 2_000 });
    const res = await dead(new Request(`${SITE}/api/db/rest/v1/teams`));
    expect(res.status).toBe(502);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

describe('read cache: end to end with supabase-js', () => {
  /** Plays Vercel: applies the vercel.json rewrite, then calls the bundled function. */
  const viaVercel: typeof fetch = async (input, init) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const m = /^\/api\/db\/rest\/v1\/([^/]+)$/.exec(url.pathname);
    const target = m
      ? `${url.origin}/api/db${url.search ? `${url.search}&` : '?'}__resource=${m[1]}`
      : url.href;
    return handler(new Request(target, init));
  };

  it('the public client reads through the committed bundle: lists, single rows, counts, refusals', async () => {
    const db = createPublicReadClient(`${SITE}/api/db`, 'sb_publishable_test', 'proxy', viaVercel);

    const list = await db.from('teams').select('id, name').order('name');
    expect(list.status).toBe(200);
    expect(list.data).toEqual([{ id: 1, resource: 'teams' }, { id: 2, resource: 'teams' }]);
    expect(seen[0]!.url).toBe('/rest/v1/teams?select=id%2Cname&order=name.asc');
    expect(seen[0]!.headers.authorization).toBeUndefined();
    expect(seen[0]!.headers.apikey).toBe('sb_publishable_bbRGJ2fM9IQ9typ5x_Kwlg_R2gtgasP');

    const count = await db.from('matches').select('*', { count: 'exact', head: true });
    expect(count.status).toBe(200);
    expect(count.count).toBe(2);
    expect(seen[1]!.method).toBe('HEAD');

    const personal = await db.from('profiles').select('*');
    expect(personal.status).toBe(404);
    expect(seen).toHaveLength(2); // the refusal never reached the database
  });
});
