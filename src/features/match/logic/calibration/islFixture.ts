// ── features/match/logic/calibration/islFixture.ts ──────────────────────────
// The real-squad fixture the engine is calibrated on.
//
// WHY REAL SQUADS
//   The calibration contract (spatial/matchDistributions.test.ts) used to play
//   two IDENTICAL average-rated sides.  Identical sides cancel each other out:
//   fewer chances, fewer saves, more draws and penalties than the real league
//   produces.  The live league (real squads, real managers' game models) was
//   already inside every real-football band we can check against its results
//   (Season 1, 234 matches: 2.99 goals, 0.29 draws, 6.19 saves a match), while
//   the equal-sides fixture reported gaps in saves, goals, draws and penalties
//   that only existed in the fixture.  So realism is measured on the clubs the
//   league actually plays.
//
// WHAT IS IN IT
//   islSquads.json is a snapshot of every ISL club taken from the live league
//   (scripts/snapshot-isl-squads.mjs): players with their five attribute
//   columns, starter flag and personality, the manager's formation, style and
//   game model.  islTeam() turns a club into engine input exactly as the match
//   worker does (toSpatialTeamInput, then applyTeamTraits with the
//   personalities), so the test and the worker see the same team.
//
//   islFixture(m) is match m of the fixed calibration schedule: pair m/2 is
//   played twice, once at each club's ground, on two different seeds; five
//   pairs in six are league fixtures (the league programme is almost all
//   league play) taken in turn from all four leagues, the sixth is a
//   cross-league cup-style tie.  The schedule mixes close and mismatched
//   pairings and is identical on every run.

import squads from './islSquads.json';
import { toSpatialTeamInput } from '../spatial/spatialEventAdapter';
import { applyTeamTraits } from '../spatial/traitModifiers';
import type { SpatialTeamInput } from '../spatial/simulateSpatialMatch';

/** A snapshot player: [jersey, name, position, starter, attacking, defending, mental, athletic, technical, personality]. */
type SnapshotPlayer = [number, string, string, boolean, number, number, number, number, number, string | null];

interface SnapshotClub {
  id: string;
  league: string;
  f: string;
  s: string;
  gm: unknown;
  ps: SnapshotPlayer[];
}

const CLUBS = (squads as unknown as { clubs: SnapshotClub[] }).clubs;

/** Date the squads were read from the live league. */
export const ISL_SNAPSHOT: string = (squads as unknown as { snapshot: string }).snapshot;

/** Every club id in the snapshot, sorted. */
export function islClubIds(): string[] {
  return CLUBS.map((c) => c.id).sort();
}

/** Club ids of each league, sorted, leagues in name order. */
function leagues(): string[][] {
  const by = new Map<string, string[]>();
  for (const c of CLUBS) by.set(c.league, [...(by.get(c.league) ?? []), c.id]);
  return [...by.keys()].sort().map((k) => by.get(k)!.sort());
}

/** One club as the match worker hands it to the engine. */
export function islTeam(id: string): SpatialTeamInput {
  const club = CLUBS.find((c) => c.id === id);
  if (!club) throw new Error(`no club ${id} in the ISL snapshot`);
  // Zero-padded jersey keeps every id unique (player 1 and 10 must differ).
  const pid = (p: SnapshotPlayer): string => `${club.id}-${String(p[0]).padStart(2, '0')}`;
  const input = toSpatialTeamInput({
    managers: [{ preferred_formation: club.f, style: club.s, game_model: club.gm }],
    players: club.ps.map((p) => ({
      id: pid(p), name: p[1], position: p[2], starter: p[3], is_active: true,
      attacking: p[4], defending: p[5], mental: p[6], athletic: p[7], technical: p[8],
    })),
  });
  return applyTeamTraits(input, new Map(club.ps.map((p) => [pid(p), p[9]])));
}

/** All 28 pairings of an 8-club league, in a fixed order. */
function leaguePairings(n: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) out.push([i, j]);
  return out;
}

export interface IslFixture {
  home: string;
  away: string;
  seed: number;
  /** Index of the pairing: matches 2k and 2k+1 are the same clubs, venues swapped. */
  pair: number;
  crossLeague: boolean;
}

/**
 * Match m of the calibration schedule (m = 0, 1, 2, ...).  Seeds are
 * seedBase + m, so the first 24 matches of a long batch ARE the test's batch.
 * League pairs walk each league's 28 pairings in a stride-11 order (every
 * pairing once per 28 rounds, like a season); cross-league pairs cycle the
 * leagues and step through their clubs.
 */
export function islFixture(m: number, seedBase = 1000): IslFixture {
  const L = leagues();
  const pair = Math.floor(m / 2);
  const crossLeague = pair % 6 === 5;
  let x: string;
  let y: string;
  if (crossLeague) {
    const c = Math.floor(pair / 6);
    const la = L[c % L.length]!;
    const lb = L[(c + 1 + (Math.floor(c / L.length) % (L.length - 1))) % L.length]!;
    x = la[(c * 3) % la.length]!;
    y = lb[(c * 5 + 1) % lb.length]!;
  } else {
    const w = pair - Math.floor((pair + 1) / 6);
    const lg = L[w % L.length]!;
    const all = leaguePairings(lg.length);
    const [i, j] = all[(Math.floor(w / L.length) * 11) % all.length]!;
    x = lg[i]!;
    y = lg[j]!;
  }
  const swap = m % 2 === 1;
  return { home: swap ? y : x, away: swap ? x : y, seed: seedBase + m, pair, crossLeague };
}
