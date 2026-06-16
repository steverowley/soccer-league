// ── features/match/api/matchPositions.ts ──────────────────────────────────────
// Read-only access to the `match_positions` table populated by the spatial
// engine (Phase A rebuild, match-worker cutover).
//
// USAGE
//   Call `getMatchPositions` once per match; cache the result in component
//   state.  The spatial playback hook (`useSpatialPlayback`) consumes the
//   returned array on every tick — it does NOT call this function itself so
//   callers control when to trigger the fetch.
//
// VOLUME
//   ~2 700 rows per 90-minute match (one row per 2-second snap).  Each row
//   is small JSONB (~1 kB) so a full-match fetch is ~2.7 MB — acceptable for
//   a single upfront load.  The query orders by (minute, second) ascending
//   so the returned array is already sorted for binary-search playback.

import { type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

// ── Zod schemas ──────────────────────────────────────────────────────────────

/** One player's position in a stored snapshot. */
const SnapshotPlayerSchema = z.object({
  id:      z.string(),
  /** x coordinate in metres, range [0, 105] (FIFA pitch length). */
  x:       z.number(),
  /** y coordinate in metres, range [0, 68] (FIFA pitch width). */
  y:       z.number(),
  /** True for at most one player — the ball holder. */
  hasBall: z.boolean(),
});

/** Ball position in a stored snapshot. */
const SnapshotBallSchema = z.object({
  x:       z.number(),
  y:       z.number(),
  /** null when the ball is loose (kicked and in-flight, not held). */
  ownerId: z.string().nullable(),
});

/** The JSONB `snapshots` column shape from one `match_positions` row. */
const SnapshotsSchema = z.object({
  players: z.array(SnapshotPlayerSchema),
  ball:    SnapshotBallSchema,
});

/**
 * A single sampled instant of the match as stored in `match_positions`.
 * `minute` + `second` together identify the in-game clock position.
 * Player and ball coordinates are in FIFA pitch-metre space.
 */
export interface PositionSnapshot {
  /** 1–120.  Extra-time snapshots sit at minute = 90. */
  minute:    number;
  /** 0–59.  Second within the minute. */
  second:    number;
  /**
   * All 22 player positions + ball for this 2-second snap.
   * Player coordinates in metres: x ∈ [0, 105], y ∈ [0, 68].
   */
  snapshots: {
    players: Array<{ id: string; x: number; y: number; hasBall: boolean }>;
    ball:    { x: number; y: number; ownerId: string | null };
  };
}

// ── Query ────────────────────────────────────────────────────────────────────

/**
 * Fetch all spatial position snapshots for a match, ordered by game time.
 *
 * Returns an empty array when:
 *  • the match was simulated by the legacy dice-roller (no rows in the table)
 *  • the Supabase query fails for any reason (logged, not thrown)
 *
 * The returned array is already sorted by (minute, second) ascending, making
 * it suitable for binary-search playback in `useSpatialPlayback`.
 *
 * PAGINATION
 *   PostgREST caps a single response at its `max-rows` setting (1000 by default
 *   on Supabase).  A 90-minute match stores ~2 700 snapshots (one per 2
 *   game-seconds), so a single un-paged select silently returns only the first
 *   ~1000 rows ≈ 33 minutes — the viewer then runs out of frames and freezes
 *   there while the clock keeps ticking.  We page through with `.range()`,
 *   advancing by the rows actually returned and stopping on the first empty
 *   page, so the whole match is loaded regardless of the server's row cap.
 *
 * @param db       Supabase client (anon or authenticated — read is public).
 * @param matchId  UUID of the match to load positions for.
 * @returns        Sorted array of position snapshots, or [] on error / not-found.
 */
export async function getMatchPositions(
  db: SupabaseClient,
  matchId: string,
): Promise<PositionSnapshot[]> {
  // Request size per page.  The loop advances by the count actually returned,
  // so a server cap below this value still pages correctly (just in more hops).
  const PAGE_SIZE = 1000;
  const rows: PositionSnapshot[] = [];

  for (let from = 0; ; ) {
    const { data, error } = await db
      .from('match_positions')
      .select('minute, second, snapshots')
      .eq('match_id', matchId)
      .order('minute', { ascending: true })
      .order('second', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      console.warn('[getMatchPositions] query failed:', error.message);
      // Degrade gracefully: a first-page failure yields [], a later-page
      // failure returns the frames gathered so far rather than nothing.
      break;
    }
    if (!data || data.length === 0) break;

    // Validate at the DB boundary so a malformed JSONB row fails loud here
    // rather than silently producing NaN coordinates in the renderer.
    for (const row of data) {
      const parsed = SnapshotsSchema.safeParse(row.snapshots);
      if (!parsed.success) {
        console.warn('[getMatchPositions] malformed snapshot row skipped:', parsed.error.issues[0]);
        continue;
      }
      rows.push({
        minute:    row.minute as number,
        second:    row.second as number,
        snapshots: parsed.data,
      });
    }

    from += data.length;
  }

  return rows;
}
