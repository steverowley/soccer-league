# ISL design directions (proposal, not yet adopted)

Three ways the design language could evolve, previewable on the live site.
Nothing here is the shipped system: `docs/design-language.md` still is, and
every fan sees it. These are for the owner to choose between by using them.

## How to preview

Open any page with `?direction=` and the whole site switches, with its real
data, in this browser only:

- `https://soccer-league-one.vercel.app/?direction=terminal` (A)
- `https://soccer-league-one.vercel.app/?direction=broadcast` (B)
- `https://soccer-league-one.vercel.app/?direction=almanac` (C)
- `?direction=off` returns to the current look and forgets the preview.

The choice is remembered while you browse. A small switcher in the bottom
left corner flips between directions from any page.

Mechanism: every type role (face, case, weight, size, tracking) and the card
surface are CSS variables in `src/shared/design/tokens.css`. Their `:root`
values are today's look (held by `tokens.test.ts`); each direction is a block
of overrides under `html[data-direction="..."]`, switched by
`src/shared/design/direction.ts`. The extra faces load from Google Fonts only
while a preview is on, and the switcher is a lazy chunk fans never download.

## What every direction keeps

Galactic Abyss and Lunar Dust, the three text tones, red for live, purple for
the Architect and focus, the one orange action, green for good outcomes, club
colours as data, the shield crest, square corners, and Space Mono for scores
or figures. These are the brand's recognition assets, not variables.

## A · Refined terminal (Preserve)

Space Grotesk, Space Mono's own proportional sibling from the same foundry,
carries titles, names, interface text and prose. Space Mono stays for scores.
Labels and headings go sentence case with no letter spacing; cards become a
tone step (`#161616`) instead of a hairline. The smallest step from today.

## B · Broadcast (Evolution, recommended)

The match-night graphics package. A condensed stadium-board face (Big
Shoulders Display) for titles, section headings, club names and scores, set
large; Space Grotesk for reading; Space Mono kept for the uppercase labels,
like a broadcast's lower thirds. Cards become a tone step (`#171717`). Fits
the game's own idea: matches are "paced like a wire-service broadcast".

Not yet in the preview (needs component work, after a choice): the score bug
behind live scores, the club-colour band on club headers, and the followed
club's row highlighted in tables.

## C · Almanac (Overhaul in voice)

The league as a 170-year record book. Newsreader serif for headings and
prose, sentence-case headings, Space Grotesk for the interface, Space Mono
for scores. Larger reading text (18 px). Elegant, but pulls toward literary
and away from sport.

## Decisions that come with the choice

- Uppercase tracked labels to sentence case: A yes, B keeps them as the
  broadcast lower-third voice, C keeps them small and tracked.
- Roman numeral section indexes: recommended to drop in every direction.

## After a choice

1. Adopt the direction's values as the `:root` defaults (one PR, before and
   after captures of every page at 390 and 1440), update
   `docs/design-language.md`, and delete the unchosen blocks and the preview
   switch.
2. Component work the direction needs (for B: score bug, club band, row
   highlight).
3. The primitives backlog on `/dev/components` (Stack, Text, Grid, ...).
4. Page layouts, one group per PR (club and match pages first).
