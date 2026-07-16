// Dedicated Vite config for the standalone match-viewer demo.
//
// Builds demo/main.tsx into a single JS bundle (no code-splitting, all assets
// inlined). The companion `inline.mjs` then folds that bundle into one
// self-contained HTML file (demo/match-demo.html) that runs with no server or
// backend — drop it into any browser, or hand it to a design tool.
//
// Aliases mirror the root vite.config.ts, except `@features/entities`, which is
// redirected to entities-shim.ts so the heavy entity/Supabase barrel isn't
// pulled in just for the <MatchViewer>'s `useReducedMotion` hook.

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const src = fileURLToPath(new URL('../src', import.meta.url));
const features = fileURLToPath(new URL('../src/features', import.meta.url));
const entitiesShim = fileURLToPath(new URL('./entities-shim.ts', import.meta.url));

export default defineConfig({
  root,
  base: './',
  plugins: [react()],
  resolve: {
    extensions: ['.mts', '.ts', '.tsx', '.mjs', '.js', '.jsx', '.json'],
    // Order matters: the most specific alias must come first.
    alias: [
      { find: '@features/entities', replacement: entitiesShim },
      { find: '@features', replacement: features },
      { find: '@', replacement: src },
    ],
  },
  build: {
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
    // Inline every static asset; emit a single, predictably-named JS bundle.
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 100_000,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: 'demo.js',
        assetFileNames: 'demo[extname]',
      },
    },
  },
});
