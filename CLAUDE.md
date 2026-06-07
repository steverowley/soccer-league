# Intergalactic Soccer League — Project Context

> **Source of truth for game design**: the Notion doc (fetched via Notion MCP — see
> `https://www.notion.so/rowley/Intergalactic-Soccer-League-33cda0dddb8780408628f63f07e89e05`).
> **Source of truth for code reality**: this file. It is re-audited against the codebase periodically
> (see the audit stamp on "Current Implementation Status"). If something here disagrees with the code,
> the code wins — fix the doc.
>
> **Re-read the Vision & Engineering Principles below before starting any new phase.** If work drifts
> off-vision, pause and escalate.

## Vision (anchor — always keep in mind)

A Blaseball-inspired **social experience browser game**. Users watch AI-simulated intergalactic soccer
matches in a fictional solar-system league, bet Intergalactic Credits on outcomes, and at season's end
collectively vote with their winnings to shape their club's future. The game's soul is **hidden
mechanics, emergent storylines, and fan-driven narratives**. Underlying stats and rules are **never
explained** — the world is treated like real life.

**North-star player experience**:
1. Sign up, get 200 Intergalactic Credits, pick a favourite club and player.
2. Watch matches unfold in retro-minimalist UI with three commentator voices (Vox / Nexus-7 / Zara)
   plus a Lovecraftian Cosmic Architect occasionally interfering.
3. Place bets on upcoming matches; win credits, build a bankroll.
4. Between matches: visit the training facility, click to help players develop, follow the news feed as
   journalists and pundits react to cosmic events.
5. At season's end: pool credits with other fans of your club to vote on 1 major + 1 minor focus
   (signings, youth, upgrades, etc.) that actually reshapes the team for next season.

**Core design pillars** (use these to break ties during execution):
- **Emergent storytelling over exposed mechanics** — the LLM layer (commentary, Architect, entities)
  must always deepen narrative, never reveal numbers.
- **Fan-driven collective agency** — every feature should feed into the shared social experience.
  Individual-only experiences are lower priority.
- **The Architect is the soul** — the chaos director is not a feature, it's the game's identity.
  Everything new should give the Architect new levers to pull.
- **Modular now, easy rewrites later** — the Notion doc will change; the codebase must bend with it
  cheaply. Features are isolated, logic is pure and tested, DB changes are reviewable migrations.
- **Retro-minimalist design** — the Figma design system is the source of truth for look & feel.
- **Long-term social experience** — years of cumulative lore. Persistence and history matter more than
  short-term polish.

**Explicit non-goals** (for now):
- Mobile-native apps (browser only).
- Real-money gambling (credits are in-game only).
- Player-vs-player direct messaging / chat.
- Exposing raw player stats to users.

---

## Claude Code Session Discipline

### The Golden Rules
1. **If the codebase is in the repo and the task is clear, don't ask — read and fix.** Trust the task
   description + repo context.
2. **Use agents proactively when they provide objectively better results.** Don't wait to be asked;
   spawn them when the math favours it.

### Agent Decision Tree
Use an **Agent** when:
- **Explore agent**: searching unknown/large areas for patterns across many files.
- **Plan agent**: multi-phase implementation or architectural tradeoffs (>3 phases / unknown-unknowns).
- **Specialized agent** (`claude-code-guide`, etc.): domain-specific expertise (Claude API, framework
  internals).
- **General-purpose agent**: complex investigation + implementation spanning multiple areas, or parallel
  work.

Use **direct tools** (Read, Edit, Bash) when the task is a single file or tightly scoped, the path is
known, or you're running tests/linters.

### Token Efficiency Imperatives
1. **No over-explanation.** State *what changed and why*, not the discovery narrative.
2. **No speculative abstractions.** One consumer = inline it. Wait for a second consumer.
3. **No dead code, commented-out logic, or TODO comments.** Delete or fix immediately.
4. **Minimize clarifying questions.** Start with a read. Ask only if genuinely ambiguous.
5. **No false starts.** Understand layer boundaries before proposing a solution.
6. **Batch independent operations.** Parallel tool calls save round-trips.

