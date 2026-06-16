# Intergalactic Soccer League — Design System

> A Blaseball-inspired, AI-simulated multiplayer soccer experience set across the
> solar system. Fans place stakes on cosmic matches, follow a roster of absurd
> orbital clubs, and vote on their club's permanent future while a single
> all-powerful "Cosmic Architect" rewrites the rules between heartbeats.

This repository is the brand + product design system for the **Intergalactic
Soccer League (ISL)**. It contains the brand voice, colour and type foundations,
real exported assets, ready-to-use CSS tokens, and high-fidelity UI-kit
recreations of the product's core screens.

---

## Sources

Everything here was reconstructed from materials the user provided:

- **Figma file** — `Soccer Game.fig` (mounted as a read-only virtual filesystem).
  - Page `Design-System` → frame `design system` (node `233:3000`) — the canonical
    style sheet: icons, fonts, colours, spacing, navigation, buttons, cards,
    space backgrounds, header sections, tables, footer.
  - Page `New-App-Pages` → frames `home` (node `229:1837`) and `leagues`
    (node `157:288` group) — the two designed product screens.
- **`uploads/ISL Logo.png`** — the full-colour primary badge (planet + ring + "ISL").
- **`uploads/design system.jpg`** — a flattened export of the Figma design-system
  frame, used for cross-checking.

> Note for future readers: the `.fig` is not bundled here. The exported assets,
> tokens and UI kits below are self-contained and need no Figma access.

---

## What ISL is (product context)

ISL is a spectator-and-participation product, not a game you "play" with a ball.
The simulation runs itself; **you** watch, stake, and vote.

- **The league structure.** Thirty-two clubs across **four orbital leagues** —
  *Rocky Inner League*, *Gas/Ice Giant League*, *Asteroid Belt League*, and
  *Kuiper Belt League*. Clubs are named for worlds and bodies (Earth United,
  Mars Rovers, Venus Inferno, Jupiter Royals, Ceres City FC, Pluto FC Wanderers…).
