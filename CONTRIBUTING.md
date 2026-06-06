# Contributing to Intergalactic Soccer League

This guide covers the Git workflow, commit conventions, and the day-to-day mechanics of working in this
repo. For project vision, architecture, and engineering invariants, read [`CLAUDE.md`](./CLAUDE.md).

## Quick Start

```bash
# 0. (Optional) install the branch-name validation hook
./scripts/setup-git-hooks.sh

# 1. Branch from main (there is no dev branch)
git switch main && git pull
git switch -c feat/your-feature-name

# 2. Make changes; commit with Conventional Commits
git commit -m "feat: add new feature"
git commit -m "fix: resolve bug in match simulation"

# 3. Verify locally, then push and open a PR targeting main
npm run check
git push -u origin feat/your-feature-name
```

## Branching

**This repo uses plain GitHub-flow on a single trunk: `main`. There is no `dev` branch** — ignore any
older doc, hook, or workflow that mentions one. Branch from `main`, open your PR against `main`, and the
branch is deleted after merge.

Name branches with a Conventional Commit type prefix + kebab-case description:

| Type | Purpose | Example |
|------|---------|---------|
| `feat/` | New features | `feat/welcome-wizard` |
| `fix/` | Bug fixes | `fix/spatial-goal-scorer-attribution` |
| `chore/` | Maintenance, deps, config | `chore/lint-unused-vars-sweep` |
| `docs/` | Documentation | `docs/realign-project-docs` |
| `refactor/` | Code restructuring | `refactor/extract-getmatch-to-feature` |
| `perf/` | Performance | `perf/standings-query-pushdown` |
| `test/` | Test improvements | `test/spatial-seed-divergence-stability` |
| `ci/` | CI / workflow changes | `ci/deploy-match-worker` |

**Avoid:** `claude/xyz-ABC123` (legacy agent pattern), vague names (`wip/`, `temp/`), uppercase, spaces,
or underscores.

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/): `<type>: <description>`, imperative
mood, lowercase, no trailing period, subject under 72 characters. Use the body to explain **why**, not
what.

```
feat: implement fan support stat boost

When a match begins, the team with more present fans receives a small stat
boost for that match. Tracked via the match_attendance table.
```

Allowed types: `feat` · `fix` · `chore` · `docs` · `style` · `refactor` · `perf` · `test` · `build` ·
`ci` · `revert`. Breaking changes append `!` and include a `BREAKING CHANGE:` footer.

## Pull Requests

1. **Open the PR against `main`.** Title in Conventional Commit format; description explains what and
   why; link related issues (e.g. `Closes #529`).
2. **CI** (`deploy.yml` → `quality` job) runs `npm run typecheck` then `npm run test`. **These gate the
   merge.** ESLint runs too, but informationally (`continue-on-error`) while a backlog of pre-existing
   errors is cleared — so lint failures do not block, but you should still write lint-clean code. Run
   `npm run check` locally before pushing.
3. **Merge** is **squash** to `main`. Keep the squashed subject in Conventional Commit form; GitHub
   appends the PR number, e.g. `fix(voting): atomic, server-validated focus votes (#539)`.
4. **After merge**, delete the branch.

## Database Migrations

When modifying the schema:

1. Create a numbered migration: `supabase/migrations/{NNNN}_{name}.sql` (next number after the current
   highest — see `supabase/migrations/`).
2. Apply it via the Supabase MCP `apply_migration`.
3. Regenerate types via the Supabase MCP `generate_typescript_types` → `src/types/database.ts`.
4. Add a Zod schema in the relevant feature's `api/` layer so the read fails loud if the DB drifts.
5. Commit the migration file **and** the regenerated `database.ts` together.

> There is no `npm run supabase:types` script and no `supabase/config.toml`. Migrations are the source
> of truth for schema; cron jobs and function secrets live in migrations and the Supabase dashboard.

## Code Organization

```
src/
├── features/<feature>/   ← 11 vertical slices (see CLAUDE.md "Feature inventory")
│   ├── api/              ← Supabase + Zod (the runtime boundary)
│   ├── logic/            ← pure TypeScript (no React, no Supabase, unit-tested)
│   ├── ui/               ← React components
│   ├── types.ts          ← feature types
│   └── index.ts          ← public barrel (the ONLY cross-feature entry point)
├── pages/                ← thin route wrappers (routing is wired in src/main.tsx)
├── shared/{ui,hooks,utils,events,supabase}/
└── types/database.ts     ← generated Supabase types
```

**Cross-feature deep imports are forbidden.** Import another feature only through its `@features/<name>`
barrel — `eslint.config.js` `no-restricted-imports` errors on deeper paths. Use the event bus
(`src/shared/events/bus.ts`) for cross-feature side effects. Not every feature has all of
`api/logic/ui` — match the shape that already exists.

## Testing

Co-locate Vitest tests next to the `logic/` and `api/` module they cover (`foo.ts` → `foo.test.ts`),
targeting 80%+ coverage of `logic/`.

```bash
npm run test           # one-shot (vitest run)
npm run test:watch     # watch mode
npm run test:coverage  # coverage report
npm run check          # typecheck + lint + test (run before every push)
```

## Task Tracking

Work is tracked in **GitHub Issues** with label-based milestones (`M0`–`M4`) and priorities (`P0`–`P3`).
See [`ROADMAP.md`](./ROADMAP.md). Beads/`bd` was removed in #357 — do not use it.

```bash
gh issue list --state open --label M0-launch-blockers   # current launch-blockers
gh issue view <number>                                   # full body + acceptance criteria
```

## Questions?

- [`CLAUDE.md`](./CLAUDE.md) — vision, architecture, engineering principles, invariants.
- [Notion](https://www.notion.so/rowley/Intergalactic-Soccer-League-33cda0dddb8780408628f63f07e89e05) —
  game design source of truth.
- Open a GitHub issue for bugs or feature requests.
