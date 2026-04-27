# Intergalactic Soccer League — Project Context

> **Source of truth for game design**: the Notion doc (fetched via Notion MCP — see `https://www.notion.so/rowley/Intergalactic-Soccer-League-33cda0dddb8780408628f63f07e89e05`).
> **Source of truth for implementation**: `/root/.claude/plans/nifty-brewing-pixel.md` (phased roadmap with exact file paths and verification steps).
> **Re-read the Vision & Engineering Principles below before starting any new phase.** If work drifts off-vision, pause and escalate.

## Vision (anchor — always keep in mind)

A Blaseball-inspired **social experiment browser game**. Users watch AI-simulated intergalactic soccer matches in a fictional solar-system league, bet Intergalactic Credits on outcomes, and at season's end collectively vote with their winnings to shape their club's future. The game's soul is **hidden mechanics, emergent storylines, and fan-driven narratives**. Underlying stats and rules are **never explained** — the world is treated like real life.

**North-star player experience**:
1. Sign up, get 200 Intergalactic Credits, pick a favourite club and player.
2. Watch matches unfold in retro-minimalist UI with three commentator voices (Vox / Nexus-7 / Zara) plus a Lovecraftian Cosmic Architect occasionally interfering.
3. Place bets on upcoming matches; win credits, build a bankroll.
4. Between matches: visit the training facility, click to help players develop, follow the news feed as journalists and pundits react to cosmic events.
5. At season's end: pool credits with other fans of your club to vote on 1 major + 1 minor focus (signings, youth, upgrades, etc.) that actually reshapes the team for next season.

**Core design pillars** (use these to break ties during execution):
- **Emergent storytelling over exposed mechanics** — the LLM layer (commentary, Architect, entities) must always deepen narrative, never reveal numbers.
- **Fan-driven collective agency** — every feature should feed into the shared social experiment. Individual-only experiences are lower priority.
- **The Architect is the soul** — the chaos director is not a feature, it's the game's identity. Everything new should give the Architect new levers to pull.
- **Modular now, easy rewrites later** — the Notion doc will change; the codebase must bend with it cheaply. Features are isolated, logic is pure and tested, DB changes are reviewable migrations.
- **Retro-minimalist design** — the Figma design system is the source of truth for look & feel.
- **Long-term social experiment** — years of cumulative lore. Persistence and history matter more than short-term polish.

**Explicit non-goals** (for now):
- Mobile-native apps (browser only).
- Real-money gambling (credits are in-game only).
- Player-vs-player direct messaging / chat.
- Exposing raw player stats to users.

## Engineering principles (non-negotiable, apply to every PR)

1. **TypeScript everywhere** with `strict: true`. Typed Supabase client regenerated on every migration via the Supabase MCP's `generate_typescript_types` into `src/types/database.ts`.
2. **Feature-based folder layout**: `src/features/{auth,betting,entities,voting,training,architect,match,finance,design-system}/{api,logic,ui}/` + `types.ts` + `index.ts` barrel. Cross-feature deep imports are forbidden — ESLint `no-restricted-imports` enforces it. Pages under `src/app/` are thin route wrappers. Shared primitives in `src/shared/{ui,hooks,utils,events,supabase}`.
3. **Clear layer boundaries inside each feature**: `api/` (Supabase + Zod), `logic/` (pure TS — no React, no Supabase, 100% unit-testable), `ui/` (React). Pure logic lives in `logic/`; nothing else.
4. **Supabase migration discipline**: every schema change is a timestamped `supabase/migrations/{ts}_{name}.sql` file applied via the Supabase MCP's `apply_migration`. `supabase/schema.sql` is a generated snapshot, not hand-edited.
5. **Runtime + compile-time boundaries**: all Supabase reads pass through Zod schemas in `api/` so DB drift fails loud at the boundary.
6. **Dependency injection**: features never `import { supabase }` directly. They consume the client via `useSupabase()` (React context) or a function argument — makes unit tests trivial and future-proofs swapping the backend.
7. **Vitest unit tests** co-located next to every `logic/` and `api/` module. CI gates on `tsc --noEmit && eslint && vitest`. Target 80%+ coverage of `logic/`.
8. **Event-driven cross-feature communication** via a typed in-app bus (`src/shared/events/bus.ts`). Example: `match.completed` triggers betting settlement without betting and match features knowing about each other.
9. **No dead code, no speculative abstractions**. One consumer ≠ helper. Refactor when a second consumer appears.
10. **ESLint + Prettier + strict tsconfig** in CI from Phase -1 onward. No style debates in review.

---

## Game Design Document

