// ── matchPositions.compact.test.ts ────────────────────────────────────────────
// Format tests for the compact (v2) replay-frame shape introduced by migration
// 0084.
//
// WHY THESE TESTS EXIST
// ─────────────────────
// `match_positions` stored one JSONB frame every 2 seconds of match time in a
// shape that repeated all 22 36-char player UUIDs in EVERY frame plus a
// `hasBall` boolean already derivable from `ball.ownerId`.  At 2 731 frames per
// match that measured 4.81 MB/match; 233 played fixtures filled the 500 MB
// Free-plan disk, Supabase restricted the project, and every API call started
// returning HTTP 402.  v2 stores coordinates only, indexed against a roster
// written once per match.
//
// So there are three things to hold still:
//   1. ROUND TRIP — the viewer must receive byte-for-byte the same
//      `PositionSnapshot[]` it got from v1, within the 0.1 m rounding.
//   2. LEGACY — v1 rows (restored backup, stale worker deploy) must still
//      decode, since the version field makes the two unambiguous.
//   3. SIZE — the win must not silently regrow.  The size assertion below is
//      the regression guard: re-add per-frame ids and it fails.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getMatchPositions, type PositionSnapshot } from './matchPositions';

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** UTF-8 byte length — the unit Postgres actually stores JSONB text in. */
const bytes = (s: string) => new TextEncoder().encode(s).length;

/** Deterministic 0..1 generator, so "realistic" coordinates are reproducible. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** 22 real 36-char UUIDs — the per-frame payload v1 repeated 2 731 times. */
const ROSTER: string[] = Array.from(
  { length: 22 },
  (_, i) => `7b1f${String(i).padStart(4, '0')}-9c2d-4e8a-b6f1-${String(i).padStart(12, '3')}`,
);

/** The engine's own frame shape (`PositionFrame`), minus the fields we ignore. */
interface Frame {
  tSec: number;
  players: Array<{ id: string; x: number; y: number }>;
  ball: { x: number; y: number; ownerId: string | null };
}

/**
 * Build frames with the float noise a physics step actually produces (the v1
 * writer stored these raw, which is a large part of why rows were so fat).
 *
 * @param count       Number of frames.
 * @param ownerEvery  Give the ball to a player on every Nth frame; the rest are
 *                    loose balls (ownerId null ⇒ ownerIdx -1).
 */
function makeFrames(count: number, ownerEvery = 3): Frame[] {
  const rand = rng(42);
  return Array.from({ length: count }, (_, f) => ({
    tSec: f * 2,
    players: ROSTER.map((id) => ({
      id,
      x: rand() * 105,
      y: rand() * 68,
    })),
    ball: {
      x: rand() * 105,
      y: rand() * 68,
      ownerId: f % ownerEvery === 0 ? (ROSTER[f % ROSTER.length] as string) : null,
    },
  }));
}

// ── The writer, mirrored ─────────────────────────────────────────────────────

/** Round to 0.1 m, exactly as the worker does before storing. */
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Must match OFF_PITCH in matchPositions.ts and the match-worker. */
const OFF_PITCH = -1;

interface CompactSnapshot {
  v: 2;
  p: number[];
  b: [number, number, number];
}

/**
 * Encode frames the way `supabase/functions/match-worker/index.ts` does.
 *
 * The worker runs on Deno and its entry point cannot be imported here (it calls
 * `Deno.serve` and pulls remote ESM), so this is a deliberate mirror of that
 * code path — the same mirroring the viewer's `framesToSnapshots` has always
 * done.  The drift guard at the bottom of this file asserts the worker source
 * still writes this shape, so the mirror cannot rot unnoticed.
 */
