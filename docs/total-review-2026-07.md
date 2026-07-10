# Total Project Review — 2026-07-10

> A full code / design / game review, run as a 25-agent audit (7 review dimensions, each with
> adversarial verification of critical findings against the repo **and** the live production
> database). Every claim below marked **[verified]** was independently reproduced by a second
> agent instructed to refute it. Purpose: establish ground truth after ~1 month away and define
> where to restart. Supersedes the "Verified state of the galaxy" section of `ROADMAP.md`
> (2026-06-14) and the numeric claims in `CLAUDE.md` (audited 2026-06-06).

## TL;DR

**The project is in far better shape than the docs say — but it is asleep and mute.**
Since the roadmap was written (2026-06-14), 39 PRs landed that completed essentially all of
Phase 1, the headline items of Phase 2, and a large unplanned engine-depth wave. The season loop
genuinely runs itself now: while nobody was watching, the game **archived Season 1 and created
Season 2 on its own** on 2026-07-08. Code health is strong: 1,487 tests green, typecheck clean,
build clean, engine twins in sync.

Three things gate everything else:

1. **The AI voices have been dead since 2026-05-21.** Zero successful LLM calls in production —
   the Anthropic credit recharge (#565) never happened. The Architect, commentary enrichment,
   drama, and the news feed all run on repetitive fallbacks (which also leak raw hidden stats,
   violating the hidden-mechanics pillar). *Operator action, ~5 minutes.*
2. **Production is running code the repo doesn't have, and vice-versa.** Migration `0077` and a
   172-persona re-seed were applied to the live DB from two PRs (#606, #609) that were never
   merged; meanwhile repo migration `0076` (the Chronicle) was **never applied to production**, so
   Chronicle writes and the Season 2 dawn announcement silently fail, and four edge functions
   haven't been redeployed since May/June. *One reconciliation session.*
3. **Season 2 is dark 13 days out of 14.** Fixtures were scheduled on a fortnightly matchday
   cadence based on a factually wrong code comment (Season 1 was daily). First kickoff
   2026-07-15, season ends 2027-01-13. A betting game with a two-week silence between matchdays
   cannot soft-launch. *One decision + one reschedule.*

## Health scoreboard (measured from a cold checkout, 2026-07-09/10)

| Check | Result | Docs claimed |
|---|---|---|
| `npm ci` | clean, 441 packages | — |
| `tsc --noEmit` | **0 errors** | ✅ |
| Vitest | **1,487 tests / 108 files, all pass** | ~1,337 |
| Build | ✅ 7.7s, dist 4.7 MB | ~4.4 MB |
| ESLint (src/) | **123 errors** (119 `no-explicit-any` + 4 `fontFamily`) | ~210 / 205 |
| ESLint (total) | 653 — **530 are the un-ignored `.claude/skills/isl-design` bundle** | — |
| Engine twins | identical modulo Deno `.ts` import extensions; 12-test drift guard passes | ✅ |
| npm audit | 9 advisories (5 high; only `react-router` ships to the browser — fix is open PR #505) | tracked |
| Migrations | 77 files `0000`–`0076` (+ `0077` in unmerged PR #606) | 74 |
| Invariants | all five mechanically-checkable CLAUDE.md invariants **pass** (worker player-select, sync `getContext()`, no deep imports, no direct supabase imports, no authed writes to `match_events`/`narratives`) | ✅ |
| Bus listeners | **three** mounted (WagerSettlementListener deleted in #557) | four |

## State of the galaxy (production, verified by SQL 2026-07-09)

- **Season 1**: was *reset and silently replayed* 2026-06-16 → 06-30 via `admin_reset_season`
  (which wiped all wager/vote/narrative/lore history — treat that RPC as a documented
  last-resort). Then archived by the new automatic rollover. **[verified]**
- **Season 2 — 2601**: created automatically 2026-07-08 with 224 real-dated league fixtures.
  First kickoff **2026-07-15**; one matchday per fortnight; ends 2027-01-13. **[verified]**
- **Cups**: the 2600-dated stranded fixtures were rescued and played July 1–4 — but both Season 1
  brackets then **stalled mid-round on drawn ties**. The engine has no extra time or penalty
  shootout for knockouts, so no champion was ever crowned, and the same bug will hit Season 2's
  cups (~Jan 2027). **[verified]**
- **LLM layer**: zero successful LLM calls since 2026-05-21; ~30 `llm_error` runs/day; the news
  feed is ~62% one fallback kind, repeats itself verbatim, and one fallback template prints raw
  stat deltas ("adjusted their technical by +3") on the public feed. **[verified]**
- **Deploy drift**: `match-worker` auto-deploys, but `architect-galaxy-tick`, `drama-tick`,
  `corpus-enricher`, `match-notify-worker` were last deployed May 21 – Jun 4 — weeks behind main.
  Repo migration `0076` (Chronicle) unapplied. **[verified]**
- **pg_cron reliability**: ~23–30% "job startup timeout" failures; drama-tick skipped 5 of the
  last 7 days; a full telemetry gap on 2026-07-02.
- **Security**: the 7 ERROR-level `SECURITY DEFINER` views (#572) are unchanged; HIBP toggle
  still off (#443). PR #606 documents a **profiles RLS infinite-recursion bug**
  (`profiles_update_own` self-queries `profiles` in its `WITH CHECK`, migrations 0041/0058) that
  breaks authenticated profile updates and guards the `is_admin`/`credits` escalation surface —
  **tracked by no issue**. **[verified]**
- **Users/economy**: pre-launch flatline — 1 profile, 0 wagers, 0 votes (history wiped by the
  June reset).
- Debris: a rogue `SPATIAL-TEST-2` team polluted Season 1's Rocky Inner League (and played the
  season's final match); an empty "ISL Champions Cup — Season 1" competition; the
  shadow-match-worker is deployed but still never scheduled (#566); no `season_config` row for
  Season 2.

## What shipped since the roadmap (2026-06-14 → 2026-06-25, 39 PRs)

**Phase 1 — perpetual season machine: essentially DONE.**
Cups rescued (#629/#641), automatic season rollover in the enact-due-seasons job (#635, plus
Galaxy Dispatch announcement #637), the Chronicle structured-history migration + code (#594,
migration `0076` — *repo only, see above*), the engine calibration/distribution test (#593).
Still open from Phase 1: **#566** (schedule shadow worker) and the descoped half of **#568**
(Election Night ritual wired into the automated close + player aging/youth promotion).

**Phase 2 — funnel & soul: headliners DONE.**
Architect interference visible in live matches (#631), onboarding finish line — inline starter
bet + credits moment + teaching strips (#632/#634), MatchDetail rebuilt as the design-system
match theatre (#628). Still open: #576 causal tags, #583 per-voice generation, #578 vote-weight
decoupling, #591 economy guardrails, #399 username moderation, #403 Supabase Pro.

**Unplanned engine wave (all verified in code, guarded by the calibration test):**
fouls/free-kicks/cards (#614), offside (#617), stoppage time (#623), penalties (#624), red cards
with send-offs (#625), substitutions (#626), widened attack (#618), goal-rate calibration
(#613), personality inputs (#610), manager play-styles (#630 — closes the "dormant" gap), convex
stat transform (#589). Determinism is clean: seeded mulberry32 is the only randomness source.

**Design system:** ISL design system adopted + committed as a skill (#612); seven pages rebuilt
to its worked screens (Teams #615, News #616, Voting #619, Idols #620, TeamDetail #621, World
#622, MatchDetail #628). The pixel-art match viewer (#598–#605) is complete and wired into real
matches. There is **no legacy-Tailwind tier left** — Tailwind is installed but literally unused
(a dead dependency; CLAUDE.md's "Tailwind 4.2" claim is stale).

## Confirmed defects (the interesting ones)

Vision-pillar gaps — features that *look* wired but are hollow underneath:

1. **Fan-support boost never reaches the sim.** `computeFanBoost` runs and logs, but its result
   is discarded before `toSpatialTeamInput`; there is also zero home advantage (the engine is
   symmetric). ROADMAP's claim that the boost "genuinely reaches the engine" is wrong — it
   described the deleted legacy path. Fix ≈ 5 lines in the worker + a test. **[verified]**
2. **The three commentator voices are decorative copy.** Live commentary is canned templates; the
   booth `AgentSystem` is dead code, never instantiated; no line is attributed to
   Vox/Nexus-7/Zara. This is the single biggest gap between the vision and the product. #583 is
   the real fix; a cheap interim is attributing template lines by event class. **[verified]**
3. **Training clicker is a placebo.** Stat bumps are logged to `player_training_log` but never
   applied to players — and the Training page has **zero inbound links** anywhere in the UI (nav,
   footer, teaching strips: nothing). A core loop pillar, unreachable and inert. **[verified]**
4. **Cup knockout draws freeze brackets** (see above) — recommended fix: a deterministic,
   match-UUID-seeded penalty-shootout resolver in `postMatchEffects`, keeping the calibrated
   90-minute engine untouched. **[verified]**
5. **Election Night incineration has never fired** — it is reachable only via a manual admin
   click nobody has clicked. Wire `runElectionNight` into the automated season close (idempotent)
   as part of finishing #568.
6. **Betting is starved by pacing**: odds exist only 72h before kickoff, but matchdays are 14
   days apart — so the onboarding starter bet works ~3 days in 14. Fixing pacing (or widening the
   odds horizon) fixes onboarding too.
7. **Architect's `bless_player` lever can never fire** — it targets `shot` events the engine
   never emits (shots resolve straight to goal/save/out). Emitting first-class shot events also
   revives the per-player shots stat and is the groundwork PR #640 builds on.
8. **Mechanically-rewritten events reach viewers unmarked** — a cursed goal still narrates
   "X scores!" while the scoreboard disagrees.

UI (first-impression surfaces):

- **/matches breaks on mobile** — fixed 404px+ of grid columns, no breakpoint; it is also the one
  main-nav page whose design-system worked screen exists but was never applied. **[verified]**
- **Welcome wizard uses purple as a fill** on the onboarding path (the skill's "purple is never a
  fill" rule); News has two off-palette hex accents; World has a 3px radius. Everything else on
  the rebuilt pages is near-perfect token compliance.
- The `src/shared/ui` primitive layer lost to `components/Layout.tsx`'s COLORS system — three
  parallel styling systems coexist; consolidate before rebuilding more pages.

Hygiene (cheap, high-leverage):

- Add `.claude/**` to ESLint ignores → backlog drops 653 → 123 and reveals #407 is half done
  (119 `any` left, was ~205).
- Add `playStyle` and `rng` to the twin drift-guard's TWINS list (both copies currently in sync;
  `rng.ts` carries the determinism seed everything depends on).
- Add an explicit `30000` timeout to the stoppage-time test
  (`simulateSpatialMatch.test.ts:118`) — it runs two full 90-min sims against the 5s default; its
  five siblings all carry explicit timeouts. (Observed to fail once under heavy load during this
  review; not reproducible in 5 clean runs — hardening, not a fire.)
- Merge dependabot #505 to clear the only browser-shipped HIGH advisory (react-router ≤ 7.15.0).

## The merge queue (7 PRs, abandoned 2026-06-25 — all mergeable-clean)

| PR | Verdict | Why |
|---|---|---|
| #606 admin_reset_season fix (migration 0077) | **MERGE FIRST** | Prod already runs it; merging restores repo↔prod parity and reserves the 0077 number |
| #609 entities audit + personas | **REBASE + MERGE** | Prod already re-seeded 172 personas from it; code must land to match |
| #640 woodwork near-miss beats | MERGE | Small, rng-free, calibration-neutral |
| #638 favicon set | MERGE | Static assets only |
| #505 react-router bump (dependabot) | REBASE + MERGE | Clears the browser-bundle HIGH advisory |
| #456 EmptyState consumer (May) | MERGE or fold into the primitive-consolidation session |
| #608 standalone viewer demo | MERGE (additive tooling) or close with a note |

## The restart plan

**Step 0 — Operator (you; ~30 min; nothing else matters until the first item is done)**
1. **#565 Recharge Anthropic API credits + enable auto-reload.** Then comment the date on the issue.
2. #443 Supabase Auth → enable "block compromised passwords" (2 min).
3. #445 create the Sentry project + set `VITE_SENTRY_DSN`; #444 pick the email provider
   (Resend recommended) — both can wait a week, neither should wait a month.
4. #442 appears indirectly fixed (workers authenticate) — confirm and close.

**Step 1 — Reconciliation session (Claude): make main describe production again.**
Merge the queue in the order above; apply migration `0076` to production; redeploy the four
stale edge functions and add deploy workflows for them (match-worker has one; the others rot);
file the profiles-RLS recursion as a P1 security issue; delete the `SPATIAL-TEST-2` fixture and
the empty Champions Cup competition; comment narrowed scope on #568/#386/#393.

**Step 2 — Pacing decision + reschedule (one genuine product decision).**
`ROLLOVER_CADENCE_MS = 14 days` in `scripts/enact-due-seasons.ts` rests on a comment claiming it
"matches production Season 1 cadence" — Season 1 was **daily**. Recommendation: daily or
every-2-days matchdays, and widen the odds horizon so betting is open whenever a user signs up.

**Step 3 — Post-recharge verify session (blocked on Step 0).**
Trigger galaxy-tick + drama-tick + one in-match interference; confirm `llmErrors: 0`, narratives
inserted, and validate the Sonnet model ids (never yet exercised on this key). Also fix the
fallback template that leaks raw stat deltas, and add idempotency so disturbances aren't
re-published every 2h.

**Step 4 — Close the hollow-pillar bugs (one session each, engine ones not concurrent):**
fan-boost wiring; cup shootout resolver (before Season 2 cups seed); training-loop close (apply
stat bumps + add nav entry points); Election Night + aging/youth into rollover (finishes #568);
shot events (revives `bless_player`); interference-aware commentary.

**Step 5 — Pre-launch guardrails (the roadmap's "before any public link" set, unchanged):**
#583 per-voice generation + golden-set CI eval (the voices are the soul — highest-leverage
feature in the whole backlog), #578 vote-weight decoupling, #591 economy guardrails minimum
slice, #399 username moderation, #572 advisor pass + the RLS recursion fix, #403 Supabase Pro.

**Step 6 — UI funnel pass:** /matches rebuild (fixes mobile), Welcome purple fix, Login/first-
session polish, primitive-layer consolidation, News/World token nits, Training/Seasons nav links
(this one belongs in Step 4's training session).

**Then:** soft-launch cohort per ROADMAP Phase 3. The Phase 4 depth backlog is untouched and
still correctly sequenced *after* strangers are in the door.

## Doc corrections needed (one docs-only PR)

- `CLAUDE.md`: 77 migrations (0000–0076, 0077 pending in #606); 1,487 tests; **three** bus
  listeners (WagerSettlementListener deleted in #557 — settlement is server-side); 29 routes;
  5 CI workflows; spatial twin set is 11 modules incl. `playStyle.ts`/`traitModifiers.ts`;
  styling is inline-styles over a frozen COLORS token layer + the isl-design skill (Tailwind is
  unused — remove the dependency or the claim); lint backlog 119 `no-explicit-any`.
- `ROADMAP.md`: mark Phase 1 done except #566 + #568's ritual/aging half; mark #570/#571/#587/
  #589 done; rewrite "Engine truth" (subs/cards/penalties/offside/stoppage/play-styles/
  personality/convex all in; fan-boost claim is false; no shots/injuries/half-time/momentum);
  replace the "Verified state of the galaxy" section with this document.
- Process: put `Closes #NNN` in PR bodies (the #635-landed-but-#568-stayed-open gap is how the
  docs drifted), and **never apply migrations or seed production from an unmerged branch** —
  the #606/#609 pattern worked out this time only because this audit caught it.
