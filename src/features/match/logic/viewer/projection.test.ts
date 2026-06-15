// ── projection.test.ts ──────────────────────────────────────────────────────
// Verifies the broadcast + follow projections: centring, depth scaling, the
// "near is bigger / fans wider" tilt, and the follow camera's zoom + clamp.

import { describe, it, expect } from 'vitest';

import {
  FOLLOW_ZOOM,
  projectBroadcast,
  projectFollow,
  followAnchor,
  clampFollowCenter,
  smoothFollowCenter,
  type Viewport,
} from './projection';

const VP: Viewport = { width: 320, height: 208 };
const CENTRE = { x: 52.5, y: 34 }; // centre spot in metres

describe('projectBroadcast', () => {
  it('maps the centre spot to the horizontal centre of the canvas', () => {
    const p = projectBroadcast(CENTRE.x, CENTRE.y, 0, VP);
    expect(p.x).toBeCloseTo(VP.width / 2, 5);
  });

  it('mirrors the two goals symmetrically about the centre', () => {
    const home = projectBroadcast(0, 34, 0, VP);
    const away = projectBroadcast(105, 34, 0, VP);
    expect(home.x).toBeCloseTo(VP.width - away.x, 5);
    expect(home.x).toBeLessThan(VP.width / 2);
    expect(away.x).toBeGreaterThan(VP.width / 2);
  });

  it('places near (high y) lower on screen and larger than far (low y)', () => {
    const far = projectBroadcast(52.5, 0, 0, VP);
    const near = projectBroadcast(52.5, 68, 0, VP);
    expect(near.y).toBeGreaterThan(far.y); // nearer the camera = further down
    expect(near.sc).toBeGreaterThan(far.sc); // nearer = bigger
  });

  it('fans wider toward the near touchline (perspective)', () => {
    const farLeft = projectBroadcast(0, 0, 0, VP);
    const nearLeft = projectBroadcast(0, 68, 0, VP);
    // near-left edge sits further from centre than far-left edge
    expect(VP.width / 2 - nearLeft.x).toBeGreaterThan(VP.width / 2 - farLeft.x);
  });

  it('lifts a point off the ground as height increases', () => {
    const ground = projectBroadcast(52.5, 34, 0, VP);
    const aloft = projectBroadcast(52.5, 34, 5, VP);
    expect(aloft.y).toBeLessThan(ground.y); // higher z = drawn higher
    expect(aloft.x).toBeCloseTo(ground.x, 5);
  });
});

describe('projectFollow', () => {
  it('puts the centred world point at the canvas centre and zooms', () => {
    const center = followAnchor(CENTRE.x, CENTRE.y, VP);
    const at = projectFollow(CENTRE.x, CENTRE.y, 0, VP, center);
    expect(at.x).toBeCloseTo(VP.width / 2, 5);
    // depth scale is the broadcast scale × zoom
    const b = projectBroadcast(CENTRE.x, CENTRE.y, 0, VP);
    expect(at.sc).toBeCloseTo(b.sc * FOLLOW_ZOOM, 5);
  });

  it('magnifies separation between two points by the zoom factor', () => {
    const center = followAnchor(CENTRE.x, CENTRE.y, VP);
    const a = projectFollow(40, 34, 0, VP, center);
    const b = projectFollow(65, 34, 0, VP, center);
    const ba = projectBroadcast(40, 34, 0, VP);
    const bb = projectBroadcast(65, 34, 0, VP);
    expect(Math.abs(b.x - a.x)).toBeCloseTo(Math.abs(bb.x - ba.x) * FOLLOW_ZOOM, 4);
  });
});

describe('clampFollowCenter', () => {
  it('keeps the centre within bounds for an off-pitch anchor', () => {
    const wild = clampFollowCenter({ x: -9999, y: 9999 }, VP);
    expect(wild.x).toBeGreaterThan(0);
    expect(wild.x).toBeLessThan(VP.width);
    expect(wild.y).toBeGreaterThan(0);
    expect(wild.y).toBeLessThan(VP.height);
  });
});

describe('smoothFollowCenter', () => {
  it('moves partway toward the target and converges as dt grows', () => {
    const prev = { x: 0, y: 0 };
    const target = { x: 100, y: 50 };
    const step = smoothFollowCenter(prev, target, 1 / 60);
    expect(step.x).toBeGreaterThan(0);
    expect(step.x).toBeLessThan(target.x); // partial step, not a snap
    const big = smoothFollowCenter(prev, target, 10);
    expect(big.x).toBeCloseTo(target.x, 1); // a long dt nearly arrives
  });
});
