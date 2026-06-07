// ── spatial/twinParity.test.ts ───────────────────────────────────────────────
// Drift-guard for the src ↔ match-worker spatial-engine twins (#547).
//
// The Deno edge worker cannot import from src/, so the spatial engine exists as
// hand-maintained copies in two places.  The risk this guards against is SILENT
// FUNCTIONAL DRIFT: the old legacy gameEngine.js copies diverged to 2576 vs
// 2815 LOC before anyone noticed (and that engine is now deleted — #389).  This
// test fails CI the moment a worker spatial twin drifts from its src source of
// truth, modulo the two legitimate differences:
//   - relative-import path extensions (worker uses './x.ts', src uses './x'), and
//   - the leading `// ── <path> ──` header / section-divider comment lines.
//
// Prose comments (other than the `// ──` dividers) must match too — the twins
// are copied by hand, so prose drift is also surfaced.  When this fails, align
// the WORKER copy to the src source of truth (src is canonical: it is the
// tsc-checked, unit-tested copy).
//
// SCOPE: the spatial engine only.  The other src↔worker twins (cosmicVoices,
// cupDraw/cupSeeder, interferenceResolver) are functionally identical but carry
// heavier prose-comment drift; extending the guard to them (after aligning
// their comments, or with a comment-stripping normaliser) is a follow-up.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// vitest runs from the repo root (where vitest.config.ts lives).
const ROOT = process.cwd();
const SRC_DIR = 'src/features/match/logic/spatial';
const WORKER_DIR = 'supabase/functions/match-worker/spatial';

/** The byte-twin spatial modules (without the `.ts` suffix). */
const TWINS = [
  'step',
  'possession',
  'spatialEventAdapter',
  'formation',
  'steering',
  'vec2',
  'types',
  'simulateSpatialMatch',
] as const;

/**
 * Normalise a twin source for comparison: drop the `// ── … ──` header /
 * section-divider lines (the worker's path differs there), strip the `.ts`
 * extension the worker adds to relative imports, drop blank lines, and trim
 * trailing whitespace.  What remains is the code + prose that MUST be identical.
 */
function normalise(source: string): string {
  return source
    .split(/\r?\n/)
    .map((line) => line.replace(/\.ts'/g, "'").replace(/\s+$/, ''))
    .filter((line) => !/^\s*\/\/ ──/.test(line))
    .filter((line) => line.length > 0)
    .join('\n');
}

describe('spatial engine src ↔ match-worker twin parity (#547)', () => {
  for (const name of TWINS) {
    it(`${name}.ts is identical in both copies (modulo import extensions + header)`, () => {
      const src = readFileSync(resolve(ROOT, SRC_DIR, `${name}.ts`), 'utf8');
      const worker = readFileSync(resolve(ROOT, WORKER_DIR, `${name}.ts`), 'utf8');
      // If this fails, the worker spatial copy has drifted — re-sync it to the
      // src source of truth (src is the tsc-checked, unit-tested canonical copy).
      expect(normalise(worker)).toBe(normalise(src));
    });
  }
});
