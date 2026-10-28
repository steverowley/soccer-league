// ── features/match/api/matchPositions.ts ──────────────────────────────────────
// Read access to a match's replay frames for the 2D viewer.
//
// WHERE REPLAYS LIVE (docs/mvp-free-tier.md, decision 1)
//   The match worker writes ONE gzipped file per match to Supabase Storage:
//   `replays/<matchId>.json.gz` in the public `replays` bucket (migration
//   0091).  It holds the per-match roster plus the compact v2 frames the worker
//   used to write to Postgres, so this module decodes it with the same v2
//   decoder.  The file is fetched from its public URL and decompressed in the
//   browser with `DecompressionStream('gzip')` (Chrome 80+, Firefox 113+,
//   Safari and iOS Safari 16.4+).
//
//   LEGACY FALLBACK: matches simulated before the switch have their frames in
//   the `match_positions` + `match_position_rosters` tables.  The reader falls
//   back to those tables ONLY when the replay file does not exist (404), so a
//   restored backup or an old match keeps playing back.  Any other failure
//   (network, a server error, an unsupported browser) returns [] and the viewer
//   shows its static formation, as it always has for a match without frames.
//
// USAGE
//   Call `getMatchPositions` once per match; cache the result in component
//   state.  The spatial playback hook (`useSpatialPlayback`) consumes the
//   returned array on every tick; it does NOT call this function itself so
//   callers control when to trigger the fetch.
//
// STORED FRAME FORMAT (v2 compact, migration 0084)
//   { v: 2, p: [x0, y0, x1, y1, ...], b: [ballX, ballY, ownerIdx] }:
//   a flat coordinate array indexed against the per-match roster, plus the
//   ball and the roster index of its carrier (-1 when loose).  The v1 shape
//   repeated all 22 36-char player UUIDs in every one of ~2 731 frames and
//   stored a `hasBall` flag that was already derivable from `ball.ownerId`.
//   Legacy v1 table rows still decode here (the `v` field makes the two
//   unambiguous).
//
//   Either way this module returns the SAME in-memory `PositionSnapshot`
//   shape it always has: decoding happens at the boundary so playback,
//   hit-testing and rendering are untouched by the storage change.
//
// VOLUME
//   ~2 800 frames per 90-minute match.  The replay file is about 0.2 MB
//   gzipped (about 0.85 MB of JSON once decompressed), a single request.
//
// FORMAT v3 (docs/match-viewer.md, section 2B)
//   Replays recorded since v3 hold every player every 0.5 s and the ball as
//   keyframes at each discontinuity in its motion (logic/replay/replayV3.ts).
//   They decode to the same `PositionSnapshot[]`, one per 0.5 s frame, with
//   two additive fields: `tSec` (the frame's exact game time) and
//   `ballTrack` (the match's ball keyframes, one object shared by every
//   frame), which `sampleFrames` replays with the engine's own ball physics.
//   v2 files decode exactly as before (no `tSec`, no `ballTrack`).

