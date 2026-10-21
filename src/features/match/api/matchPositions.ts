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
// STORED FORMAT (v2 compact, migration 0084)
//   Rows hold { v: 2, p: [x0, y0, x1, y1, …], b: [ballX, ballY, ownerIdx] }:
//   a flat coordinate array indexed against the per-match roster in
//   `match_position_rosters`, plus the ball and the roster index of its
//   carrier (-1 when loose).  The v1 shape repeated all 22 36-char player
//   UUIDs in every one of ~2 731 frames and stored a `hasBall` flag that was
//   already derivable from `ball.ownerId`; that cost a measured 4.81 MB per
//   match against 0.67 MB for v2, and 233 matches of it filled the database
//   until the project was disk-restricted.  Legacy v1 rows still decode here
//   (the `v` field makes the two unambiguous), so a restored backup or a row
//   written by an older worker build keeps playing back.
//
//   Either way this module returns the SAME in-memory `PositionSnapshot`
//   shape it always has: decoding happens at the boundary so playback,
//   hit-testing and rendering are untouched by the format change.
//
// VOLUME
//   ~2 700 rows per 90-minute match (one row per 2-second snap).  A compact
//   row is ~250 bytes, so a full-match fetch is ~0.7 MB — comfortable for a
//   single upfront load.  The query orders by (minute, second) ascending so
//   the returned array is already sorted for binary-search playback.

