/// <reference types="vitest" />
// ── Vitest configuration ────────────────────────────────────────────────────
// WHY: Phase -1 introduces Vitest as the unit-test runner for the codebase.
// The plan's engineering principles mandate that all pure logic lives in
// `features/**/logic/` and `shared/**` and is 100% unit-testable. This
// config is the CI gate that enforces "logic is testable" — if a module
// imports React or Supabase at the top level, it won't run here.
//
// KEY CHOICES:
// - `environment: 'jsdom'` — some tests exercise React components via
//   @testing-library/react, so we need a DOM. Pure logic tests don't use
//   the DOM but still run fine in this environment.
// - `setupFiles` — global test setup (jest-dom matchers, fake-timers
//   defaults, etc.) lives in src/shared/test/setup.ts so it's versioned
//   alongside the tests it supports.
// - coverage include paths are deliberately narrow: we measure coverage
//   ONLY on logic/ and shared/ because those are pure and every branch
//   should be reachable from a test. UI coverage is out of scope for the
//   coverage target.
// - Path aliases MUST mirror tsconfig.json exactly; any drift will surface
//   as "cannot find module" errors only inside tests.

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  test: {
    // Expose describe/it/expect globally so tests don't need to import
    // them. Complements the "vitest/globals" ambient types in tsconfig.
    globals: true,

    // jsdom gives us `document`/`window` so React component tests work.
    // Pure logic tests ignore the DOM and are unaffected.
    environment: 'jsdom',

    // Global setup: jest-dom matchers, any per-test teardown, shared mocks.
    setupFiles: ['./src/shared/test/setup.ts'],

    // Co-located test files next to the modules they exercise.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],

    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Only measure coverage on pure logic + shared primitives. UI and
      // api/ layers have their own tests but aren't gated on coverage.
      include: ['src/features/**/logic/**', 'src/shared/**'],
      // Exclude test files themselves, barrel re-exports, and type-only
      // files — none of them contain executable logic to measure.
      exclude: ['**/*.test.{ts,tsx}', '**/index.ts', '**/types.ts'],
    },
  },

  // Aliases mirror tsconfig.json's `paths`. Drift between these three
  // files (tsconfig, vite config, vitest config) is the single most
  // common cause of "works in dev but not in test" bugs.
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@app': fileURLToPath(new URL('./src/app', import.meta.url)),
      '@features': fileURLToPath(new URL('./src/features', import.meta.url)),
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
      // NOTE: @types is intentionally omitted — TypeScript reserves that
      // namespace for DefinitelyTyped. Use @/* instead: '@/types/database'.
    },
  },
});
