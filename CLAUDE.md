# Intergalactic Soccer League — Project Context

> **Source of truth for game design**: the Notion doc (fetched via Notion MCP — see `https://www.notion.so/rowley/Intergalactic-Soccer-League-33cda0dddb8780408628f63f07e89e05`).
> **Re-read the Vision & Engineering Principles below before starting any new phase.** If work drifts off-vision, pause and escalate.

## Vision (anchor — always keep in mind)

A Blaseball-inspired **social experience browser game**. Users watch AI-simulated intergalactic soccer matches in a fictional solar-system league, bet Intergalactic Credits on outcomes, and at season's end collectively vote with their winnings to shape their club's future. The game's soul is **hidden mechanics, emergent storylines, and fan-driven narratives**. Underlying stats and rules are **never explained** — the world is treated like real life.

**North-star player experience**:
1. Sign up, get 200 Intergalactic Credits, pick a favourite club and player.
2. Watch matches unfold in retro-minimalist UI with three commentator voices (Vox / Nexus-7 / Zara) plus a Lovecraftian Cosmic Architect occasionally interfering.
3. Place bets on upcoming matches; win credits, build a bankroll.
4. Between matches: visit the training facility, click to help players develop, follow the news feed as journalists and pundits react to cosmic events.
5. At season's end: pool credits with other fans of your club to vote on 1 major + 1 minor focus (signings, youth, upgrades, etc.) that actually reshapes the team for next season.

**Core design pillars** (use these to break ties during execution):
- **Emergent storytelling over exposed mechanics** — the LLM layer (commentary, Architect, entities) must always deepen narrative, never reveal numbers.
- **Fan-driven collective agency** — every feature should feed into the shared social experience. Individual-only experiences are lower priority.
- **The Architect is the soul** — the chaos director is not a feature, it's the game's identity. Everything new should give the Architect new levers to pull.
- **Modular now, easy rewrites later** — the Notion doc will change; the codebase must bend with it cheaply. Features are isolated, logic is pure and tested, DB changes are reviewable migrations.
- **Retro-minimalist design** — the Figma design system is the source of truth for look & feel.
- **Long-term social experience** — years of cumulative lore. Persistence and history matter more than short-term polish.

**Explicit non-goals** (for now):
- Mobile-native apps (browser only).
- Real-money gambling (credits are in-game only).
- Player-vs-player direct messaging / chat.
- Exposing raw player stats to users.

---

## Claude Code Session Discipline

### The Golden Rules
1. **If the codebase is in the repo and the task is clear, don't ask—read and fix.** Clarifying questions waste tokens. Trust the task description + repo context.
2. **Use agents proactively when they provide objectively better results.** Don't wait to be asked; spawn them when the math favors it.

### Agent Decision Tree
Use an **Agent** when:
- **Explore agent**: Searching unknown/large codebase for patterns, multiple file types, or building a mental map. Better than grep when you need to synthesize findings across many files.
- **Plan agent**: Multi-phase implementation, architectural decisions, or tradeoffs. Better than planning inline when >3 phases or unknown-unknowns exist.
- **Specialized agent** (`claude-code-guide`, etc.): Domain-specific expertise (Claude API, framework internals). Use proactively when the task involves their specialty.
- **General-purpose agent**: Complex investigation + implementation spanning multiple areas. Useful for parallel work (spawn agents for investigation, then implement sequentially).

Use **direct tools** (Read, Edit, Bash) when:
- Single file or tightly scoped task (mutation, debug, one-liner)
- File path is known and target is visible
- Refactor or bug fix in a single feature
- Running tests/linters

### Token Efficiency Imperatives
1. **No over-explanation.** Commit messages, comments, and text output should state *what changed and why*, not narrate discovery. User can read the diff.
2. **No speculative abstractions.** One consumer = inline it. Wait for a second consumer before extracting.
3. **No dead code, commented-out logic, or TODO comments.** Delete or fix immediately. Dead code in PRs signals incomplete thinking.
4. **Minimize clarifying questions.** You have a repo and a task. Start with a read. Ask only if the task is genuinely ambiguous after you've looked at the code.
5. **No false starts.** Read the codebase *first*; understand layer boundaries and patterns before proposing a solution.
6. **Batch independent operations.** Parallel tool calls (Read, Bash) save round-trips. Use them.

