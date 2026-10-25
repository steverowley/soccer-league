// ── scripts/build-api.mjs ───────────────────────────────────────────────────
// Bundles the remote simulation function into api/simulate.mjs, the file
// Vercel serves as POST /api/simulate.
//
// The source of truth is src/features/match/api/simulateFunction.entry.ts
// (handler + request schema) and src/features/match/logic/spatial/ (the
// engine).  The bundle is committed because Vercel compiles functions file by
// file and, with "type": "module", cannot resolve the engine's extensionless
// imports at runtime (see the entry's header).
//
// Usage:
//   npm run build:api            # rewrite api/simulate.mjs
//   node scripts/build-api.mjs --check   # exit 1 if the bundle is stale
//
// src/features/match/api/apiBundle.test.ts runs the --check logic in the
// test suite, so a change to the engine or the handler that is not followed by
// npm run build:api fails CI instead of deploying a stale simulator.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildApiBundle, API_BUNDLE_PATH } from './lib/apiBundle.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const out = await buildApiBundle(repoRoot);
const target = `${repoRoot}${API_BUNDLE_PATH}`;

if (process.argv.includes('--check')) {
  let current = '';
  try { current = readFileSync(target, 'utf8').replace(/\r\n/g, '\n'); } catch { /* missing */ }
  if (current !== out) {
    console.error(`${API_BUNDLE_PATH} is stale: run npm run build:api`);
    process.exit(1);
  }
  console.log(`${API_BUNDLE_PATH} is up to date (${(out.length / 1024).toFixed(0)} KB)`);
} else {
  writeFileSync(target, out);
  console.log(`wrote ${API_BUNDLE_PATH} (${(out.length / 1024).toFixed(0)} KB)`);
}
