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
    // Prioritise .ts/.tsx over .js/.jsx so that src/lib/supabase.ts is
    // resolved instead of src/lib/supabase.js for extensionless imports.
    // Vite's default order puts .js before .ts, which is wrong for a
    // mixed-JS/TS codebase where .ts files intentionally shadow .js ones.
    extensions: ['.mts', '.ts', '.tsx', '.mjs', '.js', '.jsx', '.json'],

    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@app': fileURLToPath(new URL('./src/app', import.meta.url)),
      '@features': fileURLToPath(new URL('./src/features', import.meta.url)),
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
      // NOTE: @types is intentionally omitted — TypeScript reserves that
      // namespace for DefinitelyTyped. Use @/* instead: '@/types/database'.
    },
  },

  // ── Build-time chunking ────────────────────────────────────────────────
  // The post-PR-10 single bundle ballooned past 500 KB minified, which
  // triggers Vite's chunk-size warning.  Splitting on stable library
  // boundaries gives the browser parallel downloads + cache hits across
  // deploys (changing app code doesn't bust the vendor chunk).
  //
  // CHUNK STRATEGY:
  //   - `react`          : react + react-dom + react-router-dom — rarely
  //                        changes, lives in its own chunk so app deploys
  //                        don't invalidate it.
  //   - `supabase`       : @supabase/* — heavy, app-rare-update profile.
  //   - `engine`         : gameEngine + the leagueData / teams seed
  //                        modules — large static payload only the match
  //                        simulator needs.  Keeping it separate means
  //                        every read-only page (Home, Leagues, Teams,
  //                        News, Idols) gets a smaller initial paint.
  //   - everything else  : default bundle.
  //
  // Raising `chunkSizeWarningLimit` is the lazy fix; manualChunks is the
  // honest one and gives genuine caching wins.
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            if (id.includes('react-router')) return 'react';
            if (id.includes('react-dom'))    return 'react';
            if (id.includes('/react/'))      return 'react';
            if (id.includes('@supabase'))    return 'supabase';
            return undefined;
          }
          // gameEngine is the largest hand-written module (2700+ LOC) —
          // group it with the static seed data it imports so the
          // editorial pages don't pull the simulator into their initial
          // chunk.
          if (id.includes('/src/gameEngine')) return 'engine';
          if (id.includes('/src/data/'))      return 'engine';
          return undefined;
        },
      },
    },
  },
});
