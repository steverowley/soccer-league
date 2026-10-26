// @vitest-environment node
// ── match-worker/replayFile.test.ts ──────────────────────────────────────────
// The worker half of replays in Storage (docs/mvp-free-tier.md, decision 1):
// the payload it builds, the exact upload call it makes, and the cleanup
// delete. The reader half (fetch, DecompressionStream, decode) is covered in
// src/features/match/api/matchPositions.replay.test.ts and, against the real
// engine's substitutions, matchPositions.substitutions.test.ts.

import { describe, it, expect, vi } from 'vitest';
import {
  buildReplayPayload,
  deleteReplays,
  encodeReplayFile,
  gunzipBytes,
  replayObjectPath,
  uploadReplay,
  OFF_PITCH,
  REPLAY_BUCKET,
  REPLAY_CACHE_SECONDS,
  REPLAY_CONTENT_TYPE,
  type ReplayFrameInput,
  type ReplayStorage,
} from './replayFile.ts';

const MATCH_ID = '6f1c1a52-6a43-4d0e-9a1f-3b6d5f0c9e21';

/** Two starters, then a substitution: B leaves, C comes on. */
const FRAMES: ReplayFrameInput[] = [
  { tSec: 0, players: [{ id: 'A', x: 10.04, y: 20.06 }, { id: 'B', x: 30, y: 40 }], ball: { x: 1.26, y: 2, ownerId: 'A' } },
  { tSec: 62, players: [{ id: 'A', x: 11, y: 21 }, { id: 'B', x: 31, y: 41 }], ball: { x: 3, y: 4, ownerId: null } },
  { tSec: 7300, players: [{ id: 'A', x: 12, y: 22 }, { id: 'C', x: 50, y: 60 }], ball: { x: 5, y: 6, ownerId: 'C' } },
];

/** A Storage fake that records every call. */
function fakeStorage(opts: { uploadError?: string; removeError?: string; removeThrows?: boolean } = {}) {
  const uploads: Array<{ bucket: string; path: string; body: Uint8Array; options: unknown }> = [];
  const removes: Array<{ bucket: string; paths: string[] }> = [];
  const storage: ReplayStorage = {
    from(bucket: string) {
      return {
        async upload(path, body, options) {
          uploads.push({ bucket, path, body, options });
          return { error: opts.uploadError ? { message: opts.uploadError } : null };
        },
        async remove(paths) {
          if (opts.removeThrows) throw new Error('network down');
          removes.push({ bucket, paths });
          return { error: opts.removeError ? { message: opts.removeError } : null };
        },
      };
    },
  };
  return { storage, uploads, removes };
}

describe('buildReplayPayload', () => {
  it('writes the union roster, compact v2 frames and the clock mapping', () => {
    const file = buildReplayPayload(MATCH_ID, FRAMES);

    expect(file).toMatchObject({ format: 'isl-replay', v: 2, matchId: MATCH_ID });
    // Union of every frame, in first-seen order: the substitute is included.
    expect(file.roster).toEqual(['A', 'B', 'C']);
    expect(file.frames.map((f) => [f.minute, f.second])).toEqual([[1, 0], [2, 2], [120, 40]]);

    // Rounded to 0.1 m; C is off the pitch at kickoff, B after the change.
    expect(file.frames[0]!.snapshots).toEqual({
      v: 2,
      p: [10, 20.1, 30, 40, OFF_PITCH, OFF_PITCH],
      b: [1.3, 2, 0],
    });
    expect(file.frames[1]!.snapshots.b).toEqual([3, 4, -1]);
    expect(file.frames[2]!.snapshots).toEqual({
      v: 2,
      p: [12, 22, OFF_PITCH, OFF_PITCH, 50, 60],
      b: [5, 6, 2],
    });
  });
});

describe('encodeReplayFile', () => {
  it('gzips JSON that decodes back to the same payload', async () => {
    const file = buildReplayPayload(MATCH_ID, FRAMES);
    const enc = await encodeReplayFile(file);

    expect(enc.body[0]).toBe(0x1f); // gzip magic
    expect(enc.body[1]).toBe(0x8b);
    expect(enc.gzipBytes).toBe(enc.body.length);
    const back = JSON.parse(new TextDecoder().decode(await gunzipBytes(enc.body)));
    expect(back).toEqual(file);
    expect(enc.rawBytes).toBe(new TextEncoder().encode(JSON.stringify(file)).length);
  });
});

describe('uploadReplay', () => {
  it('uploads one gzipped file to replays/<matchId>.json.gz with upsert and a long cache', async () => {
    const { storage, uploads } = fakeStorage();

    const stored = await uploadReplay(storage, MATCH_ID, FRAMES);

    expect(uploads).toHaveLength(1);
    const call = uploads[0]!;
    expect(call.bucket).toBe(REPLAY_BUCKET);
    expect(call.bucket).toBe('replays');
    expect(call.path).toBe(`${MATCH_ID}.json.gz`);
    expect(call.path).toBe(replayObjectPath(MATCH_ID));
    expect(call.options).toEqual({
      contentType: REPLAY_CONTENT_TYPE,
      upsert: true,
      cacheControl: String(REPLAY_CACHE_SECONDS),
    });
    // The uploaded bytes are exactly the payload the reader expects.
    const back = JSON.parse(new TextDecoder().decode(await gunzipBytes(call.body)));
    expect(back).toEqual(buildReplayPayload(MATCH_ID, FRAMES));
    expect(stored).toMatchObject({ path: call.path, frames: 3, roster: 3, gzipBytes: call.body.length });
  });

  it('throws when Storage rejects the upload, so the caller can log it', async () => {
    const { storage } = fakeStorage({ uploadError: 'Payload too large' });
    await expect(uploadReplay(storage, MATCH_ID, FRAMES)).rejects.toThrow(/Payload too large/);
  });
});

describe('deleteReplays', () => {
  it('removes each match file from the replays bucket in one call', async () => {
    const { storage, removes } = fakeStorage();
    expect(await deleteReplays(storage, ['m1', 'm2'])).toBe(true);
    expect(removes).toEqual([{ bucket: 'replays', paths: ['m1.json.gz', 'm2.json.gz'] }]);
  });

  it('makes no call for an empty list', async () => {
    const { storage, removes } = fakeStorage();
    expect(await deleteReplays(storage, [])).toBe(true);
    expect(removes).toHaveLength(0);
  });

  it('never throws on the cleanup path (error result or thrown error)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await deleteReplays(fakeStorage({ removeError: 'denied' }).storage, ['m1'])).toBe(false);
    expect(await deleteReplays(fakeStorage({ removeThrows: true }).storage, ['m1'])).toBe(false);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