### Quality Checklist (before saying "done")
- [ ] No console.logs, commented code, or debug statements
- [ ] No dead imports or unused variables
- [ ] `npm run check` is green (`tsc --noEmit` + `eslint` + `vitest`) — note that **CI only gates
      typecheck + tests today** (lint is informational; see "Continuous integration"), but new code
      should still be lint-clean
- [ ] Follows existing patterns (layer boundaries, naming, style)
- [ ] One concern per file (or a clear reason for multiple)
- [ ] Commit message uses Conventional Commits format

---

## Git Workflow & Branch Strategy

**This project uses plain GitHub-flow on a single trunk. There is NO `dev` branch.** (Any doc, hook, or
workflow that still references `dev` is stale — `setup-branch-protection.yml` and
`scripts/validate-branch-name.sh` are known offenders, tracked for cleanup.)

- **`main`** — the default and only long-lived branch. Production-ready. Protected: requires a passing
  CI `quality` check and (where enabled) 1 review. No force-pushes.
- **`feat/*`, `fix/*`, `chore/*`, `docs/*`, `refactor/*`, `perf/*`, `test/*`, `ci/*`** — short-lived
  branches, deleted after merge.

**Workflow:**
1. Branch from `main`: `git checkout -b feat/<short-description>`.
2. Commit using Conventional Commits.
3. Push and open a PR **targeting `main`**.
4. CI runs typecheck + tests (gating) and lint (informational). Run `npm run check` locally first.
5. PRs are **squash-merged** to `main`; the squashed subject keeps the Conventional Commit format and
   ends with the PR number, e.g. `fix(voting): atomic, server-validated focus votes (#539)`.
6. Delete the branch after merge.

**Branch naming** (optionally validated by `scripts/setup-git-hooks.sh`): `<type>/<kebab-description>`,
e.g. `feat/welcome-wizard`, `fix/spatial-goal-scorer-attribution`.

**Commit message types**: `feat` · `fix` · `chore` · `docs` · `style` · `refactor` · `perf` · `test` ·
`build` · `ci` · `revert`. Imperative mood, lowercase, no trailing period, subject < 72 chars.

---

## Engineering principles (non-negotiable, apply to every PR)

1. **TypeScript everywhere** with `strict: true`. The typed Supabase client is regenerated on every
   migration via the Supabase MCP's `generate_typescript_types` into `src/types/database.ts`.
2. **Feature-based folder layout**: `src/features/<feature>/{api,logic,ui}/` + `types.ts` + `index.ts`
   barrel. Cross-feature deep imports are forbidden — ESLint `no-restricted-imports` enforces it. Pages
   under `src/pages/` are thin route wrappers. Shared primitives in
   `src/shared/{ui,hooks,utils,events,supabase}`. (Not every feature has all of `api/logic/ui` — see
   "Feature inventory" for the real shape.)
3. **Clear layer boundaries inside each feature**: `api/` (Supabase + Zod), `logic/` (pure TS — no
   React, no Supabase, 100% unit-testable), `ui/` (React). Pure logic lives in `logic/`; nothing else.
4. **Supabase migration discipline**: every schema change is a numbered `supabase/migrations/{NNNN}_{name}.sql`
   file applied via the Supabase MCP's `apply_migration`. There is no hand-edited `schema.sql` and no
   `supabase/config.toml` — cron and function secrets live in migrations and the Supabase dashboard.
5. **Runtime + compile-time boundaries**: all Supabase reads pass through Zod schemas in `api/` so DB
   drift fails loud at the boundary.
6. **Dependency injection**: features never `import { supabase }` directly. They consume the client via
   `useSupabase()` (React context) or a function argument. (`src/lib/supabase.ts` was deleted in #387;
   re-importing it is an ESLint error.)
7. **Vitest unit tests** co-located next to every `logic/` and `api/` module. Target 80%+ coverage of
   `logic/`.
8. **Event-driven cross-feature communication** via a typed in-app bus (`src/shared/events/bus.ts`).
   All listeners mounted in `src/main.tsx`.
9. **No dead code, no speculative abstractions**. One consumer ≠ helper. Refactor when a second consumer
   appears.
10. **ESLint + Prettier + strict tsconfig**. CI gates on `tsc --noEmit` + `vitest`; ESLint currently
    runs informationally (`continue-on-error`) because of a backlog of pre-existing errors (cleanup
    tracked under M3). New code must still be lint-clean.

---

## Game Design Document

