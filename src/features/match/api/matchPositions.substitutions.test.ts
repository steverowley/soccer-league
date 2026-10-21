// ── features/match/api/matchPositions.substitutions.test.ts ──────────────────
// Regression guard for the bug that the v2 compact frame format shipped with.
//
// WHAT WENT WRONG
// ───────────────
// v2 stores player coordinates POSITIONALLY against a roster held once per
// match, which is what makes it ~86% smaller than v1. The first version built
// that roster from frame 0 and assumed the player set never changed, on the
// stated belief that the engine "never substitutes".
//
// The engine does substitute. `maybeSubstitute` in spatial/step.ts replaces the
// most tired outfield starter on each side from minute 55, up to three per side,
// and the outgoing player leaves the replay frames while the incoming one joins.
// The side stays eleven strong, so the per-frame coordinate COUNT never changes,
// which is precisely why the reader's length check could not detect it.
//
// Net effect before the fix: from roughly minute 56 to full time, every
// coordinate was attributed to the wrong player. The pitch still animated
// plausibly, which is what made it dangerous.
//
// WHY THIS TEST DRIVES THE REAL ENGINE
// ────────────────────────────────────
// A hand-built fixture would encode whatever assumption the author already
// held, which is how the bug got in. This runs `simulateSpatialMatch` with real
// benches so the substitutions are the engine's own, then asserts the decoded
// identities match the engine's frames at a point AFTER the first change.

import { describe, it, expect } from 'vitest';
import { getMatchPositions, type PositionSnapshot } from './matchPositions';
import {
  simulateSpatialMatch,
  type SpatialTeamInput,
  type SpatialPlayerInput,
} from '../logic/spatial/simulateSpatialMatch';
import type { Role, SimPlayerStats } from '../logic/spatial/types';

const OFF_PITCH = -1;
const r1 = (n: number) => Math.round(n * 10) / 10;

const XI_ROLES: Role[] = ['GK', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'FW', 'FW'];
const BENCH_ROLES: Role[] = ['DF', 'MF', 'MF', 'FW', 'FW'];

const stats = (role: Role): SimPlayerStats => ({
  shooting: 70,
  passing: 70,
  dribbling: 70,
  speed: 70,
  stamina: 70,
  tackling: 70,
  positioning: 70,
  goalkeeping: role === 'GK' ? 80 : 35,
  vision: 70,
});

/** A side with a real bench, so the engine's substitution path is reachable. */
function team(side: string): SpatialTeamInput {
  return {
    formation: '4-4-2',
    players: XI_ROLES.map(
      (role, i): SpatialPlayerInput => ({
        id: `${side}-start-${i}`,
        name: `${side}S${i}`,
        role,
        stats: stats(role),
      }),
    ),
    bench: BENCH_ROLES.map(
      (role, i): SpatialPlayerInput => ({
        id: `${side}-bench-${i}`,
        name: `${side}B${i}`,
        role,
        stats: stats(role),
      }),
    ),
  };
}

interface Frame {
  tSec: number;
  players: Array<{ id: string; x: number; y: number }>;
  ball: { x: number; y: number; ownerId: string | null };
}

/** The match-worker's encoder: union roster, fixed-width rows, sentinel gaps. */
function encodeAsWorker(frames: Frame[]) {
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
    const p = new Array<number>(playerIds.length * 2).fill(OFF_PITCH);
    for (const pl of frame.players) {
      const i = index.get(pl.id)!;
      p[i * 2] = r1(pl.x);
      p[i * 2 + 1] = r1(pl.y);
    }
    const ownerIdx = frame.ball.ownerId == null ? -1 : (index.get(frame.ball.ownerId) ?? -1);
    return {
      minute: Math.min(120, Math.max(1, Math.floor(frame.tSec / 60) + 1)),
      second: Math.floor(frame.tSec % 60),
      snapshots: { v: 2 as const, p, b: [r1(frame.ball.x), r1(frame.ball.y), ownerIdx] },
    };
  });
  return { playerIds, rows };
}

/** Minimal table-aware Supabase stub: frames from one table, roster from the other. */
function makeDb(rows: unknown[], roster: string[]) {
  return {
    from(table: string) {
      if (table === 'match_position_rosters') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: { player_ids: roster }, error: null }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            order: () => ({
              order: () => ({
                range: (from: number, to: number) =>
                  Promise.resolve({ data: rows.slice(from, to + 1), error: null }),
              }),
            }),
          }),
        }),
      };
    },
  } as unknown as Parameters<typeof getMatchPositions>[0];
}

