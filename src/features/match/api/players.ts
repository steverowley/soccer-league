// ── features/match/api/players.ts ─────────────────────────────────────────
// Slice 5 of #387 — moves `getPlayer` (with per-match-stats aggregation)
// out of `src/lib/supabase.ts` and behind the typed-client DI pattern.
//
// SCOPE
// ─────
// One function for now — `getPlayer` is the only player-specific read
// in the lib singleton that hasn't already been extracted. Idol-rank
// reads (`getPlayerIdolRank`, `getTopIdolsForArchitect`) belong with
// the idol-board cluster and land in a separate slice so the player
// vs idol surfaces stay split by domain.

import type { IslSupabaseClient } from '@shared/supabase/client';
// #386: validate the player row (Critical Invariant #1 columns) + the per-match
// stat rows at the api boundary. The player row is checked for drift (warn,
// then returned unchanged); malformed stat rows warn-log and drop.
import { checkPlayerRow, parsePlayerStatRows } from './players.schema';

// ── Internal types ────────────────────────────────────────────────────────

/**
 * Aggregated season statistics returned alongside the player row.
 * Sourced from a sum over `match_player_stats` rows for the player.
 */
interface SeasonStats {
  goals:           number;
  assists:         number;
  yellow_cards:    number;
  red_cards:       number;
  minutes_played:  number;
  matches_played:  number;
  avg_rating:      number | null;
}

/**
 * Player row with the inline season-stats aggregation attached.
 * Intentionally loose-typed beyond the `seasonStats` field — the
 * PlayerDetail page narrows the rest via its own component-local
 * type. #386 (Zod boundaries) is where this row should eventually
 * gain a proper schema-validated shape; until then the `[k]: unknown`
 * index signature keeps the call site working without an excessive
 * generated-type dance.
 */
type PlayerWithStats = {
  seasonStats: SeasonStats;
  [key: string]: unknown;
};

// ── getPlayer ─────────────────────────────────────────────────────────────

/**
 * Fetch a player row joined to its current team, plus an inline
 * aggregation over every `match_player_stats` row for the player.
 *
 * The two queries run in parallel (`Promise.all`) so the page only
 * waits one round-trip. Aggregation lives client-side because the
 * per-match stat table is small (≤ 28 league rounds + cup runs per
 * season, ≤ ~40 rows per player) and the aggregation rules are
 * read-only — no benefit to pushing this into a SQL view.
 *
 * Throws on Supabase error. PlayerDetail's existing `.catch()` then
 * renders the "Unknown Player" surface unchanged.
 *
 * @param db        Injected Supabase client.
 * @param playerId  Player UUID.
 * @returns         Player row (typed wide via the [k]: unknown index
 *                  signature) plus the aggregated `seasonStats`.
 */
export async function getPlayer(
  db:        IslSupabaseClient,
  playerId:  string,
): Promise<PlayerWithStats> {
  const [playerResult, statsResult] = await Promise.all([
    db.from('players').select('*, teams(id, name)').eq('id', playerId).single(),
    db
      .from('match_player_stats')
      .select('goals, assists, yellow_cards, red_cards, minutes_played, rating')
      .eq('player_id', playerId),
  ]);

  if (playerResult.error) throw playerResult.error;
  if (statsResult.error)  throw statsResult.error;

  // Drift-check the player row at the boundary (Critical Invariant #1: the
  // engine reads attacking/defending/mental/athletic/technical). On drift we
  // warn-log loudly but still return the raw row, so PlayerDetail keeps
  // rendering rather than blanking on a non-critical column rename.
  const playerCheck = checkPlayerRow(playerResult.data);
  if (!playerCheck.success) {
    console.warn('[getPlayer] player row failed schema validation:', playerCheck.error.issues);
  }

  // Sum per-row. _rsum + _rcnt feed the average-rating divisor below;
  // we keep them on the same accumulator so the reducer stays single-
  // pass. Stat rows are validated first — malformed rows drop with a warn.
  const statRows = parsePlayerStatRows((statsResult.data ?? []) as unknown[], 'getPlayer');
  const agg = statRows.reduce(
    (acc: {
      goals: number; assists: number;
      yellow_cards: number; red_cards: number;
      minutes_played: number; matches_played: number;
      _rsum: number; _rcnt: number;
    }, row: {
      goals?:          number | null;
      assists?:        number | null;
      yellow_cards?:   number | null;
      red_cards?:      number | null;
      minutes_played?: number | null;
      rating?:         number | null;
    }) => ({
      goals:           acc.goals          + (row.goals          ?? 0),
      assists:         acc.assists        + (row.assists        ?? 0),
      yellow_cards:    acc.yellow_cards   + (row.yellow_cards   ?? 0),
      red_cards:       acc.red_cards      + (row.red_cards      ?? 0),
      minutes_played:  acc.minutes_played + (row.minutes_played ?? 0),
      matches_played:  acc.matches_played + 1,
      _rsum:           acc._rsum + (row.rating ?? 0),
      _rcnt:           acc._rcnt + (row.rating != null ? 1 : 0),
    }),
    {
      goals: 0, assists: 0,
      yellow_cards: 0, red_cards: 0,
      minutes_played: 0, matches_played: 0,
      _rsum: 0, _rcnt: 0,
    },
  );

  // Average rating rounded to 1 dp for the page; null when the player
  // has zero rated appearances (rookies / DNPs).
  const avg_rating = agg._rcnt > 0
    ? +(agg._rsum / agg._rcnt).toFixed(1)
    : null;

  return {
    ...playerResult.data,
    seasonStats: {
      goals:          agg.goals,
      assists:        agg.assists,
      yellow_cards:   agg.yellow_cards,
      red_cards:      agg.red_cards,
      minutes_played: agg.minutes_played,
      matches_played: agg.matches_played,
      avg_rating,
    },
  } as PlayerWithStats;
}