### Goal
Create a soccer simulation browser game inspired by Blaseball — a social experience with many hidden and
unexplained mechanics.

### Player Interaction
- **Betting**: bet credits on match outcomes; odds are generated from team skill and probability.
- **Voting**: at season's end, fans pool credits to vote on club decisions (signings, training, upgrades).
- **Fan Support**: teams with more fans present during a match receive a small stat boost.
- **Training Minigame**: visit the training facility between matches; a clicker minigame boosts players.

### User Account
- Username, favourite team and player.
- Start with **200 Intergalactic Credits**.
- Being present during a match slightly boosts the supported team's performance.

### Betting Rules
- Minimum bet: 10 Intergalactic Credits, no maximum.
- Three-way odds (home / draw / away) generated per match from team stats (~5% house margin).
- Win/loss determined by match result; winnings paid out on settlement.

### Voting (End of Season)
- Fans spend credits on "focuses" for their team.
- The focus with the most credits across all fans of a team is enacted.
- **2 focuses per season**: 1 major (10 IC), 1 minor (5 IC).
- Focus options: sign new players, promote youth, player boosts, preseason training investments,
  stadium upgrades.

### Fan Support Boost
- Each match: compare present fans for both teams; the team with more present fans gets a small stat
  boost for that match.

---

## Leagues (4 conferences × 8 teams = 32 teams)

### Rocky Inner League
| Club | Location |
|------|----------|
| Mercury Runners FC | Mercury |
| Venus Volcanic SC | Venus |
| Earth United FC | Earth |
| Terra Nova SC | Earth |
| Mars Athletic | Mars |
| Olympus Mons FC | Mars |
| Valles Mariners SC | Mars |
| Solar City FC | Earth Orbital Colony |

### Gas/Ice Giant League
| Club | Location |
|------|----------|
| Jupiter Royals FC | Jupiter |
| Great Red FC | Jupiter |
| Saturn Rings United | Saturn |
| Cassini Explorers FC | Saturn |
| Uranus Athletic Club | Uranus |
| Neptune FC Mariners | Neptune |
| Galilean Giants FC | Jupiter region |
| Saturn Orbital SC | Saturn orbital colony |

### Asteroid Belt League
| Club | Location |
|------|----------|
| Ceres City FC | Ceres |
| Vesta United | Vesta |
| Pallas SC | Pallas |
| Hygiea Rangers | Hygiea |
| Beltway FC | Asteroid Belt colony |
| Solar Miners FC | Asteroid Belt colony |
| Juno Athletic | Juno |
| Pallas Rovers FC | Pallas |

### Kuiper Belt League
| Club | Location |
|------|----------|
| Pluto FC Wanderers | Pluto |
| Eris FC Rebels | Eris |
| Haumea SC Cyclones | Haumea |
| Makemake United | Makemake |
| Sedna FC Mariners | Sedna |
| Plutino FC Pirates | Plutino Region |
| Orcus FC Shadows | Orcus |
| Scattered Disc FC Rangers | Outer Kuiper Belt |

---

## Tournament Structure

### League
- Win = 3 pts, Draw = 1 pt, Loss = 0 pts.
- Tiebreaker: goal difference → goals scored.
- Each team plays every other team twice (home and away) — 28 fixtures per team per season.

### Celestial Cup (Champions League equivalent)
- Top 3 teams per league qualify. Single-elimination, standard interleaving seeds (top seeds meet only
  in the final), byes auto-advance.

### Solar Shield (Europa League equivalent)
- Teams ranked 4th–6th per league qualify. Same single-elimination format.

---

## Match Rules
- Standard 11-a-side football, two 45-minute halves + stoppage time.
- Yellow/red cards, VAR enforcement.
- 11 players (1 GK) + 5 substitutes; 3 substitutions allowed.

---

## Team Structure

Each club has: Name, Location, Home Ground (name, capacity, nickname), Training Facility (name,
nickname, quality), History/Lore, and a Manager.

### Manager
- **Formations**: 4-4-2, 3-4-3, 4-5-1, 5-4-1 (expandable).
- **Play Styles**: Offensive, Balanced, Defensive, Direct, Possession, Counterattacking, High Pressing,
  Aggressive.
- **Coaching Stats**: Attacking, Defending, Technical, Athletic, Mental.

