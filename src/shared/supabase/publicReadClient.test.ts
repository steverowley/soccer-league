// ── shared/supabase/publicReadClient.test.ts ────────────────────────────────
// The public-read client (docs/read-cache.md): where it sends reads, and the
// request shape that lets Vercel's CDN cache them (no Authorization, only the
// safe headers, GET/HEAD only).  Nothing here touches the network: the
// client's fetch is a recording stub.

import { describe, expect, it, vi } from 'vitest';
import {
  READ_PROXY_PATH,
  createPublicReadClient,
  makePublicReadFetch,
  resolvePublicReadTarget,
} from './publicReadClient';

const DIRECT = 'https://ddtpbipkqamuxnvupddc.supabase.co';
const SITE = 'https://soccer-league-one.vercel.app';

/** A fetch stub that records the URL, method and headers it was given. */
function recorder() {
  const calls: Array<{ url: string; method: string; headers: Record<string, string> }> = [];
  const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => { headers[k] = v; });
    calls.push({ url: String(input instanceof Request ? input.url : input), method: init?.method ?? 'GET', headers });
    return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  return { calls, fetchStub: fetchStub as unknown as typeof fetch };
}

describe('resolvePublicReadTarget', () => {
  it('uses the proxy on a production build in a browser', () => {
    expect(resolvePublicReadTarget({ prod: true, origin: SITE, directUrl: DIRECT })).toEqual({
      url: `${SITE}${READ_PROXY_PATH}`,
      mode: 'proxy',
    });
  });

  it('falls back to Supabase directly in dev (vite has no /api/db)', () => {
    expect(resolvePublicReadTarget({ prod: false, origin: 'http://localhost:5173', directUrl: DIRECT })).toEqual({
      url: DIRECT,
      mode: 'direct',
    });
  });

  it('honours VITE_READ_PROXY overrides, and never builds a proxy URL without an http origin', () => {
    expect(resolvePublicReadTarget({ prod: true, origin: SITE, directUrl: DIRECT, override: 'off' }).mode).toBe('direct');
    expect(resolvePublicReadTarget({ prod: false, origin: 'http://localhost:3000', directUrl: DIRECT, override: 'on' }).mode).toBe('proxy');
    expect(resolvePublicReadTarget({ prod: true, origin: undefined, directUrl: DIRECT }).mode).toBe('direct');
    expect(resolvePublicReadTarget({ prod: true, origin: 'null', directUrl: DIRECT }).mode).toBe('direct');
  });
});

describe('makePublicReadFetch', () => {
  it('proxy mode: forwards only the safe headers (no Authorization, no apikey, no client info)', async () => {
    const { calls, fetchStub } = recorder();
    const f = makePublicReadFetch('proxy', fetchStub);
    await f(`${SITE}/api/db/rest/v1/teams?select=*`, {
      method: 'GET',
      headers: {
        Authorization: 'Bearer user.jwt',
        apikey: 'sb_publishable_x',
        'X-Client-Info': 'supabase-js-web/2',
        Accept: 'application/vnd.pgrst.object+json',
        'Accept-Profile': 'public',
        Prefer: 'count=exact',
      },
    });
    expect(calls[0]!.headers).toEqual({
      accept: 'application/vnd.pgrst.object+json',
      'accept-profile': 'public',
      prefer: 'count=exact',
    });
  });

  it('direct mode keeps the apikey (Supabase needs it) but still drops Authorization', async () => {
    const { calls, fetchStub } = recorder();
    await makePublicReadFetch('direct', fetchStub)(`${DIRECT}/rest/v1/teams`, {
      headers: { Authorization: 'Bearer user.jwt', apikey: 'sb_publishable_x' },
    });
    expect(calls[0]!.headers).toEqual({ apikey: 'sb_publishable_x' });
  });

  it('refuses writes locally with a 405 and never calls fetch', async () => {
    const { calls, fetchStub } = recorder();
    const f = makePublicReadFetch('proxy', fetchStub);
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
      const res = await f(`${SITE}/api/db/rest/v1/teams`, { method, body: '{}' });
      expect(res.status).toBe(405);
    }
    expect(calls).toHaveLength(0);
  });
});

describe('createPublicReadClient', () => {
  it('sends supabase-js reads to /api/db/rest/v1/<resource> with the query intact and no Authorization', async () => {
    const { calls, fetchStub } = recorder();
    const db = createPublicReadClient(`${SITE}${READ_PROXY_PATH}`, 'sb_publishable_test', 'proxy', fetchStub);
    await db.from('teams').select('id, name').eq('league_id', 'rocky-inner').order('name');
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]!.url);
    expect(`${url.origin}${url.pathname}`).toBe(`${SITE}/api/db/rest/v1/teams`);
    expect(url.searchParams.get('select')).toBe('id,name');
    expect(url.searchParams.get('league_id')).toBe('eq.rocky-inner');
    expect(url.searchParams.get('order')).toBe('name.asc');
    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.headers['authorization']).toBeUndefined();
    expect(calls[0]!.headers['apikey']).toBeUndefined();
  });

  it('a count request goes out as HEAD with the count preference', async () => {
    const { calls, fetchStub } = recorder();
    const db = createPublicReadClient(`${SITE}${READ_PROXY_PATH}`, 'sb_publishable_test', 'proxy', fetchStub);
    await db.from('matches').select('*', { count: 'exact', head: true });
    expect(calls[0]!.method).toBe('HEAD');
    expect(calls[0]!.headers['prefer']).toMatch(/count=exact/);
  });
});