### Quality Checklist (before saying "done")
- [ ] No console.logs, commented code, or debug statements
- [ ] No dead imports or unused variables
- [ ] Tests pass (`tsc --noEmit && eslint && vitest`)
- [ ] Follows existing code patterns (layer boundaries, naming, style)
- [ ] One concern per file (or clear reason for multiple)
- [ ] Commit message uses Conventional Commits format

---

## Git Workflow & Branch Strategy

**Branch Hierarchy:**
- `main` — production-ready, merged from dev via fast-forward. Protected: requires 1 approval + passing CI.
- `dev` — integration branch for features. Protected: auto-merge enabled (squash) for feature PRs, requires passing CI.
- `feat/*`, `fix/*`, `chore/*`, `docs/*`, `refactor/*` — feature branches, deleted after merge.

**Branch Naming (Conventional Commits):**
```
feat/user-authentication          ← New features
fix/match-event-dedup             ← Bug fixes
chore/update-dependencies         ← Maintenance, config, tooling
docs/api-reference                ← Documentation
refactor/architect-logic-cleanup  ← Code restructuring
test/simulation-coverage          ← Test improvements
```

**Commit Messages (Conventional Commits):**
```
feat: add user authentication flow
fix: resolve match event duplication on retry
chore: upgrade dependencies to latest
docs: document betting API endpoint
```

**Workflow:**
1. Create feature branch: `git checkout -b feat/description`
2. Make commits with conventional format
3. Push and create PR to `dev` (auto-merge enabled for squash)
4. Once merged, branch is automatically deleted
5. Sync `main` from `dev` weekly or per release cycle
6. **IMPORTANT**: After every merge, delete the source branch immediately (no orphaned branches)

**Branch Protection Rules:**
- `main`: 1 approval required, status checks required (ESLint, TypeScript, Tests)
- `dev`: auto-merge enabled (squash merge), status checks required
- No force pushes allowed on either branch
- Require conversation resolution before merge

---

## Engineering principles (non-negotiable, apply to every PR)

1. **TypeScript everywhere** with `strict: true`. Typed Supabase client regenerated on every migration via the Supabase MCP's `generate_typescript_types` into `src/types/database.ts`.
2. **Feature-based folder layout**: `src/features/{auth,betting,entities,voting,training,architect,match,finance,admin}/{api,logic,ui}/` + `types.ts` + `index.ts` barrel. Cross-feature deep imports are forbidden — ESLint `no-restricted-imports` enforces it. Pages under `src/pages/` are thin route wrappers. Shared primitives in `src/shared/{ui,hooks,utils,events,supabase}`.
3. **Clear layer boundaries inside each feature**: `api/` (Supabase + Zod), `logic/` (pure TS — no React, no Supabase, 100% unit-testable), `ui/` (React). Pure logic lives in `logic/`; nothing else.
4. **Supabase migration discipline**: every schema change is a timestamped `supabase/migrations/{ts}_{name}.sql` file applied via the Supabase MCP's `apply_migration`. `supabase/schema.sql` is a generated snapshot, not hand-edited.
5. **Runtime + compile-time boundaries**: all Supabase reads pass through Zod schemas in `api/` so DB drift fails loud at the boundary.
6. **Dependency injection**: features never `import { supabase }` directly. They consume the client via `useSupabase()` (React context) or a function argument — makes unit tests trivial and future-proofs swapping the backend.
7. **Vitest unit tests** co-located next to every `logic/` and `api/` module. CI gates on `tsc --noEmit && eslint && vitest`. Target 80%+ coverage of `logic/`.
8. **Event-driven cross-feature communication** via a typed in-app bus (`src/shared/events/bus.ts`). Example: `match.completed` triggers betting settlement without betting and match features knowing about each other. All listeners mounted in `src/main.tsx`.
9. **No dead code, no speculative abstractions**. One consumer ≠ helper. Refactor when a second consumer appears.
10. **ESLint + Prettier + strict tsconfig** in CI. No style debates in review.