import { type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { BallTrack } from '../logic/replay/ballTrack';
import type { ReplayFileV3 } from '../logic/replay/replayV3';

// ── Replay files in Storage ──────────────────────────────────────────────────

/** Storage bucket the match worker writes replays to (migration 0091). */
export const REPLAY_BUCKET = 'replays';

/** Object path of a match's replay inside {@link REPLAY_BUCKET}. */
export function replayObjectPath(matchId: string): string {
  return `${matchId}.json.gz`;
}

/** The fetch function the reader uses; injectable for tests. */
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Optional dependencies of {@link getMatchPositions}. */
export interface MatchPositionsDeps {
  /** Defaults to the global `fetch`. */
  fetch?: FetchLike;
}

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
 * The CURRENT (v2) compact `snapshots` shape written by the match-worker:
 * coordinates only, identities resolved through the roster.
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
 * A replay file as the match worker writes it
 * (supabase/functions/match-worker/replayFile.ts).  Frames are validated one
 * by one below, so a single bad frame is skipped rather than failing the
 * whole match; only the envelope is checked here.
 */
const ReplayFileSchema = z.object({
  format: z.literal('isl-replay'),
  v: z.literal(2),
  roster: RosterSchema,
  frames: z.array(
    z.object({
      minute: z.number(),
      second: z.number(),
      snapshots: z.unknown(),
    }),
  ),
});

/** A finite number array (checked in one pass; zod per element is slow at
 *  the size of a v3 file, about 700 000 numbers). */
function isNumberArray(v: unknown): v is number[] {
  if (!Array.isArray(v)) return false;
  for (const n of v) if (typeof n !== 'number' || !Number.isFinite(n)) return false;
  return true;
}

const NumberArray = z.custom<number[]>(isNumberArray, 'expected an array of finite numbers');

/**
 * A v3 replay file (logic/replay/replayV3.ts): players every 0.5 s as
 * delta-coded runs per roster member, the ball as keyframe columns.
 */
const ReplayFileV3Schema = z.object({
  format: z.literal('isl-replay'),
  v: z.literal(3),
  matchId: z.string(),
  roster: RosterSchema,
  dt: z.number().positive(),
  every: z.number().positive(),
  frames: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  players: z.array(
    z.object({
      s: z.array(z.tuple([z.number().int(), z.number().int()])),
      x: NumberArray,
      y: NumberArray,
    }),
  ),
  ball: z.object({
    t: NumberArray,
    x: NumberArray,
    y: NumberArray,
    z: NumberArray,
    vx: NumberArray,
    vy: NumberArray,
    vz: NumberArray,
    o: NumberArray,
  }),
});

/**
 * A single sampled instant of the match.
 * `minute` + `second` together identify the in-game clock position.
 * Player and ball coordinates are in FIFA pitch-metre space.
 *
 * This is the DECODED shape and it is deliberately format-independent: the
 * compaction in migration 0084 and the move to Storage changed what is
 * stored, not what this module hands to the viewer.
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
  /**
   * v3 only: the frame's exact game time in seconds (frames are 0.5 s apart,
   * so `minute`/`second` alone repeat).  Absent on v2 and table frames.
   */
  tSec?: number;
  /**
   * v3 only: the whole match's ball keyframes, the SAME object on every
   * frame of the match.  `sampleFrames` replays it with the engine's ball
   * physics.  Absent on v2 and table frames.
   */
  ballTrack?: BallTrack;
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

/** Outcome of decoding one stored row (table row or replay-file frame). */
type RowDecode =
  | { kind: 'ok'; snapshot: PositionSnapshot }
  | { kind: 'skip' }
  | { kind: 'no-roster' };

/**
 * Decode one stored `{ minute, second, snapshots }` row, v2 or legacy v1.
 * Shared by the replay-file path and the legacy table path so both decode
 * identically.
 */
function decodeRow(
  row: { minute: unknown; second: unknown; snapshots: unknown },
  roster: readonly string[] | null,
): RowDecode {
  // Validate at the boundary so a malformed frame fails loud here rather than
  // silently producing NaN coordinates in the renderer.
  const compact = SnapshotsV2Schema.safeParse(row.snapshots);
  if (compact.success) {
    if (!roster) return { kind: 'no-roster' };
    const decoded = decodeV2(compact.data, roster);
    if (!decoded) {
      console.warn('[getMatchPositions] compact frame does not match roster size, skipped');
      return { kind: 'skip' };
    }
    return {
      kind: 'ok',
      snapshot: { minute: row.minute as number, second: row.second as number, snapshots: decoded },
    };
  }

  // Not v2: try the legacy shape before giving up on the row.
  const legacy = SnapshotsV1Schema.safeParse(row.snapshots);
  if (!legacy.success) {
    console.warn('[getMatchPositions] malformed snapshot row skipped:', legacy.error.issues[0]);
    return { kind: 'skip' };
  }
  return {
    kind: 'ok',
    snapshot: { minute: row.minute as number, second: row.second as number, snapshots: legacy.data },
  };
}

// ── gzip ─────────────────────────────────────────────────────────────────────

/** First two bytes of every gzip stream (RFC 1952). */
function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/**
 * Decompress gzip bytes with the browser's native DecompressionStream.
 *
 * @throws Error with a clear message when the browser has no
 *         DecompressionStream (Safari before 16.4, very old Chrome/Firefox).
 */
async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error(
      'This browser cannot decompress match replays (DecompressionStream is missing; ' +
        'it needs Safari or iOS 16.4+, Chrome 80+ or Firefox 113+).',
    );
  }
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  // The cast bridges a lib.dom typing quirk (Uint8Array<ArrayBufferLike> vs
  // BufferSource) between ReadableStream and DecompressionStream.
  const reader = source
    .pipeThrough(new DecompressionStream('gzip') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>)
    .getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

// ── Replay file read ─────────────────────────────────────────────────────────

/** What reading the replay file produced. */
type ReplayLoad =
  | { kind: 'found'; rows: PositionSnapshot[] }
  | { kind: 'missing' }
  | { kind: 'failed' };

/**
 * Fetch, decompress and decode a match's replay file from Storage.
 *
 * Supabase Storage answers a missing public object with 404 (older versions
 * with 400 and a JSON "not found" body), so both mean "no file": the caller
 * then tries the legacy tables.
 */