### Squad
- 22 players per club (704 total across 32 teams).
- **Player Details**: Name, Age (16+), Height, Weight, Appearance, Race, achievements, seasonal stats,
  injury status, Form.
- **Player Stats** (engine-internal, never shown raw to users): Shooting, Assisting, Tackling, Blocking,
  Goalkeeping, Passing, Dribbling, Speed, Stamina, Strength, Positioning, Aggression, Vision. In the DB
  these are stored as five composite columns — `attacking`, `defending`, `mental`, `athletic`,
  `technical` — which the engine expands into fine-grained sim stats.
- **Potential**: Godly / High / Medium / Low; Early / Balanced / Late Developer; Superstar flag.

---

## Architecture Overview

A TypeScript + React single-page app talking to a Supabase backend, with Deno edge functions that
simulate matches and tick the galaxy forward.

- **Frontend** — React 18.3 + Vite 6.4, React Router 7, Tailwind 4.2, strict TypeScript 6. Routing is
  defined inline in `src/main.tsx` (`BrowserRouter` + `Routes`); every page is `React.lazy`-loaded
  under a single `Suspense` boundary with a per-route `ErrorBoundary` and a `*` → `NotFound` catch-all.
- **Backend** — Supabase (PostgreSQL + row-level security). 74 migrations (`0000`–`0073`), 40 tables,
  9 views, 14 RPC/functions. Generated types in `src/types/database.ts`.
- **AI** — Anthropic SDK. Two models in use: `claude-sonnet-4-6` for in-match Architect/interference and
  the daily drama tick; `claude-haiku-4-5-20251001` for the galaxy tick, corpus enrichment, and in-app
  commentary (`CLAUDE_MODEL` in `src/constants.ts`). Each edge function hardcodes its own model id, so
  `constants.ts` is the source of truth only for the browser bundle.
- **Simulation** — a deterministic, agent-based **spatial** match engine run server-side by the
  `match-worker` edge function (see "Match Simulation").
- **Hosting** — the static site deploys to **GitHub Pages** via `deploy.yml`; the `match-worker` edge
  function deploys via `deploy-match-worker.yml`.
- **Observability** — Sentry (`@sentry/react`), wired in `src/main.tsx`.

### Feature inventory

**11 vertically-sliced features** under `src/features/`. Each exposes its public API through an
`index.ts` barrel; nothing outside a feature may reach past that barrel. The `{api,logic,ui}/ + types.ts`
shape is the ideal, not a guarantee — real folders deviate:

| Feature | Purpose | Notes on shape |
|---|---|---|
| **admin** | Dev/maintainer controls (fast-forward fixtures, manual enactment/completion, season status, system stats). Real boundary is the `admin_*` SECURITY DEFINER RPCs. | no `logic/`, no `types.ts` |
| **agents** | The **LLM narrative layer**: commentary corpus, snippet retrieval + `composeNarrative`, persona/memory models, a three-tier decision system (`runDecision` → `logic/resolvers/`: reflex / reflection / drama), a voice-coherence guard, and `MemoryWriteListener`. | full shape |
| **architect** | The Cosmic Architect chaos-director: in-match interference, persistent lore, audited result rewrites (`CosmicArchitect`, `prepareArchitectForMatch`, `LoreStore`). | no `ui/` |
| **auth** | Accounts (Supabase Auth + `profiles`), credit helpers, app-wide auth context (`AuthProvider`/`useAuth`). | full shape |
| **betting** | Wager lifecycle: odds, placement, settlement on `match.completed` (`WagerSettlementListener`). | full shape |
| **entities** | Unified first-class entity model (players, managers, referees, pundits, journalists, owners, media, bookies, planets, political bodies) + traits + relationship graph. | full shape |
| **finance** | Ticket revenue from present fans + the fan-support stat boost. | no `ui/`, no `types.ts` |
| **match** | The full fixture lifecycle (largest barrel): simulation, cup draws/seeding, league standings, season lifecycle, idols, team/player reads, the 2D pitch view, and the spatial position-playback layer. | full shape (+ `logic/pitch/`, `logic/spatial/`, `ui/pitch/`) |
| **notifications** | Web Push subscriptions + per-user notification preferences for `/profile`. | full shape |
| **training** | Between-match clicker minigame (rate-limited, geometric XP curve). | no `ui/` |
| **voting** | End-of-season credit-pooled focus voting, enactment, and the Election Night incineration ritual. | no `ui/` |