function encodeAsWorker(frames: Frame[]): {
  playerIds: string[];
  rows: Array<{ minute: number; second: number; snapshots: CompactSnapshot }>;
} {
  // Mirrors the worker: the roster is the UNION of everyone appearing in ANY
  // frame, because the engine substitutes mid-match and the player SET changes
  // while staying 11-a-side. Taking it from frame 0 misattributes every
  // coordinate after the first substitution.
  const playerIds: string[] = [];
  const index = new Map<string, number>();
  for (const frame of frames) {
    for (const p of frame.players) {
      if (!index.has(p.id)) {
        index.set(p.id, playerIds.length);
        playerIds.push(p.id);
      }
    }
  }

  const rows = frames.map((frame) => {
    const minute = Math.min(120, Math.max(1, Math.floor(frame.tSec / 60) + 1));
    const second = Math.floor(frame.tSec % 60);
    // Fixed width over the union roster; absentees keep the OFF_PITCH sentinel.
    const p: number[] = new Array<number>(playerIds.length * 2).fill(OFF_PITCH);
    for (const player of frame.players) {
      const idx = index.get(player.id);
      if (idx === undefined) continue;
      p[idx * 2] = r1(player.x);
      p[idx * 2 + 1] = r1(player.y);
    }
    const ownerIdx = frame.ball.ownerId == null ? -1 : (index.get(frame.ball.ownerId) ?? -1);
    return {
      minute,
      second,
      snapshots: {
        v: 2 as const,
        p,
        b: [r1(frame.ball.x), r1(frame.ball.y), ownerIdx] as [number, number, number],
      },
    };
  });

  return { playerIds, rows };
}

/** Encode frames in the LEGACY v1 shape, for the size comparison. */
function encodeAsV1(frames: Frame[]) {
  return frames.map((frame) => ({
    minute: Math.min(120, Math.max(1, Math.floor(frame.tSec / 60) + 1)),
    second: Math.floor(frame.tSec % 60),
    snapshots: {
      players: frame.players.map((p) => ({
        id: p.id,
        x: p.x,
        y: p.y,
        hasBall: frame.ball.ownerId === p.id,
      })),
      ball: frame.ball,
    },
  }));
}

// ── Supabase mock ────────────────────────────────────────────────────────────

/**
 * Minimal client returning `roster` from `match_position_rosters` and `rows`
 * from `match_positions` (single page; pagination is covered elsewhere).
 */
function makeDb(rows: unknown[], roster: string[] | null) {
  function rosterBuilder() {
    const b = {
      select() {
        return b;
      },
      eq() {
        return b;
      },
      maybeSingle() {
        return Promise.resolve({
          data: roster ? { player_ids: roster } : null,
          error: null,
        });
      },
    };
    return b;
  }
  function frameBuilder() {
    let from = 0;
    const b = {
      select() {
        return b;
      },
      eq() {
        return b;
      },
      order() {
        return b;
      },
      range(f: number) {
        from = f;
        return b;
      },
      then(onFulfilled: (r: { data: unknown[]; error: null }) => unknown) {
        return Promise.resolve({ data: from === 0 ? rows : [], error: null }).then(onFulfilled);
      },
    };
    return b;
  }
  return {
    from: vi.fn((table: string) =>
      table === 'match_position_rosters' ? rosterBuilder() : frameBuilder(),
    ),
  };
}

/** Read frames back through the real read path. */
async function readBack(rows: unknown[], roster: string[] | null): Promise<PositionSnapshot[]> {
  return getMatchPositions(makeDb(rows, roster) as any, 'm1');
}

// ── 1. Round trip ────────────────────────────────────────────────────────────

