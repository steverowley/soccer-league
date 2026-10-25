// ── features/match/api/simulateFunction.entry.ts ────────────────────────────
// Entry point of the Vercel function api/simulate.mjs.  Vercel's Node.js
// runtime calls the exported HTTP-method functions with a Web Request.
//
// WHY A GENERATED BUNDLE AND NOT api/simulate.ts IMPORTING src/
//   package.json is "type": "module", so Vercel compiles a TypeScript function
//   to native ESM file by file, and Node's ESM loader cannot resolve the
//   engine's extensionless relative imports ('./vec2'): the function would
//   build and then crash with ERR_MODULE_NOT_FOUND on every call.  Bundling
//   with esbuild (npm run build:api) gives one self-contained file with no
//   relative imports at all.  The engine source of truth stays in
//   src/features/match/logic/spatial/; apiBundle.test.ts fails whenever the
//   committed bundle no longer matches what the sources build to.

import { handleSimulateRequest } from './simulateFunction';

const methodNotAllowed = (): Response =>
  new Response(JSON.stringify({ error: 'method not allowed' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Allow: 'POST' },
  });

export function POST(request: Request): Promise<Response> {
  return handleSimulateRequest(request);
}

export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