import { type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

// ── Zod schemas ──────────────────────────────────────────────────────────────

/** One player's position in a stored v1 snapshot. */
const SnapshotPlayerSchema = z.object({
  id: z.string(),
  /** x coordinate in metres, range [0, 105] (FIFA pitch length). */
  x: z.number(),
  /** y coordinate in metres, range [0, 68] (FIFA pitch width). */
  y: z.number(),
  /** True for at most one player — the ball holder. */
  hasBall: z.boolean(),
});

/** Ball position in a stored v1 snapshot. */
const SnapshotBallSchema = z.object({
  x: z.number(),
  y: z.number(),
  /** null when the ball is loose (kicked and in-flight, not held). */
  ownerId: z.string().nullable(),
});

/**
 * The LEGACY (v1) JSONB `snapshots` shape: every player id spelled out in
 * every frame.  Kept so rows written before migration 0084 (or restored from
 * a pre-0084 backup) still render instead of being skipped as malformed.
 */
const SnapshotsV1Schema = z.object({
  players: z.array(SnapshotPlayerSchema),
  ball: SnapshotBallSchema,
});

/**
 * The CURRENT (v2) compact JSONB `snapshots` shape written by the
 * match-worker: coordinates only, identities resolved through the roster.
 *
 * `p` is 2N numbers (x0, y0, x1, y1, …) in roster order.
 * `b` is [ballX, ballY, ownerIdx]; ownerIdx is -1 when the ball is loose.
 */
const SnapshotsV2Schema = z.object({
  v: z.literal(2),
  p: z.array(z.number()),
  b: z.tuple([z.number(), z.number(), z.number()]),
});

/** The per-match roster the v2 coordinate arrays are indexed against. */
const RosterSchema = z.array(z.string());

/**
 * A single sampled instant of the match as stored in `match_positions`.
 * `minute` + `second` together identify the in-game clock position.
 * Player and ball coordinates are in FIFA pitch-metre space.
 *
 * This is the DECODED shape and it is deliberately format-independent: the
 * compaction in migration 0084 changed what sits in the database, not what
 * this module hands to the viewer.
 */
export interface PositionSnapshot {
  /** 1–120.  Extra-time snapshots sit at minute = 90. */
  minute: number;
  /** 0–59.  Second within the minute. */
  second: number;
  /**
   * All 22 player positions + ball for this 2-second snap.
   * Player coordinates in metres: x ∈ [0, 105], y ∈ [0, 68].
   */
  snapshots: {
    players: Array<{ id: string; x: number; y: number; hasBall: boolean }>;
    ball: { x: number; y: number; ownerId: string | null };
  };
}

// ── Decoding ─────────────────────────────────────────────────────────────────

/**
 * Sentinel coordinate meaning "this roster member is not on the pitch in this
 * frame". Real coordinates are rounded to 0.1 m inside [0, 105] x [0, 68], so a
 * negative value can never collide with a genuine position.
 *
 * This exists because the roster is the UNION of everyone who appears during
 * the match, not the starting XI. The engine substitutes 3 players per side
 * from minute 55, so a match has 22 players on the pitch but up to 28 in the
 * roster, and the 6 who are off at any instant are written as sentinels.
 */
const OFF_PITCH = -1;

/**
 * Decode one compact v2 frame back into the v1-shaped snapshot the viewer
 * consumes.
 *
 * `hasBall` is reconstructed rather than stored: the carrier is whoever sits at
 * roster index named by `ownerIdx`, which is exactly what the writer used to
 * derive it.
 *
 * Roster members flagged {@link OFF_PITCH} are omitted, so the returned player
 * list contains only those actually on the pitch at this instant. That keeps
 * the decoded shape identical to v1, which only ever held on-pitch players.
 *
 * @param compact  The stored frame.
 * @param roster   Ordered player ids for this match (the union, see OFF_PITCH).
 * @returns        Decoded snapshot, or null when the frame and roster
 *                 disagree on length (a corrupt or mis-encoded row).
 */
function decodeV2(
  compact: z.infer<typeof SnapshotsV2Schema>,
  roster: readonly string[],
): PositionSnapshot['snapshots'] | null {
  if (compact.p.length !== roster.length * 2) return null;

  const [ballX, ballY, ownerIdx] = compact.b;
  const owner = ownerIdx >= 0 ? roster[ownerIdx] : undefined;

  const players: PositionSnapshot['snapshots']['players'] = [];
  roster.forEach((id, i) => {
    const x = compact.p[i * 2] ?? OFF_PITCH;
    const y = compact.p[i * 2 + 1] ?? OFF_PITCH;
    // A substituted or not-yet-introduced player is absent from this frame.
    if (x === OFF_PITCH && y === OFF_PITCH) return;
    players.push({ id, x, y, hasBall: i === ownerIdx });
  });

  return { players, ball: { x: ballX, y: ballY, ownerId: owner ?? null } };
}

// ── Query ────────────────────────────────────────────────────────────────────

/**
 * Fetch all spatial position snapshots for a match, ordered by game time.
 *
 * Returns an empty array when:
 *  • the match was simulated by the legacy dice-roller (no rows in the table)
 *  • the match has compact frames but no roster row to decode them against
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

  // One extra round-trip, once per match: the roster that v2 coordinate arrays
  // are indexed against.  A missing roster is not fatal on its own — v1 rows
  // carry their own ids — so this never throws and never short-circuits.
  const roster = await fetchRoster(db, matchId);

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
      const compact = SnapshotsV2Schema.safeParse(row.snapshots);
      if (compact.success) {
        if (!roster) {
          // Undecodable: the ids live in match_position_rosters and that row
          // is gone.  Returning [] matches the no-frames case, which the
          // viewer already handles by falling back to a static formation.
          console.warn('[getMatchPositions] compact frames with no roster row; match', matchId);
          return [];
        }
        const decoded = decodeV2(compact.data, roster);
        if (!decoded) {
          console.warn('[getMatchPositions] compact frame does not match roster size, skipped');
          continue;
        }
        rows.push({
          minute: row.minute as number,
          second: row.second as number,
          snapshots: decoded,
        });
        continue;
      }

      // Not v2 — try the legacy shape before giving up on the row.
      const legacy = SnapshotsV1Schema.safeParse(row.snapshots);
      if (!legacy.success) {
        console.warn('[getMatchPositions] malformed snapshot row skipped:', legacy.error.issues[0]);
        continue;
      }
      rows.push({
        minute: row.minute as number,
        second: row.second as number,
        snapshots: legacy.data,
      });
    }

    from += data.length;
  }

  return rows;
}

/**
 * Load the ordered player-id roster for a match's compact frames.
 *
 * @param db       Supabase client.
 * @param matchId  UUID of the match.
 * @returns        Roster in frame order, or null when absent / unreadable.
 */
async function fetchRoster(db: SupabaseClient, matchId: string): Promise<string[] | null> {
  const { data, error } = await db
    .from('match_position_rosters')
    .select('player_ids')
    .eq('match_id', matchId)
    .maybeSingle();

  if (error) {
    console.warn('[getMatchPositions] roster query failed:', error.message);
    return null;
  }

  const parsed = RosterSchema.safeParse((data as { player_ids?: unknown } | null)?.player_ids);
  if (!parsed.success) return null;
  return parsed.data;
}