---

## Game Design Document

### Goal
Create a soccer simulation browser game inspired by Blaseball — a social experience with many hidden and unexplained mechanics.

### Player Interaction
- **Betting**: Bet tokens on match outcomes; odds are generated from team skill and probability.
- **Voting**: At season's end, fans pool credits to vote on club decisions (signing players, training, upgrades).
- **Fan Support**: Teams with more fans logged in during a match receive a small stat boost.
- **Training Minigame**: Visit the training facility between matches; a clicker minigame helps boost individual players.

### User Account
- Username
- Favourite team and player
- Start with **200 Intergalactic Credits**
- Logging in during a match slightly boosts the supported team's performance

### Betting Rules
- Minimum bet: 10 Intergalactic Credits, no maximum
- Realistic odds generated per match based on team stats
- Win/loss determined by match result; winnings paid out accordingly

### Voting (End of Season)
- Fans spend credits on "focuses" for their team
- The focus with the most credits across all fans of a team is enacted
- **2 focuses per season**: 1 major, 1 minor
- Focus options: Sign new players, Promote youth players, Player boosts, Preseason training investments, Stadium upgrades

### Fan Support Boost
- Each match: compare logged-in fans for both teams
- The team with more logged-in fans receives a small % stat boost for that match

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
- Win = 3 pts, Draw = 1 pt, Loss = 0 pts
- Tiebreaker: goal difference → goals scored
- Each team plays every other team twice (home and away)

### Celestial Cup (Champions League equivalent)
- Top 3 teams per league qualify
- Random draw single-elimination tournament

### Solar Shield (Europa League equivalent)
- Teams ranked 4th–6th per league qualify
- Random draw single-elimination tournament

---

## Match Rules
- Standard 11-a-side football
- Two 45-minute halves + stoppage time
- Yellow and red cards
- 11 players per team (1 GK) + 5 substitutes; 3 substitutions allowed
- VAR enforcement

---

## Team Structure

Each club has:
- Name, Location, Home Ground (name, capacity, nickname)
- Training Facility (name, nickname, quality)
- History/Lore (league & cup history, notable events)
- Manager (name, age, race, nationality, tactical preferences)

### Manager
- **Formations**: 4-4-2, 3-4-3, 4-5-1, 5-4-1 (expandable)
- **Play Styles**: Offensive, Balanced, Defensive, Direct, Possession, Counterattacking, High Pressing, Aggressive
- **Coaching Stats**: Attacking, Defending, Technical, Athletic, Mental

### Squad
- 22 players per club (704 total across 32 teams)
- **Player Details**: Name, Age (16+), Height, Weight, Appearance, Race, Historical achievements, Seasonal stats, Injury status, Form
- **Player Stats**: Shooting, Assisting, Tackling, Blocking, Goalkeeping, Passing, Dribbling, Speed, Stamina, Strength, Positioning, Aggression, Vision
- **Potential**: Godly / High / Medium / Low; Early / Balanced / Late Developer; Superstar flag

---

## Current Implementation Status

> **Last audited: 2026-05-19.** The codebase is production-ready. All core systems are fully operational.

### ✅ COMPLETED — All Core Systems

#### Infrastructure & Tooling
- TypeScript everywhere (`strict: true`), all `.js`/`.jsx` migrated to `.ts`/`.tsx`
- Feature-based folder layout (`src/features/{auth,betting,match,architect,entities,voting,training,finance,admin}`)
- Vitest (668 tests, all passing), ESLint, Prettier, `tsc --noEmit` all green in CI
- Supabase migrations directory (`supabase/migrations/` 0000–0022, no hand-edited schema.sql)
- Generated typed Supabase client (`src/types/database.ts`, 37 tables)
- Event bus (`src/shared/events/bus.ts`) wiring cross-feature side effects
- GitHub Pages deployment via Actions

