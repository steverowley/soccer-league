# ISL design directions (decided: B, Broadcast)

The record of how the current look was chosen. The shipped system is
`docs/design-language.md`; this file only explains the choice.

## The decision

The owner used all three directions on the live site with real data (an
opt-in `?direction=` preview, #754) and chose **B, Broadcast**, keeping two
things from before: uppercase tracked labels and Roman numeral section
indexes. Adopted in the PR that removed the preview switch.

## What was on the table

All three kept the brand's recognition assets: Galactic Abyss and Lunar
Dust, the three text tones, red for live, purple for the Architect and focus,
the one orange action, green for good outcomes, club colours as data, the
shield crest and square corners.

- **A · Refined terminal.** Space Grotesk for titles, names and prose, Space
  Mono kept for scores; sentence-case labels; tone-step cards. The smallest
  step.
- **B · Broadcast (chosen).** The match-night graphics package: a condensed
  stadium-board face (Big Shoulders Display) for headings, names and scores,
  set large; Space Grotesk for reading; Space Mono for the uppercase labels,
  like a broadcast's lower thirds; tone-step cards. Chosen because it fits the
  game's own idea (matches "paced like a wire-service broadcast") and reads
  best at arm's length on a phone.
- **C · Almanac.** A record-book serif (Newsreader) for headings and prose,
  sentence-case headings, larger reading text. Elegant, but literary rather
  than sport.

## Broadcast components (done)

The type swap alone did not give the direction's signature pieces; these
followed it: the ScoreBug behind featured and match scores, the club-colour
band on the club page header (`PageHeader accent`), and the followed club's
row highlighted in standings. All are on `/dev/components`.

## Next

The primitives backlog on `/dev/components` (Stack, Text, Grid, ...) and
page layouts, one group per PR, club and match pages first.

## Trialling a future direction

The type roles (`--isl-font-*`, `--isl-case-*`, `--isl-weight-*`) and the card
surface (`--isl-card-fill`, `--isl-card-edge`) are tokens. To let the owner
try a new look on the live site, bring back an opt-in override block under
`html[data-direction="..."]` with a switch like #754's
(`src/shared/design/direction.ts`, removed when B was adopted; recover it
from git history) rather than judging from screenshots.