> Several `ui/` folders were intentionally emptied in the "2026-05 nuke" (architect, training, voting)
> and will be rebuilt against the new design system. Cross-feature imports must go through the
> `@features/<name>` barrel alias; `eslint.config.js` `no-restricted-imports` errors on
> `@features/*/*` deep paths (relaxed for tests).

---

## Match Simulation

The live engine is the **spatial, agent-based physics engine** — and as of #389 it is the *only* engine.
The legacy `gameEngine.js` "dice-roller", the `USE_SPATIAL_ENGINE` env switch, and the PATH B fallback
were all deleted; the worker now runs the spatial sim unconditionally.

### How a match runs
All matches are simulated server-side by `supabase/functions/match-worker/index.ts`, invoked by a
`pg_cron` job (`trigger-match-worker`, every minute). On each tick the worker claims due matches
(optimistic lock), fetches both rosters, runs the spatial engine (`toSpatialTeamInput` → seed derived
from the match UUID → `simulateSpatialMatch` → `adaptSpatialResult`), then trims the stream to the
notable beats via `filterNotableEvents` before persisting. It returns `{ events, finalScore, mvp,
playerStats }`; per-player stats accumulate over the full pre-filter stream, so they stay complete.

### The spatial engine
It lives in two byte-identical copies — `src/features/match/logic/spatial/` (browser + tests) and
`supabase/functions/match-worker/spatial/` (the Deno worker, copied because edge functions cannot import
from `src/`). Both contain `types.ts`, `vec2.ts`, `rng.ts`, `formation.ts`, `steering.ts`,
`possession.ts`, `step.ts`, `simulateSpatialMatch.ts`, `spatialEventAdapter.ts`.

22 players and a ball move continuously through pitch-metre space (x∈[0,105], y∈[0,68]); events are
**derived from geometry**, not rolled. Pipeline:
1. **Formation → world** — players assigned to 11 formation slots (`4-4-2`/`4-5-1`/`3-4-3`/`5-4-1`) by
   role, mapped to absolute pitch positions. Formation from `managers[0].preferred_formation`.
2. **Step loop** — fixed-timestep at 10 Hz (`dtSec=0.1`) for 90 minutes (54,000 ticks). Each tick
   assigns roles, computes Reynolds-style steering (seek/arrive/pursueBall/separation), integrates
   motion, updates the ball, resolves events.
3. **Possession brain** (`possession.ts`) — stats → outcomes (shoot/pass/dribble, aim error, tackle &
   save probabilities).
4. **Event resolution** (`step.resolveLooseBall`) — goals/saves/corners/throw-ins/tackles emerge from
   ball motion.
5. **Adapter** (`spatialEventAdapter.adaptSpatialResult`) — converts emergent events to the
   `match_events` shape, accumulates per-player stats, computes MVP (`goals×3 + saves×2 + tackles`).

Determinism: `rng.ts` is a seeded mulberry32 generator; the worker derives the seed from the match UUID,
so a fixture always reproduces the same match — the stored frames, live viewer, and final score can
never disagree.

### Position frames & the 2D viewer
The engine samples a position frame every 2s and the worker persists them to
`match_positions` (migration `0061`), keyed by `(match_id, minute, second)` with a `jsonb` snapshot of
player/ball coordinates (public read, service-role write). The browser reads these via
`src/features/match/api/matchPositions.ts` for 2D playback.

---

## Cosmic Architect Narrative Layer

- `src/features/architect/logic/CosmicArchitect.ts` — interference layers: Cosmic Edicts, Intentions,
  Sealed Fate, Interference Flags (reality-rewrites).
- Persistent lore in `architect_lore`; `prepareArchitectForMatch()` hydrates before kickoff;
  `LoreStore` writes fire-and-forget post-match.
