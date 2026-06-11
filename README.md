# Intergalactic Soccer League

A Blaseball-inspired social experience browser game. AI-simulated soccer matches across a fictional solar-system league — place bets, watch cosmic chaos unfold, and vote with your credits to shape your club's future.

![React](https://img.shields.io/badge/React-18.3-blue) ![Vite](https://img.shields.io/badge/Vite-6.4-purple) ![Tailwind](https://img.shields.io/badge/Tailwind-4.2-teal) ![Claude](https://img.shields.io/badge/Claude-Sonnet_4.6_%2B_Haiku_4.5-orange) ![Supabase](https://img.shields.io/badge/Supabase-2.99-green)

---

## 🚧 Not ready to play yet

The ISL is still under construction. **Please don't try to clone or run this repo locally** — the game is meant to be experienced as a shared, persistent world with other fans, not as a single-player sandbox on your laptop. Half the magic is that the Cosmic Architect's lore accumulates across every match, every season, for everyone.

**When the league opens, it will live on its own website.** A link will be posted here once the gates are open. Until then, this repo is the construction site — feel free to peek, but the show isn't running yet.

---

## What is this?

**32 planetary clubs.** Four regional leagues — Rocky Inner, Gas/Ice Giant, Asteroid Belt, Kuiper Belt — from Mercury Runners FC to Scattered Disc FC Rangers.

**704 players, 32 managers, every match a story.** Matches play out as full 90-minute simulations. The engine is a deterministic, agent-based physics sim: 22 players and a ball move through real pitch-space, and everything that happens — goals, saves, tackles, corners — emerges from where they are and what they do, with three commentators arguing in real time over what just happened.

**A Lovecraftian entity is loose in the universe.** The Cosmic Architect rewrites probability, seals fates, and occasionally tears holes in reality. Nobody in-world knows it exists. The fans only see the shape of its decisions in the news.

**You get 200 Intergalactic Credits when you sign up.** You bet them on matches, win or lose, and at season's end you and every other fan of your club pool what's left to vote on the club's future — sign a star, promote youth, upgrade the stadium, overhaul the tactics. The vote actually reshapes the team for next season.

**Nothing is explained.** No stat screens, no probability tables, no rulebooks. The world is treated like real life — you learn the league by watching it.

---

## What you'll find when it opens

- **A live league** — 28 fixtures per team per season, plus the Celestial Cup (top 3 per league, single-elimination) and the Solar Shield (4th–6th per league).
- **Three commentators** — Captain Vox (bombastic veteran), Nexus-7 (clinical AI analyst), Zara Bloom (ex-striker tactician), all running via Claude.
- **Two cosmic voices** — Balance and Chaos. Unnamed, uncredited. They interrupt the broadcast when something feels off. You'll learn to recognise them.
- **The Galaxy Dispatch** — a news feed of architect whispers, political shifts, geological events, economic tremors, and wager narratives. The world reacts to itself.
- **A 2D pitch view** — because matches are simulated in real pitch-space, you can watch the dots move: a live-ish replay of where everyone was, synced to the commentary clock.
- **A training facility** — between matches, fans can click together to help individual players develop. Collective effort, geometric XP curve.
- **Idols** — a league-wide leaderboard of player adoration. The top 10 face double-weight votes when the cosmos chooses who to incinerate at season's end. Love is dangerous.
- **Cup brackets, league tables, squad pages, manager profiles** — every entity in the universe (players, managers, referees, journalists, pundits, bookies) has a page and a relationship graph.

---

## Project info

This is a TypeScript + React app talking to a Supabase backend, with Deno edge functions that simulate matches server-side and tick the galaxy forward on a schedule.

- **Frontend** — React 18.3 + Vite 6.4, React Router 7, Tailwind 4, strict TypeScript 6. ~28 routes, all lazy-loaded, with per-route error boundaries.
- **Backend** — Supabase (PostgreSQL with row-level security), 73 timestamped migrations, 40 tables / 9 views / 13 RPCs. Generated types in `src/types/database.ts`.
- **AI** — Anthropic SDK. `claude-sonnet-4-6` for the in-match Architect and the daily drama beat; `claude-haiku-4-5-20251001` for the galaxy heartbeat, voice-library enrichment, and live commentary.
- **Simulation** — a deterministic, agent-based spatial match engine (Reynolds-style steering, geometry-derived events), run by the `match-worker` edge function and seeded from each match's UUID so a fixture always replays identically.
- **Hosting** — currently deployed via GitHub Pages on push; this will move to a proper domain when the league opens.
- **Tests** — Vitest (~1,340 tests). CI gates on `tsc --noEmit` + Vitest; ESLint and Prettier are wired (lint is informational for now while a cleanup backlog is cleared).
- **Issues** — tracked in **GitHub Issues** under milestone + priority labels; the phase-based execution plan lives in [`ROADMAP.md`](./ROADMAP.md).

The four core ideas the codebase is organised around:

1. **Emergent storytelling over exposed mechanics.** The LLM layer always deepens narrative, never reveals numbers.
2. **Fan-driven collective agency.** Every feature feeds the shared social experience.
3. **The Architect is the soul.** It's the game's identity, not a feature. Every new lever extends it.
4. **Modular now, easy rewrites later.** Feature folders with hard boundaries, pure logic, event-bus side effects, generated types.

For the full design and engineering charter, see [`CLAUDE.md`](./CLAUDE.md). For contribution workflow (branches, commits, issues), see [`CONTRIBUTING.md`](./CONTRIBUTING.md). For the roadmap, see [`ROADMAP.md`](./ROADMAP.md).

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

**Construction site.** All core systems are wired (spatial match sim + 2D viewer, betting, voting, training, cups, architect lore, fan support, Galaxy Dispatch, entity graph, notifications, admin). What's left before public launch: making the season loop perpetual (automatic rollover + cup completion), finishing the first-fan onboarding, surfacing the Architect live in matches, and the hosting move to a real domain — the full plan lives in [`ROADMAP.md`](./ROADMAP.md).

When the league opens, a link will appear at the top of this README. In the meantime: don't clone it, don't run it locally — just wait for the gates. It'll be worth it.

---

## License

Proprietary — all rights reserved. This repository is published for viewing only; it is not licensed for reuse, redistribution, or running your own instance.
