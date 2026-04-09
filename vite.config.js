// ── Vite configuration ──────────────────────────────────────────────────────
// WHY: Vite is the dev server + build tool for the ISL frontend. This file
// wires the React plugin, Tailwind v4 plugin, the GitHub Pages sub-path
// (`/soccer-league/`), and the path aliases that mirror tsconfig.json and
// vitest.config.ts.
//
// PATH ALIASES: keep in lock-step with tsconfig.json's `paths` and
// vitest.config.ts's `resolve.alias`. Drift between any of the three is
// the single most common cause of "module not found" bugs. If you add a
// new alias, update all three files in the same commit.
//
// BASE PATH: the app is deployed to GitHub Pages at /soccer-league/, so
// Vite needs to emit asset URLs prefixed with that sub-path. Changing the
// deploy location means updating this value AND the `basename` on
// <BrowserRouter> in src/main.jsx.

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react(), tailwindcss()],

  // GitHub Pages sub-path. See comment above for rationale.
  base: '/soccer-league/',

  // Path aliases — MUST match tsconfig.json and vitest.config.ts exactly.
  // See the WHY block at the top of this file for the synchronization rule.
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
