// Zero-dependency post-build step.
//
// Folds the single JS bundle (and any CSS) that `vite build` emits into
// demo/dist/index.html, writing one self-contained file at demo/match-demo.html
// that runs with no server, network, or backend.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const distUrl = new URL('./dist/', import.meta.url);
const indexPath = fileURLToPath(new URL('index.html', distUrl));
const jsPath = fileURLToPath(new URL('demo.js', distUrl));
const cssPath = fileURLToPath(new URL('demo.css', distUrl));
const outPath = fileURLToPath(new URL('match-demo.html', new URL('./', import.meta.url)));

let html = await readFile(indexPath, 'utf8');
const js = await readFile(jsPath, 'utf8');

// Inline CSS if the build produced any.
let css = '';
try {
  css = await readFile(cssPath, 'utf8');
} catch {
  // No CSS emitted (the demo uses inline styles + canvas) — fine.
}
// NB: pass a replacer *function* (not a string) to String.replace — minified
// bundles contain literal "$&"/"$1" sequences that a string replacement would
// interpret as match-group references, corrupting the inlined code.
if (css) {
  html = html.replace(/<link\b[^>]*rel="stylesheet"[^>]*>/i, () => `<style>${css}</style>`);
}

// Swap the external module script for an inline one. Escape any literal
// "</script>" in the bundle so it can't terminate the tag early.
const safeJs = js.replace(/<\/script>/gi, '<\\/script>');
html = html.replace(
  /<script\b[^>]*\bsrc="[^"]*demo\.js"[^>]*><\/script>/i,
  () => `<script type="module">${safeJs}</script>`,
);

await writeFile(outPath, html, 'utf8');
console.log(`Wrote ${outPath} (${(html.length / 1024).toFixed(0)} KB)`);
