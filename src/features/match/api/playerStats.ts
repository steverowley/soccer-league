// ── features/match/api/playerStats.ts ────────────────────────────────────────
// Supabase queries powering the per-player surfaces on /players/:playerId.
//
// WHAT THIS MODULE OWNS
//   • `getPlayerRecentMatches` — the player's last N appearances, sourced
//     from `match_lineups` (one row per starter, isl-pfm) and LEFT JOINED
//     to `match_player_stats` for the contribution columns.  Transformed
//     into the narrative-shaped `PlayerRecentMatch` (result W/D/L,
//     opponent name, home/away) the detail page renders.
//   • `getNarrativesMentioningPlayer` — narratives where the player's
//     `entity_id` appears in `entities_involved` (JSONB array contains).
//     Falls back to an empty list when the player has no linked entity
//     (legacy rows that pre-date the universal-agent migration).
//
// LAYER BOUNDARY
//   • No React, no direct Supabase singleton — every function takes an
//     injected `db: IslSupabaseClient` so tests pass a fake without
//     patching the module graph.
//   • Zod schemas validate every row at the boundary (CLAUDE.md
//     engineering principle #5).  Malformed rows are dropped with a
//     console warning rather than crashing the page.
//
// INVARIANT (Vision pillar #1, hidden mechanics)
//   • This module never reads or returns raw engine ratings
//     (attacking / defending / mental / athletic / technical).  Only
//     outcome stats (goals, assists, cards, minutes, rating) leak to
//     the UI — the engine inputs stay hidden.

import { z } from 'zod';

import type { IslSupabaseClient } from '@shared/supabase/client';

// ── Zod row schemas ──────────────────────────────────────────────────────────
// These mirror the columns we ask for in the SELECTs below.  We use
// `z.unknown().nullable()` for the relational sub-objects and narrow
// them with focused inner schemas so a half-joined row (e.g. the
// `matches` join missing because of an RLS-stripped column) gets
// dropped rather than crashing the .map() in the caller.

/** Inner `teams` row used for the opponent join. */
const TeamMiniSchema = z.object({
  id:   z.string(),
  name: z.string(),
}).nullable();

/** Inner `matches` row joined to a match_player_stats row. */
const MatchInnerSchema = z.object({
  id:             z.string(),
  competition_id: z.string(),
  scheduled_at:   z.string().nullable(),
  played_at:      z.string().nullable(),
  status:         z.string(),
  home_team_id:   z.string(),
  away_team_id:   z.string(),
  home_score:     z.number().nullable(),
  away_score:     z.number().nullable(),
  home_team:      TeamMiniSchema,
  away_team:      TeamMiniSchema,
});

/**
 * One nested `match_player_stats` row joined off a lineup row.  The
 * outer select sources the lineup from `match_lineups`, then LEFT
 * JOINs `match_player_stats` filtered by the same player_id so the
 * contribution columns come in alongside.  When the player took no
 * contribution stats, the nested array is empty and we render zeros.
 */
const NestedStatRowSchema = z.object({
  goals:          z.number(),
  assists:        z.number(),
  rating:         z.number().nullable(),
  yellow_cards:   z.number(),
  red_cards:      z.number(),
}).nullable();

/**
 * Raw row returned by the recent-matches SELECT (before transform).
 * Sourced from `match_lineups` (isl-pfm) so every starter has a row
 * even when they took no contribution stats.  The `match_player_stats`
 * row LEFT-JOINS in via the player_id filter for goals/assists/cards.
 */
const PlayerMatchRowSchema = z.object({
  match_id:       z.string(),
  team_id:        z.string(),
  minutes_played: z.number(),
  matches:        MatchInnerSchema,
  // PostgREST returns nested 1:N joins as arrays — at most one row
  // here because match_player_stats's PK is (match_id, player_id).
  match_player_stats: z.array(NestedStatRowSchema).optional().nullable(),
});

/** Narrative row returned by `getNarrativesMentioningPlayer`. */
const NarrativeRowSchema = z.object({
  id:                z.string(),
  kind:              z.string(),
  summary:           z.string(),
  source:            z.string(),
  created_at:        z.string(),
  entities_involved: z.array(z.string()).nullable(),
});

// ── Public types ─────────────────────────────────────────────────────────────

/**
 * One row of the Recent Matches section on the player detail page.
 *
 * Transformed from the raw match_player_stats + matches join so the UI
 * doesn't have to reason about "which team is the opponent" — the API
 * layer does that derivation once per row.
 */
