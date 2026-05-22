<pre>
══════════════════════════════════════════════════════════════════════════════
  THE  INTERGALACTIC  SOCCER  LEAGUE   ·   EST. MMXXXVII   ·   VOL. I
══════════════════════════════════════════════════════════════════════════════

     ·     *      ·          +                  ·         .          *
                             |
                         \   |   /                          ░
   .                      \  |  /                         ░▒▓░             ·
        *                  \ | /                          ▒▓██▒
                   ──────── ─+─ ────────             .   ░▓███▓░
   ·                       / | \                        ▒▓████▓░     *
                          /  |  \                       ▓██████▓░
       *                 /   |   \         .            ▓███████▓░       .
                             |                          ▓████████▓░
                             *                  ·       ░▓███████▓░   *
              ·                                          ▒▓█████▓▒
   *                                  .                   ░▓███▓░          ·
                                                           ░▒▓▒░
   .         *                ·                             ░░░         .


       S O C C E R ,   C H A R T E D   A C R O S S   T H E   S T A R S


──────────────────────────────────────────────────────────────────────────────
  RA 14ʰ 04ᵐ 12ˢ   ·   EPOCH MMXXXVII   ·   DEC −27° 19′   ·   LIVE
──────────────────────────────────────────────────────────────────────────────
</pre>

# Intergalactic Soccer League

A Blaseball-inspired social experience browser game. AI-simulated soccer matches across a fictional solar-system league — place bets, watch cosmic chaos unfold, and vote with your credits to shape your club's future.

![React](https://img.shields.io/badge/React-18.3-blue) ![Vite](https://img.shields.io/badge/Vite-6.0-purple) ![Tailwind](https://img.shields.io/badge/Tailwind-4.2-teal) ![Claude](https://img.shields.io/badge/Claude-Haiku_4.5-orange) ![Supabase](https://img.shields.io/badge/Supabase-2.99-green)

---

## 🚧 Not ready to play yet

The ISL is still under construction. **Please don't try to clone or run this repo locally** — the game is meant to be experienced as a shared, persistent world with other fans, not as a single-player sandbox on your laptop. Half the magic is that the Cosmic Architect's lore accumulates across every match, every season, for everyone.

**When the league opens, it will live on its own website.** A link will be posted here once the gates are open. Until then, this repo is the construction site — feel free to peek, but the show isn't running yet.

---

## What is this?

**32 planetary clubs.** Four regional leagues — Rocky Inner, Gas/Ice Giant, Asteroid Belt, Kuiper Belt — from Mercury Runners FC to Scattered Disc FC Rangers.

**704 players, 32 managers, every match a story.** Matches play out as full 90-minute simulations with weather, momentum, injuries, VAR, and three commentators arguing in real time over what just happened.

**A Lovecraftian entity is loose in the universe.** The Cosmic Architect rewrites probability, seals fates, and occasionally tears holes in reality. Nobody in-world knows it exists. The fans only see the shape of its decisions in the news.

**You get 200 Intergalactic Credits when you sign up.** You bet them on matches, win or lose, and at season's end you and every other fan of your club pool what's left to vote on the club's future — sign a star, promote youth, upgrade the stadium, overhaul the tactics. The vote actually reshapes the team for next season.

**Nothing is explained.** No stat screens, no probability tables, no rulebooks. The world is treated like real life — you learn the league by watching it.

---

## What you'll find when it opens

- **A live league** — 28 fixtures per team per season, plus the Celestial Cup (top 3 per league, single-elimination) and the Solar Shield (4th–6th per league).
- **Three commentators** — Captain Vox (bombastic veteran), Nexus-7 (clinical AI analyst), Zara Bloom (ex-striker tactician), all running in parallel via Claude.
- **Two cosmic voices** — Balance and Chaos. Unnamed, uncredited. They interrupt the broadcast when something feels off. You'll learn to recognise them.
- **The Galaxy Dispatch** — a news feed of architect whispers, political shifts, geological events, economic tremors, and wager narratives. The world reacts to itself.
- **A training facility** — between matches, fans can click together to help individual players develop. Collective effort, geometric XP curve.
- **Idols** — a league-wide leaderboard of player adoration. The top 10 face double-weight votes when the cosmos chooses who to incinerate at season's end. Love is dangerous.
- **Cup brackets, league tables, squad pages, manager profiles** — every entity in the universe (players, managers, referees, journalists, pundits, bookies) has a page and a relationship graph.

---

## Project info

This is a TypeScript + React app talking to a Supabase backend, with a Node worker that simulates matches server-side and an edge function that ticks the galaxy forward every two hours.

- **Frontend** — React 18 + Vite 6, React Router 7, Tailwind 4, strict TypeScript everywhere
- **Backend** — Supabase (PostgreSQL with row-level security), 45 timestamped migrations
- **AI** — Anthropic SDK with Claude Haiku 4.5 for live commentary, manager dialogue, player thoughts, and Architect proclamations
- **Simulation** — A pure 90-minute match engine (13+ event types, planetary weather, 8 personality archetypes, manager AI mid-match), wrapped by a server-side worker that pre-computes events and persists them
- **Hosting** — currently deployed via GitHub Pages on push; this will move to a proper domain when the league opens
- **Tests** — Vitest (668+ tests), ESLint, Prettier, `tsc --noEmit` all gating CI
- **Issues** — tracked in-repo via [Beads](https://github.com/steveyegge/beads) (`bd ready`)

The four core ideas the codebase is organised around:

1. **Emergent storytelling over exposed mechanics.** The LLM layer always deepens narrative, never reveals numbers.
2. **Fan-driven collective agency.** Every feature feeds the shared social experience.
3. **The Architect is the soul.** It's the game's identity, not a feature. Every new lever extends it.
4. **Modular now, easy rewrites later.** Feature folders with hard boundaries, pure logic, event-bus side effects, generated types.

For the full design and engineering charter, see [`CLAUDE.md`](./CLAUDE.md). For contribution workflow (branches, commits, beads), see [`CONTRIBUTING.md`](./CONTRIBUTING.md). For the public roadmap, see [`ROADMAP.md`](./ROADMAP.md).

---

## Leagues

| League | Region |
|---|---|
| Rocky Inner League | Mercury, Venus, Earth, Mars (8 clubs) |
| Gas/Ice Giant League | Jupiter, Saturn, Uranus, Neptune (8 clubs) |
| Asteroid Belt League | Ceres, Vesta, Pallas, Hygiea and belt colonies (8 clubs) |
| Kuiper Belt League | Pluto, Eris, Haumea, Makemake, Sedna and the outer reaches (8 clubs) |

Top 3 per league qualify for the **Celestial Cup**. 4th–6th qualify for the **Solar Shield**. Single-elimination, standard interleaving seeds, top seeds only meet in the final.

---

## Status

**Construction site.** All core systems are wired (match sim, betting, voting, training, cups, architect lore, fan boost, Galaxy Dispatch, entity graph). What's left before public launch is operational polish — admin tooling, mobile refinement, performance audit, and the hosting move to a real domain.

When the league opens, a link will appear at the top of this README.

In the meantime: don't clone it, don't run it locally — just wait for the gates. It'll be worth it.
