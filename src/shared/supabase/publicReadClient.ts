// ── shared/supabase/publicReadClient.ts ─────────────────────────────────────
// The second Supabase client: anonymous public reads through the read cache
// (docs/read-cache.md).  Its REST URL is `${origin}/api/db`, so supabase-js
// sends `GET /api/db/rest/v1/<resource>?<query>`, which the Vercel function
// api/db.mjs forwards to PostgREST and Vercel's CDN caches per URL.  Identical
// reads from many fans inside the TTL cost the database one query.
//
// WHAT GOES THROUGH IT
//   Reads whose answer is the same for every visitor, of resources on the
//   allow-list (src/shared/readCache/allowList.ts).  Personal reads (profile,
//   wagers, votes), admin reads, worker-like pipelines and every write stay
//   on the direct client (`supabaseClient` / `useSupabase()`).
//   publicReadSplit.test.ts enforces the split across src/.
//
// THE TYPE IS THE GUARD
//   `PublicReadClient` exposes only `.from()` and carries a brand, so:
//     - an api function declared `(db: PublicReadClient)` cannot be handed
//       the direct client (the brand is missing) and cannot call .rpc(),
//       .channel() or .auth (they do not exist on the type);
//     - the proxy client cannot be handed to a function that needs the
//       direct client (it lacks auth/rpc/channel), so a write or a personal
//       read can never be routed through the cache by accident.
//
// REQUEST SHAPE (what makes a CDN HIT possible)
//   Vercel only caches requests WITHOUT an Authorization header, so the fetch
//   below strips everything except accept, accept-profile, range and prefer.
//   No session is ever attached: persistSession, autoRefreshToken and
//   detectSessionInUrl are off (the last one matters: a second client must
//   not consume the OAuth / password-recovery hash meant for the main one).
//   Non-GET/HEAD requests are refused locally with a 405.
//
// LOCAL DEV
//   `vite` has no /api/db, so outside a production build the client talks to
//   Supabase directly (same header discipline, plus the apikey).  Set
//   VITE_READ_PROXY=off to force direct reads in a production build, or
//   VITE_READ_PROXY=on to use the proxy in dev (behind `vercel dev`).

import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import type { IslSupabaseClient } from './client';
import { READ_CACHE_FORWARDED_HEADERS } from '../readCache/allowList';

// ── Type ─────────────────────────────────────────────────────────────────────

declare const publicReadBrand: unique symbol;

/**
 * A client that can only read, through the read cache.  Feature api
 * functions that serve public pages declare their client parameter with this
 * type; callers get one from `usePublicReadClient()`.
 */
export type PublicReadClient = Pick<IslSupabaseClient, 'from'> & {
  readonly [publicReadBrand]: true;
};

/**
 * Treat an existing client as a public-read client.  For tests (fakes) and
 * for Node scripts that read public data with their own client.  Never use
 * it in browser code to dodge the split: use `usePublicReadClient()`.
 */
export function asPublicReadClient(db: Pick<IslSupabaseClient, 'from'>): PublicReadClient {
  return db as PublicReadClient;
}

// ── Configuration ────────────────────────────────────────────────────────────

/** Path of the read-cache function; supabase-js appends /rest/v1/<resource>. */
export const READ_PROXY_PATH = '/api/db';

/** Where the public client sends reads. */
export type PublicReadMode = 'proxy' | 'direct';

/**
 * Pick the public client's base URL.
 *
 * @param opts.prod       import.meta.env.PROD (a production build).
 * @param opts.origin     window.location.origin, when running in a browser.
 * @param opts.directUrl  The Supabase project URL.
 * @param opts.override   VITE_READ_PROXY: 'on' or 'off' forces the mode.
 */
export function resolvePublicReadTarget(opts: {
  prod: boolean;
  origin: string | undefined;
  directUrl: string;
  override?: string | undefined;
}): { url: string; mode: PublicReadMode } {
  const wantProxy = opts.override === 'on' ? true : opts.override === 'off' ? false : opts.prod;
  if (wantProxy && opts.origin && /^https?:\/\//.test(opts.origin)) {
    return { url: `${opts.origin}${READ_PROXY_PATH}`, mode: 'proxy' };
  }
  return { url: opts.directUrl, mode: 'direct' };
}

/**
 * The fetch the public client uses: GET/HEAD only, and only the safe headers
 * (plus `apikey` when talking to Supabase directly; the proxy adds its own).
 * Exported for tests.
 */
export function makePublicReadFetch(mode: PublicReadMode, baseFetch: typeof fetch = (i, init) => fetch(i, init)): typeof fetch {
  const keep = new Set<string>(READ_CACHE_FORWARDED_HEADERS);
  if (mode === 'direct') keep.add('apikey');
  return async (input, init) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      return new Response(JSON.stringify({ message: 'the public read client only reads' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const headers = new Headers();
    new Headers(init?.headers).forEach((value, key) => {
      if (keep.has(key.toLowerCase())) headers.set(key, value);
    });
    return baseFetch(input, { ...init, method, headers });
  };
}

/**
 * Build a public-read client.
 *
 * @param url   Base URL: `${origin}/api/db` (proxy) or the Supabase URL (direct).
 * @param key   The publishable key (supabase-js requires one; the proxy ignores it).
 * @param mode  Which header set to keep (see makePublicReadFetch).
 */
export function createPublicReadClient(
  url: string,
  key: string,
  mode: PublicReadMode,
  baseFetch?: typeof fetch,
): PublicReadClient {
  const client = createClient<Database>(url, key, {
    auth: {
      persistSession:     false,
      autoRefreshToken:   false,
      detectSessionInUrl: false,
      storageKey:         'isl-public-read',
    },
    global: { fetch: makePublicReadFetch(mode, baseFetch) },
  });
  return asPublicReadClient(client);
}

// ── Application instance ─────────────────────────────────────────────────────

const DIRECT_URL =
  (import.meta.env['VITE_SUPABASE_URL'] as string | undefined) ?? 'https://ddtpbipkqamuxnvupddc.supabase.co';
const PUBLISHABLE_KEY =
  (import.meta.env['VITE_SUPABASE_ANON_KEY'] as string | undefined) ?? 'sb_publishable_bbRGJ2fM9IQ9typ5x_Kwlg_R2gtgasP';

/** Where this build's public reads go (exported for diagnostics and tests). */
export const publicReadTarget = resolvePublicReadTarget({
  prod:      Boolean(import.meta.env.PROD),
  origin:    typeof window !== 'undefined' ? window.location.origin : undefined,
  directUrl: DIRECT_URL,
  override:  import.meta.env['VITE_READ_PROXY'] as string | undefined,
});

/**
 * The application-wide public-read client.  Import it only in src/main.tsx
 * (to put it in context); feature code calls `usePublicReadClient()`.
 */
export const publicReadClient: PublicReadClient = createPublicReadClient(
  publicReadTarget.url,
  PUBLISHABLE_KEY,
  publicReadTarget.mode,
);
