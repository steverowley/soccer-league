# ISL design language

The one set of rules every page, component and feature follows. It codifies
the look the site already has (the most common pattern for each element, as
measured in the design review, issue #723) and fixes the parts that fail
readability. Where this file and `.claude/skills/isl-design/` disagree, this
file wins: that folder is the original brand kit; this is the shipped system.

Owner decisions (2026-10-27): codify what the site already does rather than
reverting to the original kit; red means live; body text is 15 px.

## 1. Principles

1. **One system, no local styling.** A page uses tokens and shared
   components. It never writes a raw font size, colour, opacity or letter
   spacing. A guard test enforces it.
2. **Colour means something or it is not there.** About 90% of every screen
   is Lunar Dust on Galactic Abyss. Each accent has exactly one job (section 4).
3. **Hierarchy comes from size and weight first, tone second.** Fewer, larger
   steps beat many small ones.
4. **Hard-edged and quiet.** Square corners, 1 px hairline boxes, no fills,
   no shadows. Glow is the only elevation, and only on hover and focus.
5. **Phone first.** Every token has a phone value; every component is checked
   at 390 px before desktop.

## 2. Type

One typeface: Space Mono (regular 400, bold 700, italic for quotes).

| Token | Desktop | Phone (< 600 px) | Use | Style |
|---|---|---|---|---|
| `display` | 56 | 40 | Home hero only | 700, uppercase, tracking 0.02em, leading 1.05 |
| `title` | 40 | 30 | Page title (the page's h1) | 700, uppercase, tracking 0.02em, leading 1.1 |
| `heading` | 28 | 22 | Section title (h2) | 700, uppercase, tracking 0.02em, leading 1.15 |
| `subheading` | 18 | 16 | Card title, club and player names in lists | 700, uppercase, tracking 0.02em, leading 1.25 |
| `score` | 48 | 36 | Scores and big numbers | 700, tabular figures, leading 1 |
| `body` | 15 | 15 | Prose: descriptions, articles, commentary | 400, sentence case, leading 1.6 |
| `small` | 13 | 13 | Data, table cells, secondary prose, captions | 400 (700 for emphasis), leading 1.5 |
| `label` | 11 | 11 | Eyebrows, kickers, meta, tags, buttons, table headers | 700, uppercase, tracking 0.12em, leading 1.4 |

Rules:
- 11 px is the floor. Nothing renders smaller.
- Two trackings only: 0.12em on uppercase `label` text, 0.02em on uppercase
  headings. Body and small text use none.
- Headings and interface chrome are uppercase, including names used as
  titles (player, manager, club, character pages). Prose, quotes, commentary
  and news headlines are sentence case: they are writing, not chrome.
- Numbers that line up (tables, scores, stats) use tabular figures.

## 3. Text tones

Three tones, all at least 4.5:1 on Galactic Abyss.

| Token | Value | Contrast | Use |
|---|---|---|---|
| `text` | `#E3E0D5` | 14.3:1 | Default: headings, body, values |
| `text-secondary` | `#A8A69E` | 7.7:1 | Labels, meta, captions, inactive tabs |
| `text-tertiary` | `#8F8D87` | 5.7:1 | Separators, timestamps, de-emphasised data |

Replaces the 17 tones in use today (`dust70`, `dust50`, `dustFaint` as text,
and every inline `rgba(227, 224, 213, x)`). 50% and 40% dust (4.3:1 and
3.2:1) are retired as text colours.

## 4. Colour by meaning

| Token | Value | Means | Allowed on | Never on |
|---|---|---|---|---|
| `bg` | `#111111` | Canvas | Page background | |
| `surface-raised` | `#1F1F1F` | Something you type into or that floats | Inputs, toasts, menus | Cards, panels |
| `line` | Dust at 18% | Structure | Card borders, dividers, table rules | Text |
| `line-faint` | Dust at 10% | Quiet structure | Row dividers inside tables | Text |
| `live` | `#FF4F5E` | Happening now, or went wrong | Live dot and badge, error messages, red cards | Categories, decoration, ranks |
| `architect` | `#9A5CF4` | The Cosmic Architect and the cosmic voices; keyboard focus | Architect panels, interventions, cosmic voice lines, focus ring | Links, labels, player pages |
| `action` | `#FF6637` | The primary thing to do on this view | One primary button per view, its hover glow | Repeated row buttons, labels |
| `success` | `#A5D6A7` | Good outcome | Wins, confirmations, qualification markers, positive change | Decoration |
| `card-yellow` | `#F5C518` | A yellow card | The yellow-card glyph only | Anything else |
| Club colour | per club (data) | That club | Its crest, its kit on the pitch | Text, borders, page chrome |

Commentators are told apart by name and role, not colour: Vox, Nexus-7 and
Zara use the text tones; Balance and Chaos (cosmic voices) use `architect`.
News categories are neutral tags, except Architect-related ones (`architect`).
`#FFD700`, `#4FC3F7`, `#64748B`, `#F59E0B`, `#5DE0A6` and any other value not
in this table are retired.

**Canvas palette.** The match viewer draws on a `<canvas>`, which cannot read
CSS variables, so it uses `canvasColor` from `tokens.ts`: literal values for
`text`, `bg` and `architect` (the figures, outlines and focus halo) plus the
pitch's own surround, mowing stripes, markings, shadows, fallback kits and
phosphor hair shades. Each is declared once more in `tokens.css`
(`--isl-pitch-*`) and a test holds the two equal. Canvas only: never page
chrome.

## 5. Space, shape, layout

- Spacing steps: 4, 8, 12, 16, 24, 32, 48, 64 px. Nothing else.
- Container: max 1248 px; side padding 16 px on phones, 24 px from 600 px.
- Page rhythm: page header, then 48 px (32 on phones) between sections.
- Cards: 1 px `line` border, no fill, padding 24 (16 on phones).
- Radius 0 everywhere. Round only: status dots, player avatars.
- Borders 1 px. 2 px only for the footer rule.
- Every page sits in a page shell: header, content, footer pinned to the
  bottom of the viewport on short pages.

## 6. Components (all in `src/shared/ui`)

One implementation each. The old duplicates are deleted: the
`components/Layout.tsx` set (`PrimaryButton`, `DustButton`, `FocusCTA`,
`COLORS`), page-local copies (`FilterChip`, `Card`, `SectionLabel`,
`Divider`, `RailPanel`, `HeroStat`, `ResultPill`, `StatusChip`, ...), the
admin console's own primitives (`PanelHeader`, `StatCell`, `AdminButton`,
`ActionToast`) and the early shared `Chip`, `Kicker`, `Pip`, `StatPair` and
`KeyValue`.

- **PageShell**: header, `main`, footer; footer sits at the bottom of short pages.
- **PageHeader**: the one page header. Props: `eyebrow` (the section of the
  site, e.g. "Clubs"), `title` (renders the h1), `subtitle?`, `back?`
  (BackLink), `crumbs?`, `crest?`, `meta?` (a row of StatBlocks or Tags),
  `actions?`. Index and detail pages use the same component; detail pages add
  back link, crest and meta. Bottom hairline. Every page has exactly one.
- **SectionHeader**: h2 for sections within a page. Props: `index` (Roman
  numeral, numbered I, II, III in page order), `label`, `title?`, `action?`.
- **Card**: hairline box. `tone`: default, `architect` (Architect content),
  `live` (a live match).
- **Button**: `primary` (action fill; one per view), `secondary` (hairline
  outline), `tertiary` (text with a ▸ marker). Uppercase `label` type.
  Minimum 44 px tall on touch.
- **Tag**: small hairline label for categories, filters and statuses.
  Selected state is a Lunar Dust fill with Abyss text. Tones: default,
  `architect`, `live`, `success`.
- **LiveBadge**: red dot + "Live · 37'" (neutral text, red dot), then
  "Full time". The only way live is shown.
- **BackLink**: one glyph and the destination, e.g. "◂ All clubs".
- **Breadcrumbs**: "Leagues / Rocky Inner / Earth United", `label` type.
- **Crest**: the club shield silhouette in the club colour; sizes 16, 24, 40,
  64. Used wherever a club is named in a list, table or header.
- **StatBlock**: label over value. Replaces HeroStat, StatPair, KeyValue.
- **DataTable** styles: `label` headers, `small` cells, `line-faint` rows,
  tabular numbers, a Crest beside club names.
- **EmptyState / LoadingState / ErrorState**: as today. Empty sections are
  hidden or say what will appear and when; never "(no snippets yet)".

## 7. Copy conventions that are part of the look

- Page eyebrows name the section of the site, never a number.
- Roman numerals index sections within a page, starting at I.
- The world calendar comes from data ("Season 1", "Matchday 3"). No
  hard-coded season labels, no real-world dates in fan text, no code terms
  (e.g. `bless_player`).
- Middot `·` separates items in a row; "/" separates breadcrumbs.
- Tied ranks show as "=1", not as several "01"s.

## 8. Enforcement

- `src/shared/design/tokens.css` defines the tokens as CSS custom properties,
  with phone values in one media query; `src/shared/design/tokens.ts` exposes
  the same names as typed style presets (`type.title`, `tone.secondary`, ...)
  for inline styles. Imported once in `main.tsx`.
- `scripts/designTokens.test.ts` scans `src/` (not tests or the token files)
  for raw font sizes, colour literals, Lunar Dust opacities and letter
  spacings. It is a hard zero: any raw value in any scanned file fails the
  suite. (It began as a ratchet against a per-file baseline while pages
  migrated group by group; the last group took every file to zero and the
  baseline and its script were deleted.) The only exclusions are the token
  files, generated database types and the club colours in
  `src/data/leagueData.ts` (data, not styling); a colour computed from
  interpolated channels (`rgb(${r},${g},${b})`) is arithmetic, not a raw
  value. A fixture in the test proves a new raw colour or size fails it.
- `src/shared/design/tokens.test.ts` holds `tokens.ts` to `tokens.css`:
  every `var()` the presets use is declared, and every canvas palette value
  equals its custom property.
- `src/pages/pageHeadings.test.ts` checks every page renders exactly one
  PageHeader (one h1), at runtime for pages with branches (MatchDetail).

## 9. Migration order

Each group is one PR with before and after screenshots at 390 and 1440 px.

1. Foundation: tokens, components, guard, PageShell; Home, Leagues, League detail, Matches.
2. Match: match detail (gains its h1), live views, booth, red live everywhere.
3. Clubs and people: Teams, club, player, manager, character pages.
4. Content: News, Idols, Leaderboards, World, Seasons, Season.
5. Account and static: Voting, Training, Wagers, Profile, Login, Welcome,
   Reset password, About, Privacy, Terms, Not found, Admin, What if. Then
   delete the old duplicates and take the guard to zero. (Done: 5a and 5b;
   the guard is a hard zero.)
