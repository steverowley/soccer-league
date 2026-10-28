// ── features/match/logic/viewer/trackLookup.test.ts ─────────────────────────
// The viewer's side of the action track: finding it on the frames, the
// roster its indices name (rebuilt from the frames, through a real v3
// encode and decode, with a substitution in it), and the lookups.

import { describe, expect, it } from 'vitest';
import type { PositionSnapshot } from '../../api/matchPositions';
import type { ActionTrack } from '../replay/actions';
import type { ReplayTrack } from '../replay/recorder';
import { decodeReplayV3, encodeReplayV3 } from '../replay/replayV3';
import { trackToSnapshots } from '../replay/snapshots';
import { actionTrackOf, findReception, makeTrackLookup, rosterFromFrames } from './trackLookup';

/** Three players, then the second replaced by a substitute (engine order keeps the slot). */
const REPLAY: ReplayTrack = {
  dtSec: 0.1,
  everySec: 0.5,
  frames: [
    [{ id: 'h1', x: 10, y: 10 }, { id: 'h2', x: 20, y: 20 }, { id: 'a1', x: 90, y: 30 }],
    [{ id: 'h1', x: 11, y: 10 }, { id: 'h2', x: 21, y: 20 }, { id: 'a1', x: 89, y: 30 }],
    [{ id: 'h1', x: 12, y: 10 }, { id: 'sub', x: 52, y: 68 }, { id: 'a1', x: 88, y: 30 }],
    [{ id: 'h1', x: 13, y: 10 }, { id: 'sub', x: 50, y: 66 }, { id: 'a1', x: 87, y: 30 }],
  ],
  ball: {
    dtSec: 0.1,
    endTick: 15,
    keys: [
      { tick: 0, x: 12, y: 10, z: 0, vx: 20, vy: 0, vz: 0, ownerId: null },
      { tick: 6, x: 30, y: 10, z: 0, vx: 0, vy: 0, vz: 0, ownerId: 'a1' },
    ],
  },
};

describe('rosterFromFrames', () => {
  it('rebuilds the v3 union roster exactly from decoded frames (substitute appended)', () => {
    const file = encodeReplayV3('m1', REPLAY);
    const decoded = decodeReplayV3(file);
    expect(decoded).not.toBeNull();
    const snaps = trackToSnapshots(decoded!);
    expect(rosterFromFrames(snaps)).toEqual(file.roster);
    expect(file.roster).toEqual(['h1', 'h2', 'a1', 'sub']);
  });

  it('gives the same roster from the recorder\'s own frames (the local demo path)', () => {
    expect(rosterFromFrames(trackToSnapshots(REPLAY))).toEqual(encodeReplayV3('m1', REPLAY).roster);
  });
});

describe('actionTrackOf', () => {
  const snaps = trackToSnapshots(REPLAY);
  it('is null when the frames carry no track (v2, older v3: no animations)', () => {
    expect(actionTrackOf(snaps)).toBeNull();
    expect(actionTrackOf([])).toBeNull();
  });

  it('reads the track shared on the frames', () => {
    const track: ActionTrack = { dtSec: 0.1, actions: [{ kind: 'kick', tick: 3, by: 0, kick: 'pass' }] };
    const withTrack = snaps.map((s) => ({ ...s, actionTrack: track })) as PositionSnapshot[];
    expect(actionTrackOf(withTrack)).toBe(track);
  });
});

describe('lookups', () => {
  const snaps = trackToSnapshots(REPLAY);
  it('findReception: where and when the ball is next owned', () => {
    const meet = findReception(snaps, 0);
    expect(meet).not.toBeNull();
    expect(meet!.sec).toBeGreaterThanOrEqual(0.6);
    expect(meet!.x).toBeCloseTo(30);
  });

  it('makeTrackLookup: ball position, reception and side by roster index', () => {
    const roster = rosterFromFrames(snaps);
    const look = makeTrackLookup(snaps, roster, (id) => (id.startsWith('a') ? 'away' : 'home'));
    expect(look.ballAt(0)?.x).toBeCloseTo(12);
    expect(look.ballAt(0)).toBe(look.ballAt(0)); // memoised
    expect(look.receptionAfter(0)?.x).toBeCloseTo(30);
    expect(look.sideOf(2)).toBe('away');
    expect(look.sideOf(3)).toBe('home');
    expect(look.sideOf(99)).toBeNull();
  });
});
