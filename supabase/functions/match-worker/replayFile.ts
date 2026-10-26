// ── match-worker/replayFile.ts ───────────────────────────────────────────────
// One gzipped replay file per match in Supabase Storage, instead of ~2 800
// rows of `match_positions` in Postgres.
//
// WHY (docs/mvp-free-tier.md, decision 1; incident #712)
//   A new-engine replay measured 2.6 MB per match as Postgres rows, so one
//   224-match season of replays (about 590 MB) was larger than the whole free
//   plan's 500 MB database quota. Storage has its own 1 GB allowance and the
//   same frames gzip to a few hundred KB, so the database keeps only the
//   result, the events and the stats.
//
// WHAT IS IN THE FILE
//   Exactly the payload the worker used to write to the two tables:
//     - `roster`: the UNION of every player id appearing in any frame (what
//       `match_position_rosters.player_ids` held). The engine substitutes from
//       minute 55, so the player set changes mid-match while staying
//       eleven a side; a frame-0 roster would misattribute every coordinate
//       after the first change.
//     - `frames`: one row per engine frame, `{ minute, second, snapshots }`,
//       where `snapshots` is the compact v2 shape `{ v: 2, p, b }` that
//       `match_positions.snapshots` held. `p` is 2N coordinates in roster
//       order with OFF_PITCH (-1) for anyone not on the pitch; `b` is
//       `[ballX, ballY, ownerIdx]` with -1 for a loose ball.
//   The viewer (src/features/match/api/matchPositions.ts) decodes it with the
//   same v2 decoder it uses for table rows.
//
// PURE MODULE
//   No Supabase client, no Deno globals: storage is injected, and gzip uses the
//   web-standard CompressionStream (Deno, Node 18+ and every modern browser),
//   so vitest exercises this exact code.
//
// NEVER REGENERATE (decision 2)
//   A replay is recorded once, from the frames of the simulation that produced
//   the stored events and score. There is deliberately no path that rebuilds a
//   replay from `matches.sim_seed`: a later engine change would make the
//   regenerated replay disagree with the recorded result.

import type { PositionFrame } from './spatial/types.ts';

/** Storage bucket holding replay files (migration 0091). Public read. */
export const REPLAY_BUCKET = 'replays';

/** Format tag written into every file, so a reader can reject anything else. */
export const REPLAY_FORMAT = 'isl-replay';

/** MIME type the bucket allows (migration 0091 `allowed_mime_types`). */
export const REPLAY_CONTENT_TYPE = 'application/gzip';

/**
 * Cache lifetime for a stored replay, in seconds (one year). A replay never
 * changes once recorded: a retried match re-simulates from the same seed, so
 * even a re-upload writes identical bytes.
 */
export const REPLAY_CACHE_SECONDS = 31_536_000;

/**
 * Coordinate meaning "not on the pitch in this frame". Real rounded coordinates
 * live in [0, 105] x [0, 68], so a negative can never collide with one. Must
 * match OFF_PITCH in src/features/match/api/matchPositions.ts.
 */
export const OFF_PITCH = -1;

/** One stored frame: the compact v2 shape `match_positions.snapshots` held. */
export interface CompactFrame {
  v: 2;
  p: number[];
  b: [number, number, number];
}

/** One frame row, keyed by the in-game clock exactly as the table rows were. */
export interface ReplayRow {
  minute: number;
  second: number;
  snapshots: CompactFrame;
}

/** The whole file, before JSON encoding and gzip. */
export interface ReplayFile {
  format: typeof REPLAY_FORMAT;
  v: 2;
  matchId: string;
  roster: string[];
  frames: ReplayRow[];
}

/** The frame fields the encoder reads (a subset of the engine's PositionFrame). */
export type ReplayFrameInput = Pick<PositionFrame, 'tSec' | 'ball'> & {
  players: ReadonlyArray<{ id: string; x: number; y: number }>;
};

/** Object path of a match's replay inside the bucket. */
export function replayObjectPath(matchId: string): string {
  return `${matchId}.json.gz`;
}

/** Round to 0.1 m: below one rendered pixel, and it drops float noise. */
function r1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Build the replay payload from the engine's frames.
 *
 * This is the encoder that used to sit inline in index.ts and feed
 * `match_position_rosters` + `match_positions`; the shape is unchanged.
 *
 * Frame to row mapping:
 *   minute = floor(tSec / 60) + 1, clamped to [1, 120] (extra time)
 *   second = floor(tSec % 60)
 *
 * @param matchId  The match the frames belong to (recorded in the file).
 * @param frames   Engine frames in time order.
 * @returns        The payload to encode and upload.
 */