describe('v2 frames survive the engine substituting players', () => {
  // One full simulated match, reused by every assertion below.
  const result = simulateSpatialMatch(team('H'), team('A'), { seed: 12345 });
  const frames = result.frames as unknown as Frame[];
  const subs = result.events.filter((e) => e.type === 'substitution');

  it('the engine really does substitute, so this guard is meaningful', () => {
    // If this ever fails the engine changed, not the encoder. Re-read the
    // encoder's assumptions before relaxing anything here.
    expect(subs.length).toBeGreaterThan(0);

    const firstIds = new Set(frames[0]!.players.map((p) => p.id));
    const changedAt = frames.findIndex((f) => f.players.some((p) => !firstIds.has(p.id)));
    expect(changedAt).toBeGreaterThan(0);

    // The count stays constant, which is the reason a length check is not
    // sufficient protection and this test has to exist.
    const counts = new Set(frames.map((f) => f.players.length));
    expect([...counts]).toEqual([firstIds.size]);
  });

  it('the union roster is larger than the starting XI', () => {
    const { playerIds } = encodeAsWorker(frames);
    const firstIds = new Set(frames[0]!.players.map((p) => p.id));
    expect(playerIds.length).toBeGreaterThan(firstIds.size);
  });

  it('decodes the correct identities AFTER the first substitution', async () => {
    const { playerIds, rows } = encodeAsWorker(frames);
    const firstIds = new Set(frames[0]!.players.map((p) => p.id));
    const changedAt = frames.findIndex((f) => f.players.some((p) => !firstIds.has(p.id)));

    const decoded = await getMatchPositions(makeDb(rows, playerIds), 'm1');
    expect(decoded).toHaveLength(frames.length);

    // Check a frame well past the first change, where the old encoder was wrong.
    const probe = Math.min(changedAt + 50, frames.length - 1);
    const expectedIds = [...frames[probe]!.players.map((p) => p.id)].sort();
    const actualIds = [...decoded[probe]!.snapshots.players.map((p) => p.id)].sort();
    expect(actualIds).toEqual(expectedIds);

    // And a substitute specifically: present late, absent at kickoff.
    const lateIds = new Set(frames[frames.length - 1]!.players.map((p) => p.id));
    const introduced = [...lateIds].filter((id) => !firstIds.has(id));
    expect(introduced.length).toBeGreaterThan(0);
    const lastDecoded = decoded[decoded.length - 1]!.snapshots.players.map((p) => p.id);
    for (const id of introduced) expect(lastDecoded).toContain(id);
  });

  it('never reports a player who has left the pitch', async () => {
    const { playerIds, rows } = encodeAsWorker(frames);
    const decoded = await getMatchPositions(makeDb(rows, playerIds), 'm1');

    frames.forEach((frame, i) => {
      const expected = new Set(frame.players.map((p) => p.id));
      for (const p of decoded[i]!.snapshots.players) {
        expect(expected.has(p.id)).toBe(true);
      }
      // Sentinel holders are dropped, so counts agree with the engine exactly.
      expect(decoded[i]!.snapshots.players).toHaveLength(frame.players.length);
    });
  });

  it('keeps coordinates attached to the right player at every frame', async () => {
    const { playerIds, rows } = encodeAsWorker(frames);
    const decoded = await getMatchPositions(makeDb(rows, playerIds), 'm1');

    // Spot-check across the whole match rather than only the start, since the
    // original bug was invisible before minute 56.
    for (let i = 0; i < frames.length; i += 137) {
      const byId = new Map(frames[i]!.players.map((p) => [p.id, p]));
      for (const got of decoded[i]!.snapshots.players) {
        const want = byId.get(got.id)!;
        expect(got.x).toBeCloseTo(r1(want.x), 5);
        expect(got.y).toBeCloseTo(r1(want.y), 5);
      }
    }
  });

  it('still identifies the ball carrier after substitutions', async () => {
    const { playerIds, rows } = encodeAsWorker(frames);
    const decoded = await getMatchPositions(makeDb(rows, playerIds), 'm1');

    frames.forEach((frame, i) => {
      const snap = decoded[i]!.snapshots;
      expect(snap.ball.ownerId).toBe(frame.ball.ownerId);
      const carriers = snap.players.filter(
        (p: PositionSnapshot['snapshots']['players'][number]) => p.hasBall,
      );
      if (frame.ball.ownerId == null) {
        expect(carriers).toHaveLength(0);
      } else {
        expect(carriers.map((c) => c.id)).toEqual([frame.ball.ownerId]);
      }
    });
  });
});
