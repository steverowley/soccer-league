// Time full simulations of the current engine (CPU, single thread).
import { simulateSpatialMatch } from '../src/features/match/logic/spatial/simulateSpatialMatch';
import { toSpatialTeamInput, buildPlayerIndex } from '../src/features/match/logic/spatial/spatialEventAdapter';
import teams from './fixtures/bench-teams.json';

function row(t: any) {
  return {
    id: t.id, name: t.name, short_name: t.short, color: t.color,
    managers: [{ preferred_formation: t.f, style: t.s, game_model: t.gm }],
    players: t.ps.map((p: any, i: number) => ({
      id: `${t.id}-${i}`, name: p[0], position: p[1], starter: p[2], team_id: t.id,
      attacking: p[3], defending: p[4], mental: p[5], athletic: p[6], technical: p[7],
    })),
  };
}
const T = (teams as any[]).map(row);
const pairs = [[0, 2], [4, 1], [3, 5]];
const times: number[] = [];
for (let i = 0; i < 6; i++) {
  const [a, b] = pairs[i % 3];
  const h = toSpatialTeamInput(T[a] as any, 'home');
  const w = toSpatialTeamInput(T[b] as any, 'away');
  const t0 = performance.now();
  const r = simulateSpatialMatch(h, w, { seed: 1000 + i } as any);
  const ms = performance.now() - t0;
  times.push(ms);
  console.log(`match ${i}: ${Math.round(ms)} ms, ${r.events.length} events, ${r.frames?.length ?? 0} frames`);
}
times.sort((x, y) => x - y);
console.log('median ms', Math.round(times[3]));
void buildPlayerIndex;