- **Live matches.** Matches sim in real time ("LIVE · 73'"), with a running score,
  a momentum/possession bar, and **two AI commentators** ("Zara Bloom — Colour
  Analyst", "Nexus-7 — AI Analyst") narrating in the booth.
- **Betting.** Users hold a balance of **Intergalactic Credits (ic)** and stake on
  outcomes, prop lines, and meta-events (e.g. "whether the Architect will manifest
  before the eightieth minute").
- **Voting.** Members can spend Credits on **end-of-cycle votes** that permanently
  alter their club. Outcomes are irreversible.
- **The Cosmic Architect.** A looming AI presence ("ARCHITECT — Elevated") that
  interferes with matches. Rendered in **Quantum Purple** glows throughout.
- **Time + place.** The world keeps its own calendar — *Season VII*, *Matchday XIV*,
  *Season cycle 014 / 030*, *EPOCH MMXXXVII*, *EST. SOLAR CYCLE 2401* — and labels
  things with astronomical coordinates (`RA 14ʰ 04ᵐ 12ˢ`, `DEC −27° 19′`).

### Products represented
1. **Marketing / web app** — the public site: hero, live match feed, "three steps
   to enter", league standings, footer. (Frames `home`, `leagues`.) This is the
   single product surface in scope, captured as the `web` UI kit.

---

## Content fundamentals (voice & tone)

The voice is **deadpan cosmic-bureaucratic**: clipped, technical, faintly ominous,
and very dry. It treats an absurd premise (soccer across the solar system, run by
an AI god) with the flat seriousness of an astronomical almanac or a transit
schedule. Think *NASA mission log meets a fatalistic sports ticker.*

- **Casing.** Two registers, used deliberately:
  - **UPPERCASE** for headlines and UI chrome — headings at every level, labels, nav,
    buttons, data, status — `SOCCER, CHARTED ACROSS THE STARS`, `LIVE NOW`,
    `BROWSE LEAGUES`, `MATCHDAY 14`, `CREATE ACCOUNT`. Hierarchy comes from size,
    never from fading text.
  - **Sentence case** for body prose and captions only. Prose is short and declarative.
- **Person.** Addresses the reader as **you** and commands them: *"Place your stake,
  vote on your club's future, and watch the void stare back."* Imperative mood is
  the house style for CTAs and instructions.
- **Numbers.** Two systems coexist. **Roman numerals** for seasons/epochs/indices
  (*Season VII, Matchday XIV, EPOCH MMXXXVII, I · II · III · IV*). **Arabic** for
  live data (scores `2 · 1`, table stats `14 10 2 2 +18`, version `v0.7.0`).
  Counts in prose are spelled out for effect: *"Thirty-two clubs… Five-hundred-twelve souls."*
- **Vocabulary.** A consistent invented lexicon — *the void, the Architect, orbital
  leagues, souls, Intergalactic Credits (ic), season cycle, the booth, dispatch,
  manifest, heat-death*. Soccer terms stay real (matchday, form, GD, prop lines).
- **Tone examples (verbatim):**
  - *"Thirty-two clubs across four orbital leagues. Five-hundred-twelve souls. One
    Cosmic Architect rewriting the rules between heartbeats."*
  - *"Matches in progress. Position updates every ninety seconds. Architect
    interference reflected in real time."*
  - *"One credential pair. Your handle persists across every season cycle and
    survives all but a complete heat-death."*
  - *"Affiliation is permanent. The club may transfer leagues, dissolve, or be
    erased from the record — but you cannot leave."*
  - *"Creating an account is easy. Escaping the league? Not so much."*
  - *"End-of-cycle votes… Costs Intergalactic Credits. Outcomes are permanent."*
- **Emoji:** never. The brand has no emoji. Texture comes from typography, Roman
  numerals, astronomical glyphs (`°`, `′`, `·`, `—`) and the monospace grid — not
  decoration.
- **Punctuation tics.** Middot `·` as a separator (`live · 73'`, `2 · 1`), em dashes
  for asides, the prime mark `'` for minutes. Sentences are short. Periods land hard.

---

## Visual foundations

The whole system is **monospace, hard-edged, and nearly monochrome** — a light
parchment-grey (`Lunar Dust #E3E0D5`) drawn on near-black (`Galactic Abyss
#111111`), as if the UI were printed in phosphor on the inside of a spacecraft.
Colour is rationed: it only appears to mean something (live = red, focus/Architect
= purple, action = orange, success = green).

- **Colour & palette.** See `colors_and_type.css` for the full token set.
  - Base: Lunar Dust on Galactic Abyss. Raised surfaces use Phobos Ash `#1F1F1F`.
  - Accents are functional, never decorative: **Solar Flare `#FF4F5E`** = LIVE /
    error; **Quantum Purple `#9A5CF4`** = focus / the Architect (always with a glow);
    **Astro Explorer `#FF6637`** = the primary call-to-action fill; **Terra Nova
    `#A5D6A7`** = confirmation. Pure **white `#FFFFFF`** is reserved for hard
    dividers and the logged-in nav outline.
  - Roughly 90% of every screen is just two colours. Accent area should stay small.
- **Typography.** A **single typeface — Space Mono** — carries the entire brand:
  H1 40 / H2 32 / H3 28 / body & labels 16, mostly **Bold**, with Regular for
  longer copy and Italic for commentary. There is no secondary face. Line height
  is tight — `100%` on headings and labels. No letter-spacing except a hair
  on eyebrows.
- **Layout.** A strict grid on an **8-pt rhythm** (8/16/24/32/64/84). 1920 canvas
  with **200px side gutters**, content max ~1520. Everything is rectilinear and
  aligned to the grid; sections are separated by hairline rules and generous
  64px gaps. Eyebrow → headline → body → divider is the repeating section pattern.
- **Borders & cards.** A "card" is **a 1px Lunar Dust hairline box** — no fill change,
  no shadow, no radius. Internal padding is 32px. Dividers are 1px Lunar Dust (or
  2px white in the footer). This hairline-box-on-black look is the single most
  defining motif.
- **Corner radius.** **Zero.** The system is square. The *only* round things are
  circular team avatars/badges and the 10px LIVE status dot (`border-radius: 50%`).
- **Backgrounds.** Full-bleed **space photography** — the real brand imagery is
  **high-contrast halftone black-and-white**: spacewalks, lunar surfaces, an
  astronaut saluting an *Earth United* flag, a match broadcast on the Moon. Deep
  blacks, blown highlights, a visible print-grain/halftone texture. Cool and
  desaturated to pure monochrome. Stored in `assets/img-*.png`. No
  gradients-as-decoration; no flat colour blocks beyond the two base tones.
  **Text never sits directly over an image** — pair copy beside or below the
  photo (as the hero does), never overlaid on it.
- **Shadows & glows.** No drop shadows for elevation. Instead, **glows** signal
  energy: a tight purple glow (`0 0 6px rgba(154,92,244,.8)`) on Architect/focus
  elements, a red bloom (`--isl-glow-live`) behind the live momentum bar that
  intensifies with possession, and a light glow on hovered tertiary links.
- **Hover / press states.** Buttons gain a **light glow** rather than tinting or
  inverting: the filled primary and the outlined secondary both keep their colours
  and pick up `glow-light` on hover; tertiary text links glow too. Active/selected nav uses a filled
  CTA chip. No scale-bounce; transitions are quick, linear fades (no playful
  easing — the brand is austere).
- **Transparency & blur.** Used sparingly — muted text via reduced-opacity Lunar
  Dust; no glassmorphism. Imagery is the only place real depth appears.
- **Data display.** League tables are dense monospace grids: index `| 01`, club,
  `P W D L GD`, a **FORM** strip of small bordered W/D/L cells, and `PTS`. Cup-place
  rows (top two) carry a Terra-Nova index; relegation rows a Solar-Flare index.
  Matches show big numeric scores split by
  a middot and a bordered momentum bar with a red fill + red bloom.

---

## Iconography

ISL is **almost icon-free by design** — it leans on type, Roman numerals, and a
couple of geometric primitives instead of an icon set.

- **The logo.** A single hero mark: the **ISL badge** — a ringed planet over a
  star-field inside a shield, with the "ISL" lockup. This full-colour badge
  (`assets/isl-logo-full.png`) is *the* logo and the only form used in product
  (nav, footer, brand moments). A monochrome shield silhouette
  (`assets/isl-logo.svg`, `fill: currentColor`) also ships for rare single-colour
  needs, but it is **not** the primary mark — prefer the full badge everywhere.
- **No icon font, no Lucide/Heroicons in the source.** The only repeated glyph is a
  tiny **right-pointing triangle** (a rotated `REGULAR_POLYGON`) used as the "more"
  arrow on tertiary links — *"VIEW ALL MATCHES ▸"*. It's drawn as a 12px SVG
  triangle, not an icon-font glyph. Recreated inline in the UI kit.
- **Status dot.** A 10px filled circle (Solar Flare) is the LIVE indicator.
- **Club crests.** Detailed circular/shield emblems — a planetary motif + the
  ISL tri-spoke star + a club lockup. Two real crests ship, extracted from the
  source: **Earth United** (`assets/crest-earth-united.png` — blue/green shield)
  and **Mars Rovers** (`assets/crest-mars-rovers.png` — red "MR" roundel), both on
  transparent backgrounds. The `Crest` component renders crest art when given an
  `img`, and falls back to a monogram circle for clubs whose art doesn't exist yet.
- **LIVE indicator.** Neutral hairline box + neutral uppercase label + a single
  red dot. Colour is rationed — the dot carries the meaning, not the whole chip.
- **Unicode as iconography.** The brand uses typographic glyphs where most products
  would use icons: `·` separators, `°` `′` for coordinates, `—` for asides,
  Roman numerals as section markers. Keep this — do **not** introduce a generic
  icon set, and **never** use emoji.

> If a future surface genuinely needs UI icons (settings, profile, etc.) and none
> exist in the brand, substitute a **thin, square-cut, monoline** set (e.g. Lucide
> at 1.5px stroke, sharp joints) to match the hairline aesthetic — and flag it.

---

## Index — what's in this folder

| Path | What it is |
|---|---|
| `README.md` | This file — brand context, voice, visual foundations, iconography. |
| `Design System.html` | **The styleguide front door** — one polished page presenting foundations, colour, type, components, iconography & assets in ISL's own aesthetic. Open this first. |
| `colors_and_type.css` | The token layer: colour vars, type families/scale, spacing, glows + semantic classes. **Import this first.** |
| `isl-pages.css` | Shared page shell (nav, header, buttons, crest, form-strip, footer) used by the screen pages below. Import after `colors_and_type.css`. |
| `SKILL.md` | Agent-Skill manifest so this system can be used as a Claude Skill. |
| `Voting.html` · `Teams.html` · `Matches.html` · `World.html` · `Match.html` · `Club.html` · `Dispatch.html` · `Idols.html` | **Worked example screens**, each built entirely from the system's tokens + components (`isl-pages.css` shell) and registered as starting points. Voting (allocate credits across irreversible decrees), Teams (club directory w/ league filter), Matches (matchday hub), World (interactive force-directed network graph of the whole ISL universe), Match (live match theatre — booth feed, event timeline, staking), Club (club dossier — squad table deep-links into World), Dispatch (the league news wire), Idols (pledge leaderboard). All cross-linked through a shared 8-link nav. |
| `assets/` | Real exported assets — the logo (`isl-logo-full.png`, plus a mono `isl-logo.svg`) and the brand's halftone B&W space imagery (`img-spacewalk.png`, `img-earth-united-flag.png`, `img-moon-broadcast.png`). |
| `preview/` | Small HTML specimen cards that populate the Design System tab (type, colour, spacing, components). |
| `ui_kits/web/` | High-fidelity, click-through recreation of the ISL web app — `index.html` plus modular JSX components. |

### UI kits
- **`ui_kits/web/`** — the ISL public web app. Home (hero, live match feed, steps to
  enter, standings) and the leagues directory, with working nav state, a live-ish
  match card, and the standings table. See its own `README.md`.

---

## Font substitution note

**None required.** The sole brand typeface — **Space Mono** — is **self-hosted**
from the uploaded files in `fonts/` (Regular / Italic / Bold / Bold-Italic),
wired via `@font-face` in `colors_and_type.css`. No CDN dependency.
If you ever need it elsewhere, the same family is also a free Google Font.