export function buildReplayPayload(
  matchId: string,
  frames: readonly ReplayFrameInput[],
): ReplayFile {
  const roster: string[] = [];
  const rosterIndex = new Map<string, number>();
  for (const frame of frames) {
    for (const p of frame.players) {
      if (!rosterIndex.has(p.id)) {
        rosterIndex.set(p.id, roster.length);
        roster.push(p.id);
      }
    }
  }

  const rows: ReplayRow[] = frames.map((frame) => {
    const minute = Math.min(120, Math.max(1, Math.floor(frame.tSec / 60) + 1));
    const second = Math.floor(frame.tSec % 60);
    // Fixed width over the union roster; absentees keep the OFF_PITCH sentinel.
    const p: number[] = new Array<number>(roster.length * 2).fill(OFF_PITCH);
    for (const player of frame.players) {
      const idx = rosterIndex.get(player.id);
      if (idx === undefined) continue;
      p[idx * 2] = r1(player.x);
      p[idx * 2 + 1] = r1(player.y);
    }
    const ownerIdx =
      frame.ball.ownerId == null ? -1 : (rosterIndex.get(frame.ball.ownerId) ?? -1);
    return {
      minute,
      second,
      snapshots: { v: 2, p, b: [r1(frame.ball.x), r1(frame.ball.y), ownerIdx] },
    };
  });

  return { format: REPLAY_FORMAT, v: 2, matchId, roster, frames: rows };
}

/** Concatenate stream chunks into one byte array. */
async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = stream.getReader();
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

/** Wrap bytes in a one-chunk ReadableStream. */
function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/**
 * The web-standard (De)CompressionStream as a byte-to-byte stream pair. The
 * cast only bridges a lib.dom typing quirk (its writable side is typed as
 * BufferSource, which a Uint8Array stream does not structurally match).
 */
type BytePair = ReadableWritablePair<Uint8Array, Uint8Array>;

/**
 * Gzip bytes with the web-standard CompressionStream. The compression itself
 * runs in native code (Deno and Node both implement it outside JS), which is
 * what keeps this cheap on the edge's ~2 s CPU budget.
 */
export async function gzipBytes(bytes: Uint8Array): Promise<Uint8Array> {
  return collect(streamOf(bytes).pipeThrough(new CompressionStream('gzip') as unknown as BytePair));
}

/** Inverse of {@link gzipBytes}; used by tests and the size script. */
export async function gunzipBytes(bytes: Uint8Array): Promise<Uint8Array> {
  return collect(streamOf(bytes).pipeThrough(new DecompressionStream('gzip') as unknown as BytePair));
}

/** The encoded file plus the numbers worth logging. */
export interface EncodedReplay {
  body: Uint8Array;
  rawBytes: number;
  gzipBytes: number;
}

/** JSON-encode and gzip a replay payload. */
export async function encodeReplayFile(file: ReplayFile): Promise<EncodedReplay> {
  const raw = new TextEncoder().encode(JSON.stringify(file));
  const body = await gzipBytes(raw);
  return { body, rawBytes: raw.length, gzipBytes: body.length };
}

/**
 * The slice of the Supabase Storage client this module needs. The real
 * `supabase.storage` satisfies it; tests pass a recording fake.
 */
export interface ReplayStorage {
  from(bucket: string): {
    upload(
      path: string,
      body: Uint8Array,
      options: { contentType: string; upsert: boolean; cacheControl: string },
    ): Promise<{ error: { message: string } | null }>;
    remove(paths: string[]): Promise<{ error: { message: string } | null }>;
  };
}

/** What {@link uploadReplay} stored. */
export interface UploadedReplay extends EncodedReplay {
  path: string;
  frames: number;
  roster: number;
}

/**
 * Build, encode and upload one match's replay.
 *
 * `upsert: true` because a retried match (same seed, same frames) must be able
 * to overwrite whatever a failed earlier attempt left behind.
 *
 * @throws Error when the upload is rejected, so the caller decides how fatal
 *         that is (the worker logs it and carries on, as it did for frames).
 */
export async function uploadReplay(
  storage: ReplayStorage,
  matchId: string,
  frames: readonly ReplayFrameInput[],
): Promise<UploadedReplay> {
  const file = buildReplayPayload(matchId, frames);
  const encoded = await encodeReplayFile(file);
  const path = replayObjectPath(matchId);
  const { error } = await storage.from(REPLAY_BUCKET).upload(path, encoded.body, {
    contentType: REPLAY_CONTENT_TYPE,
    upsert: true,
    cacheControl: String(REPLAY_CACHE_SECONDS),
  });
  if (error) throw new Error(`replay upload failed: ${error.message}`);
  return { ...encoded, path, frames: file.frames.length, roster: file.roster.length };
}

/**
 * Delete the replay files of the given matches. Best effort: a missing object
 * is not an error (Storage ignores unknown paths), and a failure is logged
 * rather than thrown because every caller is already on a cleanup path.
 *
 * @returns true when Storage accepted the delete.
 */
export async function deleteReplays(
  storage: ReplayStorage,
  matchIds: readonly string[],
): Promise<boolean> {
  if (matchIds.length === 0) return true;
  try {
    const { error } = await storage.from(REPLAY_BUCKET).remove(matchIds.map(replayObjectPath));
    if (error) {
      console.warn(`[replayFile] replay delete failed: ${error.message}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[replayFile] replay delete threw:', (err as Error)?.message ?? err);
    return false;
  }
}
