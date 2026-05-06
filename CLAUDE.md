# Intergalactic Soccer League — Engineering Guide

**Source of truth for game design**: Notion doc.  
**Source of truth for implementation**: `/root/.claude/plans/nifty-brewing-pixel.md`.

## Core Vision

A Blaseball-inspired **social experiment browser game** with **hidden mechanics, emergent storylines, and fan-driven narratives**. Design pillars: **emergent storytelling over exposed mechanics** · **fan-driven collective agency** · **the Architect is the soul** · **modular now, easy rewrites later** · **retro-minimalist design** · **long-term social experiment**.

## Engineering principles (non-negotiable, apply to every PR)

1. **TypeScript everywhere** with `strict: true`. Typed Supabase client regenerated on every migration via the Supabase MCP's `generate_typescript_types` into `src/types/database.ts`.
2. **Feature-based folder layout**: `src/features/{auth,betting,entities,voting,training,architect,match,finance,design-system}/{api,logic,ui}/` + `types.ts` + `index.ts` barrel. Cross-feature deep imports are forbidden — ESLint `no-restricted-imports` enforces it. Pages under `src/app/` are thin route wrappers. Shared primitives in `src/shared/{ui,hooks,utils,events,supabase}`.
3. **Clear layer boundaries inside each feature**: `api/` (Supabase + Zod), `logic/` (pure TS — no React, no Supabase, 100% unit-testable), `ui/` (React). Pure logic lives in `logic/`; nothing else.
4. **Supabase migration discipline**: every schema change is a timestamped `supabase/migrations/{ts}_{name}.sql` file applied via the Supabase MCP's `apply_migration`. `supabase/schema.sql` is a generated snapshot, not hand-edited.
5. **Runtime + compile-time boundaries**: all Supabase reads pass through Zod schemas in `api/` so DB drift fails loud at the boundary.
6. **Dependency injection**: features never `import { supabase }` directly. They consume the client via `useSupabase()` (React context) or a function argument — makes unit tests trivial and future-proofs swapping the backend.
7. **Vitest unit tests** co-located next to every `logic/` and `api/` module. CI gates on `tsc --noEmit && eslint && vitest`. Target 80%+ coverage of `logic/`.
8. **Event-driven cross-feature communication** via a typed in-app bus (`src/shared/events/bus.ts`). Example: `match.completed` triggers betting settlement without betting and match features knowing about each other.
9. **No dead code, no speculative abstractions**. One consumer ≠ helper. Refactor when a second consumer appears.
10. **ESLint + Prettier + strict tsconfig** in CI from Phase -1 onward. No style debates in review.


### Critical engineering invariants
- `src/gameEngine.js` consumes player data in camelCase via `normalizeTeamForEngine()` (`src/lib/supabase.js:381–437`). **Never drop** `attacking`/`defending`/`mental`/`athletic`/`technical`/`jersey_number`/`starter` columns from `players`.
- `CosmicArchitect.getContext()` (`src/agents.js:161`) is called synchronously on every LLM prompt and can fire 5–10 times in <500ms during a goal burst. **Never block it on Supabase round-trips** — hydrate lore before kickoff, write fire-and-forget.
- The Architect is the game's identity. Every new feature should give it new levers.
