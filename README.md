# Intergalactic Soccer League

A Blaseball-inspired social experiment browser game. AI-simulated soccer matches across a fictional solar-system league — place bets, watch cosmic chaos unfold, and vote with your credits to shape your club's future.

![React](https://img.shields.io/badge/React-18.3-blue) ![Vite](https://img.shields.io/badge/Vite-6.0-purple) ![Tailwind](https://img.shields.io/badge/Tailwind-4.2-teal) ![Anthropic](https://img.shields.io/badge/Claude-Haiku_4.5-orange) ![Supabase](https://img.shields.io/badge/Supabase-2.99-green)

## Overview

32 planetary teams compete across 4 regional leagues — from the Rocky Inner League to the Kuiper Belt. Fans sign up, pick a favourite club, and earn Intergalactic Credits by betting on match outcomes. At season's end, fans pool their credits to vote on their club's direction for next season.

Matches run as full 90-minute simulations with live AI commentary from three distinct voices (Captain Vox, Nexus-7, Zara Bloom), plus a Lovecraftian Cosmic Architect who warps reality mid-match. The underlying mechanics are never explained — the world is treated like real life.

## Features

### Website
- Multi-page app with client-side routing and live Supabase data fetching
- **Home** (`/`) — League standings carousel and Galaxy Dispatch (real-time Architect narratives feed)
- **Leagues** (`/leagues`, `/leagues/:leagueId`) — All four regional leagues with live standings tables
- **Teams** (`/teams`, `/teams/:teamId`) — 32 teams grouped by league, with squad rosters and stats
- **Players** (`/players`, `/players/:playerId`) — All 512 players with jersey number sorting and profile pages
- **Matches** (`/matches`, `/matches/:matchId`) — Match schedule, live simulator, and per-fixture WagerWidget
- **Authenticated routes**:
  - **Profile** (`/profile`) — IC credit balance, team/player preference, personal BetHistory
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

### The Cosmic Architect
- Lovecraftian cosmic entity that shapes every match through four interference layers:
  - **Cosmic Edicts** — polarity/magnitude modifiers on match probability
  - **Intentions** — 12 directed-outcome types wired into player selection
  - **Sealed Fate** — prophecy-driven forced outcomes (goals, red cards, wonder saves)
  - **Interference Flags** — 10 reality-rewrite flags (gravityFlipped, voidCreature, eldritchPortal, etc.)
- Persistent lore accumulates across matches — rivalries, player arcs, season storylines
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
│   ├── gameEngine.js            # Core simulation: events, contests, player logic
│   ├── agents.js                # Claude AI commentary and Architect system
│   ├── simulateHelpers.js       # Chaos, sequences, late-game logic
│   ├── constants.js             # Enums, personalities, weather, formations
│   ├── features/                # Feature modules
│   │   ├── architect/           # Cosmic narrator and match interference
│   │   ├── auth/                # Authentication and user profiles
│   │   ├── betting/             # Wager system and odds engine
│   │   ├── design-system/       # Component library and theme tokens
│   │   ├── entities/            # Player, team, season data models
│   │   ├── finance/             # Fan boost and ticket revenue
│   │   ├── match/               # Match scheduling
│   │   ├── training/            # Player development clicker
│   │   └── voting/              # End-of-season focus voting
│   ├── shared/                  # Cross-feature infrastructure
│   │   ├── events/bus.ts        # Typed event bus (match.completed, wager.placed, …)
│   │   ├── supabase/            # Singleton client + React DI context
│   │   └── utils/               # Shared utilities
│   ├── pages/
│   │   ├── Home.jsx             # Landing page with standings and Galaxy Dispatch
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
