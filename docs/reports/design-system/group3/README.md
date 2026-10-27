# Design system, group 3: clubs and people

Page bodies of `/teams`, `/teams/:id`, `/players/:id`, `/managers/:id` and
`/entities/:id` moved onto the design language (`docs/design-language.md`,
section 9, group 3). Headers were already unified in #725.

Captured from a local `vite preview` build at 390 px (full page) and 1440 px,
with `/api/db/*` answered from production's read cache. Each response was
fetched once (before pass) and replayed from disk for the after passes, so
both sides show the same data and production saw one capture pass. Images
stay out of git.

## Routes

| Route | Sample |
|---|---|
| teams | `/teams` |
| team | `/teams/earth-united` |
| player | `/players/14bc8bc6-68ca-4549-988f-333300a5fcc0` |
| manager | `/managers/4e09e73f-f198-4c42-bb20-b7ebd419e6b7` |
| entity-pundit | `/entities/f83eb41c-9ddc-4b73-8383-e6b0c2196ccd` |
| entity-stadium | `/entities/80000000-0000-0000-0000-000000000002` |

## Measurements (computed styles inside `main`, 390 px)

| Route | scrollWidth before / after | purple elements before / after | red elements before / after | orange fills before / after |
|---|---|---|---|---|
| teams | 390 / 390 | 1 / 0 | 30 / 0 | 0 / 0 |
| team | **426** / 390 | 1 / 1 | 2 / 2 | 2 / 1 |
| player | 390 / 390 | **14** / 1 | 3 / 3 | 1 / 1 |
| manager | 390 / 390 | 1 / 1 | 2 / 2 | 1 / 1 |
| entity-pundit | 390 / 390 | 1 / 1 | 2 / 2 | 1 / 1 |
| entity-stadium | 390 / 390 | 1 / 1 | 2 / 2 | 1 / 1 |

Every remaining purple, red and orange element after the migration is a
swatch in the legend of the shared relationship graph (`RelationshipGraph`,
also on World, group 4), plus on the player page one red-card glyph (red
cards are an allowed use of `live`). There are no orange buttons on any of
these pages now (the club page's "Watch & stake" was the only one; it is
secondary). The 14 text nodes under 11 px on the detail pages are the same
graph legend (9 px). The club page's remaining 14 px and 28 px text is the
shared History & honours block (`LoreHistory`, also on the league page).

Font sizes on `/teams` at 390 px: 11/12/14/15/16/18/20/30 px before, 11/15/16/30
px after (the token scale only).

## Requests

The club page re-requested its team and supporter count in a loop: the
static team record was rebuilt on every render and sat in two effects'
dependency lists. One capture of `/teams/earth-united` at both widths (about
eleven seconds of page time) made 24,341 read-cache requests (4,867 each for
`teams` and `team_supporter_count_v`), and the standings read was cancelled
before it landed, so the season record and the league place always showed
dashes. Memoised on the team id, a capture of all six routes at both widths
makes 146 requests in total and the record shows the real figures.

## Guard

`scripts/designTokens.baseline.json`: 532 raw values in 45 files before,
448 in 40 files after. Teams, TeamDetail, PlayerDetail, ManagerDetail,
EntityDetail and the new shared pieces (FormStrip, DataTable, FactList) are
in `MIGRATED` at zero.