describe('compact v2 frames — write/read round trip', () => {
  it('decodes back to the same snapshots the v1 shape produced (within 0.1 m)', async () => {
    const frames = makeFrames(40);
    const { playerIds, rows } = encodeAsWorker(frames);
    const expected = encodeAsV1(frames);

    const decoded = await readBack(rows, playerIds);

    expect(decoded).toHaveLength(frames.length);
    for (const [i, frame] of decoded.entries()) {
      const want = expected[i]!;
      expect(frame.minute).toBe(want.minute);
      expect(frame.second).toBe(want.second);
      expect(frame.snapshots.players).toHaveLength(22);

      for (const [j, player] of frame.snapshots.players.entries()) {
        const wantPlayer = want.snapshots.players[j]!;
        // Identity survives: ids come from the roster, in frame order.
        expect(player.id).toBe(wantPlayer.id);
        // 0.1 m rounding is the only loss, and it is below one rendered pixel.
        expect(Math.abs(player.x - wantPlayer.x)).toBeLessThanOrEqual(0.051);
        expect(Math.abs(player.y - wantPlayer.y)).toBeLessThanOrEqual(0.051);
        // hasBall is derived, not stored — it must still land on the carrier.
        expect(player.hasBall).toBe(wantPlayer.hasBall);
      }

      expect(Math.abs(frame.snapshots.ball.x - want.snapshots.ball.x)).toBeLessThanOrEqual(0.051);
      expect(Math.abs(frame.snapshots.ball.y - want.snapshots.ball.y)).toBeLessThanOrEqual(0.051);
      expect(frame.snapshots.ball.ownerId).toBe(want.snapshots.ball.ownerId);
    }
  });

  it('gives hasBall to exactly the carrier, and to nobody when the ball is loose', async () => {
    const carrier = ROSTER[7]!;
    const frames: Frame[] = [
      {
        tSec: 0,
        players: ROSTER.map((id, i) => ({ id, x: i, y: i })),
        ball: { x: 10, y: 20, ownerId: carrier },
      },
      {
        tSec: 2,
        players: ROSTER.map((id, i) => ({ id, x: i, y: i })),
        ball: { x: 30, y: 40, ownerId: null },
      },
    ];
    const { playerIds, rows } = encodeAsWorker(frames);

    // The loose frame really does store -1, not a stale index.
    expect(rows[0]!.snapshots.b[2]).toBe(7);
    expect(rows[1]!.snapshots.b[2]).toBe(-1);

    const decoded = await readBack(rows, playerIds);

    const held = decoded[0]!.snapshots;
    expect(held.players.filter((p) => p.hasBall).map((p) => p.id)).toEqual([carrier]);
    expect(held.ball.ownerId).toBe(carrier);

    const loose = decoded[1]!.snapshots;
    expect(loose.players.some((p) => p.hasBall)).toBe(false);
    expect(loose.ball.ownerId).toBeNull();
  });

  it('keeps the minute/second mapping, including the extra-time clamp', async () => {
    const frames: Frame[] = [0, 59, 60, 5399, 7300].map((tSec) => ({
      tSec,
      players: ROSTER.map((id, i) => ({ id, x: i, y: i })),
      ball: { x: 1, y: 2, ownerId: null },
    }));
    const { rows } = encodeAsWorker(frames);

    expect(rows.map((r) => [r.minute, r.second])).toEqual([
      [1, 0],
      [1, 59],
      [2, 0],
      [90, 59],
      [120, 40], // floor(7300/60)+1 = 122 → clamped to 120
    ]);
  });

  it('returns [] when compact frames exist but the roster row is gone', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { rows } = encodeAsWorker(makeFrames(5));

    const decoded = await readBack(rows, null);

    expect(decoded).toEqual([]); // degrades like a match with no frames at all
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('skips a frame whose coordinate count disagrees with the roster', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { playerIds, rows } = encodeAsWorker(makeFrames(3));
    const corrupt = { ...rows[1]!, snapshots: { ...rows[1]!.snapshots, p: [1, 2, 3] } };

    const decoded = await readBack([rows[0], corrupt, rows[2]], playerIds);

    expect(decoded).toHaveLength(2); // the truncated frame is dropped, not fatal
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

// ── 2. Legacy v1 rows ────────────────────────────────────────────────────────

describe('legacy v1 frames still decode', () => {
  it('reads a pre-0084 row unchanged, roster or no roster', async () => {
    const legacyRow = {
      minute: 12,
      second: 34,
      snapshots: {
        players: [
          { id: ROSTER[0]!, x: 1.5, y: 2.5, hasBall: true },
          { id: ROSTER[1]!, x: 3.5, y: 4.5, hasBall: false },
        ],
        ball: { x: 1.5, y: 2.5, ownerId: ROSTER[0]! },
      },
    };

    for (const roster of [null, ROSTER]) {
      const decoded = await readBack([legacyRow], roster);
      expect(decoded).toHaveLength(1);
      expect(decoded[0]).toEqual(legacyRow); // identical in-memory shape
    }
  });

  it('decodes a mixed table (v1 and v2 rows side by side)', async () => {
    const { playerIds, rows } = encodeAsWorker(makeFrames(2));
    const legacyRow = {
      minute: 99,
      second: 9,
      snapshots: {
        players: [{ id: 'legacy-player', x: 9, y: 9, hasBall: false }],
        ball: { x: 0, y: 0, ownerId: null },
      },
    };

    const decoded = await readBack([...rows, legacyRow], playerIds);

    expect(decoded).toHaveLength(3);
    expect(decoded[0]!.snapshots.players).toHaveLength(22);
    expect(decoded[2]!.snapshots.players[0]!.id).toBe('legacy-player');
  });
});

// ── 3. The size win (regression guard) ───────────────────────────────────────

describe('compact v2 frames — stored size', () => {
  it('is at least 80% smaller than v1 for a realistic 22-player match', () => {
    // A full 90-minute match at one frame per 2 seconds.
    const FRAMES = 2731;
    const frames = makeFrames(FRAMES);

    const v1Bytes = bytes(
      encodeAsV1(frames)
        .map((r) => JSON.stringify(r.snapshots))
        .join(''),
    );

    const { playerIds, rows } = encodeAsWorker(frames);
    // Count the roster too: it is new storage, so the comparison must pay for
    // it even though it is written once against 2 731 frames.
    const v2Bytes =
      bytes(rows.map((r) => JSON.stringify(r.snapshots)).join('')) +
      bytes(JSON.stringify(playerIds));

    const reduction = 1 - v2Bytes / v1Bytes;
    // Logged so the measured number is visible when the suite runs verbose.
    console.info(
      `[match_positions] v1 ${(v1Bytes / 1e6).toFixed(2)} MB → ` +
        `v2 ${(v2Bytes / 1e6).toFixed(2)} MB (${(reduction * 100).toFixed(1)}% smaller)`,
    );

    expect(reduction).toBeGreaterThanOrEqual(0.8);
  });

  it('drops the repeated player ids and the derivable hasBall flag', () => {
    const frames = makeFrames(1);
    const { rows } = encodeAsWorker(frames);
    const json = JSON.stringify(rows[0]!.snapshots);

    // Not one of the 36-char UUIDs survives into a frame, and neither does the
    // flag the reader now derives. These two facts ARE the 86%.
    for (const id of ROSTER) expect(json).not.toContain(id);
    expect(json).not.toContain('hasBall');
    // One frame of 22 players should fit comfortably inside 500 bytes.
    expect(bytes(json)).toBeLessThan(500);
  });
});

// ── 4. Drift guard ───────────────────────────────────────────────────────────

describe('the match-worker still writes the shape these tests encode', () => {
  it('writes the roster once and stores v2 rounded coordinates', () => {
    // vitest runs from the repo root (where vitest.config.ts lives).
    const source = readFileSync(
      resolve(process.cwd(), 'supabase/functions/match-worker/index.ts'),
      'utf8',
    );

    // `encodeAsWorker` above is a hand-mirror of this code path (the Deno entry
    // point cannot be imported into vitest). If the writer changes shape, this
    // fails and the mirror must be re-synced.
    expect(source).toContain("from('match_position_rosters')");
    expect(source).toContain('v: 2,');
    expect(source).toContain('Math.round(n * 10) / 10');
    expect(source).toContain('b: [r1(frame.ball.x), r1(frame.ball.y), ownerIdx]');
    // And it must NOT have gone back to spelling ids out per frame.
    expect(source).not.toContain('hasBall: frame.ball.ownerId === p.id');
  });
});
