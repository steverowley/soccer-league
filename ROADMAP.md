# Intergalactic Soccer League — Roadmap

> **The active roadmap lives in GitHub Issues.** This file is a pointer.

## Milestones

Each milestone is a **label** on GitHub Issues (not a GitHub Milestone object). Open the live view:

- **[M0 — Launch Blockers](https://github.com/steverowley/soccer-league/issues?q=is%3Aissue+is%3Aopen+label%3AM0-launch-blockers)**
  Must land before any public link goes out — security holes, atomic betting/voting, account health,
  onboarding, observability, the operator deploy checklist.
- **[M1 — Architect Wakes Up](https://github.com/steverowley/soccer-league/issues?q=is%3Aissue+is%3Aopen+label%3AM1-architect-wakes-up)**
  The headline mechanic. Wire the Architect's mechanical interference into the **live spatial engine**
  (it was originally built against the legacy event shape), Balance/Chaos voices, Election Night ritual.
- **[M2 — Product Foundation](https://github.com/steverowley/soccer-league/issues?q=is%3Aissue+is%3Aopen+label%3AM2-product-foundation)**
  Design primitives, first-match teaching layer, login streaks, social presence, accessibility, smarter
  Home, global toast / per-route ErrorBoundary.
- **[M3 — Architectural Cleanup](https://github.com/steverowley/soccer-league/issues?q=is%3Aissue+is%3Aopen+label%3AM3-architectural-cleanup)**
  Delete the legacy `gameEngine.js` + its tests (the spatial engine is live); reduce the `src/` ↔ Deno
  `match-worker/` code duplication; clear the ESLint backlog so lint can gate CI; remove dead code/exports;
  remove stale `dev` references in `setup-branch-protection.yml` and `scripts/validate-branch-name.sh`;
  regenerate types; perf + RLS index passes.
- **[M4 — Depth & Community](https://github.com/steverowley/soccer-league/issues?q=is%3Aissue+is%3Aopen+label%3AM4-depth-community)**
  Mid-season micro-votes, training-narrative wiring, personal narrative threads, Discord + feedback +
  `/roadmap`, share-to-grow OG images, rivalry threads, supporter tier, DR runbook, doc re-audits.

> Issue counts move as work lands — use the live links above rather than a number baked into this file.
> As of the last refresh there were ~38 open issues across the milestones (M0 the largest).

## How to pick the next PR

1. Filter by the current milestone: `is:issue is:open label:M0-launch-blockers` (advance to M1/M2/… as
   M0 closes out).
2. Sort by priority label (`P0` → `P1` → `P2` → `P3`).
3. Read the issue body — it's self-contained: scope, tasks, file refs, acceptance criteria.
4. Check the `Source` line at the bottom — points at the audit that produced it.

## Conventions

- **Priority**: `P0` (critical / launch blocker) · `P1` (high) · `P2` (medium) · `P3` (low / backlog)
- **Type**: `feature` · `fix` · `refactor` · `chore` · `docs`
- **Milestone**: `M0-launch-blockers` · `M1-architect-wakes-up` · `M2-product-foundation` ·
  `M3-architectural-cleanup` · `M4-depth-community`

Branch + commit conventions live in [`CONTRIBUTING.md`](./CONTRIBUTING.md): branch from `main`, PR to
`main`, Conventional Commits.

## Origin

This roadmap structure was produced from a multi-agent comprehensive review (code architecture, gameplay
depth, UI/UX, product readiness, infra/security). Each issue references the specific audit finding that
produced it. The milestone descriptions were last reconciled against the codebase on 2026-06-06.
