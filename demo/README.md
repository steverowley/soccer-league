# Match Viewer — standalone demo

A self-contained, backend-free build of the in-app match viewer: the real
canvas pixel-art `<MatchViewer>` renderer, driven by the real spatial match
engine, replaying a synthetic match on a loop.

The output, **`match-demo.html`**, is a single HTML file with everything
inlined (engine + renderer + React). Open it in any browser — no server, no
network, no Supabase. It's meant to be handed to a design tool or shared as-is.

## Regenerate

```bash
npx vite build -c demo/vite.demo.config.ts   # bundles demo/main.tsx → demo/dist/
node demo/inline.mjs                          # folds the bundle → demo/match-demo.html
```

## Files

| File | Purpose |
|---|---|
| `index.html` / `main.tsx` | Standalone entry: renders `<MatchViewer>` with `generateDemoMatch()`. |
| `entities-shim.ts` | Aliases the heavy `@features/entities` barrel down to just `useReducedMotion`. |
| `vite.demo.config.ts` | Single-bundle build config (mirrors the root aliases). |
| `inline.mjs` | Inlines the bundle into one HTML file. |
| `match-demo.html` | **The deliverable** — the generated single-file demo. |

The demo reuses the app's actual code unchanged; nothing here is a
reimplementation, so the look matches production exactly.