#### Match Simulation
- `src/gameEngine.js` (2748 LOC) — minute-by-minute, 13+ event types, personality-driven contests, weather, momentum, tension curves, multi-step sequences (penalties, free kicks, sieges, counters, VAR, confrontations)
- `src/gameEngine.d.ts` — full TypeScript declarations for the JS engine
- `src/features/match/logic/simulateFullMatch.ts` — pure 90-minute orchestrator wrapping genEvent()
- `scripts/match-worker.ts` — server-side worker polling every 30s, pre-computes all match events and persists to `match_events`
- 8 personality archetypes, 3 commentator voices (Vox / Nexus-7 / Zara), planetary weather system
- `src/gameEngine.smoke.test.ts` — 200 randomised full matches via seeded LCG

#### Cosmic Architect Narrative Layer
- `src/features/architect/logic/CosmicArchitect.ts` (1087 LOC) — 4 interference layers: Cosmic Edicts, Intentions (12 types), Sealed Fate, Interference Flags (10 reality-rewrites)
- Persistent lore in `architect_lore` DB table; `prepareArchitectForMatch()` hydrates before kickoff; `LoreStore.persistAll()` writes fire-and-forget post-match
- `getContext()` is synchronous — never blocks during goal bursts (5–10 calls in <500ms)
- Cosmic Voice interrupts: Balance + Chaos commentators
- Galaxy Dispatch edge function (`architect-galaxy-tick`, cron `0 */2 * * *`) emitting 5 narrative kinds

#### Authentication & Profiles
- Supabase Auth via `AuthProvider.tsx` — signIn, signUp, signOut, profile fetch, last-seen debounce (1 min)
- `profiles` table: 200 Intergalactic Credits on signup, `last_seen_at`, `favourite_team_id`, `favourite_player_id`
- `handle_new_user` DB trigger auto-creates profile on signup
- RLS: public read of safe columns via `public_profiles` view; full row readable/writable only by owner
- Pages: `/login` (sign-in/sign-up tabs) + `/profile` (account summary + allegiance form + sign-out)

#### Betting System
- Three-way odds (home/draw/away) via `src/features/betting/logic/odds.ts`
- Minimum bet: 10 IC, no maximum; settlement auto-fires on `match.completed`
- Tables: `wagers`, `match_odds`, `team_finances`, `wager_leaderboard` (materialised view), `wager_volume_v`
- Pages: `/wagers` (bet history with status filter strip) + `WagerWidget` embedded in MatchDetail
- Wager narratives written to Galaxy Dispatch post-settlement

#### Focus Voting & Enactment
- End-of-season voting: 1 major focus (10 IC), 1 minor focus (5 IC) per team
- 9 focus types with deterministic seeded-RNG mutations (`enactFocus.ts`, 546 LOC, 49 unit tests)
- `SeasonEnactmentListener` wires `season.ended` bus event to full pipeline
- Election Night ritual: top-10 idol-ranked players face 2× vote-weight permadeath surge
- Tables: `focus_options`, `focus_votes`, `focus_enacted`, `focus_tally`, `incinerations`, `season_decrees`
- Page: `/voting` (voting interface + live tally + "What the Cosmos Decided" post-season panel)

#### Training Minigame
- Clicker facility with geometric XP curve (BASE=100, MULTIPLIER=1.5)
- 1.5s cooldown + 500-click rolling session cap; optimistic updates with rollback
- Append-only `player_training_log` table
- Page: `/training` (roster picker + clicker widget + community board)

#### Cup Tournaments
- Single-elimination Celestial Cup (top 3/league) + Solar Shield (4th–6th/league)
- Standard seeding interleaving guarantees top seeds meet only in the final; byes auto-advance
- Bracket stored as JSONB in `competitions.bracket`; `CupRoundAdvancerListener` advances winners
- 75 unit tests in `cupDraw.test.ts`
- Pages: `/cup/celestial` + `/cup/solar-shield`

