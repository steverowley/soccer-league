// ── scripts/lib/apiBundle.mjs ───────────────────────────────────────────────
// Shared by scripts/build-api.mjs and the bundle tests
// (src/features/match/api/apiBundle.test.ts,
// src/shared/readCache/readCacheBundle.test.ts): the one definition of how
// each committed Vercel function bundle is built, so the staleness tests and
// the build can never disagree.

import { build } from 'esbuild';

/** The remote simulation function (POST /api/simulate). */
export const API_BUNDLE_PATH = 'api/simulate.mjs';
export const API_ENTRY_PATH = 'src/features/match/api/simulateFunction.entry.ts';

/** The read cache (GET /api/db/rest/v1/<resource>, docs/read-cache.md). */
export const READ_CACHE_BUNDLE_PATH = 'api/db.mjs';
export const READ_CACHE_ENTRY_PATH = 'src/shared/readCache/readCacheFunction.entry.ts';

/** Every committed bundle: output path, entry, banner lines. */
export const API_BUNDLES = [
  {
    out:    API_BUNDLE_PATH,
    entry:  API_ENTRY_PATH,
    banner: [
      '// GENERATED FILE, DO NOT EDIT. Built by `npm run build:api` (scripts/build-api.mjs)',
      '// from src/features/match/api/simulateFunction.entry.ts and the spatial engine in',
      '// src/features/match/logic/spatial/. Vercel serves it as POST /api/simulate.',
      '// apiBundle.test.ts fails when this file no longer matches its sources.',
    ],
  },
  {
    out:    READ_CACHE_BUNDLE_PATH,
    entry:  READ_CACHE_ENTRY_PATH,
    banner: [
      '// GENERATED FILE, DO NOT EDIT. Built by `npm run build:api` (scripts/build-api.mjs)',
      '// from src/shared/readCache/. Vercel serves it as GET /api/db/rest/v1/<resource>',
      '// (vercel.json rewrite). readCacheBundle.test.ts fails when this file no longer',
      '// matches its sources.',
    ],
  },
];

/**
 * Bundle one Vercel function.  Deterministic for a given esbuild version and
 * source tree; line endings normalised to LF.
 *
 * @param {string} repoRoot  Absolute path of the repository root (trailing slash).
 * @param {string} [out]     Which bundle (its output path); defaults to the simulate function.
 * @returns {Promise<string>} The bundle text.
 */
export async function buildApiBundle(repoRoot, out = API_BUNDLE_PATH) {
  const spec = API_BUNDLES.find((b) => b.out === out);
  if (!spec) throw new Error(`unknown api bundle ${out}`);
  const result = await build({
    absWorkingDir: repoRoot,
    entryPoints:   [spec.entry],
    bundle:        true,
    platform:      'node',
    format:        'esm',
    target:        'node20',
    write:         false,
    minify:        false,
    sourcemap:     false,
    legalComments: 'none',
    charset:       'utf8',
    banner:        { js: spec.banner.join('\n') },
    logLevel:      'silent',
    // Keep node_modules paths as seen from the checkout: a git worktree whose
    // node_modules is a junction to another checkout would otherwise bake the
    // junction target into the bundle's path comments and look stale.
    preserveSymlinks: true,
  });
  const file = result.outputFiles[0];
  if (!file) throw new Error('esbuild produced no output');
  return file.text.replace(/\r\n/g, '\n');
}
