# Intergalactic Soccer League — Roadmap

> **The single source of truth for execution order.** Tasks live in **GitHub Issues** (bodies are
> self-contained: scope, file refs, acceptance criteria). The **`RESEARCH_IMPLEMENTATION_PLAN.md`** holds
> the workstream-by-workstream detail behind the research-derived items (research basis → acceptance
> criteria). This file is the strategy on top of both: the verified state of the world, the order of
> battle, and how to execute it with Claude (Fable) sessions.
>
> Consolidated **2026-06-14**: the launch order of battle (production audit, 2026-06-11) and the deep-research
> workstreams (`RESEARCH_IMPLEMENTATION_PLAN.md`, #574, audited 2026-06-13) are now folded into one ordered
> sequence. Research workstreams are tagged `[WS-x]` and every line points at a tracked issue.

## The strategy in one paragraph

Season 1 is over and the universe is stuck: the election ran, two focuses were enacted, and then
nothing — no Season 2, no fixtures, both cups frozen, and every AI voice silent since May 21 for
want of API credits. The order of battle is therefore: **resurrect** (operator, ~20 min), **make the
season loop perpetual and give the lore a spine** (the game must run forever without surgery, and a
structured Chronicle must back the narrative), **polish the first-fan funnel and make the Architect
visible** (the soul is currently invisible during live matches), **then soft-launch** to the first real
fans. Depth — the bulk of the research library — follows once strangers are in the door, and is built
**by subtraction**, audience-informed, never wholesale.

## How the three layers fit together

| Layer | File / system | Answers |
|---|---|---|
| **Order of battle** | this file (`ROADMAP.md`) | *What do we do next, and in what order?* |
| **Workstream detail** | `RESEARCH_IMPLEMENTATION_PLAN.md` | *For a research item, what's the basis, the change, the acceptance criteria?* |
| **Unit of work** | GitHub Issues | *The branch / PR / done-definition for one task.* |

Where the research plan and this roadmap overlap, **this roadmap's launch sequencing wins**; the research
plan adds the detail and the post-launch depth.

## Verified state of the galaxy (production, 2026-06-11 / code 2026-06-13)

**Players & economy** — 1 user account, 4 wagers ever (1 won, 3 lost, all settled cleanly). This is
pre-launch; retention/community features rank below launch features.

**Season** — "Season 1 — 2600": 225/225 league fixtures completed (finished 2026-06-04); status
stuck in `voting`; election ran; 2 focuses enacted for Earth United on 2026-06-07 (Sign a Star
Player + Intensive Preseason Camp); the Election Night incineration ritual never fired (0 ever);
**no Season 2 exists** — a manual `scripts/rollover-season.ts` exists and is idempotent, but nothing
runs it, and it does not age players or promote youth (#568).

**Cups** — Celestial Cup + Solar Shield seeded their Rounds of 16 correctly… dated **2600-08-04**
(the in-universe calendar). The worker claims `scheduled_at <= now()`, so those 8 fixtures are
unreachable forever (#569). League fixtures used real 2026 dates — the bug is cup-seeder specific.

**Narrative layer** — galaxy-tick runs and writes (auth working; 102 narratives in 7 days), but
**459 LLM errors in 7 days**: credits are empty (#565), so the feed is 78% one fallback kind
(`cosmic_disturbance`). The `narratives` table is only *half* a chronicle — no `actor/action/target`,
`place`, `season`, or `importance` (#575). Cron live: match-worker + notify (1 min), galaxy-tick (2 h),
enricher (1 h), drama (daily). The shadow worker is deployed but never scheduled (#566).

**Security** — advisors report 7 ERROR-level `SECURITY DEFINER` views plus function/search-path and
admin-RPC-grant warnings (#572). HIBP toggle off (#443). Dependabot: react-router highs (track the
[alerts](https://github.com/steverowley/soccer-league/security/dependabot)).

**Code health** — typecheck ✅, **~1,337 tests ✅**, build ✅ (dist ~4.4 MB; `public/img/` already
optimized to 3.0 MB, so #393 is nearly done). ESLint backlog ~210 errors, **205 of them a single rule**
(`no-explicit-any`) — #407 is one campaign, not sixty fires.

**Engine truth** — 22-agent spatial sim with stamina, possession physics, 4 formations; the fan-support
boost genuinely reaches the engine. The Architect has **4 mechanical levers** (curse / bless / annul goal
/ force red) + 19 narrative-only kinds. The 8 manager play-styles are **fully defined but dormant** — the
engine reads only `preferred_formation` (#587). `deriveSimStats` is a linear blend (#589). Stored but
unused by the sim: player personality, age, form, home advantage; no substitutions/cards/injuries in-sim.

**Research truth** — the engine's core is the *validated answer* (multiple reports re-derive it); stop
investing in the engine core, defend its invariants, invest in the soul and the living world. A dozen
sources converge on one architecture: **tiered sim → structured Chronicle → state-aware drama director** —
which is exactly the Architect. Blaseball died of hand-crafted escalation and round-the-clock live-ops;
the automated AI sim is the structural escape **if the loop runs itself and we grow by subtraction.**

---

## Phase 0 — Resurrection (operator: ~20 min, then one Fable verify session)

| # | Action | Pri | Time |
|---|--------|-----|------|
| #565 | **Recharge Anthropic credits** (+ enable auto-reload) | P0 | 5 min |
| #442 | Confirm `WORKER_SHARED_SECRET` is set correctly, then close | P0 | 5 min |
| #443 | Supabase Auth → "Block compromised passwords" toggle | P1 | 2 min |
| #445 | Create Sentry project, set `VITE_SENTRY_DSN` | P1 | 10 min |
| #444 | Decide the email provider (Resend recommended) — only gates #381 | P1 | decision |

**Fable verify session after the recharge**: galaxy-tick returns `llmErrors: 0` and
`narrativesInserted > 0`; feed diversity returns. **Also trigger drama-tick and one in-match
interference** — both call Sonnet model ids that have never been validated on this key (the credit
outage masked them); pin or fix if rejected.

## Phase 1 — The perpetual season machine + the Chronicle keystone (Fable, ~4–5 sessions)

The most valuable thing Fable can build now: after this phase the game runs forever without manual
surgery, **and** the lore has a queryable spine that everything downstream reads from.

1. **#569 — rescue the cups** `[WS-A1]`: real-time cup scheduling + one-off fix for the 8 stranded
   fixtures; decide the "do cups gate season end?" policy.
2. **#568 — season rollover** `[WS-A1]`: `voting → enacted → archived`, create Season 2, real-dated
   fixtures for all 4 leagues, Election Night ritual wired to fire, idempotent. **Adds (from research):
   player aging + youth promotion** at rollover — without turnover the league ossifies around the same
   superstars.
3. **#575 — the Chronicle (keystone)** `[WS-A2]`: promote `narratives` into a structured, queryable
   history log (`actor/action/target/place/season/importance`, prose stays a field). **Land this early —
   #576, #582, #583, #584, #585, #586, #592 all read from it.**
4. **#577 — engine calibration test** `[WS-A4]`: assert football-realistic distributions (goals/game,
   draw rate, shots, home tilt). Good first issue, no dependencies, and the guardrail for every later
   engine change (#587/#589).
5. **#566 — schedule the shadow worker** `[ops]`: one cron migration (after #442).

Exit criterion: Season 2 kicks off on its own, the Celestial Cup crowns a champion, and the Chronicle
backs the `/news` feed.

## Phase 2 — The funnel & the soul, made visible (Fable, parallel-safe sessions)

What a first-time visitor experiences, plus the coherence guards that stop the AI silently breaking.
Land the **governance + ethics guardrails before any public link**.

1. **#570 — Architect interference visible in live matches** `[WS-B1]` (the soul pillar; the demo moment).
2. **#571 — onboarding finish line**: inline starter bet, credit moment, persistent booth intro,
   interface-not-mechanics explainers.
3. **#378 + #390's MatchDetail split — one combined session** (same file; done separately they guarantee
   merge conflicts). Visual verification against Figma required.
4. **#576 — causal bookkeeping tags** `[WS-A3]`: enabling-condition tags on `match_events` so commentary
   chains backward from the Most Reportable Event and calls back across matches. (Reads the Chronicle.)
5. **#583 — per-voice gen + golden-set CI eval** `[WS-B4]`: one model call per voice, exemplar banks,
   caching/batch, and an LLM-as-judge regression test in CI. With #575 this is the line between a coherent
   world and a contradictory one — **do it before scaling LLM volume.**
6. **#578 — decouple focus-vote weight from bankroll** `[WS-A5]` (governance integrity; before public link).
7. **#591 — economy guardrails, minimum-viable slice** `[WS-D5]`: in-game-only framing + a take-a-break
   affordance + no betting paywall on viewing (ethics; before public link).
8. **#399 — username moderation + impersonation guard** (before any public link).
9. **#403 — Supabase Pro + PITR (~$25/mo) + DR runbook** (operator billing; Fable drafts the runbook) —
   pre-launch gate.

## Phase 3 — Soft launch + early retention

Decide a soft-launch cohort (10–50 friendlies) once Phases 0–2 land. Then:

- **#381** weekly email digest (needs #444)
- **#397** feedback widget + Discord link + `/roadmap` page
- **#396** personal narrative thread on `/profile`
- **#398** share/OG images (labelled P3, but it's the growth surface — revisit priority at launch)
- **#592** public data surface for community puzzle-solving `[WS-D6]` (built on the Chronicle)
- Sentry triage habit once #445 is live

## Phase 4 — Depth (post-launch, audience-informed — build by subtraction)

The bulk of the research library. Concrete but deliberately *audience-informed*; do not over-build before
launch. Grouped by lane:

**Soul & living world**
- **#582** Architect as a state-aware drama director `[WS-B2]` (paces drama off league state)
- **#579** importance-weighted memory retrieval + reflection pass `[WS-B3]`
- **#580** entity affect model — personality / mood / emotion `[WS-C1]` (flagship soul feature)
- **#584** event-driven feuds from the relationship graph `[WS-C2]`
- **#585** location→environment→species→hidden-mechanic worldbuilding pipeline `[WS-C3]`
- **#586** lineage, involuntary loss, and memorials `[WS-C4]` (ethics note before first flashpoint)

**Engine & match**
- **#587** wire the 8 manager play-styles into the spatial engine `[WS-D1]`
- **#588** adaptive highlights — near-misses, juice, momentum, GK 8-sec rule `[WS-D2]`
- **#589** convex stat transform + finishing weight `[WS-D3]`

**Betting & economy**
- **#590** over/under + BTTS + in-play markets + free-to-play prediction `[WS-D4]`
- **#591** full faucet/sink economy balance `[WS-D5]` (the guardrail slice lands in Phase 2)

**Original depth backlog**
- **#394** mid-season micro-votes · **#395** training-narrative wire · **#559** bettor narratives
  server-side · **#402** supporter tier (timing decision) · **#510** Neptune lore decision

## Hygiene lane (continuous, parallel-safe with everything above)

- **#386** Zod boundary validation on the critical `api/` modules (P1 correctness)
- **#561** worker-twin drift check (possible silent prod divergence) → then close **#547**
- **#572** Supabase advisor pass (7 DEFINER views + function hardening)
- **#407** lint gate — now a `no-explicit-any` campaign (205 of 210 errors); after #390
- **#393** images — verify (already at 3.0 MB) + add the CI size cap, then close
- Dependabot triage: clear the react-router highs + remaining
  [alerts](https://github.com/steverowley/soccer-league/security/dependabot)

## Cross-cutting invariants (hold throughout — see CLAUDE.md "Critical Engineering Invariants")

- **Determinism is sacred.** Every engine change (#587/#588/#589) keeps the seeded mulberry32
  reproducibility and the **byte-identical `src`↔worker twins** (guard with the drift test). Manipulate
  *inputs*, never outcomes — the only sanctioned exception is the Architect's rare, disguised rewrite.
- **`getContext()` stays synchronous**; service-role-only writes to `match_events` / `narratives` /
  Chronicle; feature-barrel imports; the four mounted bus listeners.
- **Grounding before generation.** #575 (Chronicle) + #583 (hardening) come before scaling LLM volume.
- **Ethics is a workstream, not a footnote.** #578, #586, #591 are the deliberate choices on governance,
  grief, and gambling — land the guardrails before the public link.
- **Hidden mechanics, always.** Every new modifier (gravity, travel-fatigue, mood, play-style) is
  invisible; commentary describes it qualitatively, never as a number.

## Cost picture (honest, from measured data)

Exactly one healthy day of token telemetry exists (May 21: ~18.3K Haiku tokens ≈ **$0.05**). The
structural burn is enricher hourly + galaxy-tick 2-hourly (Haiku) + drama-tick daily + in-match
Architect (Sonnet) per live match — match days dominate. Pre-launch estimate: **single-digit
dollars/month**; a ~$25/mo budget with small auto-reload gives ample headroom. Post-recharge, watch
`agent_runs` token sums weekly. Supabase Pro adds $25/mo at Phase 2; GitHub Pages hosting is free.
#583's caching/batch work should *lower* the LLM burn as volume grows.

## Decisions queue (genuine choices only)

| Decision | When | Recommendation |
|----------|------|----------------|
| Email provider (#444) | Phase 0/3 | Resend free tier |
| Galaxy-tick voice model | Post-recharge | Keep Haiku; trial Sonnet for a week later |
| Do cups gate season end? (#569) | Phase 1 | Cups finish before voting opens |
| Election Night ritual (#568) | Phase 1 | Wire it — it's the signature spectacle |
| Chronicle: extend `narratives` vs. new table (#575) | Phase 1 | Extend `narratives` if the migration is clean |
| Vote-weight curve (#578) | Phase 2 | Quadratic cost + a small randomized outcome |
| Affect model scope (#580) | Phase 4 | Ship personality + mood first; add OCC emotion later |
| Architect "moods" personas (#582) | Phase 4 | Defer until single-mode state-aware pacing is solid |
| Responsible-design strictness (#591) | Phase 2/4 | Min-viable now; revisit at scale |
| Soft-launch cohort + date | After Phase 2 | 10–50 friendlies |
| Neptune club (#510) | Whenever | Fix the lore, keep 32 teams |
| Supporter tier (#402) | Post-launch | Defer |

## Explicitly NOT doing (anti-scope — from the research synthesis)

No 3D / photoreal rendering (2D blobs are the superior emotional form) · no orbital-mechanics / n-body
engine (borrow real *data* for flavour, not fidelity) · no hardcore-manager tactics board · no full
offside/handball fidelity · no per-tick or per-agent LLM calls · no "add forever" season escalation
(cap complexity) · no real-money anything · no new ecosystem/population machinery.

## Running this roadmap with Fable

1. **One issue = one session = one branch = one PR.** `<type>/<kebab-description>` off fresh `main`,
   Conventional Commits, PR to `main`, squash-merge.
2. Session prompt: *"Work issue #NNN in steverowley/soccer-league. Read the issue body + comments, then
   `RESEARCH_IMPLEMENTATION_PLAN.md` for the WS detail (if tagged) and `CLAUDE.md`. Implement with tests,
   run `npm run check`, push, open a PR, subscribe to PR activity and fix CI/review feedback until merged.
   Close the issue when done."*
3. **Parallel lanes**: the hygiene lane runs alongside anything; Phase 2 items are largely disjoint.
   Never run two sessions on the same feature or page (#378 + #390's MatchDetail = one session). Never run
   two engine-twin sessions concurrently (#587/#588/#589 all touch the spatial twins).
4. **Verify sessions are first-class work**: after operator actions, point Fable at production via the
   Supabase MCP ("trigger a tick, read `agent_runs`, confirm the feed") rather than assuming.
5. UI sessions run the app and visually verify before pushing; Figma is the look-and-feel source of truth.
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

Issue corpus from the 2026-05 multi-agent audits; codebase reconciled 2026-06-06; launch plan rebuilt
2026-06-11 from a first-hand production + code audit; research workstreams distilled from the 2026-06
deep-research library (`RESEARCH_IMPLEMENTATION_PLAN.md`, #574, audited 2026-06-13) and folded into this
single sequence 2026-06-14. The phases supersede milestone-label ordering; labels remain for filtering.
</content>
</invoke>
