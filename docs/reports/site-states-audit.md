# Site states audit (2026-10-26)

What every page shows a fan when (a) no season exists, (b) a Supabase request
errors, (c) a request hangs, (d) data is present.

## Method

- Routes: `src/main.tsx` (29 routes). Reads: every `get*/fetch*/list*` call
  and inline `.from()` in `src/pages/*.tsx`.
- Rendered in real Chrome (taste-skill CDP driver) at 390 px against
  production, which since the 2026-10-26 reset has no seasons, competitions
  or matches (state a).
- (b) and (c) were produced with the CDP `Fetch` domain on production:
  `error` fails every `*.supabase.co*` request with `ConnectionRefused`;
  `hang` pauses every such request and never answers it (what the fan saw
  during the outage). Read after 5 s, 13 s and 20 s.
- supabase-js retries a refused GET with backoff, so an `error` looks like a
  `hang` for roughly the first 10 to 15 s and only then reaches the page's
  error branch, if it has one.
- (d) is from reading the code (no season data exists to render today).
- Tools: `scripts/site-states-capture.mjs` (screenshots plus visible text per
  route and mode) and `scripts/site-states-text.mjs`.

## Before (production at b55dcff)

| Page | Supabase reads | (a) no season | (b) error | (c) hang | (d) data |
|---|---|---|---|---|---|
| `/` Home | getLiveMatches, getUpcomingMatches, getActiveSeason (swallows errors as null), fetchLeagueStandings | Hero kicker "SEASON — • LIVE NOW", "00 Active matches", "Watch live match" CTA; "In Progress" panel "No match in progress"; Rocky Inner table of eight clubs on 0 points with "Top of the table after fourteen matchdays" | after about 15 s a "Signal lost" banner with Retry, but the hero still says LIVE NOW and the table section is a bare header; standings error only goes to the console | "SEASON — • LIVE NOW" forever, empty live panel, header-only table, no message ever | live card or next fixture, real table |
| `/matches` Fixtures | getLiveMatches, getUpcomingMatches, completed matches (inline) | "LIVE NOW 0" section heading, three empty sections | "Loading fixtures..." for about 15 s, then "Fixture data unavailable" (no retry) | "Loading fixtures..." forever | sections by status |
| `/matches/:id` | getMatch (`.single()`), events, positions, duration, watcher count | an unknown id reads "Match data unavailable" (the not-found error is treated as an outage) | "Loading match..." then "Match data unavailable", no retry | "Loading match..." forever | scoreboard, theatre, stats |
| `/leagues` | fetchLeagueStandingsResult x4 | "Current leaders 01 ... 0 pts" for every league | per-card loading at 5 s (not re-read later) | per-card loading forever | top three per league |
| `/leagues/:id` | fetchLeagueStandings | full table of eight clubs on 0 | no message at 20 s: description and clubs render, the table area stays empty | the same | full table |
| `/teams` | fetchLeagueStandings x4 (static roster from `leagueData.ts`) | renders from static data; fine | fine (static) | fine (static) | fine |
| `/teams/:id` | getTeam, getEntityProfile, fetchLeagueStandings, getUpcomingMatches, supporter count | "III League position, 0 played, 0 won..." (a position with no games) | "—" in every stat, sections silently empty | "—" forever, "Loading" in sections | real stats |
| `/leaderboards` | getWagerLeaderboard, getIdolBoard | bankroll table "01 rowley 0 0"; idol board of 0 scores ranked "02" | bankroll says "No wagers settled yet. Be the first." (an error presented as empty); idol board "unavailable" | blank tables forever | ranked boards |
| `/seasons` | listAllSeasons (swallows errors as []) | "The void offers no record of past seasons." | the same empty message (error presented as empty) | "Reading the cosmic ledger..." forever | season list |
| `/seasons/:id` | getSeasonSummary | not reachable without a season | not rendered (no season id exists) | not rendered | season detail |
| `/news` | getRecentNarratives | "No narratives yet" | "Dispatch unavailable" after about 15 s | loading forever | feed |
| `/idols` | getIdolBoard | board of 0 scores ranked "02" | "The idol board is unavailable" | blank board forever | ranked board |
| `/players/:id` | getPlayer, idol rank, recent matches, narratives, entity profile | **crashes**: "This page misfired: Cannot read properties of undefined (reading 'toLocaleString')" | blank page with only section numerals | blank page forever | profile |
| `/managers/:id` | getManager | fine | "Loading manager..." at 5 s | "Loading manager..." forever | profile |
| `/entities/:id` | entities, persona, memories, snippets | fine | "Loading..." and "Plotting connections..." forever | the same | dossier |
| `/world` | listEntities | fine | "Nothing found for this filter" (error presented as empty) | loading forever | atlas |
| `/voting`, `/training`, `/wagers`, `/profile` | auth gated; season, focus, tally and wager reads after sign in | sign-in prompt (signed out) | sign-in prompt | sign-in prompt | not audited signed in (no credentials) |
| `/login`, `/about`, `/privacy`, `/terms`, `/welcome`, `/reset-password` | none before submit | static | static | static | static |
| `/admin`, `/admin/what-if` | admin only | not audited | not audited | not audited | not audited |

### Findings

1. No page has a request timeout. A hung request is an endless spinner or a
   page that quietly renders nothing; this is what fans saw during the outage.
2. Several reads swallow errors and return empty values
   (`getActiveSeason`, `listAllSeasons`, the wager board, `listEntities`), so an
   outage is shown as "nothing here yet". The page cannot tell the two apart.
3. "LIVE NOW" on Home is a hard-coded string, shown whatever the data says.
4. With no season the site paints zero-point tables ("after fourteen
   matchdays"), a "LIVE NOW 0" section and a league position for a team that
   has played no games.
5. Each page hand-rolls its own loading and error copy; most have no retry.
6. Match page (from the owner's screenshot of a finished match at 390 px): the
   away name is clipped, the score wraps to "1 . 5" on three lines, the ground
   reads "Unknown Ground" (`matches.stadium` is never written by any
   producer, so the fallback always shows) and a stray "Mvp." line appears at
   91' (the worker appends an `mvp` event with `payload.player` and no prose:
   `supabase/functions/match-worker/index.ts:904-910`; the page then renders
   the bare type label).
7. `/players/:id` crashes on any player with no recorded stats.
8. An unknown match id is reported as "data unavailable" because `getMatch`
   uses `.single()`, which errors on zero rows.

## After

See the "After" table appended by the fix commits below.