#### Entity System
- Unified `entities` + `entity_traits` + `entity_relationships` tables
- First-class entities: players, managers, referees, pundits, journalists, media companies, bookies
- Relationship graph utilities (`relationshipGraph.ts`) — BFS, adjacency, directed/undirected
- Referee selection logic + referee narratives wired to match completion
- Pure factories + 4 test files (entityFactory, relationshipGraph, refereeNarratives, refereeSelection)

#### Season Lifecycle
- Round-robin fixture generation (28 matches/team), cup integration, `season_config` knobs
- Season-end detector fires `season.ended`; 48-hour voting window; enactment; next-season rollover with mutated rosters + new fixtures + re-drawn brackets
- 22 tests in `seasons.test.ts`

#### Fan Support & Finance
- Active fans (last_seen_at within 5 min) grant +2 stat boost to their team at kickoff
- Ticket sales → `team_finances`; `match_attendance` table tracks presence
- `countPresentFans()` called by match-worker before simulation

#### All 11 Pages Live
| Route | Page | Status |
|-------|------|--------|
| `/` | Home | ✅ Hero + live matches + upcoming + standings carousel |
| `/leagues`, `/leagues/:id` | Leagues + LeagueDetail | ✅ Standings tables |
| `/teams`, `/teams/:id` | Teams + TeamDetail | ✅ Squad roster + manager/facility |
| `/matches`, `/matches/:id` | Matches + MatchDetail | ✅ Schedule + WagerWidget |
| `/news` | News | ✅ Galaxy Dispatch feed + kind filters |
| `/idols` | Idols | ✅ Player leaderboard + hot movers strip |
| `/voting` | Voting | ✅ Focus voting + tally + enactment results |
| `/training` | Training | ✅ Clicker minigame |
| `/login` | Login | ✅ Sign-in/sign-up tabs |
| `/profile` | Profile | ✅ Account + allegiance settings |
| `/wagers` | Wagers | ✅ Bet history |

---

## Database Schema (37 tables, migrations 0000–0022)

### Core
`teams`, `leagues`, `managers`, `players`, `entities`, `entity_traits`, `entity_relationships`

### Match & Competition
`matches`, `match_events`, `match_player_stats`, `match_attendance`, `match_odds`, `competitions`, `competition_teams`

### Season
`seasons`, `season_config`

### Narrative & Lore
`architect_lore`, `architect_interventions`, `narratives`, `season_decrees`

### Voting
`focus_options`, `focus_votes`, `focus_enacted`, `focus_tally`, `incinerations`

### Betting & Finance
`wagers`, `team_finances`, `wager_leaderboard` (view), `wager_volume_v` (view)

### User
`profiles`, `public_profiles` (view), `player_training_log`, `player_idol_score` (view), `player_idol_movers` (view)

---

## Remaining Work (Priority Order)

### ✅ Phase A: Live Match Event Streaming — SHIPPED
- `subscribeToMatchEvents()` in `src/features/match/api/matchEvents.ts:173` opens a `postgres_changes` channel filtered by `match_id`.
- `LiveCommentary` in `src/pages/MatchDetail.tsx` mounts the subscription whenever the paced window is open (`scheduled_at + season_config.match_duration_seconds`), funnels both the initial fetch and Realtime stream through `mergeAndSortEvents()` (dedup-by-id + chronological sort), then filters by `filterEventsByElapsedMinute(events, elapsedMinute)` on every per-second tick.
- Pacing anchor is `matches.scheduled_at` (there is no `simulated_at` column).
- Component-level tests cover normal paced replay, mid-simulation join (incl. duplicate Realtime delivery), and early completion (worker flips `status=completed` mid-pacing without skipping the timeline) — see `src/pages/MatchDetail.LiveCommentary.test.tsx`.

### 🟡 Phase B: Admin Dashboard (Medium Priority, Medium Effort — ~1 week)
Operations tool for managing seasons, triggering match simulation, reviewing architect interventions.
- `/admin` route with season state controls (start voting, enact, roll season)
- Fixture browser + manual match completion
- Architect intervention log viewer
- Files to create: `src/pages/AdminDashboard.tsx`, `src/features/admin/ui/`

