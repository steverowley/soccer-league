// ── shared/readCache/allowList.ts ───────────────────────────────────────────
// The single list of database resources fans may read through the read cache
// (docs/read-cache.md).  Two consumers share it so they can never disagree:
//
//   1. The Vercel function api/db.mjs (bundled from readCacheFunction.ts),
//      which forwards GET/HEAD for these resources only and answers 404 for
//      anything else.
//   2. publicReadSplit.test.ts, which fails when an api function reads one of
//      these resources through the direct client without a recorded reason,
//      or reads anything else through the proxy client.
//
// WHAT BELONGS HERE
//   A table or view whose rows are the same for every visitor (RLS
//   `USING (true)` or a view granted to anon), read on a page an anonymous
//   visitor can open.  Never anything filtered by the current user, never a
//   table only the service role can read.  The proxy never forwards a user's
//   JWT, so a personal resource here would at worst return the anonymous view
//   of it; keeping it off the list keeps the intent obvious.
//
// HOW THE TTLS WERE CHOSEN
//   They follow how fast the data changes (docs/read-cache.md section 1):
//   near-static catalogue data for minutes, fixtures/standings/finished
//   matches for about a minute, live match data for about ten seconds.
//   `staleWhileRevalidate` lets the CDN answer instantly with the previous
//   copy while one request refreshes it; `staleIfError` lets it keep serving
//   the last good copy when the database is down (Vercel honours both, see
//   the doc's "As built" section).  No dependencies: this file is bundled into
//   the Vercel function.

/** Cache policy for one resource, in seconds. */
export interface ReadCachePolicy {
  /** How long the CDN treats a 200 as fresh (`s-maxage`). */
  readonly ttl: number;
  /** How long after that the CDN may serve it stale while it refreshes. */
  readonly staleWhileRevalidate: number;
  /** How long the CDN may serve the last good copy while the origin errors. */
  readonly staleIfError: number;
  /** Why this resource is public and why this TTL (shown in the doc). */
  readonly why: string;
}

/** One day: how long a stale copy may stand in for an unreachable database. */
const DAY = 86_400;

/** Rarely changing catalogue data: teams, people, lore. */
const STATIC = { ttl: 300, staleWhileRevalidate: 3_600, staleIfError: DAY } as const;
/** Fixtures, standings, finished matches, boards: about a minute. */
const MINUTE = { ttl: 60, staleWhileRevalidate: 600, staleIfError: DAY } as const;
/** Match rows: status flips at kickoff and full time, so a bit tighter. */
const MATCH = { ttl: 30, staleWhileRevalidate: 300, staleIfError: DAY } as const;
/** Live match data polled by open match pages. */
const LIVE = { ttl: 10, staleWhileRevalidate: 60, staleIfError: DAY } as const;

/**
 * Every resource the read cache serves, with its cache policy.  Keyed by the
 * PostgREST resource name (the path segment after /rest/v1/).
 */
export const READ_CACHE_ALLOW_LIST: Readonly<Record<string, ReadCachePolicy>> = Object.freeze({
  // ── Near-static catalogue ────────────────────────────────────────────────
  teams:                  { ...STATIC, why: 'Club pages, standings and fixture lists; edited by migrations and season rollover only.' },
  players:                { ...STATIC, why: 'Squads and player pages; ratings move with training and elections, minutes of lag is invisible.' },
  managers:               { ...STATIC, why: 'Manager pages; changes only at season rollover.' },
  entities:               { ...STATIC, why: 'World, entity, player and team profile pages; seeded lore.' },
  entity_traits:          { ...STATIC, why: 'Manager page traits; seeded.' },
  entity_relationships:   { ...STATIC, why: 'World relationship graph; changes with narrative events, not per second.' },
  entity_persona:         { ...STATIC, why: 'Entity pages and the viewer thoughts panel; written by seeding and elections.' },
  entity_snippets:        { ...STATIC, why: 'Entity pages and the viewer thoughts panel; seeded voice snippets.' },
  entity_memories:        { ...STATIC, why: 'Entity page memory list; grows a few rows per match.' },
  competitions:           { ...STATIC, why: 'Match duration and season lookups; created at season rollover.' },
  season_config:          { ...STATIC, why: 'Match duration lookup; written at season rollover.' },
  team_supporter_count_v: { ...STATIC, why: 'Supporter count on club pages; moves when a fan picks a club.' },

  // ── About a minute ───────────────────────────────────────────────────────
  seasons:                { ...MINUTE, why: 'Season list, season pages and the season phase banner; status changes a few times a season.' },
  match_player_stats:     { ...MINUTE, why: 'Player pages; written once per finished match.' },
  match_lineups:          { ...MINUTE, why: 'Player recent matches; written once per match.' },
  narratives:             { ...MINUTE, why: 'News feed and player stories; a few rows per match.' },
  player_idol_score:      { ...MINUTE, why: 'Idol board and player rank; aggregate view.' },
  match_odds:             { ...MINUTE, why: 'Odds on the wager widget; computed before kickoff.' },
  wager_leaderboard:      { ...MINUTE, why: 'Public leaderboard view (aggregated, no personal rows).' },
  active_watchers_v:      { ...MINUTE, why: 'Cosmos-wide watcher count on match pages; the page polls it every 60 s.' },

  // ── Match state and live data ────────────────────────────────────────────
  matches:                { ...MATCH,  why: 'Fixtures, results, live list and match pages; status flips at kickoff and full time.' },
  match_events:           { ...LIVE,   why: 'Live feed and mini pitches, polled every 15 s while a match is live.' },
});

/** True when `resource` is served by the read cache. */
export function isReadCacheResource(resource: string): boolean {
  return Object.prototype.hasOwnProperty.call(READ_CACHE_ALLOW_LIST, resource);
}

/** The Cache-Control value for a 200 from `resource`. */
export function cacheControlFor(policy: ReadCachePolicy): string {
  return (
    `public, max-age=0, s-maxage=${policy.ttl}, ` +
    `stale-while-revalidate=${policy.staleWhileRevalidate}, stale-if-error=${policy.staleIfError}`
  );
}

/**
 * Request headers the proxy forwards to PostgREST.  Everything else is
 * dropped, above all `Authorization` (a user's JWT must never reach a cached
 * response) and `Cookie`.  `prefer` is further reduced to its count token.
 */
export const READ_CACHE_FORWARDED_HEADERS = ['accept', 'accept-profile', 'range', 'prefer'] as const;

/** The only schema the proxy serves. */
export const READ_CACHE_SCHEMA = 'public';
