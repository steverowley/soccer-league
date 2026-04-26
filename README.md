# Intergalactic Soccer League

A Blaseball-inspired social experiment browser game. AI-simulated soccer matches across a fictional solar-system league — place bets, watch cosmic chaos unfold, and vote with your credits to shape your club's future.

![React](https://img.shields.io/badge/React-18.3-blue) ![Vite](https://img.shields.io/badge/Vite-6.0-purple) ![Tailwind](https://img.shields.io/badge/Tailwind-4.2-teal) ![Anthropic](https://img.shields.io/badge/Claude-Haiku_4.5-orange) ![Supabase](https://img.shields.io/badge/Supabase-2.99-green)

## Overview

32 planetary teams compete across 4 regional leagues — from the Rocky Inner League to the Kuiper Belt. Fans sign up, pick a favourite club, and earn Intergalactic Credits by betting on match outcomes. At season's end, fans pool their credits to vote on their club's direction for next season.

Matches run as full 90-minute simulations with live AI commentary from three distinct voices (Captain Vox, Nexus-7, Zara Bloom), plus a Lovecraftian Cosmic Architect who warps reality mid-match. The underlying mechanics are never explained — the world is treated like real life.

## Features

### Website
Multi-page app with client-side routing and live Supabase data fetching. All pages share a unified design system with consistent page heroes, section navigation arrows, and reusable card components.

- **Home** (`/`) — Hero section with:
  - **Live Games** — MatchCard components displaying all active matches (status='active') with momentum bars and pulsing when matches are in progress; section hidden when no live matches
  - **Upcoming Games** — next 6 scheduled fixtures (status='upcoming') as MatchCard components with bet sliders
  - League standings carousel and Galaxy Dispatch (real-time Architect narratives feed)
- **News** (`/news`) — Paginated Galaxy Dispatch feed with Architect narratives; kind filter strip (news, political_shift, geological_event, architect_whisper, economic_tremor) with purple glow highlighting on `architect_whisper` cards; public route (no auth required)
- **Leagues** (`/leagues`, `/leagues/:leagueId`) — All four regional leagues with live standings tables; per-league carousel navigation with arrow controls
- **Teams** (`/teams`, `/teams/:teamId`) — 32 teams grouped by league, with squad rosters and stats; per-league carousel for browsing
- **Players** (`/players`, `/players/:playerId`) — All 512 players with jersey number sorting and profile pages
- **Matches** (`/matches`, `/matches/:matchId`) — Match schedule as MatchCard components (in_progress / scheduled / completed variants), live simulator, and per-fixture WagerWidget
- **Authenticated routes**:
  - **Profile** (`/profile`) — Fan number, fan since date, IC credit balance, team/player preference, personal BetHistory, total winnings
  - **Voting** (`/voting`) — End-of-season focus voting with Major/Minor tier options
  - **Training** (`/training`) — Clicker minigame to collectively boost player stats
  - **Architect Log** (`/architect-log`, dev-only) — Intervention audit table with JSON snapshots
- Shared header/footer with authenticated account menu (login state, IC balance, dropdown nav)


### Match Simulator
- Full 90-minute matches with stoppage time, powered by live Supabase roster data
- 13+ event types: goals, free kicks, penalties, VAR reviews, cards, injuries, confrontations
- Planetary weather systems (Mars dust storms, Europa magnetic storms, zero-gravity quirks)
- Tension curves, narrative residue, and momentum tracking
- Manager AI that makes tactical decisions mid-match in response to game state
- Player psychology: 8 personality types with per-player confidence, fatigue, and morale
- **Fan support boost** — teams with more present fans (logged-in profiles within 5 minutes) receive a +2 stat bump across all five player categories at kickoff, affecting all subsequent contests and tactical outcomes

### The Cosmic Architect
- Lovecraftian cosmic entity that shapes every match through four interference layers:
  - **Cosmic Edicts** — polarity/magnitude modifiers on match probability
  - **Intentions** — 12 directed-outcome types wired into player selection
  - **Sealed Fate** — prophecy-driven forced outcomes (goals, red cards, wonder saves)
  - **Interference Flags** — 10 reality-rewrite flags (gravityFlipped, voidCreature, eldritchPortal, etc.)
- Persistent lore accumulates across matches — rivalries, player arcs, season storylines
  - **Database-backed**: Pre-match `LoreStore.hydrate()` loads all `architect_lore` DB rows into memory; lore is immediately injected before match start so Architect sees cross-session state from first Proclamation
  - **Post-match persistence**: `LoreStore.persistAll()` chains onto match completion to batch-upsert fully-updated lore to DB; localStorage writes preserved for offline resilience
- All AI voices speak with narrative coherence via injected Architect context
- Affected characters react with confusion and disbelief; they have zero knowledge of any cosmic cause

### AI Commentary
Three distinct voices powered by Claude Haiku, running in parallel for minimal latency:
- **Captain Vox** — bombastic veteran narrator with cosmic metaphors
- **Nexus-7** — clinical AI analyst, data-driven and precise
- **Zara Bloom** — ex-striker colour analyst, tactically sharp

Plus player inner thoughts, manager reactions, and referee justifications generated live. Commentary latency ~500ms at TURBO speed via parallel streaming dispatch.

**Simulation speeds**: SLOW / NORMAL / FAST / TURBO / DRAMATIC (real-time pacing with staggered voice waves)

### Betting System
- Three-way odds (home/draw/away) calculated from team ratings
- Minimum bet: 10 Intergalactic Credits
- Wager settlement auto-fires after match completion
- Kickoff-timer gate prevents bets after the match starts
- Wager ledger with status pills (WON/LOST/OPEN/VOID) and net-profit column

### Focus Voting
- End-of-season: fans spend credits to vote on club focus (signings, youth, training, upgrades)
- 2 focuses per season: 1 major (10 credits), 1 minor (5 credits)
- The focus with the most credits across all fans of a team is enacted
- Running tally visible to all fans of the club

### Training Minigame
- Clicker-style facility: fans collectively boost players between matches
- Geometric XP curve (BASE_XP_COST=100, CURVE_MULTIPLIER=1.5) with round-robin stat distribution
- Rate limited: 1.5s cooldown + 500-click rolling session cap
- Append-only audit trail in `player_training_log`

### Entity System
- Unified `entities` + `entity_traits` + `entity_relationships` tables — every player, manager, referee, pundit, journalist, media company, association, and bookie is a first-class entity
- Pure TypeScript factories (`entityFactory.ts`) produce insert rows with meta shapes matching seed migrations exactly
- Graph utilities (`relationshipGraph.ts`) for Architect narrative queries — directed/undirected adjacency, kind/strength filters, BFS path-finding (default max 4 hops), degree aggregates
- Re-runnable backfill script (`scripts/migrate-to-entities.ts`) with `--dry-run` and `--verbose` flags for linking new `players`/`managers` rows to entities post-migration

### Website
- League standings, team/player profiles, match schedule
- Player detail pages with aggregated season statistics
- Full squad pages organised by jersey number
- Auth with 200 Intergalactic Credits on signup

## Leagues

| League | Teams |
|--------|-------|
| Rocky Inner League | Mercury, Venus, Earth, Mars teams (8 clubs) |
| Gas/Ice Giant League | Jupiter, Saturn, Uranus, Neptune teams (8 clubs) |
| Asteroid Belt League | Ceres, Vesta, Pallas, Hygiea and belt colonies (8 clubs) |
| Kuiper Belt League | Pluto, Eris, Haumea, Makemake, Sedna and outer reaches (8 clubs) |

Top 3 per league qualify for the **Celestial Cup** (Champions League equivalent); 4th–6th qualify for the **Solar Shield** (Europa League equivalent).

## Getting Started

### Prerequisites
- Node.js 20+
- [Anthropic API key](https://console.anthropic.com/) for AI commentary
- [Supabase](https://supabase.com/) project for league and match data

### Installation

```bash
git clone https://github.com/steverowley/soccer-league.git
cd soccer-league
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

### Environment Variables

Create a `.env` file in the project root:

```
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

The Anthropic API key is entered at runtime via the in-app key icon and stored in `localStorage` — it never touches the server.

### Database Setup

Run the SQL files in order in the Supabase SQL Editor:

1. `supabase/schema.sql` — creates all tables with row-level security
2. `supabase/seed.sql` — populates 32 teams, 512 players, 32 managers, seasons, and competitions

## Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start local dev server |
| `npm run build` | Build for production |
| `npm run preview` | Preview production build |
| `npm run typecheck` | TypeScript type checking |
| `npm run lint` | ESLint checks |
| `npm run lint:fix` | ESLint with auto-fix |
| `npm run format` | Format with Prettier |
| `npm run test` | Run Vitest unit tests |
| `npm run test:coverage` | Run tests with coverage |
| `npm run check` | Full CI suite (typecheck + lint + test) |

## Project Structure

```
soccer-league/
├── src/
│   ├── App.jsx                  # Match simulator loop and root component
│   ├── gameEngine.js            # Core simulation: events, contests, player logic (legacy JS, pending migration)
│   ├── simulateHelpers.js       # Chaos, sequences, late-game logic
│   ├── constants.js             # Enums, personalities, weather, formations
│   ├── lib/
│   │   └── supabase.ts          # Typed TypeScript helpers for Supabase (15 query/mutation functions with injected client DI)
│   ├── features/                # Feature modules
│   │   ├── architect/           # Cosmic narrator and match interference
│   │   │   ├── logic/
│   │   │   │   ├── CosmicArchitect.ts     # Fully typed AI entity managing match edicts, intentions, and fate (migrated from agents.js)
│   │   │   │   ├── edicts.ts              # Edict system for match probability modifiers
│   │   │   │   └── loreStore.ts           # Persistent narrative context across matches
│   │   │   ├── api/
│   │   │   │   ├── interventions.ts       # API layer for architect interventions
│   │   │   │   └── lore.ts                # API layer for narrative queries
│   │   │   ├── ui/
│   │   │   │   ├── ArchitectLogPage.tsx   # Dev-only intervention audit log (mounted at /architect-log)
│   │   │   │   └── NewsFeedPage.tsx       # Paginated Galaxy Dispatch feed with kind filter strip and purple glow
│   │   │   ├── types.ts                   # Architect domain types
│   │   │   └── index.ts                   # Feature exports
│   │   ├── auth/                # Authentication and user profiles
│   │   ├── betting/             # Wager system and odds engine
│   │   ├── design-system/       # Component library and theme tokens (ISL shield logo, Space Mono fonts, color tokens)
│   │   ├── entities/            # Player, team, season data models
│   │   ├── finance/             # Fan boost and ticket revenue
│   │   ├── match/               # Match simulator types and logic
│   │   │   ├── types.ts         # Shared TypeScript interfaces (players, teams, events, feed items, architect contract, agent system)
│   │   │   └── logic/
│   │   │       └── AgentSystem.ts        # AI commentary orchestrator with three distinct voices (migrated from agents.js)
│   │   ├── training/            # Player development clicker
│   │   └── voting/              # End-of-season focus voting
│   ├── shared/                  # Cross-feature infrastructure
│   │   ├── events/bus.ts        # Typed event bus (match.completed, wager.placed, …)
│   │   ├── supabase/            # Singleton client + React DI context (useSupabase hook)
│   │   └── utils/               # Shared utilities
│   ├── pages/
│   │   ├── Home.jsx             # Landing page with standings and Galaxy Dispatch
│   │   ├── NewsFeed.jsx         # Public route wrapper for Galaxy Dispatch news feed
│   │   ├── Leagues.jsx / LeagueDetail.jsx
│   │   ├── Teams.jsx / TeamDetail.jsx
│   │   ├── Players.jsx / PlayerDetail.jsx
│   │   ├── Matches.jsx / MatchDetail.jsx
│   │   ├── Profile.jsx          # Account summary, preferences, BetHistory
│   │   ├── Voting.jsx           # Focus voting interface
│   │   ├── Training.jsx         # Training clicker minigame
│   │   ├── ArchitectLog.jsx     # Dev-only intervention audit
│   │   └── Login.jsx            # Supabase magic link auth
│   ├── components/              # UI components (layout, match simulator, design system)
│   └── types/database.ts        # Typed Supabase schema
├── supabase/
│   ├── migrations/              # Timestamped schema migrations
│   ├── schema.sql               # Database schema snapshot
│   └── seed.sql                 # Seed data
├── tsconfig.json                # TypeScript strict mode config
├── eslint.config.js             # Flat ESLint config with feature boundary rules
├── vitest.config.ts             # Unit test runner
└── .github/workflows/deploy.yml # GitHub Pages deployment
```

## Architecture

### Database Client Dependency Injection
All 11 pages use a typed `useSupabase()` hook from `shared/supabase/` that injects the Supabase client as a dependency. This ensures:
- **Testability**: Pages can be tested with a mock client (IslSupabaseClient interface)
- **Decoupling**: Pages don't import the singleton; they receive it from context
- **Type safety**: All helpers in `lib/supabase.ts` are strictly typed with `db: IslSupabaseClient` as the first parameter

### Supabase Helpers (`src/lib/supabase.ts`)
15 TypeScript helper functions for common queries/mutations:
- `getPlayersForTeam(db, teamId)` — efficient team roster fetches (prevents 512-player over-fetch)
- `getLeagueStandings()`, `getTeamDetail()`, `getMatchSchedule()`, etc.
- Each function accepts `db` from context, enabling easy mocking in tests
- **Dual-file strategy**: `supabase.ts` (typed, React pages) shadows `supabase.js` (legacy, App.jsx) via Vite's `resolve.extensions` prioritization (`.ts` before `.js`). This prevents accidental imports of the untyped version while maintaining backward compatibility with the match simulator's explicit `.js` imports.

### Match Type System (`features/match/types.ts`)
Centralized TypeScript interfaces for match simulator and AI commentary:
- **Entity types**: `MatchPlayer`, `MatchTeam`, `MatchReferee`, `MatchManager` — structural contracts for game objects
- **Agent types**: `PlayerAgent` (with confidence, fatigue, emotion, personality, form) — tracks psychological state during matches
- **Event system**: `MatchEvent` with Architect interference flags (`architectForced`, `architectConjured`, `architectStolen`, etc.) — all event types share consistent shape
- **Feed items**: `FeedItem` discriminated union — `PlayByPlayItem`, `CommentatorItem`, `PlayerThoughtItem`, `ManagerItem`, `RefereeItem`, `ArchitectProclamationItem` with streaming support
- **Architect contract**: `IArchitect` interface — allows AgentSystem to depend on an abstraction rather than concrete CosmicArchitect, enabling structural (duck) typing and loose coupling between features
- **Context types**: `AgentMatchContext`, `ArchitectMatchContext` — initialization parameters injected into systems at match start

This eliminates type drift between game engine (`App.jsx`, `gameEngine.js`) and AI commentary (`AgentSystem`) by defining each shared shape once.

### AI Commentary & Architect System (`features/architect/` & `features/match/logic/AgentSystem.ts`)
Migrated from legacy `agents.js` to strict TypeScript with clean feature separation:
- **CosmicArchitect.ts** (374 lines) — The Lovecraftian entity managing all four interference layers (Cosmic Edicts, Intentions, Sealed Fate, Interference Flags). Loaded with context-aware prompt injection, Claude API calls via streaming, and persistence via Supabase `narratives` table.
- **AgentSystem.ts** — Orchestrates three distinct AI voices (Captain Vox, Nexus-7, Zara Bloom) running in parallel streams. Manages player inner thoughts, manager reactions, and referee justifications. Latency ~500ms at TURBO speed via staggered voice dispatch.
- **Edicts & LoreStore** — Supporting systems for probability modifiers and cross-match narrative accumulation. Lore is database-backed, hydrated before match start, and persisted post-match for session coherence.
- **API layer** (`architect/api/`) — Thin modules for reading narratives and interventions from Supabase, enabling future front-end feeds (Galaxy Dispatch narrative UI, intervention audit).
- **Type safety**: Both systems depend on `IArchitect` interface (duck typing) rather than concrete CosmicArchitect, enabling loose coupling and testability.

### Design System (`features/design-system/` & `src/index.css`)
Unified visual language and component library aligned to the Figma design specification:
- **Color tokens** (`src/index.css` CSS variables) — ISL brand palette with thematic names: Void (#050308), Abyss (#1a1625), Quantum Purple (#8B5AFF), Architect Purple variants, Nexus-7 Blue (#4FC3F7), Lunar Dust (#d4cfbe), Sage Green. All colors are CSS custom properties for easy theming.
- **Self-hosted fonts** — Space Mono (Regular/Bold/Italic/BoldItalic) served from `public/fonts/`, eliminating Google Fonts dependency for improved performance and privacy.
- **Logo & branding** — ISL shield crest (ISL letterform + soccer ball planet) as `public/isl-logo.svg`, replacing generic placeholder.
- **Form system** (`index.css`) — Centralized classes for all input forms across the app:
  - `.form-group` — vertical flex wrapper with consistent spacing
  - `.isl-label`, `.isl-input`, `.isl-select` — design-system-aligned form elements used in Login, Signup, Profile, Wager, and Training pages
  - `.form-error` — red error message styling with monospace font
  - All form components now use design tokens exclusively (no inline styles)
- **Styled components**:
  - `.btn` (primary/secondary/tertiary variants) — 56px height with inline-flex alignment and Lunar Dust glow on hover/active
  - `.nav-link.active` — Lunar Dust text-shadow glow effect instead of color change
  - `.card` — full-opacity dust border for better contrast
  - Headings (h1–h3) — Title Case (not ALL CAPS) with cosmic sizing
  - Footer — logo-left + secondary-nav-right layout matching design spec
- **Auth tabs** (`.auth-tab*` in `index.css`) — Tab switcher for Login/Signup forms with bottom-border indicators and uppercase labels
- **Feature component styling** (`index.css`):
  - `.wager-widget*` — bet form, odds display, and status indicators (~100 lines)
  - `.betting-widget*, .bet-history*` — bet placement and wager ledger with shimmer skeleton loading (~150 lines)
  - `.voting-page*, .focus-card*` — focus voting interface with spend controls (~100 lines)
  - `.training-page*, .clicker-widget*` — XP clicker and progress stats (~80 lines)
  - `.account-menu*` — user dropdown menu styling (~40 lines)
- **Account menu** — replaced 100+ lines of inline styles with `.account-menu-*` CSS classes; maintains dropdown animation and IC balance display
- **Component library** — Reusable React components in `features/design-system/components/` (Button, Card, Input, Badge, etc.) with prop-driven theming.
- **Unified page layouts** — All pages share consistent `.page-hero` (100px desktop / 70px mobile, centered H1) and `.section-nav` (◄ SECTION NAME ► arrow headings) styling. Detail pages use `.page-top` utility (same vertical start as `.page-hero` without text-align: center) for left-aligned headers. Voting and Training pages now have page-hero sections matching all other routes.
- **MatchCard component** (`src/components/ui/MatchCard.jsx`) — Shared card component replacing duplicated variants across Home and Matches pages; supports in_progress / scheduled / completed statuses with momentum bars, tag badges, bet sliders, and live commentary feeds.

## Tech Stack

- **React 18** + **Vite 6** — frontend framework and build tool
- **React Router DOM 7** — client-side routing
- **Tailwind CSS 4** — styling
- **Supabase** — PostgreSQL database with row-level security
- **Anthropic SDK** (Claude Haiku 4.5) — AI commentary and Architect
- **TypeScript** (`strict: true`) — all new code is strictly typed
- **Vitest** — unit tests co-located with logic modules (80%+ coverage target)
- **GitHub Pages** — hosting via GitHub Actions

## Deployment

Deploys automatically to GitHub Pages on push to `main`/`master`. Supabase credentials are injected as environment variables in the GitHub Actions build step — if you fork this project, update `.github/workflows/deploy.yml` with your own credentials.
