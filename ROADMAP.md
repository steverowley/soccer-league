# Intergalactic Soccer League — Roadmap

> **The active roadmap lives in GitHub Issues.** This file is a pointer.

## Milestones

Each milestone is a label group on GitHub Issues. Open the live view:

- **[M0 — Launch Blockers](https://github.com/steverowley/soccer-league/issues?q=is%3Aissue+is%3Aopen+label%3AM0-launch-blockers)** (10 PRs)
  Must land before any public link goes out. Edge-function lockdown, anon-RPC fix, CI gate, atomic betting, account health, SEO/legal, onboarding wizard, observability.

- **[M1 — Architect Wakes Up](https://github.com/steverowley/soccer-league/issues?q=is%3Aissue+is%3Aopen+label%3AM1-architect-wakes-up)** (8 PRs)
  The headline mechanic. Wire `maybeInterfereWith()` into the worker, port the Balance/Chaos voices, server-side enactment + Election Night ritual UI, variant focus outcomes, mid-week roster intrusions.

- **[M2 — Product Foundation](https://github.com/steverowley/soccer-league/issues?q=is%3Aissue+is%3Aopen+label%3AM2-product-foundation)** (8 PRs)
  Design primitives, first-match teaching layer, login streaks, weekly email digest, social presence surfaces, global toast / per-route ErrorBoundary, accessibility pass, smarter Home.

- **[M3 — Architectural Cleanup](https://github.com/steverowley/soccer-league/issues?q=is%3Aissue+is%3Aopen+label%3AM3-architectural-cleanup)** (8 PRs)
  Zod schemas, dissolve `src/lib/supabase.ts`, regenerate types, convert `gameEngine.js`, split god pages, perf, RLS init-plan + index pass, asset compression.

- **[M4 — Depth & Community](https://github.com/steverowley/soccer-league/issues?q=is%3Aissue+is%3Aopen+label%3AM4-depth-community)** (11 PRs)
  Mid-season micro-votes, training-narrative wire, personal narrative thread on Profile, Discord + feedback + /roadmap, share-to-grow OG images, username moderation, sortable standings, rivalry threads in UI, Patrons supporter tier, Supabase Pro + DR runbook, CLAUDE.md re-audit.

## How to pick the next PR

1. Filter by milestone: `is:issue is:open label:M0-launch-blockers` (or whichever milestone is current).
2. Sort by priority label (`P0` → `P1` → `P2` → `P3`).
3. Read the issue body — it's self-contained: scope, tasks, file refs, acceptance criteria.
4. Check the `Source` line at the bottom — points at the audit that produced it.

## Conventions

- **Priority**: `P0` (critical / launch blocker) · `P1` (high) · `P2` (medium) · `P3` (low / backlog)
- **Type**: `feature` · `fix` · `refactor` · `chore` · `docs`
- **Milestone**: `M0-launch-blockers` · `M1-architect-wakes-up` · `M2-product-foundation` · `M3-architectural-cleanup` · `M4-depth-community`

Branch naming follows Conventional Commits (see `CLAUDE.md`): `feat/<short>`, `fix/<short>`, `chore/<short>`, `refactor/<short>`, `docs/<short>`.

## Origin

This roadmap was produced from a five-agent comprehensive review (code architecture, gameplay depth, UI/UX, product readiness, infra/security) on 2026-05-22. Each issue references the specific audit finding that produced it.