### Goal
Create a soccer simulation browser game inspired by Blaseball — a social experiment with many hidden and unexplained mechanics.

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
- 22–25 players per club
- **Player Details**: Name, Age (16+), Height, Weight, Appearance, Race, Historical achievements, Seasonal stats, Injury status, Form
- **Player Stats**: Shooting, Assisting, Tackling, Blocking, Goalkeeping, Passing, Dribbling, Speed, Stamina, Strength, Positioning, Aggression, Vision
- **Potential**: Godly / High / Medium / Low; Early / Balanced / Late Developer; Superstar flag

---

## Current Implementation Status

### Already Built
- Match simulator: minute-by-minute, 13+ event types, personality-driven contests, weather, momentum, tension curves, multi-step sequences (penalties, freekicks, sieges, counters) — `src/gameEngine.js` (1100+ LOC)
- Cosmic Architect director: `src/features/architect/logic/CosmicArchitect.ts` (TypeScript). Persistent lore lives in the `architect_lore` DB table; `prepareArchitectForMatch()` is the canonical kickoff lifecycle (hydrate → primed Architect + LoreStore for post-match `persistAll`). `getContext()` stays synchronous so it never blocks commentary during goal bursts.
- AI commentary via Claude: 3 commentator personas (Captain Vox, Nexus-7, Zara Bloom) + Architect voice + player thoughts + manager shouts
- **32 teams across 4 leagues, 512 players (16/team), 32 managers** fully seeded in `supabase/seed.sql` (Phase 0.5 expands to 22/team = 704)
- Season 1 competitions: 4 round-robin leagues (224 fixtures) + ISL Champions Cup (13 fixtures)
- League standings, team/player profile pages, match simulator UI
- Supabase backend: 9 tables with RLS (public read, authenticated write); schema currently hand-maintained in `schema.sql` (migrations adoption in Phase -1)
- Manager tactics AI, player psychology system, 8 personality archetypes
- Planetary weather system (Mars dust storms, Europa magnetic storms, zero-G quirks, etc.)
- **Focus voting consequence (Package 2)**: `focus_enacted` table (migration 0011); pure enactment engine `enactFocus.ts` (9 focus types, seeded-RNG determinism, discriminated `EnactmentMutation` union); DB layer `enactment.ts` (`enactSeasonFocuses`, `getEnactedFocuses`); `SeasonEnactmentListener` wires `season.ended` bus event to the pipeline; VotingPage shows "What the Cosmos Decided" post-season panel. 49 unit tests in `enactFocus.test.ts`.

### Planned / Not Yet Built (see plan file for phased roadmap)
- **Phase -1**: TypeScript migration, feature-based folder reshape, Vitest/ESLint/Prettier tooling, Supabase migrations directory, typed Supabase client, dependency injection, event bus
- **Phase 0**: Figma design system tokens (foundation only) and component refactor
- **Phase 0.5**: Seed generator script + roster expansion 16 → 22 players (→ 704 total)
- **Phase 1**: Supabase Auth + `profiles` table (200 credits, `last_seen_at`)
- **Phase 5**: Unified `entities` + `entity_traits` + `entity_relationships` + `narratives` tables (additive only — keep `players`/`managers` typed columns intact). Seeds referees, pundits, journalists, owners, bookie.
- **Phase 5.1**: Architect lore DB hydration lifecycle (pre-hydrate once per match, fire-and-forget writes — `getContext()` must stay synchronous)
- **Phase 2**: Betting (`wagers`, `match_odds`, `team_finances`, odds engine, RLS + leaderboard view)
- **Phase 3**: Fan support stat boost + ticket-sales revenue → `match_attendance`, `team_finances`
- **Phase 4**: End-of-season focus voting
- **Phase 6**: Training clicker minigame
- **Phase 8**: Out-of-match Architect Edge Function + historic rewrite audit (`architect_interventions`)

### Critical engineering invariants
- `src/gameEngine.js` consumes player data in camelCase via `normalizeTeamForEngine()` (`src/lib/supabase.js:381–437`). **Never drop** `attacking`/`defending`/`mental`/`athletic`/`technical`/`jersey_number`/`starter` columns from `players`.
- `CosmicArchitect.getContext()` (`src/features/architect/logic/CosmicArchitect.ts`) is called synchronously on every LLM prompt and can fire 5–10 times in <500ms during a goal burst. **Never block it on Supabase round-trips** — hydrate lore before kickoff via `prepareArchitectForMatch()`, write fire-and-forget via `LoreStore.persistAll()`.
- The Architect is the game's identity. Every new feature should give it new levers.
