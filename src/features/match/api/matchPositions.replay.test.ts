// ── matchPositions.replay.test.ts ─────────────────────────────────────────────
// The reader half of replays in Storage (docs/mvp-free-tier.md, decision 1):
// fetch the public file, decompress it with DecompressionStream, decode it with
// the v2 decoder, and fall back to the legacy tables ONLY when the file 404s.
//
// The files here are produced by the worker's real encoder
// (supabase/functions/match-worker/replayFile.ts), so a change to either side
// that breaks the other fails here.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { getMatchPositions, replayObjectPath, REPLAY_BUCKET } from './matchPositions';
import {
  buildReplayPayload,
  encodeReplayFile,
  type ReplayFrameInput,
} from '../../../../supabase/functions/match-worker/replayFile.ts';

const MATCH_ID = '6f1c1a52-6a43-4d0e-9a1f-3b6d5f0c9e21';
const URL_BASE = 'https://proj.supabase.co/storage/v1/object/public/replays/';

const FRAMES: ReplayFrameInput[] = Array.from({ length: 30 }, (_, i) => ({
  tSec: i * 2,
  players: [
    { id: 'home-1', x: 10 + i * 0.3, y: 20 },
    { id: 'away-1', x: 60, y: 30 + i * 0.1 },
  ],
  ball: { x: 50, y: 34, ownerId: i % 2 === 0 ? 'home-1' : null },
}));

/** A client whose Storage hands out the public URL and whose tables record reads. */
function makeDb(legacyRows: unknown[] = []) {
  const tableReads: string[] = [];
  const bucketsAsked: string[] = [];
  const db = {
    storage: {
      from(bucket: string) {
        bucketsAsked.push(bucket);
        return { getPublicUrl: (path: string) => ({ data: { publicUrl: URL_BASE + path } }) };
      },
    },
    from(table: string) {
      tableReads.push(table);
      if (table === 'match_position_rosters') {
        const b = { select: () => b, eq: () => b, maybeSingle: async () => ({ data: null, error: null }) };
        return b;
      }
      let from = 0;
      const b = {
        select: () => b,
        eq: () => b,
        order: () => b,
        range: (f: number) => {
          from = f;
          return b;
        },
        then: (ok: (r: { data: unknown[]; error: null }) => unknown) =>
          Promise.resolve({ data: from === 0 ? legacyRows : [], error: null }).then(ok),
      };
      return b;
    },
  };
  return { db: db as unknown as Parameters<typeof getMatchPositions>[0], tableReads, bucketsAsked };
}

/** A fetch that serves `body` at the match's URL and records what was asked. */
function serving(body: BodyInit | null, status = 200) {
  const urls: string[] = [];
  const fetch = vi.fn(async (input: string) => {
    urls.push(input);
    return new Response(body, { status });
  });
  return { fetch, urls };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('replay file read: fetch, decompress, decode', () => {
  it('round-trips the worker payload through gzip and the v2 decoder', async () => {
    const { body } = await encodeReplayFile(buildReplayPayload(MATCH_ID, FRAMES));
    const { db, tableReads, bucketsAsked } = makeDb();
    const { fetch, urls } = serving(body.slice());

    const frames = await getMatchPositions(db, MATCH_ID, { fetch });

    expect(bucketsAsked).toEqual([REPLAY_BUCKET]);
    expect(urls).toEqual([URL_BASE + replayObjectPath(MATCH_ID)]);
    expect(urls[0]).toBe(`${URL_BASE}${MATCH_ID}.json.gz`);
    expect(tableReads).toEqual([]); // the file exists, so no legacy read

    expect(frames).toHaveLength(FRAMES.length);
    expect(frames[0]).toEqual({
      minute: 1,
      second: 0,
      snapshots: {
        players: [
          { id: 'home-1', x: 10, y: 20, hasBall: true },
          { id: 'away-1', x: 60, y: 30, hasBall: false },
        ],
        ball: { x: 50, y: 34, ownerId: 'home-1' },
      },
    });
    expect(frames[1]!.snapshots.ball.ownerId).toBeNull();
    expect(frames[29]).toMatchObject({ minute: 1, second: 58 });
    expect(frames[29]!.snapshots.players[0]).toEqual({ id: 'home-1', x: 18.7, y: 20, hasBall: false });
  });

  it('accepts a file a CDN already decompressed (plain JSON bytes)', async () => {
    const json = JSON.stringify(buildReplayPayload(MATCH_ID, FRAMES));
    const { db } = makeDb();
    const frames = await getMatchPositions(db, MATCH_ID, serving(json));
    expect(frames).toHaveLength(FRAMES.length);
  });
});

describe('fallbacks', () => {
  const legacyRow = {
    minute: 3,
    second: 4,
    snapshots: { players: [{ id: 'old', x: 1, y: 2, hasBall: false }], ball: { x: 0, y: 0, ownerId: null } },
  };

  it('reads the legacy tables when the replay file is missing (404)', async () => {
    const { db, tableReads } = makeDb([legacyRow]);
    const frames = await getMatchPositions(db, MATCH_ID, serving(null, 404));
    expect(tableReads).toContain('match_positions');
    expect(frames).toEqual([legacyRow]);
  });

  it('treats a Storage 400 "object not found" like a 404', async () => {
    const { db, tableReads } = makeDb([legacyRow]);
    const frames = await getMatchPositions(
      db,
      MATCH_ID,
      serving(JSON.stringify({ statusCode: '404', error: 'not_found' }), 400),
    );
    expect(tableReads).toContain('match_positions');
    expect(frames).toHaveLength(1);
  });

  it('does NOT fall back on a server error: returns [] without reading tables', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { db, tableReads } = makeDb([legacyRow]);
    const frames = await getMatchPositions(db, MATCH_ID, serving('oops', 503));
    expect(frames).toEqual([]);
    expect(tableReads).toEqual([]);
  });

  it('returns [] when the network fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { db } = makeDb([legacyRow]);
    const fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await getMatchPositions(db, MATCH_ID, { fetch })).toEqual([]);
  });

  it('returns [] for a file with an unknown shape', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { db } = makeDb();
    const frames = await getMatchPositions(db, MATCH_ID, serving(JSON.stringify({ format: 'other' })));
    expect(frames).toEqual([]);
  });

  it('logs a clear error and returns [] when the browser has no DecompressionStream', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { body } = await encodeReplayFile(buildReplayPayload(MATCH_ID, FRAMES));
    vi.stubGlobal('DecompressionStream', undefined);
    const { db } = makeDb();

    const frames = await getMatchPositions(db, MATCH_ID, serving(body.slice()));

    expect(frames).toEqual([]);
    expect(String(error.mock.calls[0]?.[1])).toMatch(/DecompressionStream is missing.*16\.4/);
  });
});
