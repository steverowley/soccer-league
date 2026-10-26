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
