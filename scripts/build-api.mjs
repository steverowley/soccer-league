// ── scripts/build-api.mjs ───────────────────────────────────────────────────
// Bundles the Vercel functions into their committed files:
//   api/simulate.mjs  POST /api/simulate (remote match simulation), from
//                     src/features/match/api/simulateFunction.entry.ts + engine
//   api/db.mjs        GET /api/db/rest/v1/<resource> (the read cache), from
//                     src/shared/readCache/readCacheFunction.entry.ts
//
// The bundles are committed because Vercel compiles functions file by file
// and, with "type": "module", cannot resolve extensionless imports at runtime
// (see the entries' headers).
//
// Usage:
//   npm run build:api                    # rewrite every bundle
//   node scripts/build-api.mjs --check   # exit 1 if any bundle is stale
//
// apiBundle.test.ts and readCacheBundle.test.ts run the --check logic in the
// test suite, so a source change that is not followed by npm run build:api
// fails CI instead of deploying a stale function.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildApiBundle, API_BUNDLES } from './lib/apiBundle.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const check = process.argv.includes('--check');
let stale = false;

for (const { out: path } of API_BUNDLES) {
  const out = await buildApiBundle(repoRoot, path);
  const target = `${repoRoot}${path}`;
  if (check) {
    let current = '';
    try { current = readFileSync(target, 'utf8').replace(/\r\n/g, '\n'); } catch { /* missing */ }
    if (current !== out) {
      console.error(`${path} is stale: run npm run build:api`);
      stale = true;
    } else {
      console.log(`${path} is up to date (${(out.length / 1024).toFixed(0)} KB)`);
    }
  } else {
    writeFileSync(target, out);
    console.log(`wrote ${path} (${(out.length / 1024).toFixed(0)} KB)`);
  }
}

if (stale) process.exit(1);
