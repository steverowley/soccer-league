# Read cache: fans read through Vercel, not straight from the database

> **Status:** approved 2026-10-26 (the owner chose to stay on the free tier).
> **Why:** the free Nano instance has a shared, burst-credit CPU. About 1,400 page reads in 15 minutes (2026-10-26 14:30 to 14:45) were enough to tip it over for hours (#712). Each page load currently fires several direct PostgREST queries, so database load grows with the number of fans. With a cache, it grows with the number of distinct queries per minute instead.

## 1. Design

- **A Vercel function proxy, cached on Vercel's CDN.** `GET /api/db/rest/v1/<table or view>?<query>` forwards to Supabase PostgREST with the public publishable key. Bodies for 200 responses are returned with `Cache-Control: public, s-maxage=<ttl>, stale-while-revalidate=<longer>`, so identical requests within the TTL never reach the function or the database. Errors are never cached.
- **Allow-list only.** Only public, anonymous read tables and views can be reached, and only with GET or HEAD, through an explicit list with a TTL per resource. Anything else returns 404. The proxy never forwards a user's JWT, so it can never cache personal data.
- **TTLs follow how fast the data changes:**
  - near-static (teams, players, managers, leagues, entities, lore, seasons): minutes
  - fixtures, standings and finished matches: about 60 s
  - live match data: about 10 to 15 s
- **Resilience:** where Vercel honours it, a stale copy is served while the database is unavailable. If it does not, document that.
- **Client:** a second Supabase client (`publicReadClient`) whose REST URL points at the proxy. Anonymous public reads move to it; authenticated and personal reads (profile, wagers, votes, admin) and every write stay on the direct client.
- **Live updates:** audit Realtime subscriptions and polling (`useMatchEventsBroadcast`, MatchDetail, Voting, Training, the admin panels). For public live views, prefer polling the cached proxy at a modest interval over Realtime `postgres_changes`, which loads the database once per subscriber. Keep broadcast-only channels if they do not touch Postgres.
- **Bundling:** like `api/simulate.mjs`, ship a committed esbuild bundle, with the extensionless-import rule from the skill.

## 2. Verification

- **Unit tests:** allow-list matching, TTL selection, headers (no caching on errors, no auth forwarding), and the client split (every public api module uses the proxy client, enforced by a test that scans imports).
- **After deploy:** the same URL fetched twice returns `x-vercel-cache: HIT` the second time. A burst of 500 identical requests produces at most a handful of PostgREST requests in the Supabase logs.
- **Page budget:** with a warm cache, one page load at 390 px makes zero direct Supabase REST calls for public data.

## 3. As built

### 3.1 Request path

```
browser (publicReadClient, base URL ${origin}/api/db)
  GET /api/db/rest/v1/<resource>?<query>        no Authorization, no apikey
    -> Vercel CDN: HIT inside the TTL, STALE while revalidating or while the origin errors
    -> vercel.json rewrite /api/db/rest/v1/:resource -> /api/db?__resource=:resource
    -> api/db.mjs (bundle of src/shared/readCache/, maxDuration 15 s)
    -> https://ddtpbipkqamuxnvupddc.supabase.co/rest/v1/<resource>?<query>   apikey = publishable key
```

- **Function:** `src/shared/readCache/readCacheFunction.ts`, bundled by `npm run build:api` into the committed `api/db.mjs` (same reason as `api/simulate.mjs`: with `"type": "module"` Vercel compiles functions file by file and cannot resolve extensionless imports). `readCacheBundle.test.ts` fails when the bundle is stale and runs the committed file against a local fake PostgREST.
- **Routing:** a project without a framework gets one function per file in `api/`, and Vercel's guidance for such projects is a single handler reached through rewrites. So the function is `api/db.mjs` and a rewrite placed before the SPA fallback sends `/api/db/rest/v1/:resource` to it, passing the resource as `__resource` (the original query string is passed through by the rewrite). The handler also accepts the original path if Vercel hands it the unrewritten URL, and strips `__resource` before forwarding. The SPA rewrite `/((?!api/).*)` already leaves `/api/*` alone. Anything with more path segments (for example `/rest/v1/rpc/x`) matches no rewrite and gets Vercel's 404.
- **Methods:** GET and HEAD only; everything else gets 405 with `no-store`, without touching the database.
- **Forwarded:** the query string byte for byte; `accept`, `accept-profile` (only `public`, anything else 400), `range`, and only the `count=` token of `prefer`. Never `Authorization`, cookies or client headers. The upstream always runs as anon with the publishable key in `apikey`, so a cached body can never contain one user's personal rows.
- **Returned:** the upstream status and body, `Content-Type`, `Content-Range` (counts), `Vary: Accept, Accept-Profile, Prefer` and `X-Read-Cache-Resource`. Upstream `Set-Cookie` is dropped.
- **Cache-Control:** a 200 gets `public, max-age=0, s-maxage=<ttl>, stale-while-revalidate=<swr>, stale-if-error=86400`; every other status (400, 404, 406 single-row miss, 206, 5xx, timeouts) gets `no-store`. The upstream has 8 s: a timeout answers 504, an unreachable upstream 502, both `no-store`.
- **Client:** `src/shared/supabase/publicReadClient.ts`. In a production build it points at `${window.location.origin}/api/db`; under `vite` (no `/api`) it talks to Supabase directly with the same header discipline plus the apikey. `VITE_READ_PROXY=off|on` overrides. It has no session (`persistSession`, `autoRefreshToken` and `detectSessionInUrl` off, so it can never consume the login or password-recovery hash meant for the main client), strips every header except the four above (Vercel never caches a request that carries `Authorization`, and supabase-js adds one to every request), and refuses non-GET/HEAD locally.

### 3.2 Allow-list

The single source is `src/shared/readCache/allowList.ts`, shared by the function and the split test. Every entry is world-readable (RLS `USING (true)` or a view granted to anon) and read on a page an anonymous visitor can open. stale-if-error is one day for all of them.

| Resource | TTL (s-maxage) | stale-while-revalidate | Why |
|---|---|---|---|
| `teams` | 300 s | 3600 s | Club pages, standings and fixture lists; edited by migrations and season rollover only. |
| `players` | 300 s | 3600 s | Squads and player pages; ratings move with training and elections, minutes of lag is invisible. |
| `managers` | 300 s | 3600 s | Manager pages; changes only at season rollover. |
| `entities` | 300 s | 3600 s | World, entity, player and team profile pages; seeded lore. |
| `entity_traits` | 300 s | 3600 s | Manager page traits; seeded. |
| `entity_relationships` | 300 s | 3600 s | World relationship graph; changes with narrative events, not per second. |
| `entity_persona` | 300 s | 3600 s | Entity pages and the viewer thoughts panel; written by seeding and elections. |
| `entity_snippets` | 300 s | 3600 s | Entity pages and the viewer thoughts panel; seeded voice snippets. |
| `entity_memories` | 300 s | 3600 s | Entity page memory list; grows a few rows per match. |
| `competitions` | 300 s | 3600 s | Match duration and season lookups; created at season rollover. |
| `season_config` | 300 s | 3600 s | Match duration lookup; written at season rollover. |
| `team_supporter_count_v` | 300 s | 3600 s | Supporter count on club pages; moves when a fan picks a club. |
| `seasons` | 60 s | 600 s | Season list, season pages and the season phase banner; status changes a few times a season. |
| `match_player_stats` | 60 s | 600 s | Player pages; written once per finished match. |
| `match_lineups` | 60 s | 600 s | Player recent matches; written once per match. |
| `narratives` | 60 s | 600 s | News feed and player stories; a few rows per match. |
| `player_idol_score` | 60 s | 600 s | Idol board and player rank; aggregate view. |
| `match_odds` | 60 s | 600 s | Odds on the wager widget; computed before kickoff. |
| `wager_leaderboard` | 60 s | 600 s | Public leaderboard view (aggregated, no personal rows). |
| `active_watchers_v` | 60 s | 600 s | Cosmos-wide watcher count on match pages; the page polls it every 60 s. |
| `matches` | 30 s | 300 s | Fixtures, results, live list and match pages; status flips at kickoff and full time. |
| `match_events` | 10 s | 60 s | Live feed and mini pitches, polled every 15 s while a match is live. |

`matches` sits between the fixture tier and the live tier because one table serves both: 30 s keeps a kickoff or full-time flip visible within half a minute.

**Deliberately not on the list:** `profiles`, `wagers`, `push_subscriptions`, `focus_votes` (personal, RLS "own rows"); `shadow_match_results` and `agent_runs` (service role only); `focus_options`, `focus_tally`, `focus_enacted` (read only by the signed-in Voting page, which re-reads the tally right after the user's own vote, so a cached tally would hide the vote); `player_training_log` (Training, signed in); `architect_lore`, `architect_interventions` (Architect pipeline and admin); `match_positions` and `match_position_rosters` (the replay path, which PR #714 moves to Storage; left untouched here).

**Embedding:** PostgREST resource embedding (`select=*,other_table(*)`) runs as anon with RLS, so it can only ever return what anon could read directly; the allow-list bounds which top-level queries the cache serves, not what anon may see.

### 3.3 The client split

Every read whose answer is the same for every visitor moved to `publicReadClient` (via `usePublicReadClient()` in components). `PublicReadClient` is a branded `Pick<IslSupabaseClient, 'from'>`, so TypeScript enforces the split at each call site in both directions: a public api function cannot be handed the direct client, and the proxy client cannot reach a function that writes, calls `.rpc()`, uses `.auth` or opens a channel.

Moved to the proxy: `features/match/api` (teams, matches, events, players, player stats, seasons except `getActiveSeason`, standings, idols board and rank, managers), `features/entities/api` (entities, relationships, chronicle, news narratives, profiles, referees), `features/agents/api` (personas, snippets, memories lists), `getActiveWatcherCount`, `getTeamSupporterCount`, `getMatchOdds`, `getWagerLeaderboard`, plus the page-level reads in `EntityDetail` and `Matches`.

Stayed direct (each listed with its reason in `DIRECT_PUBLIC_READS` in `publicReadSplit.test.ts`): admin panels and `/admin/what-if`; the signed-in Voting and Wagers pages; write pipelines that read then write (cup seeder, season rollover, enactment, election night, memory, referee and training narrative writers); the Architect pipeline; every write and every personal read.

`publicReadSplit.test.ts` scans `src/` with the TypeScript parser and fails when a proxy read touches anything off the allow-list, writes or filters by user; when a direct read of an allow-listed resource has no recorded reason; when an exception or allow-list entry goes stale; when anything subscribes to `postgres_changes`; or when a third Supabase client appears. It was checked against two deliberate regressions (a public function moved back to the direct client, a personal read moved onto the proxy) and failed on both.

### 3.4 Live updates: what moved off Realtime

| Live view | Before | After | Why |
|---|---|---|---|
| Match page live feed (`LiveCommentary` in `MatchDetail.tsx`) | Realtime `postgres_changes` on `match_events`, one channel per viewer, filtered by match | Poll `getMatchEvents` through the proxy every 15 s while the paced window is open; paused while the tab is hidden, immediate catch-up when shown | The worker publishes a match's events in one batch and the viewer reveals them by wall clock, so a 15 s poll loses nothing, and every viewer of a match shares one cached query per 10 s TTL. postgres_changes made the database do work per subscriber. |
| Matches list mini pitches (`useMatchEventLatest`) | One table-wide Realtime `postgres_changes` channel on `match_events` per visitor | One shared 15 s poll per page of `getLatestMatchEvent` (latest row per live match) through the proxy, paused while hidden | Same reason; the cost stays flat however many chips mount (the isl-a8i criterion), and identical URLs from every fan are one cached query. |
| Watcher count badge (`MatchDetail`) | 60 s poll, direct | 60 s poll through the proxy (`active_watchers_v`, 60 s TTL) | Same answer for everyone. |
| Replay frames (`getMatchPositions` 5 s poll until frames land) | direct | unchanged | Replay path; PR #714 moves replays to Storage. |
| `AuthProvider` (`onAuthStateChange`, presence heartbeat, login streak) | direct | unchanged | Auth events are not Postgres changes, and the heartbeat is a personal write. |
| `Voting.tsx`, `Training.tsx`, admin panels | no Realtime; direct reads | unchanged | Signed-in or admin views that need read-after-write freshness. |

The poller is `src/shared/hooks/useVisibleInterval.ts` (`startVisibleInterval` plus a hook); `subscribeToMatchEvents` was removed. After this change nothing in `src/` uses Realtime `postgres_changes`.

### 3.5 stale-if-error: the finding

Vercel's CDN documentation (Cache-Control headers, "stale-if-error", and the CDN cache page, checked 2026-10-26) states that the CDN supports `stale-if-error` for all responses: when revalidation hits an error (a 500, a network failure, a DNS error) it serves the stale copy for up to the stated time instead of the error, and it consumes the directive rather than passing it to the browser. `stale-while-revalidate` is also honoured, and a failed background revalidation surfaces as `x-vercel-cache: STALE` (reason "revalidation error") while the last good response keeps being served. So with a one-day `stale-if-error`, pages whose queries were cached before an outage keep rendering through it; queries nobody made before the outage still fail.

Other Vercel cache rules that shaped the design: the CDN only caches GET/HEAD requests with no `Authorization` and no `Range` header, responses with status 200 (also 404/410/30x, which the function marks `no-store`), no `Set-Cookie` and no `private`/`no-store`; it keys on `Accept` by default and honours `Vary` for the other headers; it strips `s-maxage` and `stale-while-revalidate` before the response reaches the browser; and the cache is per region and best effort.

### 3.6 Post-deploy verification (for the parent, after merge)

Do these only once the database answers again, and keep them gentle: the point of the change is fewer requests.

1. **Routing and headers.** After the production deploy of the merge commit:
   `curl -sI "https://soccer-league-one.vercel.app/api/db/rest/v1/teams?select=id&limit=1"`
   Expect 200, `x-read-cache-resource: teams`, `content-type: application/json...`. Repeat the same command: the second answer must say `x-vercel-cache: HIT` (or `STALE`). A 404 from Vercel (HTML) means the rewrite did not match; a JSON 404 `not in the read cache allow-list` means the resource was not resolved.
2. **Refusals.** `curl -s -o /dev/null -w "%{http_code}\n" .../api/db/rest/v1/profiles?select=id` gives 404; `curl -X POST ...teams` gives 405; both carry `cache-control: no-store`.
3. **Burst test, sized gently.** Pick a query nobody else makes so the first request is a MISS, then send 50 identical requests one after another:
   `U="https://soccer-league-one.vercel.app/api/db/rest/v1/teams?select=id,name&limit=2&order=name.asc"; for i in $(seq 50); do curl -s -o /dev/null -D - "$U" | grep -i '^x-vercel-cache'; done | sort | uniq -c`
   Expect about 1 MISS and 49 HIT.
4. **Read the Supabase logs.** With `mcp__supabase__query_logs`, count gateway requests for that query in the test window (edge_logs):
   ```sql
   select count(*) as n, r.method, r.path, r.search
   from edge_logs
     cross join unnest(metadata) as m
     cross join unnest(m.request) as r
   where r.path = '/rest/v1/teams' and r.search like '%limit=2%'
   group by r.method, r.path, r.search
   ```
   Expect n of 1 (a few at most if requests landed in different Vercel regions or revalidated). Fifty would mean the CDN is not caching: check the request carried no `Authorization`/`Range` and the response `Vary`.
5. **Page budget.** Open the home page and a match page at 390 px in a browser with DevTools open: public reads go to `/api/db/rest/v1/...` and none go to `ddtpbipkqamuxnvupddc.supabase.co/rest/v1/` (auth calls for a signed-in user still do). A second load shows `x-vercel-cache: HIT` on them. On a live match page, a `match_events` request appears every 15 s and stops while the tab is hidden; no websocket to `/realtime/v1` opens for a signed-out visitor.
6. **Rollback.** Revert the PR (or build with `VITE_READ_PROXY=off`, which sends public reads straight to Supabase again).