### 🟡 Phase C: Player Detail Pages (Medium Priority, Medium Effort — ~1 week)
`/players/:id` links exist throughout the app but 404 today. Player detail page showing career stats, training XP, idol rank, match history, and narrative mentions.
- Fetch player from `players` table + entity row + `player_idol_score`
- Match history from `match_player_stats`
- Recent narratives mentioning this player
- Files to create: `src/pages/PlayerDetail.tsx`, `src/features/match/api/playerStats.ts`

### 🟢 Phase D: Performance Optimisation (Low Priority — profile first)
- `React.memo` on `MatchCard`, `WagerWidget`, `StandingsTable`
- Code-split routes via `React.lazy`
- Only do this once there is real traffic to profile against

### 🟢 Phase E: Mobile Polish (Low Priority, Low Effort — ~3 days)
The app works on mobile via responsive CSS but hasn't been polished for touch. Tap targets, nav drawer, viewport refinements.

---

## Critical Engineering Invariants

**Never break these without explicit approval:**

1. **`gameEngine.js` player data normalization** — Consumes camelCase via `normalizeTeamForEngine()` in `src/lib/supabase.ts`. **Never drop** `attacking` / `defending` / `mental` / `athletic` / `technical` / `jersey_number` / `starter` columns from `players`.

2. **`CosmicArchitect.getContext()` must stay synchronous** — Called 5–10 times in <500ms during goal bursts. Hydrate lore pre-match via `prepareArchitectForMatch()` (one DB round-trip); all in-match reads are in-memory via `LoreStore`. Never block on Supabase inside `getContext()`.

3. **Feature-based import discipline** — Cross-feature deep imports are forbidden. Always import from a feature's barrel (`src/features/betting/index.ts`), never from `src/features/betting/logic/odds.ts` directly.

4. **Supabase RLS** — Anon role: public read. Authenticated: creator/owner write. Service role: full access. Never grant authenticated INSERT on `match_events` or `narratives` — only the service-role worker writes those.

5. **Event bus for cross-feature side effects** — `match.completed` → `WagerSettlementListener`, `CupRoundAdvancerListener`, `RefereeNarrativeListener`. `season.ended` → `SeasonEnactmentListener`. No direct feature-to-feature imports for side effects. All listeners mounted in `src/main.tsx`.

6. **The Architect is the game's identity** — Every new feature should give the Architect new levers to pull. Before shipping any gameplay change, ask: "what does the Architect do with this?"

---

## Security audit cadence (edge function npm: imports)

Deno edge functions in `supabase/functions/**` pull npm packages via `npm:<pkg>@<ver>` URLs (e.g. `npm:web-push@3.6.7` in `match-notify-worker/index.ts`). These bypass `package.json` and therefore are NOT covered by `npm audit` on the project root. Audit them manually:

1. **On any edge-function PR that bumps an npm: pin** — run `npm view <pkg> versions` to confirm you're on the latest patch in the same major; check `npm audit` after temporarily adding the package to a scratch `package.json` to surface transitive CVEs.
2. **Quarterly** — sweep every `npm:` import in `supabase/functions/**` and confirm pinned versions are current. Notes to keep in the issue: package name + version, latest available, advisories checked, transitive deps inspected.
3. **On the next bump of `web-push`** — verify `asn1.js`, `http_ece`, `https-proxy-agent`, `jws`, `minimist` (transitive deps) still have no open advisories.

Last audited: 2026-05-21. `web-push@3.6.7` and its transitive deps clean per npm audit.

---

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:ca08a54f -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd dolt push
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Subscribe to PR activity** - If this session opened or pushed to a PR, you MUST call `mcp__github__subscribe_pr_activity` for that PR number **before ending your turn**. Without this, review comments and CI failures will not wake any session. The subscription is per-session and per-PR; opening the PR does NOT auto-subscribe. Skipping this step strands the PR with nobody watching it.
6. **Clean up** - Clear stashes, prune remote branches
7. **Verify** - All changes committed AND pushed
8. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
- NEVER end a session that opened a PR without subscribing to its activity
<!-- END BEADS INTEGRATION -->
