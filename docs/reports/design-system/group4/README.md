# Design system, group 4: content pages

Page bodies of `/news`, `/idols`, `/leaderboards`, `/world`, `/seasons` and
`/seasons/:id` moved onto the design language (`docs/design-language.md`,
section 9, group 4), with the two shared pieces they render: the
relationship graph (also on character pages) and History & honours
(`LoreHistory`, also on club and league pages). Headers were already
unified in #725.

Captured from a local `vite preview` build at 390 px (full page) and 1440 px,
with `/api/db/*` answered from production's read cache. Each response was
fetched once (before pass, 31 requests) and replayed from disk for every
later pass, so both sides show the same data. Each width is captured in its
own tab: a background tab reports `visibilityState: hidden`, which pauses
the graph's simulation and would capture it unsettled. Images stay out of
git.

## Routes

| Route | Sample |
|---|---|
| news | `/news` |
| idols | `/idols` |
| leaderboards | `/leaderboards` |
| world | `/world` |
| seasons | `/seasons` |
| season | `/seasons/823e7bbb-499c-4376-8f20-ca55cba96111` |
| league (Roll of honour) | `/leagues/rocky-inner` |
| entity-pundit (graph) | `/entities/f83eb41c-9ddc-4b73-8383-e6b0c2196ccd` |

## Measurements (computed styles inside `main`, 390 px)

| Route | scrollWidth | text under 11 px | purple | red | orange (any) | green | crests |
|---|---|---|---|---|---|---|---|
| news | **531** / 390 | 0 / 0 | 6 / 11 | 3 / 0 | 1 / 0 | 0 / 0 | 0 / 0 |
| idols | **657** / 390 | 0 / 0 | 0 / 0 | 1 / 0 | 25 / 0 | 20 / 0 | 0 / 25 |
| leaderboards | 390 / 390 | 0 / 0 | 0 / 1 | 1 / 0 | 0 / 0 | 0 / 0 | 0 / 50 |
| world | 390 / 390 | **117** / 0 | 29 / 1 | 79 / 0 | 45 / 0 | 57 / 0 | 0 / 0 |
| seasons | 390 / 390 | 1 / 0 | 1 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| season | 390 / 390 | 0 / 0 | 1 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| league | 390 / 390 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 11 / 16 | 16 / 203 |
| entity-pundit | 390 / 390 | 14 / 0 | 5 / 1 | 4 / 0 | 11 / 0 | 54 / 0 | 0 / 0 |

Before / after. Colour counts are elements whose text, border, fill or
stroke uses the accent. What remains after the migration:

- **Purple**: on News, the Architect's own categories (Architect, Cosmic
  Disturbance, Cosmic Omens, Balance and Chaos whispers) as architect Tags,
  which is the spec's one exception for news categories. On World and the
  character page, the "Cosmic voice" glyph in the graph legend. On
  Leaderboards, one club crest whose club colour is purple (data).
- **Red**: none. The error states (shared `ErrorState`, "Signal lost") use
  it when a read fails, checked with every read failing.
- **Orange**: none inside `main` on any of these pages (the header's Sign up
  is the view's one primary action).
- **Green**: the league page's standings (top-three places and W tiles,
  `StandingsTable`, group 1). The extra five are the Roll of honour's
  crests of a green club.
- **Crests**: every club in the idol boards, the leaderboards and the
  honours tables now has one (203 on the league page includes the full
  season register inside its closed disclosure).

Font sizes at 390 px (px):

| Route | Before | After |
|---|---|---|
| news | 11/12/13/14/15/16/17/26/30 | 11/13/15/16/22/30 |
| idols | 11/12/13/14/15/16/18/20/30 | 11/13/15/16/30 |
| leaderboards | 11/13/15/16/30/40 | 11/13/15/16/22/30 |
| world | 9/10/11/12/13/15/16/20/22/30 | 11/13/15/16/30 |
| seasons | 10/11/12/15/18/30 | 11/13/15/16/30 |
| entity-pundit | 9/11/13/15/16/22/30 | 11/13/15/16/22/30 |

## Requests

One pass over all eight routes at both widths makes 70 read-cache requests
before and after (narratives 2, player_idol_score 12, wager_leaderboard 2,
seasons 10, entities 14, entity_relationships 20, matches 2, teams 2, entity
persona, snippets and memories 2 each): no loops.

## Guard

`scripts/designTokens.baseline.json`: 448 raw values in 40 files before,
333 in 32 files after. The six pages, `LoreHistory` and the relationship
graph files (`RelationshipGraph`, `KindGlyph`, `kindColor`) are in
`MIGRATED` at zero.
