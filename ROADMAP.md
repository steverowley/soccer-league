# Intergalactic Soccer League — Roadmap

> **The active roadmap lives in GitHub Issues** — issue bodies are self-contained (scope, tasks,
> acceptance criteria). This file is the organized view on top: current state, execution order, and
> how to run the work with Claude (Fable) sessions. Last reorganized **2026-06-11** against the live
> issue tracker and codebase.

## Where the project stands

- **M0 (launch blockers): ✅ all closed.** Security holes, atomic betting/voting, onboarding,
  account health — done.
- **M1 (Architect wakes up): ✅ all closed code-side.** The spatial engine is the only engine (#389),
  Architect interference mechanically bites it (#543), drift between the browser and worker engine
  copies is CI-guarded (#554/#560).
- **M2 (product foundation): one and a half issues left** (#378 final slice, #381 blocked on an
  operator decision).
- **M3 (cleanup) and M4 (depth & community)** are the open backlog: 7 + 9 issues.
- **~1,330 Vitest tests green; CI gates typecheck + tests.** Lint still runs informationally
  (230-error backlog, #407).

**⚠️ But production is dark.** Two things broke the live game and both need ~30 minutes of
human (operator) action — no code is missing:

1. **Every LLM voice has been silent since May 21** — the Anthropic account ran out of API credits
   (#565). Pundits, journalists, whispers, decrees: all dead. Code fix + observability already
   shipped (#515); it revives on recharge.
2. **Match simulation and the galaxy tick stopped on June 2** — the `WORKER_SHARED_SECRET` isn't
   set on the production project, so the cron workers reject their own invocations (#442).

Everything else on this roadmap lands into a frozen game until those two are done.

## Milestone views (live links)

- [M2 — Product Foundation](https://github.com/steverowley/soccer-league/issues?q=is%3Aissue+is%3Aopen+label%3AM2-product-foundation)
- [M3 — Architectural Cleanup](https://github.com/steverowley/soccer-league/issues?q=is%3Aissue+is%3Aopen+label%3AM3-architectural-cleanup)
- [M4 — Depth & Community](https://github.com/steverowley/soccer-league/issues?q=is%3Aissue+is%3Aopen+label%3AM4-depth-community)
- [Operator queue](https://github.com/steverowley/soccer-league/issues?q=is%3Aissue+is%3Aopen+label%3Aoperator-action)
  (human-only: dashboards, billing, secrets — an agent cannot do these)

---

## Track 0 — Turn the universe back on (operator, ~30 min total)

Do these first, in this order. None are code tasks.

| # | Action | Time |
|---|--------|------|
| #565 | **Recharge Anthropic credits** (Console → Billing; consider auto-reload) | 5 min |
| #442 | Set `WORKER_SHARED_SECRET` Supabase secret + redeploy `match-worker` & `architect-galaxy-tick` | 15 min |
| #443 | Toggle "Block compromised passwords" in Supabase Auth | 2 min |
| #445 | Create a Sentry project, set `VITE_SENTRY_DSN` | 10 min |
| #444 | **Decide** the email provider (recommendation in the issue: Resend free tier) | decision |

**Then run one Fable verification session**: confirm matches simulate again, the galaxy tick reports
`llmErrors: 0` with `narrativesInserted > 0`, and fresh narratives reach the News feed. (Fable can do
this end-to-end via the Supabase MCP: trigger ticks, read logs, query `agent_runs`.)

## Track 1 — Finish M2 (product foundation)

| # | What | Notes for execution |
|---|------|---------------------|
| #378 | Final slice: migrate `MatchDetail` onto the shared primitives | **Combine with #390's MatchDetail split** (same file — doing them separately guarantees merge conflicts). Needs app-run visual verification against Figma. 9/12 primitives + Home migration already shipped (#562/#563). |
| #381 | Weekly email digest | Unblocked the moment #444 is decided. Self-contained edge function + profile toggle. |

## Track 2 — M3 cleanup (the most agent-friendly work; run these as parallel sessions)

Suggested order, with what can run simultaneously:

1. **#561 — diff the diverged worker twins** (`cosmicVoices`, `interferenceResolver`). Small, but it's
   a *possible silent production bug* (untested logic running in the deployed worker) — do it first.
   Closing it likely also closes **#547** (the remaining acceptance branch).
2. **#386 — Zod schemas on betting/voting/match/architect/entities reads** (P1). Biggest correctness
   win in the backlog; touches `api/` layers only, parallel-safe with everything below.
3. **#390 — split the 1,000+ line pages** (MatchDetail part folds into #378 above), then
   **#407 — clear the ESLint backlog and flip lint to gating in CI**. This order matters: #407's
   `any`-typing work overlaps the same pages #390 restructures.
4. **#393 — compress the 19 MB of PNGs to AVIF/WebP** and **#548 — delete fallow-flagged dead code**.
   Independent of everything; run any time. Do #548 *after* #386/#390 merge to avoid deleting
   exports those refactors touch.
5. **#566 — schedule the shadow-match-worker** (one cron migration; after #442).

## Track 3 — M4 depth & community (one Fable session per issue)

All five P2 features are independent (different features, disjoint files) and can run as parallel
sessions. Suggested order by player-visible impact:

1. #395 — training → newsfeed narrative wire (makes the clicker matter socially)
2. #396 — personal narrative thread on `/profile` (first-person hook, pure DB reads)
3. #394 — mid-season micro-votes (keeps the voting pillar warm weekly)
4. #397 — feedback widget + Discord link + `/roadmap` page
5. #399 — username moderation + impersonation guard (do before any public link goes out)

P3 backlog, in rough order: #559 (bettor narratives server-side), #398 (share/OG images),
#403 (Supabase Pro + DR runbook — operator + docs), #402 (cosmetic supporter tier — see Decisions).

## Open PR triage (state as of 2026-06-11)

- **#505** (dependabot: react-router 7.13 → 7.16) — merge once CI is green on it.
- **Dependabot security alerts**: GitHub reports 6 open (4 high, 2 moderate) on `main` — triage at
  [security/dependabot](https://github.com/steverowley/soccer-league/security/dependabot); #505 may
  clear some. Good first Fable session: review each alert, bump or dismiss with justification.
- **#456** (Wagers EmptyState consumer) — still valid but 2+ weeks stale; rebase or redo in the next
  primitives session (it's a 5-line change).
- **#475, #496** — closed during this reorg: both targeted `simulateFullMatch.ts`/`gameEngine.js`,
  which were deleted when the project committed fully to the spatial engine (#389/#553). Their intent
  (interference wiring, position snapshots) already shipped via #543 and migration 0061.

## Decisions queue (genuine choices only — everything else just proceeds)

| Decision | Options | Recommendation |
|----------|---------|----------------|
| Email provider (#444) | Resend / Supabase SMTP relay / Postmark | Resend (free tier covers early traffic) |
| Galaxy-tick voice model | Keep Haiku (current pin, ~10× cheaper) vs restore Sonnet richness | Keep Haiku until the feed is alive again, then A/B a week of Sonnet |
| Neptune club (#510) | Add a 33rd club vs fix the lore/docs | Fix the lore (option 2) — adding a team breaks the 4×8 league math |
| Supporter tier timing (#402) | Build now vs after public launch | After launch — no fans yet to support it |

## Running this roadmap with Fable

The repo is set up so an agent session can carry an issue end-to-end. Per session:

1. **One issue = one branch = one PR.** Branch `<type>/<kebab-description>` off fresh `main`;
   Conventional Commit messages; PR targets `main`; squash-merge.
2. Point the session at the issue: *"Work issue #NNN in steverowley/soccer-league. Read the issue
   body and comments, then CLAUDE.md. Implement with tests, run `npm run check`, push, open a PR,
   subscribe to PR activity, and fix CI/review feedback until it merges. Close the issue when done."*
3. **Parallel sessions are safe when file surfaces are disjoint** — the groupings above call out
   what can run simultaneously. Don't run two sessions that both touch the same page or feature.
4. UI work (#378, #390, M4 features) should **run the app and visually verify** before pushing —
   the Figma design system is the source of truth for look & feel.
5. Anything labeled `operator-action` is human-only: billing, dashboard toggles, secrets. Fable can
   *verify* the outcomes afterwards via the Supabase MCP but cannot perform them.

## Horizon (designed in Notion, not yet ticketed)

From the design doc, for after M4 — file issues when they become current:
- **Positional play styles + personality-driven player agents** (the "fox-in-the-box vs target man"
  idea) — natural next layer on the spatial engine.
- **More entity types**: physios, doctors, scouts, analysts, the players' union, named broadcast
  companies.
- **Merch e-commerce** (Shopify) — explicitly "if the game becomes popular".

## Conventions

- **Priority**: `P0` (critical) · `P1` (high) · `P2` (medium) · `P3` (low / backlog)
- **Type**: `feature` · `fix` · `refactor` · `chore` · `docs` (+ `operator-action`)
- **Milestone labels**: `M2-product-foundation` · `M3-architectural-cleanup` · `M4-depth-community`
  (M0/M1 retired — closed out)

Branch + commit conventions live in [`CONTRIBUTING.md`](./CONTRIBUTING.md): branch from `main`, PR to
`main`, Conventional Commits.

## Origin

Issue structure produced by the 2026-05 multi-agent audit (architecture, gameplay, UI/UX, product,
infra/security); milestones reconciled against the codebase 2026-06-06; this execution plan
reorganized 2026-06-11 after M0/M1 closed out.