export interface PlayerRecentMatch {
  matchId:       string;
  competitionId: string;
  /** ISO timestamp: played_at when known, else scheduled_at. */
  date:          string | null;
  /** Opponent team (the team that is NOT this player's team in the match). */
  opponent:      { id: string; name: string } | null;
  isHome:        boolean;
  /** W / D / L from the player's team perspective.  `null` if the match
   *  has no recorded scores yet (in_progress / scheduled rows that snuck
   *  in via the join — safe to surface as an em-dash in the UI). */
  result:        'W' | 'D' | 'L' | null;
  goals:         number;
  assists:       number;
  minutes:       number;
  /** Player rating 1–10 from the engine.  May be null for early-season
   *  matches before the rating subsystem ran on that game. */
  rating:        number | null;
  yellowCards:   number;
  redCards:      number;
}

/** Narrative row as the player detail page consumes it. */
export interface NarrativeMention {
  id:         string;
  kind:       string;
  summary:    string;
  source:     string;
  created_at: string;
}

// ── Recent matches ───────────────────────────────────────────────────────────

/**
 * Fetch the player's `limit` most recent appearances.
 *
 * SOURCE — match_lineups (isl-pfm): one row per starter regardless of
 * whether the player accrued a stat that match.  A LEFT JOIN to
 * `match_player_stats` filtered by the same player_id pulls in
 * contribution columns (goals / assists / cards / rating); when the
 * player took no contributions in that match, the nested array is
 * empty and the row reads as zeros.
 *
 * Sorted by the JOINED `matches.played_at` descending on the server,
 * then trimmed to `limit` rows.  We still do an in-memory pass for
 * the `played_at ?? scheduled_at` fallback used by the UI date, but
 * the server-side ORDER + LIMIT guarantees we never silently truncate
 * a high-volume player's most-recent rows to PostgREST's `max-rows`
 * cap (default 1000) before sorting.
 *
 * Malformed rows (the relational join silently dropped one side) are
 * filtered out and logged; the function returns at most `limit` valid
 * rows rather than blowing up.
 *
 * @param db        Injected Supabase client.
 * @param playerId  UUID of the player to fetch matches for.
 * @param limit     Max rows to return (default 10).
 * @returns         Transformed PlayerRecentMatch rows, newest first.
 *                  Empty array on error or for a player who has never
 *                  appeared in a completed match.
 */
export async function getPlayerRecentMatches(
  db:       IslSupabaseClient,
  playerId: string,
  limit:    number = 10,
): Promise<PlayerRecentMatch[]> {
  // SAFETY MARGIN: Some matches use `played_at`, others fall back to
  // `scheduled_at` (the row was created from a fixture but never
  // completed).  Server-side ORDER BY only lets us anchor on ONE column
  // — we pick `played_at desc` (NULLS LAST) since that's the canonical
  // chronological field.  Rows still in `scheduled` state sink to the
  // bottom and the in-memory tie-break below adjudicates the rest using
  // `played_at ?? scheduled_at`.  We over-fetch by 2× so the in-memory
  // re-sort doesn't lose newest rows to the join's secondary ordering.
  const dbFetchLimit = Math.max(limit * 2, limit + 5);

  const { data, error } = await db
    .from('match_lineups')
    .select(`
      match_id, team_id, minutes_played,
      matches:matches!inner(
        id, competition_id, scheduled_at, played_at, status,
        home_team_id, away_team_id, home_score, away_score,
        home_team:teams!matches_home_team_id_fkey(id, name),
        away_team:teams!matches_away_team_id_fkey(id, name)
      ),
      match_player_stats!left(goals, assists, rating, yellow_cards, red_cards)
    `)
    .eq('player_id', playerId)
    // Filter the joined stats rows by the same player_id so a match
    // where THIS player took no contributions still returns the lineup
    // row (with an empty nested array) instead of joining another
    // player's contribution row.
    .eq('match_player_stats.player_id', playerId)
    .order('played_at', {
      // Anchor on the parent `matches.played_at` so the join can sort
      // newest-first at the DB layer rather than relying on PostgREST's
      // arbitrary default ordering when the `max-rows` cap clips us.
      referencedTable: 'matches',
      ascending: false,
      nullsFirst: false,
    })
    .limit(dbFetchLimit);

  if (error) {
    console.warn('[getPlayerRecentMatches] failed:', error.message);
    return [];
  }

  const validated: PlayerRecentMatch[] = [];
  for (const row of data ?? []) {
    const parsed = PlayerMatchRowSchema.safeParse(row);
    if (!parsed.success) {
      console.warn('[getPlayerRecentMatches] dropped invalid row:', parsed.error.message);
      continue;
    }
    const r = parsed.data;
    const m = r.matches;
    // Pull the nested stat row (may be missing entirely for a quiet
    // appearance).  Default everything to zero so the UI renders a
    // tidy "appeared, took no stats" row instead of nulls.
    const stat = (r.match_player_stats?.[0]) ?? null;
    const isHome   = r.team_id === m.home_team_id;
    const opponent = isHome ? m.away_team : m.home_team;
    const myScore  = isHome ? m.home_score : m.away_score;
    const oppScore = isHome ? m.away_score : m.home_score;
    const result   =
      myScore == null || oppScore == null
        ? null
        : myScore > oppScore
          ? 'W'
          : myScore < oppScore
            ? 'L'
            : 'D';

    validated.push({
      matchId:       m.id,
      competitionId: m.competition_id,
      date:          m.played_at ?? m.scheduled_at,
      opponent,
      isHome,
      result,
      goals:         stat?.goals        ?? 0,
      assists:       stat?.assists      ?? 0,
      minutes:       r.minutes_played,
      rating:        stat?.rating       ?? null,
      yellowCards:   stat?.yellow_cards ?? 0,
      redCards:      stat?.red_cards    ?? 0,
    });
  }

  // Sort newest first.  Null dates sink to the end so unsimulated rows
  // never displace real appearances at the top of the list.
  validated.sort((a, b) => {
    if (a.date == null && b.date == null) return 0;
    if (a.date == null) return 1;
    if (b.date == null) return -1;
    return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
  });

  return validated.slice(0, limit);
}

