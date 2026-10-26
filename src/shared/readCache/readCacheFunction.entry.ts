// ── shared/readCache/readCacheFunction.entry.ts ─────────────────────────────
// Entry point of the Vercel function api/db.mjs (the read cache, see
// docs/read-cache.md).  Vercel's Node.js runtime calls the exported
// HTTP-method functions with a Web Request.
//
// Bundled by `npm run build:api` for the same reason as api/simulate.mjs:
// with "type": "module" Vercel compiles TypeScript functions file by file and
// Node's ESM loader cannot resolve extensionless relative imports, so a
// committed self-contained bundle is what deploys.  readCacheBundle.test.ts
// fails when the committed file no longer matches these sources.
//
// `createReadCacheHandler` is exported so the test can run the committed
// bundle itself against a local fake PostgREST instead of production.

import { defaultReadCacheDeps, handleReadCacheRequest, type ReadCacheDeps } from './readCacheFunction';

export { SUPABASE_URL, UPSTREAM_TIMEOUT_MS } from './readCacheFunction';
export { READ_CACHE_ALLOW_LIST } from './allowList';

/** A handler bound to explicit dependencies (tests point it at a fake upstream). */
export function createReadCacheHandler(deps: Partial<ReadCacheDeps> = {}): (request: Request) => Promise<Response> {
  const bound: ReadCacheDeps = { ...defaultReadCacheDeps(), ...deps };
  return (request) => handleReadCacheRequest(request, bound);
}

export function GET(request: Request): Promise<Response> {
  return handleReadCacheRequest(request);
}

export function HEAD(request: Request): Promise<Response> {
  return handleReadCacheRequest(request);
}

/** Every other method: refused by the handler with 405 and no-store. */
export const POST = GET;
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
export const OPTIONS = GET;
