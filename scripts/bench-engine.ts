// Time full simulations of the current engine (CPU, single thread).
// Six full matches of real ISL squads (scripts/fixtures/bench-teams.json, with
// each manager's game model); prints each time and the median (the 4th of 6).
// Budget and how to read it: docs/emergent-engine.md, section 9 "CPU budget".
// Run: npm run bench:engine
import { simulateSpatialMatch } from '../src/features/match/logic/spatial/simulateSpatialMatch';
import { toSpatialTeamInput } from '../src/features/match/logic/spatial/spatialEventAdapter';
import teams from './fixtures/bench-teams.json';

/** A fixture player: [name, position, starter, attacking, defending, mental, athletic, technical]. */
type FixturePlayer = [string, string, boolean, number, number, number, number, number];
interface FixtureTeam { id: string; f: string; s: string; gm: unknown; ps: FixturePlayer[] }

function row(t: FixtureTeam): Parameters<typeof toSpatialTeamInput>[0] {
  return {
    managers: [{ preferred_formation: t.f, style: t.s, game_model: t.gm }],
    players: t.ps.map((p, i) => ({
      id: `${t.id}-${i}`, name: p[0], position: p[1], starter: p[2],
      attacking: p[3], defending: p[4], mental: p[5], athletic: p[6], technical: p[7],
    })),
  };
}
const T = (teams as unknown as FixtureTeam[]).map(row);
const pairs = [[0, 2], [4, 1], [3, 5]] as const;
const times: number[] = [];
for (let i = 0; i < 6; i++) {
  const [a, b] = pairs[i % 3]!;
  const h = toSpatialTeamInput(T[a]!);
  const w = toSpatialTeamInput(T[b]!);
  const t0 = performance.now();
  const r = simulateSpatialMatch(h, w, { seed: 1000 + i });
  const ms = performance.now() - t0;
  times.push(ms);
  console.log(`match ${i}: ${Math.round(ms)} ms, ${r.events.length} events, ${r.frames.length} frames`);
}
times.sort((x, y) => x - y);
console.log('median ms', Math.round(times[3]!));