- `getContext()` is **synchronous** — never blocks during goal bursts (see Critical Invariant #2).
- Out-of-match heartbeat via the `architect-galaxy-tick` edge function (every 2h) and the daily
  `drama-tick`, both writing to `narratives` (the Galaxy Dispatch feed).

---

## Pages & Routes

Routing is inline in `src/main.tsx` (28 routes, 29 page files in `src/pages/`, all lazy-loaded). Public
unless noted.

| Route | Page | Notes |
|---|---|---|
| `/` | Home | hero + live/upcoming matches + standings |
| `/leagues`, `/leagues/:leagueId` | Leagues, LeagueDetail | standings |
| `/teams`, `/teams/:teamId` | Teams, TeamDetail | squad + manager/facility |
| `/matches`, `/matches/:matchId` | Matches, MatchDetail | schedule; paced LiveCommentary + WagerWidget |
| `/players/:playerId` | PlayerDetail | profile; raw stats hidden |
| `/managers/:managerId` | ManagerDetail | profile; coaching stats hidden |
| `/entities/:entityId` | EntityDetail | persona + snippets |
| `/news` | News | Galaxy Dispatch feed |
| `/idols` | Idols | idol leaderboard + movers |
| `/leaderboards` | Leaderboards | wager + idol leaderboards |
| `/seasons`, `/seasons/:seasonId` | Seasons, SeasonDetail | season archive |
| `/voting` | Voting | in-page gated on auth + favourite team |
| `/training` | Training | in-page gated |
| `/wagers` | Wagers | **auth-gated** → `/login` |
| `/profile` | Profile | **auth-gated** → `/login` |
| `/login` | Login | redirects authed users to `/profile` |
| `/admin` | Admin | **admin-gated** (client gate + `admin_*` RPC boundary) |
| `/world`, `/whatif`, `/welcome`, `/about`, `/privacy`, `/terms`, `/reset-password` | World, WhatIf, Welcome, About, Privacy, Terms, ResetPassword | supporting/legal/onboarding |
| `*` | NotFound | catch-all (pairs with a GitHub Pages `404.html` redirect) |

---

## Database Schema (40 tables + 9 views + 14 RPC functions, migrations 0000–0073)

Source of truth is the generated `src/types/database.ts` (regenerate after every migration).

**Core / entities**: `entities`, `entity_traits`, `entity_relationships`, `entity_memories`,
`entity_persona`, `entity_snippets`, `leagues`, `teams`, `managers`, `players`
**Match & competition**: `matches`, `match_events`, `match_player_stats`, `match_lineups`,
`match_attendance`, `match_odds`, `match_notification_sends`, `match_positions`, `competitions`,
`competition_teams`
**Season**: `seasons`, `season_config`, `season_decrees`
**Narrative & lore**: `architect_lore`, `architect_interventions`, `narratives`,
`shadow_match_results`, `drama_consequences`
**Voting**: `focus_options`, `focus_votes`, `focus_enacted`, `incinerations`
**Betting & finance**: `wagers`, `team_finances`
**User**: `profiles`, `player_training_log`, `push_subscriptions`, `account_deletions`
**Ops / config**: `agent_runs`, `app_config`, `claude_sessions`

> The table list above is the generated set as of the audit date; treat `database.ts` as authoritative.
> The earlier counting drift (`match_positions` etc.) is the reason this section is regenerated, not
> hand-maintained.

**Views (9)**: `active_watchers_v`, `focus_tally`, `match_referee_v`, `player_idol_movers`,
`player_idol_score`, `public_profiles`, `team_supporter_count_v`, `wager_leaderboard`, `wager_volume_v`

**RPC functions (14)**: `admin_add_player`, `admin_complete_match`, `admin_fast_forward_matches`,
`admin_inject_narrative`, `admin_reset_season`, `admin_set_season_status`, `assign_match_referee`,
`berger_round_robin_fixtures`, `bump_login_streak`, `cast_focus_vote`, `incinerate_player`,
`place_wager`, `request_account_deletion`, `settle_wager` (note: `cast_focus_vote` ships in migration
`0072`; regenerate types after it is applied to surface it in `database.ts`).

---

## Edge Functions (7)

| Function | Purpose | Cron | Model | Writes match data? |
|---|---|---|---|---|
| `match-worker` | Claim due matches, run the 90-min spatial sim, persist events + stats + lineups, generate odds, seed cups | every minute | sonnet (in-match architect) | **yes** (service-role) |
| `shadow-match-worker` | Cheap Poisson alternate-timeline outcomes per upcoming match (engine-independent since #389 dropped its legacy-engine path) | **not scheduled by any migration** (header notes intended hourly) | none | yes (`shadow_match_results`) |
| `match-notify-worker` | Web-push "match starting" notifications; idempotent | every minute | none | no |
| `architect-galaxy-tick` | Out-of-match Architect heartbeat → Galaxy Dispatch narratives | every 2h | haiku | no |
| `drama-tick` | Daily drama narrative (transfer demand, retirement, decree, feud) | daily 07:00 | sonnet | no |
| `corpus-enricher` | Grow entity voice library (`entity_snippets`); logs token usage | hourly | haiku | no |
| `account-delete` | GDPR Article 17 erasure (user-JWT phase 1 + service-role phase 2) | HTTP POST | none | no |

The four LLM-spending workers are gated by a shared secret bridging pg_cron and the function
(migration `0052`). `match-notify-worker` uses its own secret and `--no-verify-jwt`.

---

## Continuous Integration

Four workflows under `.github/workflows/`:
- **`deploy.yml`** — on push to `main`, PRs to `main`, and manual dispatch. Jobs: **`quality`** (`npm ci`
  → `typecheck` → `test`; lint runs last with `continue-on-error: true` and **does not gate**) →
  `build` → `deploy` (GitHub Pages, `main` only).
- **`deploy-match-worker.yml`** — deploys the `match-worker` edge function on pushes to `main` touching
  it; deploys with `--no-verify-jwt`.
- **`enact-due-seasons.yml`** — scheduled daily (06:00 UTC) + manual dispatch; runs end-of-season focus
  enactment as a service-role Node job (added in #529/#544). Needs the `SUPABASE_URL` +
  `SUPABASE_SERVICE_ROLE_KEY` repo secrets.
- **`setup-branch-protection.yml`** — manual helper; **stale** (still references a nonexistent `dev`
  branch; cleanup tracked in #549/#550).

There is no CodeQL workflow file, though branch protection references `Analyze` checks (CodeQL is likely
enabled via GitHub's repo-level default setup).

---

## Critical Engineering Invariants

**Never break these without explicit approval:**

1. **Player-data normalization.** The simulator reads the five composite stat columns directly. On the
   live spatial path, `toSpatialTeamInput` + `deriveSimStats` (`spatialEventAdapter.ts`) blend
   `attacking`/`defending`/`mental`/`athletic`/`technical` into the engine's fine-grained stats; on the
   legacy path, `normalizeTeamForEngine()` in `supabase/functions/match-worker/normalizeTeam.ts` does the
   same. **Never drop** `attacking`/`defending`/`mental`/`athletic`/`technical`/`jersey_number`/
   `starter`/`position`/`is_active` from the `players` select. (The old `src/lib/supabase.ts` location is
   gone — deleted in #387.)

2. **`CosmicArchitect.getContext()` must stay synchronous.** It's called 5–10 times in <500ms during
   goal bursts. Hydrate lore pre-match via `prepareArchitectForMatch()` (one DB round-trip); all in-match
   reads are in-memory via `LoreStore`. Never block on Supabase inside `getContext()`.

3. **Feature-based import discipline.** Cross-feature deep imports are forbidden. Always import from a
   feature's barrel (`@features/<feature>`), never from a `logic/`/`api/` module directly. Enforced by
   ESLint `no-restricted-imports`.

4. **Supabase RLS.** Anon: public read. Authenticated: owner/creator write. Service role: full access.
   Never grant authenticated INSERT/UPDATE on `match_events` or `narratives` — only the service-role
   worker writes those. (`match_events` has only a public-SELECT policy; `narratives` lost its
   authenticated-write policy in migration `0030`. Admin destructive RPCs check `profiles.is_admin`
   server-side — the client `/admin` gate is cosmetic.)

5. **Event bus for cross-feature side effects.** Exactly four listeners are mounted in `src/main.tsx`:
   `match.completed` → **WagerSettlementListener**, **CupRoundAdvancerListener**,
   **RefereeNarrativeListener**, **MemoryWriteListener**; `season.ended` and `architect.intervened` →
   **MemoryWriteListener**. (Season enactment is **not** a bus listener — `SeasonEnactmentListener` was
   removed in #372 because mounting it per-browser caused a race over non-idempotent mutations.
   Enactment now runs via the admin-triggered `triggerSeasonEnactment` / `triggerElectionNight` paths.)
   Note: in
   production the `match-worker` writes results directly with the service role and bypasses the bus, so
   the browser settlement/narrative listeners are effectively dead in prod — the bus is exercised by the
   admin "complete match" path and by tests.

6. **The Architect is the game's identity.** Every new feature should give the Architect new levers to
   pull. Before shipping any gameplay change, ask: "what does the Architect do with this?"

---

## Security audit cadence (edge function npm: imports)

Deno edge functions pull npm packages via `npm:<pkg>@<ver>` URLs (e.g. `npm:web-push@3.6.7` in
`match-notify-worker`). These bypass `package.json` and are NOT covered by `npm audit`. Audit them
manually:

1. **On any edge-function PR that bumps an `npm:` pin** — confirm you're on the latest patch in the same
   major; check for transitive CVEs.
2. **Quarterly** — sweep every `npm:` import in `supabase/functions/**` and confirm pinned versions are
   current.
3. **On the next bump of `web-push`** — re-verify its transitive deps (`asn1.js`, `http_ece`,
   `https-proxy-agent`, `jws`, `minimist`) have no open advisories.

---

## Task tracking — GitHub Issues

> Beads/`bd` was **removed in #357**. There is no `bd` CLI, no `.beads/` data. Do **not** use beads,
> `TodoWrite`, or markdown TODO files for cross-session tracking — use **GitHub Issues**.

Work is tracked in GitHub Issues with **label-based milestones** (not GitHub Milestone objects):
- Milestone labels: `M0-launch-blockers`, `M1-architect-wakes-up`, `M2-product-foundation`,
  `M3-architectural-cleanup`, `M4-depth-community`
- Priority labels: `P0` (critical) · `P1` (high) · `P2` (medium) · `P3` (low/backlog)
- Type labels: `feature` · `fix` · `refactor` · `chore` · `docs` (+ `operator-action`)

See `ROADMAP.md` for the milestone index, or filter directly, e.g.
`is:issue is:open label:M0-launch-blockers label:P0`.

### Quick reference (GitHub MCP tools)
- `mcp__github__list_issues` — find open work (filter by label)
- `mcp__github__issue_read` — full body + comments
- `mcp__github__issue_write` — create / update / close
- `mcp__github__add_issue_comment` — leave a note

### Session-start ritual
1. List open issues, filtered to the current milestone (start at `M0-launch-blockers`, advance as it
   closes).
2. Read this file for context.
3. Check current branch + `git status`.

### Session end
1. Push the branch and open a PR targeting `main`.
2. Subscribe to PR activity so review comments and CI failures wake the session.
3. Close any issues finished this session.

---

## Current Implementation Status

> **Last audited: 2026-06-06** against the codebase (a multi-agent ground-truth sweep). Numeric claims
> in this file reflect that sweep. Next sweep due ~2026-09-06.

All core systems are wired and tested:
- **Infrastructure** — strict TypeScript, 11-feature layout, event bus, generated typed client, GitHub
  Pages deploy. **~1,325 Vitest tests** (the legacy `gameEngine.smoke.test.ts` was removed with the
  engine in #389; the seed-divergence test was de-flaked in #541).
- **Match simulation** — live spatial engine + 2D position viewer (the legacy `gameEngine.js` engine and
  its PATH B fallback were deleted in #389).
- **Cosmic Architect** — interference layers, persistent lore, Galaxy Dispatch (galaxy-tick + drama-tick).
- **Auth & profiles**, **Betting** (odds + settlement), **Focus voting & enactment** (+ Election Night),
  **Training** (clicker), **Cup tournaments** (Celestial Cup + Solar Shield), **Entity system**
  (graph + referees), **Season lifecycle**, **Fan support & finance**, **Notifications** (web push),
  **Admin dashboard** — all live.

**Known drift / cleanup (tracked under M3):** the spatial engine is duplicated between `src/` and the
Deno worker (a runtime constraint — ~17% of the codebase is this src↔worker mirror; a drift-guard test
is added in #547); ~230 pre-existing ESLint errors (lint is informationally-gated until cleared); stale
`dev` references in `setup-branch-protection.yml` and `scripts/validate-branch-name.sh` (#549/#550).
