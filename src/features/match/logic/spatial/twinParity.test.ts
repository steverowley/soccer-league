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
// SCOPE (#547):
//   1. The spatial engine (8 modules) — guarded strictly below: code AND prose
//      must match (modulo import extensions + `// ──` dividers), since those
//      twins are hand-copied verbatim.
//   2. Three further pure-logic twins (cupDraw, random, simEvent) that are
//      code-identical but carry differing header prose — guarded with a
//      code-only comparison (full-line comments stripped, code kept verbatim).
//   The remaining same-named worker files (cosmicVoices, cupSeeder,
//   interferenceResolver, shadowDistribution) have genuinely DIVERGED beyond
//   comments — some legitimately (Deno-specific Supabase-client imports), some
//   look like real drift — so they are NOT pure twins and are deliberately
//   excluded here rather than force-aligned. Reconciling them is a separate,
//   higher-risk task (they run in the deployed worker). See #547.

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

// ── Code-only twins ───────────────────────────────────────────────────────────
// These three pure-logic modules live outside spatial/ but are still hand-copied
// into the worker. They are code-identical to their src source but carry their
// own header prose (the worker copies say "Verbatim copy of …"), so the strict
// normalise above would flag them. `normaliseCodeOnly` drops WHOLE-LINE comments
// and blank lines but keeps every code line verbatim — so prose drift is ignored
// while any real code divergence still fails the test.

/** Pure-logic twins guarded on code only (paths differ, so list both ends). */
const CODE_TWINS: ReadonlyArray<{ name: string; src: string; worker: string }> = [
  { name: 'cupDraw',  src: 'src/features/match/logic/cupDraw.ts',  worker: 'supabase/functions/match-worker/cupDraw.ts' },
  { name: 'random',   src: 'src/shared/utils/random.ts',          worker: 'supabase/functions/match-worker/random.ts' },
  { name: 'simEvent', src: 'src/features/match/logic/simEvent.ts', worker: 'supabase/functions/match-worker/simEvent.ts' },
];

/**
 * Strip full-line comments (both line-style and block-style) and the `// ──`
 * dividers, drop blank lines, remove the worker's `.ts` import-extension, and
 * trim trailing whitespace. Code lines (including any inline trailing comment or
 * a string that happens to contain `//`) are kept verbatim and compared in full,
 * so this can only ever hide whole-line PROSE differences — never a code diff.
 */
function normaliseCodeOnly(source: string): string {
  const out: string[] = [];
  let inBlock = false;
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    const t = line.trim();
    if (inBlock) {
      if (t.includes('*/')) inBlock = false;
      continue;
    }
    if (t.startsWith('/*')) {
      if (!t.includes('*/')) inBlock = true;
      continue;
    }
    if (t.startsWith('//')) continue; // full-line comment or `// ──` divider
    if (t.length === 0) continue;     // blank line
    out.push(line.replace(/\.ts(['"])/g, '$1')); // worker import extension
  }
  return out.join('\n');
}

describe('pure-logic src ↔ match-worker twin parity, code-only (#547)', () => {
  for (const { name, src, worker } of CODE_TWINS) {
    it(`${name}.ts is code-identical in both copies (prose ignored)`, () => {
      const srcSource = readFileSync(resolve(ROOT, src), 'utf8');
      const workerSource = readFileSync(resolve(ROOT, worker), 'utf8');
      // If this fails, the worker copy's CODE has drifted — re-sync it to the
      // src source of truth (src is the tsc-checked, unit-tested canonical copy).
      expect(normaliseCodeOnly(workerSource)).toBe(normaliseCodeOnly(srcSource));
    });
  }
});
