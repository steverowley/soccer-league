# Contributing to Intergalactic Soccer League

Welcome! This guide explains our Git workflow, branch strategy, and commit conventions.

## Quick Start

```bash
# 0. (Optional) Install Git hooks to validate branch names
./scripts/setup-git-hooks.sh

# 1. Create a feature branch (NOT claude/xyz-ABC123)
git checkout -b feat/your-feature-name

# 2. Make changes, commit with conventional format
git commit -m "feat: add new feature"
git commit -m "fix: resolve bug in match simulation"

# 3. Push and create a PR to `dev`
git push -u origin feat/your-feature-name

# 4. After merge, branch is auto-deleted
# (If not, delete manually: git push origin --delete feat/your-feature-name)
```

> **Pro tip:** Run `./scripts/setup-git-hooks.sh` once to install a pre-push hook that validates your branch names automatically. Non-conforming branch names will be rejected at push time.


## Branch Naming Rules

Use conventional commit type as prefix, followed by kebab-case description:

| Type | Purpose | Example |
|------|---------|---------|
| `feat/` | New features | `feat/user-authentication` |
| `fix/` | Bug fixes | `fix/realtime-event-loss` |
| `chore/` | Maintenance, deps, config | `chore/update-eslint-rules` |
| `docs/` | Documentation | `docs/api-endpoints` |
| `refactor/` | Code restructuring | `refactor/architect-logic` |
| `test/` | Test improvements | `test/cosmic-voice-coverage` |

**❌ DO NOT USE:**
- `claude/xyz-ABC123` (legacy Claude Code pattern)
- `wip/`, `temp/`, `random-stuff` (vague names)
- `FEATURE-NAME` (must be lowercase)
- Spaces or underscores (use hyphens)

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add match simulator chaos director
fix: prevent duplicate event logs on retry
chore: bump Node.js to 20.x
docs: document Architect lifecycle
refactor: simplify event filtering logic
```

**Format:**
```
<type>: <description>

<optional body - explain WHY, not WHAT>
```

**Examples:**
```
feat: implement fan support stat boost

When a match begins, the team with more logged-in fans receives 
a 2% stat multiplier for that match. Tracked via match_attendance 
table with Realtime publication.

fix: resolve realtime events lost during page load

Events arriving before initial fetch completed were overwritten. 
Now using setEvents() callback to dedupe by ID and merge arrays.
```

## Pull Request Workflow

1. **Create PR to `dev`** (never `main` directly)
   - Title: use conventional format (e.g., "feat: add betting odds engine")
   - Description: explain WHAT changed and WHY
   - Link any related issues

2. **CI gates:**
   - `npm run typecheck` — TypeScript strict mode
   - `npm run lint` — ESLint rules
   - `npm run test` — Vitest suite

3. **Code review:**
   - At least 1 approval for dev
   - Main requires explicit approval

4. **Merge strategy:**
   - `dev`: squash merge (keeps history clean)
   - `main`: fast-forward merge from dev

5. **After merge:**
   - Branch is auto-deleted
   - `main` synced with `dev` if not already

## Working with `main` and `dev`

- **Always branch from `dev`**, never from `main`
- **Always PR to `dev`**, unless explicitly told otherwise
- `main` should **only** receive merges from `dev` (via sync, not direct PRs)
- `main` is production-ready; `dev` is integration point

## Database Migrations

When modifying the schema:

1. Create a migration file: `supabase/migrations/{timestamp}_{name}.sql`
2. Apply via: `mcp apply_migration`
3. Regenerate types: `mcp generate_typescript_types` → `src/types/database.ts`
4. Commit both migration file and updated types
5. Use Zod schema in `api/` layer to validate at runtime

Example:
```bash
# Schema change in migration
supabase/migrations/20260506120000_add_match_events.sql

# Apply and regenerate
npm run supabase:types

# Commit with the migration
git add supabase/migrations/ src/types/database.ts
git commit -m "feat: add match_events table for live match tracking"
```

## Code Organization

Folder structure enforces clean boundaries:

```
src/
├── features/
│   ├── auth/
│   │   ├── api/          ← Supabase + Zod validators
│   │   ├── logic/        ← Pure TypeScript (100% testable)
│   │   ├── ui/           ← React components
│   │   ├── types.ts      ← Feature types
│   │   └── index.ts      ← Public exports
│   └── ...
├── shared/
│   ├── ui/               ← Design system primitives
│   ├── hooks/            ← React hooks
│   ├── events/bus.ts     ← Cross-feature event bus
│   └── supabase/         ← Supabase client context
├── app/                  ← Route pages (thin wrappers)
└── types/
    └── database.ts       ← Auto-generated Supabase types
```

**Cross-feature imports are forbidden** — ESLint `no-restricted-imports` enforces it. Use the event bus for cross-feature communication.

## Testing

Every `logic/` and `api/` module gets co-located tests:

```
src/features/match/logic/
├── cosmicVoices.ts
├── cosmicVoices.test.ts  ← Vitest, 80%+ coverage target
└── ...
```

Run tests:
```bash
npm run test              # Run suite
npm run test:watch       # Watch mode
npm run test:coverage    # Coverage report
```

## Common Tasks

### Adding a new feature
```bash
git checkout -b feat/my-feature
# Make changes...
git commit -m "feat: implement new feature"
git push -u origin feat/my-feature
# Create PR to dev via GitHub
```

### Fixing a bug
```bash
git checkout -b fix/bug-description
# Fix the bug, write a test...
git commit -m "fix: resolve bug in X component"
git push -u origin fix/bug-description
# Create PR to dev via GitHub
```

### Syncing with latest dev
```bash
git fetch origin
git rebase origin/dev
git push -u origin feat/my-feature --force-with-lease
```

### Handling merge conflicts
```bash
# During rebase
git rebase dev
# ... resolve conflicts in editor
git add .
git rebase --continue
```

## Questions or Issues?

- Check the main [CLAUDE.md](./CLAUDE.md) for project vision & engineering principles
- Check [Notion](https://www.notion.so/rowley/Intergalactic-Soccer-League-33cda0dddb8780408628f63f07e89e05) for game design
- Run `bd prime` for issue tracking commands
- Open an issue for bugs or feature requests

Happy coding! 🚀
