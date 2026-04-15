# Interstellar Soccer League

An AI-powered soccer league website set in a sci-fi universe, where planetary teams compete in narrative-driven matches with live commentary from Claude.

![React](https://img.shields.io/badge/React-18.3-blue) ![Vite](https://img.shields.io/badge/Vite-6.0-purple) ![Tailwind](https://img.shields.io/badge/Tailwind-4.2-teal) ![Anthropic](https://img.shields.io/badge/Claude-Haiku-orange) ![Supabase](https://img.shields.io/badge/Supabase-2.99-green)

## Overview

The Interstellar Soccer League is a full multi-page website covering a sci-fi soccer universe spanning 32 planetary teams across 4 regional leagues — from the Rocky Inner League to the Kuiper Belt League. The site features league standings, team/player profiles, a match schedule, and an in-browser match simulator with real-time AI commentary powered by Claude.

All league and team data is fetched live from Supabase, ensuring consistency between the website and the match simulator. The match simulator runs full 90-minute matches minute by minute with goals, fouls, VAR reviews, injuries, and dramatic comebacks, while three distinct AI commentator personalities react live to every moment.

## Features

### Website
- **Multi-page app** with client-side routing and live Supabase data fetching:
  - **Home** (`/`) — Landing page with league standings carousel and **Galaxy Dispatch** (real-time narratives feed from Architect)
  - **Leagues** (`/leagues`) — All four regional leagues; **League Detail** (`/leagues/:leagueId`) with standings tables (live from DB)
  - **Teams** (`/teams`) — All 32 teams grouped by league; **Team Detail** (`/teams/:teamId`) with squad rosters and stats
  - **Players** (`/players`) — All 512 players organized by league and team with jersey number sorting and profile links; **Player Detail** (`/players/:playerId`) with stats and personality types
  - **Matches** (`/matches`) — Match schedule and live simulator; **Match Detail** (`/matches/:matchId`) with odds display and **WagerWidget** for live betting
  - **Account Features** (authenticated):
    - **Profile** (`/profile`) — Account summary, IC credit balance, team/player preference selection (grouped by league), and personal **BetHistory**
    - **Voting** (`/voting`) — End-of-season fan voting on team focus improvements (Major/Minor tier options with cost display)
    - **Training** (`/training`) — Training facility clicker minigame where fans collectively boost player stats between matches via XP accumulation
  - **Developer** (`/architect-log`, DEV-only) — Intervention audit table showing all Architect rewrites with JSON snapshots and ROLLBACK notices
  - **Login** (`/login`) — Authentication (Supabase magic link)
- Shared header/footer layout with authenticated account menu (login state, IC balance display, dropdown navigation)
- Loading states, error handling, and 404 pages for missing resources

### Match Simulator
- Full 90-minute matches with stoppage time, powered by live Supabase data
- **All 32 planetary teams simulatable** — Match simulator now fetches live roster data from Supabase before each match, ensuring games use real team lineups, managers, and player stats
- Procedurally generated events: goals, free kicks, penalties, cards, injuries, VAR reviews, confrontations, and more
- **13 new match event types** with dedicated visual styling:
  - **Structural Milestones** — Kick-off (min 1), second-half kick-off (min 46), stoppage time announcements (min 45/90), half-time whistle, full-time whistle
  - **Substitutions** — Standalone substitution events fire after injury/red-card-forced subs, enabling clean AI manager reactions and feed entries
  - **Discipline** — Second-yellow → red card uses distinct `🟨🟥` commentary and `isSecondYellow` flag, distinguishing it from straight reds
  - **Play Events** — Offside (10% of attacks), post hits (15% of near-goal shots), time wasting (7% in late phase when winning), VAR no-action reviews (6% of borderline fouls), goal-line clearances (16–20 net band), goalkeeper claims on corners
- Dynamic possession, momentum, and chaos level tracking
- Planetary weather systems — rain, solar storms, zero-gravity, magnetic fields, and others
- **Tension Curves**: 10-segment time-weighted probability curve for events, with 5 pre-match tension variants (standard/frantic/cagey/slow_burn/back_and_forth)
- **Narrative Residue**: Tracks team pressure, consecutive near-misses, and 15+ flashpoint types (retaliation, momentum_surge, hat_trick_hunt, etc.) that dynamically affect gameplay
- **Manager Tactics**: AI-driven manager decisions responding to match conditions (halftime, losing position, red cards, siege mode) with stance-specific shot/defense/press biases

### Player Psychology
- 8 personality types: balanced, selfish, team_player, aggressive, cautious, creative, lazy, workhorse
- Per-player confidence, fatigue, morale, and emotion tracking
- Stats shift dynamically throughout the match based on events and form

### Betting System (Phase 2)
- **Odds engine** — Home/draw/away three-way odds with dynamic calculation based on team ratings
- **Wager settlement** — Automatic resolution after match completion with payout calculation
- **WagerWidget** — Three-way odds buttons (home/draw/away), stake input with live payout preview, kickoff-timer gate (auto-fire at exact kickoff instant), eligibility guards for anonymous/no-credits/already-started match states
- **BetHistory** — Self-fetching wager ledger with status pills (WON/LOST/OPEN/VOID), net-profit column, loading skeleton, refreshKey prop for parent-triggered re-fetches
- **Database** — `wagers` and `wager_outcomes` tables with RLS ensuring users can only view/modify their own wagers

### Focus Voting System (Phase 4)
- **End-of-season voting** — Fans vote on team focus improvements (e.g., "improve defensive positioning")
- **Tier-based credit spend** — Major focus costs 10 credits, minor focus costs 5 credits; tiered into major/minor categories
- **VotingPage** — Team-scoped focus picker with Major/Minor grouping, fetches focus options + running tally in parallel, triggers re-fetch of tally and profile after each vote
- **FocusCard** — Per-option card displaying tally bar (visual share % of tier credits), inline spend form with confirmation, tier badge and cost display, honest fallbacks for no-credits or closed voting states
- **Database** — `focus_options` and `focus_votes` tables; realtime tally aggregates votes by tier

### Entity System & Relationships (Phase 5)
- **Entity Factories** (`entityFactory.ts`) — Pure TypeScript factory functions for creating entities of all kinds:
  - Kind-specific factories for every `EntityKind` (player, manager, referee, pundit, journalist, media company, association, bookie)
  - `createTrait` / `createTraits` — Builders for entity personality/style attributes stored in `entity_traits` table
  - `createRelationship` / `createMutualRelationship` — Typed relationship edge creators with strength clamping (0–100 scale)
  - All meta shapes structurally synchronized with seed migrations so runtime and DB stay in sync
- **Relationship Graph** (`relationshipGraph.ts`) — Pure graph utilities for querying pre-fetched entity relationships:
  - `buildGraph` — O(E) adjacency index with outgoing and incoming edge maps
  - `outgoing` / `incoming` / `neighbours` / `neighbourIds` — Directed and undirected relationship queries with optional kind/strength filters
  - `findRelationship` / `areConnected` — Single-edge lookups and connectivity checks
  - `findPath` — BFS path-finder with configurable max hops (default 4) and edge filters for Architect narrative chain queries
  - `totalStrength` / `degree` — Aggregates for character colour coding (embattled vs. beloved)
- **Entity Backfill Script** (`migrate-to-entities.ts`) — Re-runnable migration utility:
  - Iterates through legacy `players` and `managers` rows with null `entity_id`
  - Creates matching `entities` rows via the shared factories, copying personality/style to `entity_traits`
  - Writes entity FK back to original records
  - Supports `--dry-run` and `--verbose` flags; exits non-zero on failures
  - Complements `0002_entities.sql` migration block for rows added after initial migration
- **Database** — `entities` and `entity_traits` and `entity_relationships` tables with structured graph schema

### Training Minigame (Phase 6)
- **Clicker-style training facility** where fans collectively boost player stats between matches by directing XP into individual players
- **Geometric XP curve** — Each click awards XP; accumulated XP crosses thresholds that award stat bumps on a round-robin basis (BASE_XP_COST=100, CURVE_MULTIPLIER=1.5)
- **Fair stat distribution** — Bumps rotate fairly across all 5 core stats: attacking → defending → mental → athletic → technical
- **Rate limiting** — 1.5s per-click cooldown + 500-click rolling session cap (1h window) prevents abuse while keeping the experience fluid
- **Append-only audit trail** — `player_training_log` table records every click (player, user, xp_added, stat_bumped) with RLS ensuring users can only write their own clicks; public read enables player pages to display lifetime XP and social leaderboards
- **API layer** — Pure, deterministic logic (xpCurve.ts, cooldown.ts) fully unit-tested (51 new tests); API functions (trainingLog.ts) parallelize DB reads for responsiveness
- **TrainingPage** — Roster picker for user's favourite team; remounts ClickerWidget via key= when selection changes to reset all internal state
- **ClickerWidget** — XP progress bar toward next stat bump, cooldown countdown with 100ms tick, session-cap guard, bump toast (stat name flashes for 2.5s), all driven by pure xpCurve/cooldown logic layer

### Out-of-Match Architect & Interventions Audit (Phase 8)
- **Scheduled news generation** — Edge Function (`architect-galaxy-tick`) runs between matches to emit in-world narratives via Claude Sonnet, generating 1-3 thematic news fragments without revealing mechanics or stats
- **Historic rewrite audit** — `architect_interventions` append-only table records every rewrite (target table, field, old/new snapshots, reason, metadata) with indexed searches for dev audit pages and per-match banners
- **Edict validation** — Whitelist-enforced rewrites (matches, match_player_stats, narratives only) prevent the Architect from unfairly modifying player profiles, wagers, or training logs; no-op guard rejects redundant changes
- **Failure resilience** — Audit writes happen BEFORE mutations; if a mutation fails, a compensating row with `meta.failed=true` preserves audit integrity so the log never lies
- **API layer** — `logIntervention()` validates and audits; `logInterventionAndRewrite()` is the production path (audit-first, then mutate); 23 unit tests lock validation rules and error codes
- **ArchitectLogPage** — Dev-only audit table displaying all interventions with JSON snapshots pretty-printed, ROLLBACK NOTICE rows highlighted, manual refresh button. Route should be gated behind `import.meta.env.DEV`

### AI Commentary (powered by Claude)
**The Architect System** — A Lovecraftian cosmic entity that shapes the narrative:
- Issues cosmic **Proclamations** every ~10 minutes (or immediately after goals/red cards)
- Maintains persistent **cosmic lore** in localStorage — accumulated player arcs, manager fates, team rivalry threads, and season arcs across all matches and leagues
- When teams meet a second time, the Architect recalls their history and previous encounters
- Context is injected into every AI prompt, so all voices speak with narrative coherence
- Influences matches through four layers:
  - **Cosmic Edicts** (polarity/magnitude modifiers)
  - **Intentions** (12 types with directed outcomes)
  - **Sealed Fate** (prophecy-driven forced outcomes)
  - **Architect Interference** (10 active flags: keeperParalysed, goalDrought, gravityFlipped, architectTantrum, commentaryVoid, voidCreature, eldritchPortal, pendingInterferences, pendingPenalty, reversalBoost — each flag fires once per event batch with 20-min cooldown, probability scaling with edict polarity)
- **Mortal Bewilderment** — When The Architect interferes, affected characters (players, managers, referees) react with confusion and disbelief:
  - Characters have **zero knowledge** of The Architect or any cosmic cause — they only sense the inexplicable effect
  - System prompts inject bewilderment directives steering reactions toward confusion rather than acceptance
  - LLM-powered reactions fire in parallel after each interference, generating targeted player thoughts and manager responses
  - **Procedural fallback** (no API key): Canned bewildered commentary lines for high-impact interference types (vanished goals, forced red cards, phantom injuries, unexplained score resets) ensure character confusion even in procedural-only matches

**Commentary Pipeline** — Optimized for minimal latency between match events and AI commentary:
- All voices (Captain Vox, Nexus-7, Zara Bloom) run in **parallel** rather than sequentially, eliminating the 300–800 ms blocking wait for Vox's narration
- Reactors receive structured event descriptions (action, player, result, flags) instead of Vox's prose, providing factual clarity without LLM round-trip latency
- **Streaming dispatch**: Each commentary item is streamed to the feed the moment its individual API call resolves, rather than batching after the slowest parallel call
- **Speed-adaptive cooldown** (TURBO → 0 ms, FAST → 100 ms, NORMAL → 300 ms, SLOW → 500 ms) scales the inter-event processing gap to match simulation speed, preventing queue back-pressure at high speeds
- **Priority queue gating** drops low-value events (minor/manager comments) when ≥2 events await; medium events when ≥3 await; goals and red cards always pass — preventing stale commentary from burying important moments
- **Selective reactions**: Medium-tier events (yellow cards, injuries, controversies) now trigger analyst reactions at 50% probability rather than 100%, keeping commentary feel impactful and punctuation-like rather than constant
- **Duplication filtering**: Feed items are strictly typed; play-by-play commentary is filtered by `type === 'play_by_play'` rather than negation, preventing procedural fallback items and other incidental entries from duplicating event text
- Net result: Commentary latency reduced from ~3 s to ~500 ms at TURBO speed

**Commentary Personas** — Three distinct voices:
- **Captain Vox** — primary narrator, bombastic veteran with cosmic metaphors; styled with gold accent border (#FFD700) and name badge for visual consistency across feed layouts. Jersey numbers are integrated into play-by-play narration — Vox will say "Number 9 Asha Renn drives forward..." when referencing players with numbers
- **Nexus-7** — clinical AI analyst, data-driven and precise
- **Zara Bloom** — ex-striker color analyst, tactically sharp

Commentary also includes player inner thoughts, manager reactions, and referee justifications — all generated by Claude Haiku in real time. The Architect Card displays cosmic prophecy with a void-black background, pulsing violet border, and featured mortals.

### Teams & Players
- 32 planetary teams across 4 leagues, each with 16 players (11 starters + 5 bench), unique formations, managers, and home stadiums
- All player data (names, positions, ratings, starter status, jersey numbers) and manager information sourced from Supabase, enabling the web roster browser and match simulator to reference the same squads
- **Team squad pages** now display a full roster section organized by jersey number; all players sorted by number with starters and bench in sequence; all player names link to their profile pages
- **Player stats in match simulator** — Each player now carries live Supabase stats (attacking, defending, mental, athletic, technical ratings) which feed directly into match engine decisions and probabilities
- **Manager and Tactical Style** information displayed prominently in team info cards for quick tactical reference
- **Team abbreviations in match commentary** — All 32 teams have 3-4 character short names (e.g., MRC for Mercury Runners, SAT for Saturn Rings) used in scoreboard displays and match event text (e.g., "MRC 2-1 SAT"). Sourced from the `short_name` column in the teams table.
- 4 regional leagues: Rocky Inner (8 teams), Gas/Ice Giants (8 teams), Outer Reaches (8 teams), Kuiper Belt (8 teams)
- 5 formation options: 4-3-3, 4-4-2, 3-5-2, 5-4-1, 5-3-2
- Substitution system (3 per team) and tactical manager personalities
- **Player Relationship Graph**: Dynamic relationships (rivalry, partnership, grudge, mutual_respect, etc.) that evolve ±0.15 per match, influencing player interactions and fouls

### Match Simulator UI
- Live scoreboard, possession bar, and momentum tracker
- **Live Pitch Visualization** — 180px tall proportional FIFA pitch with:
  - Proper pitch markings: penalty areas (16% wide × 60% tall), goal areas (5.5% × 28%), goal posts (team-colored, 6px wide × 12% tall), centre circle, centre spot, and corner arcs
  - Vertical grass stripes along the pitch length for a broadcast-style look
  - **Player Dots** — formation-based positioning (GK centered at each end, outfield players distributed across their half by formation lines); appear after Kick Off
  - **Ball Movement** — horizontal tracking by possession percentage + vertical randomization on each new event (25–75% range), creating a sense of dynamic pitch flow
  - **Momentum Pressure Overlay** — subtle team-colored gradient on the dominant side when momentum gap ≥ 2, fading when teams are balanced
  - **Goal Flash** — highlights the scoring team's goal end with a 2-second fade for visual drama
- **Player Roster** — Live squad list showing:
  - Jersey numbers displayed as subdued left-aligned badges next to each player name (both on pitch and bench)
  - Live stats (goals, assists, saves, cards, injuries) updated in real time
  - Formation-based positioning with substitution indicators (🔺 for players subbed on)
- **Chaos Meter Card** (260px, two-zone layout):
  - **Top zone** — Chaos bar with scale labels (Calm–Tense–Mayhem) and dynamic event pills:
    - **Late Game** (red) — minute > 80
    - **Final Stretch** (orange) — minutes 71–80
    - **Tied** (purple) — level scores past minute 30
    - **Close Match** (muted) — one-goal difference
    - **Red Cards** (red) — any red cards issued
    - **Heated Bench** (orange) — agents experiencing heightened emotions
    - **Full Time** (purple outline) — match complete
  - **Bottom zone** (scrollable) — **Architect Feed** with purple accent: Cosmic Proclamations and Architect Interference results (previously hidden in the centre column)
    - **Pinned Header** — "✦ The Architect" label stays fixed at the top of the zone while items scroll, ensuring the feed context never disappears even as entries accumulate
- **Real-time event feed** with optimized readability:
  - Minute timestamps and routine event text at high contrast (0.9 and 1.0 opacity respectively)
  - Default accent borders at 0.45 alpha for visibility without overwhelming the visual hierarchy
  - Text hierarchy carried by font size and border weight rather than opacity fading
  - **Captain Vox commentary cards** — Play-by-play narration rendered as styled cards matching analyst commentator layouts: gold (#FFD700) left accent border, subtle gold background wash, name badge above, minute stamp on the right, italic quote text
- Player roster with live stats (goals, assists, saves, cards, injuries)
- **Centre and right column feeds** — Two stacked cards occupy the wider centre column; right panel shows analyst commentary:
  - **Live Pitch** — Formation-based player positioning with ball tracking and momentum overlay
  - **Match Events** — Key events (goals, cards, subs) as compact chips with team colour coding
  - **Commentary feed** (right panel) — Combined Nexus-7 and Zara Bloom analyst reactions, colour-coded by commentator (purple for Nexus-7 data analysis, home team accent for Zara's tactically-driven insight). Replaces the previous Referee Decisions panel with higher-impact colour commentary on key moments.
- **Officials section** (if AI manager active):
  - **Officials info row** — 3-column grid showing Referee (name/leniency/emoji), Stadium (name/capacity), Conditions (weather icon, temperature, time of day)
- **3-column broadcast booth** — Full-width section below the pitch grid; one column per commentary voice:
  - **Nexus-7** — AI analysis and data-driven observations
  - **Captain Vox** — Play-by-play narration and procedural match commentary
  - **Zara Bloom** — Colour analysis and tactical insights
  - Architect proclamations/interference appear only in the Chaos Meter's Architect feed; not duplicated in the booth
  - Analyst reactions (Nexus-7 and Zara Bloom) appear in the right panel Commentary feed; not duplicated in the booth columns
  - Each column scrolls independently; header shows commentator emoji, name, role, and accent colour
  - Columns rendered via a single `COMMENTATOR_PROFILES.map()` pass for structural alignment
  - **Independent scrolling enabled** via CSS block formatting context (BFC): each column div has `overflow:hidden`, allowing flex layout to properly constrain scroll-container height and enable smooth scrolling through full match commentary
- Separate feeds for manager thoughts and player inner monologues
- **Simulation Speed Modes**: SLOW/NORMAL/FAST/TURBO interval-based speeds, plus **DRAMATIC** mode with tunable real-time pacing:
  - **DRAMATIC Mode** — Inspired by Blaseball's philosophy that slow cadence is a feature, not a bug
    - Each match-minute is allocated a real wall-clock budget (default: 15 seconds)
    - **Staggered voice waves** — Commentary spreads across the tick window in three sequential waves instead of arriving as a single dump:
      - **Wave 1 (t=0 s)** — Captain Vox streams his play-by-play narration (text types in live over ~1.5 s)
      - **Wave 2 (t=3 s)** — Reactor commentators chip in (Nexus-7 + Zara Bloom in parallel)
      - **Wave 3 (t=6 s)** — Player inner thoughts, manager reactions, and referee decisions fire simultaneously
      - Result: ~9 s of commentary + 6 s of reading time before the next tick, filling the interval organically rather than as a news ticker
    - Full 90-minute match runs ~22.5 real minutes (tunable: 30 s/tick → 45 min match, 8 s/tick → ~12 min match)
    - Tick timing is controlled by the `DRAMATIC_TICK_MS` constant in `App.jsx`
  - **Per-commentator visual boxes** — Each voice in the feed now has a colored box with:
    - A 3 px left accent stripe in the commentator's signature colour (100% opacity)
    - A subtle tinted background (~7% opacity) — Captain Vox (gold), Nexus-7 (blue), Zara Bloom (green)
    - A 1 px border outline on all sides (~25% opacity) — closes the card so each voice reads as a discrete unit
    - `border-radius: 3px` for a polished card appearance
  - Pause/resume controls apply to all speeds

## App Architecture & Provider Wiring

The application uses a feature-folder structure with context providers at the root level:

- **SupabaseProvider** — Initializes authenticated Supabase client, manages RLS policies, and provides singleton instance to all routes
- **AuthProvider** — Wraps SupabaseProvider; manages user authentication state, credit balances, and login/logout lifecycle
- **BrowserRouter** — Wrapped by both providers so every route has access to auth context and Supabase instance

All child routes mounted under `<BrowserRouter>` can freely use `useAuth()` and `useSupabase()` hooks to fetch user state and execute queries.

## Game Engine Architecture

The match simulator is built on a sophisticated event generation system with six major architectural layers:

1. **Tension Curves** — Events are no longer gated at a flat 35% probability. Instead, matches have a 10-segment time-weighted curve and one of 5 narrative shapes (standard/frantic/cagey/slow_burn/back_and_forth) selected at kick-off. Per-match jitter adds variation, and near-miss pressure bonuses escalate tension.

2. **Narrative Residue** — Teams accumulate pressure (0–100), consecutive near-misses, and active flashpoints (15+ types like retaliation, momentum_surge, hat_trick_hunt). Flashpoints are baked at creation with durations and effects, feeding into player selection bias and contest modifiers in events.

3. **Architect as Director** — The cosmic Architect influences matches through four mechanisms:
   - **Cosmic Edicts**: Polarity and magnitude convert to roll/contestMod/conversionBonus modifiers
   - **Intentions**: 12 intention types with per-proclamation prompts wire into player selection bias and contest bonus
   - **Sealed Fate**: Freeform prophecy parsed into forced outcomes (goal/red_card/wonder_save/chaos) with window and probability
   - **Architect Interference**: 10 reality-rewrite flags (keeperParalysed, goalDrought, gravityFlipped, architectTantrum, commentaryVoid, voidCreature, eldritchPortal, pendingInterferences, pendingPenalty, reversalBoost). Each flag fires once per event batch with 20-min cooldown; probability scales with edict polarity (base 10%, up to ~66% in chaos edict + frantic variant). Flags are actively consumed by the game engine (shot/foul/contest branches, post-event processing) to mutate outcomes, apply modifiers (±25 void-creature swing, +15 reversal boost), hijack plays (pending penalty), or spawn synthetic events (boredom cascade)

4. **LLM Manager Decisions** — Managers respond to 10 trigger conditions (halftime, losing at 60+, red card, siege mode, etc.) with AI-selected stances. Each stance applies ranged shotBias/defenseBias/pressBias/fatigueCost that expire after a window, with stale stances having zero effect.

5. **Player Relationship Graph** — Player relationships (8 types: rivalry, partnership, grudge, mutual_respect, etc.) evolve ±0.15 per match. Relationships influence rival selection in foul branches and scale resolveContest() modifiers. The lore schema supports v1→v2 migration preserving existing match history.

6. **LLM-Driven Architect Interference** — Beyond prophecy, the Architect actively warps reality during matches through 10 flag-based interference types. Each flag is set by `_applyInterferenceToState` (App.jsx) and actively consumed by the game engine:
   - **Shot branch flags** (keeperParalysed, goalDrought, architectTantrum, pendingPenalty): Force goals, collapse saves, convert outcome chains, or hijack shots into penalties
   - **Foul branch flags** (architectTantrum): Escalate yellow cards to red
   - **Contest flags** (voidCreature, reversalBoost): Apply ±25 chaos swing or +15 permanent attacker boost for trailing teams
   - **Roster flags** (eldritchPortal): Randomly remove players from active pitch (20% per minute)
   - **Post-event flags** (gravityFlipped, commentaryVoid): Invert goal outcomes or replace all commentary with cosmic static
   - **Queue flags** (pendingInterferences): Cascade multiple mild interference types (one per tick) via synthetic generation
   Interference probability scales with cosmic chaos levels and has intelligent cooldown management to prevent narrative whiplash.

All six layers degrade gracefully when the LLM is unavailable, ensuring the simulation continues to run.

## Getting Started

### Prerequisites
- Node.js 20+
- An [Anthropic API key](https://console.anthropic.com/) (for AI commentary)
- A [Supabase](https://supabase.com/) project (for live league/match data)

### Installation

```bash
git clone https://github.com/steverowley/soccer-league.git
cd soccer-league
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

### Environment Variables

Create a `.env` file in the project root with your Supabase credentials:

```
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

**Security Note**: Supabase credentials are read from environment variables at runtime and never included in source code. The Anthropic API key is user-entered at runtime and stored in the browser's `localStorage` for convenience — it never touches the server or source control.

### Database Setup

Run the SQL files in order in the Supabase SQL Editor:

1. `supabase/schema.sql` — creates all tables with row-level security, including new player attributes (attacking, defending, mental, athletic, technical, jersey_number, starter)
2. `supabase/seed.sql` — populates leagues, teams, seasons, competitions, **512 players** (16 per team, with starters/bench, overall ratings, and derived individual stat columns), and **32 managers** with space-themed names, planetary nationalities, and tactical styles. Player stats are computed via position-weighted formulas; jersey numbers assigned via ROW_NUMBER() window function (apply the final `-- ── MANAGERS ──` block in your Supabase SQL editor)

### API Key Setup

AI commentary requires a Claude API key. When the app loads, click the key icon to enter your Anthropic API key. Without it, the match simulation still runs — you just won't get live AI commentary.

## Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start local dev server |
| `npm run build` | Build for production |
| `npm run preview` | Preview production build |
| `npm run typecheck` | Run TypeScript type checking (non-emitting) |
| `npm run lint` | Run ESLint checks |
| `npm run lint:fix` | Run ESLint and auto-fix issues |
| `npm run format` | Format code with Prettier |
| `npm run format:check` | Check code formatting without modifying |
| `npm run test` | Run Vitest unit tests once |
| `npm run test:watch` | Run Vitest in watch mode (re-runs on file changes) |
| `npm run test:coverage` | Run Vitest with coverage reporting |
| `npm run check` | Run typecheck, lint, and test together (full CI suite) |

## Project Structure

```
soccer-league/
├── src/
│   ├── App.jsx                  # Main component and match simulator loop
│   ├── main.jsx                 # React entry point and router setup
│   ├── gameEngine.js            # Core simulation: events, contests, player logic
│   ├── agents.js                # Claude AI commentary system
│   ├── simulateHelpers.js       # Chaos calculation, sequences, late-game logic
│   ├── constants.js             # Enums, personalities, weather, formations
│   ├── teams.js                 # All 15 teams and 240+ players
│   ├── utils.js                 # Random number utilities
│   ├── features/                # Feature modules (Phase -1 foundation)
│   │   ├── architect/           # Cosmic narrator and match interference
│   │   ├── auth/                # Authentication (placeholder)
│   │   ├── betting/             # Wager system
│   │   ├── design-system/       # Component library and theme
│   │   ├── entities/            # Entity graph system and relationship logic
│   │   │   ├── logic/           # Pure TS modules (Phase 5)
│   │   │   │   ├── entityFactory.ts — Factory functions for all entity kinds
│   │   │   │   └── relationshipGraph.ts — Graph traversal and path-finding
│   │   │   └── index.ts         # Barrel exports
│   │   ├── finance/             # Prize pools, revenue streams
│   │   ├── match/               # Match scheduling and simulation
│   │   ├── training/            # Player development and skills
│   │   └── voting/              # Community voting and governance
│   ├── shared/                  # Cross-feature infrastructure
│   │   ├── events/              # Typed event bus (match.completed, wager.placed, etc.)
│   │   ├── supabase/            # Singleton client + React DI context
│   │   ├── test/                # Test setup (jest-dom matchers)
│   │   ├── types/               # Application types (database.ts)
│   │   └── utils/               # Shared utilities (random.ts + tests)
│   ├── data/
│   │   └── leagueData.js        # League/team reference data (used by match simulator)
│   ├── scripts/
│   │   └── migrate-to-entities.ts # Backfill players/managers into entity system (Phase 5)
│   ├── lib/
│   │   └── supabase.js          # Supabase client and data-fetching helpers
│   │                             # - getLeagues() — fetch all 4 leagues from DB
│   │                             # - getTeams(leagueId, withPlayers) — fetch teams,
│   │                             #   optionally with nested players array
│   │                             # - getPlayer(playerId) — fetch individual player with
│   │                             #   aggregated season stats from match_player_stats
│   │                             # - normalizeTeam() — map DB fields to app format
│   │                             # - normalizeLeague() — map DB fields to app format
│   ├── pages/
│   │   ├── Home.jsx             # Landing page with standings carousel and Galaxy Dispatch
│   │   ├── Leagues.jsx          # Leagues listing
│   │   ├── LeagueDetail.jsx     # Individual league page with standings table
│   │   ├── Teams.jsx            # Teams listing
│   │   ├── TeamDetail.jsx       # Individual team page with squad section
│   │   ├── Players.jsx          # Players listing with clickable profile links
│   │   ├── PlayerDetail.jsx     # Individual player profile page with stats
│   │   ├── Matches.jsx          # Match schedule and simulator
│   │   ├── MatchDetail.jsx      # Single fixture with WagerWidget and BetHistory
│   │   ├── Profile.jsx          # Account summary, preferences, and BetHistory
│   │   ├── Voting.jsx           # End-of-season focus voting interface
│   │   ├── Training.jsx         # Training facility clicker minigame
│   │   ├── ArchitectLog.jsx     # Dev-only intervention audit table
│   │   └── Login.jsx            # Login page (Supabase magic link auth)
│   └── components/
│       ├── MatchComponents.jsx  # Match simulator UI components
│       ├── layout/
│       │   ├── Layout.jsx       # Page shell wrapping header + footer
│       │   ├── Header.jsx       # Site navigation
│       │   └── Footer.jsx       # Site footer
│       └── ui/
│           ├── Button.jsx       # Primary design-system button
│           ├── IslTable.jsx     # Styled data table
│           ├── MetaRow.jsx      # Label/value metadata row
│           └── StatTable.jsx    # Stats-specific table variant
├── supabase/
│   ├── migrations/              # Timestamped schema migrations
│   │   └── 0000_init.sql        # Initial schema (from schema.sql)
│   ├── schema.sql               # Database schema (legacy; use migrations going forward)
│   └── seed.sql                 # Seed data for leagues, teams, seasons
├── tsconfig.json                # TypeScript strict mode config
├── eslint.config.js             # Flat ESLint config with feature boundary rules
├── prettier.config.js           # Code formatting config
├── vitest.config.ts             # Unit test runner config (jsdom + coverage)
├── vite.config.js               # Vite build config with path aliases
├── CLAUDE.md                    # Vision anchor and engineering principles
└── .github/workflows/
    └── deploy.yml               # GitHub Pages deployment
```

## Code Quality & Reliability

### Foundation Architecture (Phase -1)
Phase -1 establishes the engineering foundation that all subsequent features build on.

#### TypeScript & Static Analysis
- **TypeScript** (`strict: true`, `allowJs: true`) — All new source files are strictly typed; legacy JS files have a migration window
- **Strict type features enabled** — `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` catch edge-case bugs
- **ESLint + TypeScript Plugin** — Flat config enforcing:
  - Feature boundary rules (no cross-feature deep imports via `no-restricted-imports`)
  - Consistent type imports (`import type { T } from '...'`)
  - React hooks rules and best practices
  - Node globals in root config files
- **Prettier** — Consistent code formatting with single quotes, trailing commas, and generated file exclusions

#### Testing & CI
- **Vitest + jsdom** — Unit test framework targeting `logic/` and `shared/` directories with 80%+ coverage goal
- **Jest-dom matchers** — Global test setup for DOM assertions
- **Path Aliases in Tests** — `@`, `@features`, `@shared` work seamlessly in unit tests
- **CI Gate** — `npm run check` runs full typecheck + lint + test suite; must pass before merge

#### Code Organization
- **Feature-based folder structure**: `src/features/{auth,betting,entities,voting,training,architect,match,finance,design-system}/`
  - Each feature has documented `index.ts` barrel exports
  - Future expansion: `{api,logic,ui}/` subdirectories within each feature
- **Shared layer** — Cross-feature concerns live in `src/shared/`:
  - `events/bus.ts` — Typed event bus for feature communication
  - `supabase/` — Singleton typed client + React DI context
  - `utils/` — Utilities (random.ts with unit tests)
  - `types/` — Application types (database schema, etc.)
  - `test/` — Test setup and fixtures
- **Clear layer boundaries**: API (Supabase queries), Logic (pure TS, 100% unit-testable), UI (React)

#### Dependency Injection & Composability
- **Supabase Context** — Features inject the typed client via `useSupabase()` hook, not direct imports; enables testing
- **Typed Event Bus** — `src/shared/events/bus.ts` defines:
  - `match.completed` — Match simulator → analytics
  - `wager.placed` — Betting feature → leaderboard
  - `season.ended` — Season data → archive
  - `architect.intervened` — Cosmic events → match log
- **No speculative code** — Refactor abstractions only when a second consumer appears

#### Database & Migrations
- **Typed database schema** — Hand-written `src/types/database.ts` until Supabase MCP code generation available
- **Migration discipline** — Schema changes live in timestamped `supabase/migrations/` files (e.g., `0000_init.sql`), enabling version control and safe rollbacks
- **Row-Level Security** — All tables enforce RLS policies

#### Best Practices
- **Error Boundary Component** — Top-level error handler (`ErrorBoundary.jsx`) catches React errors with ISL-themed fallback UI; prevents blank screens on runtime errors
- **Comprehensive Error Logging** — All async `.catch()` handlers include console logging with context for easier debugging
- **Constants Management** — `CLAUDE_MODEL` constant extracted to `src/constants.js` for single-source-of-truth; avoids hardcoded model strings across agents and components
- **React Key Stability** — All list rendering uses stable, semantic keys (player IDs, content hashes) instead of array indices to prevent render bugs during list updates
- **Dynamic Copyright** — Footer year updates automatically with `new Date().getFullYear()` instead of manual year bumps
- **Inline Documentation** — JSDoc blocks on all exported functions; header comments explaining logic and invariants; annotated magic numbers and thresholds

### Critical Engineering Invariants
See `CLAUDE.md` for detailed engineering principles. Key constraints:
- `src/gameEngine.js` consumes player data via `normalizeTeamForEngine()` — never drop `attacking`, `defending`, `mental`, `athletic`, `technical`, `jersey_number`, or `starter` columns
- `CosmicArchitect.getContext()` is called synchronously on every LLM prompt (5–10 times in <500ms during goal bursts) — never block it on DB round-trips

## Deployment

The project deploys automatically to GitHub Pages on push to `main`/`master` via GitHub Actions.

**Build Configuration**: The `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` environment variables are injected into the GitHub Actions build step (`.github/workflows/deploy.yml`). These are public-facing credentials; the anon key is Supabase's publishable key with Row Level Security enforced on the database. If you fork this project, update `.github/workflows/deploy.yml` to set your own Supabase credentials in the `Build` step's `env` block.

## Tech Stack

- **React 18** + **Vite 6** — frontend framework and build tool
- **React Router DOM 7** — client-side routing
- **Tailwind CSS 4** — styling
- **Supabase** — database and backend (PostgreSQL + row-level security)
- **Anthropic SDK** — Claude Haiku for AI commentary
- **Lucide React** — icons
- **GitHub Pages** — hosting
