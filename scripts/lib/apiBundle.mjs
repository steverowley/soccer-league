// ── scripts/lib/apiBundle.mjs ───────────────────────────────────────────────
// Shared by scripts/build-api.mjs and src/features/match/api/apiBundle.test.ts:
// the one definition of how api/simulate.mjs is built, so the staleness test
// and the build can never disagree.

import { build } from 'esbuild';

export const API_BUNDLE_PATH = 'api/simulate.mjs';
export const API_ENTRY_PATH = 'src/features/match/api/simulateFunction.entry.ts';

const BANNER = [
  '// GENERATED FILE, DO NOT EDIT. Built by `npm run build:api` (scripts/build-api.mjs)',
  '// from src/features/match/api/simulateFunction.entry.ts and the spatial engine in',
  '// src/features/match/logic/spatial/. Vercel serves it as POST /api/simulate.',
  '// apiBundle.test.ts fails when this file no longer matches its sources.',
].join('\n');

/**
 * Bundle the simulate function.  Deterministic for a given esbuild version and
 * source tree; line endings normalised to LF.
 *
 * @param {string} repoRoot  Absolute path of the repository root (trailing slash).
 * @returns {Promise<string>} The bundle text.
 */
export async function buildApiBundle(repoRoot) {
  const result = await build({
    absWorkingDir: repoRoot,
    entryPoints:   [API_ENTRY_PATH],
    bundle:        true,
    platform:      'node',
    format:        'esm',
    target:        'node20',
    write:         false,
    minify:        false,
    sourcemap:     false,
    legalComments: 'none',
    charset:       'utf8',
    banner:        { js: BANNER },
    logLevel:      'silent',
  });
  const file = result.outputFiles[0];
  if (!file) throw new Error('esbuild produced no output');
  return file.text.replace(/\r\n/g, '\n');
}