async function loadReplayFile(
  db: SupabaseClient,
  matchId: string,
  fetchFn: FetchLike,
): Promise<ReplayLoad> {
  let res: Response;
  try {
    const { data } = db.storage.from(REPLAY_BUCKET).getPublicUrl(replayObjectPath(matchId));
    res = await fetchFn(data.publicUrl);
  } catch (err) {
    console.warn('[getMatchPositions] replay fetch failed:', (err as Error)?.message ?? err);
    return { kind: 'failed' };
  }

  if (res.status === 404 || res.status === 400) return { kind: 'missing' };
  if (!res.ok) {
    console.warn(`[getMatchPositions] replay fetch returned HTTP ${res.status} for match`, matchId);
    return { kind: 'failed' };
  }

  let parsedJson: unknown;
  try {
    const bytes = new Uint8Array(await res.arrayBuffer());
    // A CDN or browser that already undid the gzip hands us plain JSON; accept
    // either rather than failing on an encoding detail.
    const jsonBytes = isGzip(bytes) ? await gunzip(bytes) : bytes;
    parsedJson = JSON.parse(new TextDecoder().decode(jsonBytes));
  } catch (err) {
    console.error('[getMatchPositions] replay could not be decoded:', (err as Error)?.message ?? err);
    return { kind: 'failed' };
  }

  const v3 = ReplayFileV3Schema.safeParse(parsedJson);
  if (v3.success) {
    // Loaded on demand: keeps the v3 decoder (and the ball physics it
    // replays with) out of the entry chunk this module sits in.
    const [{ decodeReplayV3 }, { trackToSnapshots }] = await Promise.all([
      import('../logic/replay/replayV3'),
      import('../logic/replay/snapshots'),
    ]);
    const track = decodeReplayV3(v3.data as ReplayFileV3);
    if (!track) {
      console.warn('[getMatchPositions] v3 replay file is inconsistent, ignored; match', matchId);
      return { kind: 'failed' };
    }
    return { kind: 'found', rows: trackToSnapshots(track) };
  }

  const file = ReplayFileSchema.safeParse(parsedJson);
  if (!file.success) {
    console.warn('[getMatchPositions] replay file has an unknown shape:', file.error.issues[0]);
    return { kind: 'failed' };
  }

  const rows: PositionSnapshot[] = [];
  for (const frame of file.data.frames) {
    const decoded = decodeRow(frame, file.data.roster);
    if (decoded.kind === 'ok') rows.push(decoded.snapshot);
  }
  return { kind: 'found', rows };
}

// ── Query ────────────────────────────────────────────────────────────────────

/**
 * Fetch all spatial position snapshots for a match, ordered by game time.
 *
 * Reads the replay file from Storage first; falls back to the legacy
 * `match_positions` tables only when that file does not exist.
 *
 * Returns an empty array when:
 *  • the match has no replay anywhere (not simulated yet, or pruned)
 *  • the file exists but cannot be fetched or decoded (logged, not thrown)
 *  • legacy compact rows exist but no roster row to decode them against
 *  • the legacy table query fails for any reason (logged, not thrown)
 *
 * The returned array is sorted by (minute, second) ascending, making it
 * suitable for binary-search playback in `useSpatialPlayback`.
 *
 * @param db       Supabase client (anon or authenticated — read is public).
 * @param matchId  UUID of the match to load positions for.
 * @param deps     Optional injected fetch (tests).
 * @returns        Sorted array of position snapshots, or [] on error / not-found.
 */
export async function getMatchPositions(
  db: SupabaseClient,
  matchId: string,
  deps: MatchPositionsDeps = {},
): Promise<PositionSnapshot[]> {
  const fetchFn: FetchLike = deps.fetch ?? ((input, init) => fetch(input, init));
  const replay = await loadReplayFile(db, matchId, fetchFn);
  if (replay.kind === 'found') return replay.rows;
  if (replay.kind === 'failed') return [];
  return getLegacyTablePositions(db, matchId);
}

/**
 * Read frames from the legacy `match_positions` + `match_position_rosters`
 * tables (matches simulated before replays moved to Storage).
 *
 * PAGINATION
 *   PostgREST caps a single response at its `max-rows` setting (1000 by default
 *   on Supabase).  A 90-minute match stores ~2 700 snapshots (one per 2
 *   game-seconds), so a single un-paged select silently returns only the first
 *   ~1000 rows ≈ 33 minutes — the viewer then runs out of frames and freezes
 *   there while the clock keeps ticking.  We page through with `.range()`,
 *   advancing by the rows actually returned and stopping on the first empty
 *   page, so the whole match is loaded regardless of the server's row cap.
 */
async function getLegacyTablePositions(
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

    for (const row of data) {
      const decoded = decodeRow(row, roster);
      if (decoded.kind === 'no-roster') {
        // Undecodable: the ids live in match_position_rosters and that row
        // is gone.  Returning [] matches the no-frames case, which the
        // viewer already handles by falling back to a static formation.
        console.warn('[getMatchPositions] compact frames with no roster row; match', matchId);
        return [];
      }
      if (decoded.kind === 'ok') rows.push(decoded.snapshot);
    }

    from += data.length;
  }

  return rows;
}

/**
 * Load the ordered player-id roster for a match's legacy compact frames.
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
