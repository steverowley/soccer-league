# Agent Instructions

Instructions for AI coding agents working in this repo. The full project charter — vision, engineering
principles, architecture, and invariants — lives in [`CLAUDE.md`](./CLAUDE.md); **read it first**.

## Where the work lives

Task tracking is **GitHub Issues**, organised by label-based milestones (`M0`–`M4`) and priority
(`P0`–`P3`).

```bash
gh issue list --state open --label M0-launch-blockers   # current launch-blockers
gh issue list --state open --label "M0-launch-blockers" --label P0   # top priority
gh issue view <number>                                   # full body + acceptance criteria
```

Or use the GitHub MCP tools: `mcp__github__list_issues`, `mcp__github__issue_read`,
`mcp__github__issue_write`, `mcp__github__add_issue_comment`.

> **Do NOT use beads/`bd`.** That tooling was removed in #357 — there is no `bd` binary and no `.beads/`
> data. Don't use `TodoWrite` or markdown TODO files for cross-session tracking either. GitHub Issues is
> the single system of record.

## Session ritual

1. **Start** — pick an issue (start at the current milestone, sort by priority), read its body, then
   check the current branch and `git status`.
2. **Branch** — from `main`: `git checkout -b <type>/<short-description>`. There is **no `dev` branch**;
   ignore any doc/hook/workflow that mentions one.
3. **Work** — follow the layer boundaries and import discipline in `CLAUDE.md`. Keep changes surgical.
4. **Verify** — run `npm run check` (`typecheck` + `lint` + `test`). CI gates on typecheck + tests; lint
   is currently informational, but write lint-clean code.
5. **Commit** — Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `perf:`, `test:`,
   `ci:`), imperative, lowercase, no trailing period.
6. **Finish** — push the branch, open a PR **targeting `main`**, subscribe to PR activity, and close any
   issues you completed. Work isn't done until it's pushed and the PR is open.

## Database changes

Schema changes are numbered migrations under `supabase/migrations/{NNNN}_{name}.sql`, applied via the
Supabase MCP `apply_migration`, after which you regenerate `src/types/database.ts` via the Supabase MCP
`generate_typescript_types`. Commit the migration and the regenerated types together. (There is no
`npm run supabase:types` script and no `supabase/config.toml`.)

## Non-interactive shell commands

**Always use non-interactive flags** so an agent never hangs on a confirmation prompt. `cp`/`mv`/`rm`
may be aliased to `-i` on some systems:

```bash
cp -f source dest        # not: cp source dest
mv -f source dest        # not: mv source dest
rm -f file               # not: rm file
rm -rf directory         # not: rm -r directory
```

Other commands that may prompt: `scp`/`ssh` (use `-o BatchMode=yes`), `apt-get` (`-y`), `brew`
(`HOMEBREW_NO_AUTO_UPDATE=1`).