// ── Narrative mentions ───────────────────────────────────────────────────────

/**
 * Fetch the `limit` most recent narratives that mention this player.
 *
 * Lookups happen in two hops:
 *   1) `players.entity_id` for the given playerId — narratives reference
 *      universal-agent entity UUIDs, not raw player IDs.  Players added
 *      before migration 0002 may have `entity_id = NULL`; those return
 *      an empty array (no false positives, no crash).
 *   2) `narratives` where `entities_involved` JSONB array contains the
 *      entity_id, ordered by `created_at DESC`.
 *
 * Two queries cost one extra round-trip but keep both the player and
 * narrative tables decoupled in the API surface — no joined view to
 * maintain, no schema cast.
 *
 * @param db        Injected Supabase client.
 * @param playerId  UUID of the player.
 * @param limit     Max rows to return (default 10).
 * @returns         Validated NarrativeMention rows, newest first.  Empty
 *                  when the player has no entity_id, or no narratives,
 *                  or any query fails.
 */
export async function getNarrativesMentioningPlayer(
  db:       IslSupabaseClient,
  playerId: string,
  limit:    number = 10,
): Promise<NarrativeMention[]> {
  // Step 1: resolve the player's entity_id.
  const { data: playerRow, error: playerErr } = await db
    .from('players')
    .select('entity_id')
    .eq('id', playerId)
    .maybeSingle();

  if (playerErr) {
    console.warn('[getNarrativesMentioningPlayer] player lookup failed:', playerErr.message);
    return [];
  }
  const entityId = playerRow?.entity_id ?? null;
  if (!entityId) return [];

  // Step 2: query narratives whose entities_involved array contains the
  // player's entity id.  Postgrest's `cs.` (contains) operator works on
  // JSONB arrays — pass the value wrapped in an array so the URL param
  // serialises to `entities_involved=cs.["<uuid>"]`.
  // CAST: the typed `Database` declares entities_involved as Json, which
  // makes the .contains overload reject `string[]`.  An untyped client
  // ref keeps the call site clean without weakening the validated return.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (db as any)
    .from('narratives')
    .select('id, kind, summary, source, created_at, entities_involved')
    .contains('entities_involved', [entityId])
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.warn('[getNarrativesMentioningPlayer] narrative query failed:', error.message);
    return [];
  }

  const validated: NarrativeMention[] = [];
  for (const row of (data ?? []) as unknown[]) {
    const parsed = NarrativeRowSchema.safeParse(row);
    if (!parsed.success) {
      console.warn('[getNarrativesMentioningPlayer] dropped invalid row:', parsed.error.message);
      continue;
    }
    const r = parsed.data;
    validated.push({
      id:         r.id,
      kind:       r.kind,
      summary:    r.summary,
      source:     r.source,
      created_at: r.created_at,
    });
  }

  return validated;
}
