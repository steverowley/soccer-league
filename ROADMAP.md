# Intergalactic Soccer League — Roadmap

> Tasks live in **GitHub Issues** (bodies are self-contained: scope, file refs, acceptance criteria).
> This file is the strategy on top: the verified state of the world, the order of battle, and how to
> execute it with Claude (Fable) sessions. Rebuilt **2026-06-11** from a first-hand audit —
> production DB queries, Supabase security advisors, a full player-journey code walkthrough, an
> engine capability map, and a clean-room `npm run check` + build.

## The strategy in one paragraph

Season 1 is over and the universe is stuck: the election ran, two focuses were enacted, and then
nothing — no Season 2, no fixtures, both cups frozen, and every AI voice silent since May 21 for
want of API credits. The order of battle is therefore: **resurrect** (operator, ~20 min), **make the
season loop perpetual** (the game must run forever without surgery), **polish the first-fan funnel
and make the Architect visible** (the soul is currently invisible during live matches), **then
soft-launch** to the first real fans. Depth features follow once strangers are in the door.

## Verified state of the galaxy (production, 2026-06-11)

**Players & economy** — 1 user account, 4 wagers ever (1 won, 3 lost, all settled cleanly). This is
pre-launch; retention/community features rank below launch features.

**Season** — "Season 1 — 2600": 225/225 league fixtures completed (finished 2026-06-04); status
stuck in `voting`; election ran; 2 focuses enacted for Earth United on 2026-06-07 (Sign a Star
Player + Intensive Preseason Camp); the Election Night incineration ritual never fired (0 ever);
**no Season 2 exists and no code path creates one** (#568).

**Cups** — Celestial Cup + Solar Shield seeded their Rounds of 16 correctly… dated **2600-08-04**
(the in-universe calendar). The worker claims `scheduled_at <= now()`, so those 8 fixtures are
unreachable forever (#569). League fixtures used real 2026 dates — the bug is cup-seeder specific.

**Narrative layer** — galaxy-tick runs and writes (auth working again; 102 narratives in 7 days),
but **459 LLM errors in 7 days**: credits are still empty (#565), so the feed is 78% one fallback
kind (`cosmic_disturbance`). Cron live: match-worker + notify (1 min), galaxy-tick (2 h), enricher
(1 h), drama (daily). The shadow worker is deployed but never scheduled (#566).

**Security** — advisors report 7 ERROR-level `SECURITY DEFINER` views plus function/search-path and
admin-RPC-grant warnings, none previously tracked (#572). HIBP toggle off (#443). npm audit: 2 high
(react-router — exactly Dependabot PR #505) + 1 moderate.

**Code health** — typecheck ✅, **1,337 tests ✅**, build ✅ (dist 4.4 MB; `public/img/` already
optimized to 3.0 MB, so #393 is nearly done). ESLint backlog is 210 errors, **205 of them a single
rule** (`no-explicit-any`) — #407 is one campaign, not sixty fires. 62k LOC in `src/`, 14k in the
worker mirror.

**Engine truth** — 22-agent spatial sim with stamina, possession physics, 4 formations; the
fan-support boost genuinely reaches the engine. The Architect has **4 mechanical levers** (curse /
bless / annul goal / force red) + 19 narrative-only kinds. Stored but unused by the sim: player
personality, age, form, home advantage; no substitutions/cards/injuries in-sim. Worker catch-up
after downtime is safe (5 matches claimed per minute).

**Funnel truth** — signup → welcome wizard → bet → train → vote all work, but the wizard's "first
bet" step dead-ends off-page, the 200-credit grant has no moment, teaching strips are
dismissible-forever, odds/economy are unexplained (#571) — and **Architect interference never
appears in the live match feed**, only later in `/news` (#570).

## Phase 0 — Resurrection (operator: ~20 min, then one Fable verify session)

| # | Action | Time |
|---|--------|------|
| #565 | **Recharge Anthropic credits** (+ enable auto-reload) | 5 min |
| #442 | Confirm `WORKER_SHARED_SECRET` is set correctly, then close (auth already works in practice — the tick executes) | 5 min |
| #443 | Supabase Auth → "Block compromised passwords" toggle | 2 min |
| #445 | Create Sentry project, set `VITE_SENTRY_DSN` | 10 min |
| #444 | Decide the email provider (Resend recommended) — only gates #381 | decision |

**Fable verify session after the recharge**: galaxy-tick returns `llmErrors: 0` and
`narrativesInserted > 0`; feed diversity returns (the `cosmic_disturbance` fallback stops
dominating); **also trigger drama-tick and one in-match interference** — both call Sonnet model ids
that have never been validated on this key (the credit outage masked them); pin or fix if rejected.

## Phase 1 — The perpetual season machine (Fable, ~3–4 sessions)

The most valuable thing Fable can build now: after this phase the game runs forever without manual
surgery.

1. **#569 — rescue the cups**: real-time cup scheduling + one-off fix for the 8 stranded fixtures;
   decide the "do cups gate season end?" policy.
2. **#568 — season rollover**: `voting → enacted → archived`, create Season 2, generate real-dated
   fixtures for all 4 leagues, Election Night ritual decision, idempotent.
3. **#566 — schedule the shadow worker**: one cron migration (after #442).

Exit criterion: Season 2 kicks off on its own and the Celestial Cup crowns a champion.

## Phase 2 — The funnel and the soul (Fable, parallel-safe sessions)

What a first-time visitor experiences, in priority order:

1. **#570 — Architect interference visible in live matches** (the soul pillar; the demo moment).
2. **#571 — onboarding finish line**: inline starter bet, credit moment, persistent booth intro,
   interface-not-mechanics explainers.
3. **#378 final slice + #390's MatchDetail split — one combined session** (same file; done
   separately they guarantee merge conflicts). Visual verification against Figma required.
4. **#399 — username moderation + impersonation guard** (before any public link).
5. **#403 — Supabase Pro + PITR (~$25/mo) + DR runbook** (operator billing; Fable drafts the
   runbook) — pre-launch gate.

## Phase 3 — Soft launch + early retention

Decide a soft-launch cohort (10–50 friendlies) once Phases 0–2 land. Then:

- #381 weekly email digest (needs #444)
- #397 feedback widget + Discord link + `/roadmap` page
- #396 personal narrative thread on `/profile`
- #398 share/OG images (labelled P3, but it's the growth surface — revisit priority at launch)
- Sentry triage habit once #445 is live

## Phase 4 — Depth (post-launch, audience-informed)

#394 mid-season micro-votes · #395 training-narrative wire · #559 bettor narratives server-side ·
#402 supporter tier (timing decision) · #510 Neptune lore decision.

**Engine-depth backlog** (deliberately unticketed until prioritized; from the capability map):
personality-modulated decision-making, age curves, home-advantage physics, form, substitutions/
injuries/cards in-sim, and promoting more of the 19 narrative-only interference kinds into
mechanical Architect levers — each is a new lever for the soul, and none needs a schema change.

## Hygiene lane (continuous, parallel-safe with everything above)

- **#505** merge the react-router bump (clears both high npm-audit vulns), then triage the remaining
  [Dependabot alerts](https://github.com/steverowley/soccer-league/security/dependabot)
- **#386** Zod boundary validation on the critical `api/` modules (P1 correctness)
- **#561** worker-twin drift check (possible silent prod divergence) → then close **#547**
- **#572** Supabase advisor pass (7 DEFINER views + function hardening)
- **#407** lint gate — now effectively a `no-explicit-any` campaign (205 of 210 errors); after #390
- **#548** dead code (+ the orphaned `roadmap` trigger functions) — after #386/#390 merge
- **#393** images — verify (already at 3.0 MB) + add the CI size cap, then close
- **#456** rebase or fold into the next primitives session

## Cost picture (honest, from measured data)

Exactly one healthy day of token telemetry exists (May 21: ~18.3K Haiku tokens ≈ **$0.05**). The
structural burn is enricher hourly + galaxy-tick 2-hourly (Haiku) + drama-tick daily + in-match
Architect (Sonnet) per live match — match days dominate. Pre-launch estimate: **single-digit
dollars/month**; a ~$25/mo budget with small auto-reload gives ample headroom. Post-recharge, watch
`agent_runs` token sums weekly (the telemetry now exists). Supabase Pro adds $25/mo at Phase 2;
GitHub Pages hosting is free.

## Decisions queue (genuine choices only)

| Decision | When | Recommendation |
|----------|------|----------------|
| Email provider (#444) | Phase 3 | Resend free tier |
| Galaxy-tick voice model | Post-recharge | Keep Haiku; trial Sonnet for a week later |
| Do cups gate season end? (#569) | Phase 1 | Cups finish before voting opens |
| Election Night ritual (#568) | Phase 1 | Wire it — it's the signature spectacle |
| Soft-launch cohort + date | After Phase 2 | 10–50 friendlies |
| Neptune club (#510) | Whenever | Fix the lore, keep 32 teams |
| Supporter tier (#402) | Post-launch | Defer |

## Running this roadmap with Fable

1. **One issue = one session = one branch = one PR.** `<type>/<kebab-description>` off fresh
   `main`, Conventional Commits, PR to `main`, squash-merge.
2. Session prompt: *"Work issue #NNN in steverowley/soccer-league. Read the issue body + comments,
   then CLAUDE.md. Implement with tests, run `npm run check`, push, open a PR, subscribe to PR
   activity and fix CI/review feedback until merged. Close the issue when done."*
3. **Parallel lanes**: Phase 2 items 1/2/4 are disjoint; the hygiene lane runs alongside anything.
   Never run two sessions on the same feature or page (#378 + #390's MatchDetail = one session).
4. **Verify sessions are first-class work**: after operator actions, point Fable at production via
   the Supabase MCP ("trigger a tick, read `agent_runs`, confirm the feed") rather than assuming.
5. UI sessions run the app and visually verify before pushing; Figma is the look-and-feel source of
   truth.
6. The `operator-action` label means human-only (billing, dashboards, secrets). Fable verifies the
   outcome; you click the buttons.

Live filters: [operator queue](https://github.com/steverowley/soccer-league/issues?q=is%3Aissue+is%3Aopen+label%3Aoperator-action) ·
[M2](https://github.com/steverowley/soccer-league/issues?q=is%3Aissue+is%3Aopen+label%3AM2-product-foundation) ·
[M3](https://github.com/steverowley/soccer-league/issues?q=is%3Aissue+is%3Aopen+label%3AM3-architectural-cleanup) ·
[M4](https://github.com/steverowley/soccer-league/issues?q=is%3Aissue+is%3Aopen+label%3AM4-depth-community)

## Conventions

- **Priority**: `P0` critical · `P1` high · `P2` medium · `P3` backlog
- **Type**: `feature` · `fix` · `refactor` · `chore` · `docs` (+ `operator-action`)
- **Milestone labels**: `M2-product-foundation` · `M3-architectural-cleanup` · `M4-depth-community`
  (M0/M1 closed out and retired)

Branch + commit conventions live in [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## Origin

Issue corpus from the 2026-05 multi-agent audits; codebase reconciled 2026-06-06; this plan rebuilt
2026-06-11 from a first-hand production + code audit (DB state, security advisors, player-journey
walkthrough, engine capability map, full check suite). The phases supersede milestone-label
ordering; labels remain for filtering.
