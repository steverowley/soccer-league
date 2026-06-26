// ── features/match/logic/spatial/spatialEventAdapter.test.ts ─────────────────
// Unit tests for the spatial-engine → match_events bridge.
//
// Tests are structured around the three exported concerns:
//   1. adaptSpatialResult  — event conversion, stat accumulation, MVP, commentary
//   2. buildPlayerIndex    — roster → lookup map
//   3. deriveSimStats      — 5 composite stats → 9 fine-grained stats
//   4. toSpatialTeamInput  — raw DB row → SpatialTeamInput
//
// We test the CONTRACTS (payload shape, stat monotonicity, ordering invariants)
// rather than exact magic numbers so the suite stays green as tuning evolves.

import { describe, it, expect } from 'vitest';
import {
  adaptSpatialResult,
  buildPlayerIndex,
  deriveSimStats,
  toSpatialTeamInput,
  filterNotableEvents,
  type PlayerIndex,
  type AdaptedEvent,
} from './spatialEventAdapter';
import type { SpatialMatchResult, SimEvent, PositionFrame } from './types';

// ── Fixture helpers ───────────────────────────────────────────────────────────

function makeIndex(entries: Array<{ id: string; name: string; teamName: string; side: 'home' | 'away' }>): PlayerIndex {
  const m: PlayerIndex = new Map();
  for (const e of entries) m.set(e.id, { ...e });
  return m;
}

function baseResult(events: SimEvent[], score: [number, number] = [0, 0]): SpatialMatchResult {
  return { finalScore: score, events, frames: [] as PositionFrame[] };
}

function ev(
  overrides: Partial<SimEvent> & { type: SimEvent['type'] },
): SimEvent {
  return {
    tSec:   300,   // 5:00 into the match → minute=5
    minute: 5,
    ...overrides,
  };
}

// ── adaptSpatialResult: fouls + cards ──────────────────────────────────────────

describe('adaptSpatialResult — fouls + cards', () => {
  const index = makeIndex([
    { id: 'd1', name: 'Defender', teamName: 'Rovers', side: 'home' },
    { id: 'a1', name: 'Attacker', teamName: 'City',   side: 'away' },
  ]);

  it('books the fouler on a yellow-card foul and tags the payload', () => {
    const result = baseResult([ev({ type: 'foul', playerId: 'd1', otherId: 'a1', side: 'home', card: 'yellow' })]);
    const adapted = adaptSpatialResult(result, index);
    expect(adapted.playerStats['Defender']?.yellowCard).toBe(true);
    expect(adapted.playerStats['Defender']?.redCard).toBe(false);
    expect(adapted.events[0]!.payload['cardType']).toBe('yellow');
  });

  it('sends off the fouler on a red-card foul', () => {
    const result = baseResult([ev({ type: 'foul', playerId: 'd1', otherId: 'a1', side: 'home', card: 'red' })]);
    const adapted = adaptSpatialResult(result, index);
    expect(adapted.playerStats['Defender']?.redCard).toBe(true);
  });

  it('a cardless foul books nobody but still surfaces in the notable feed', () => {
    const result = baseResult([ev({ type: 'foul', playerId: 'd1', otherId: 'a1', side: 'home' })]);
    const adapted = adaptSpatialResult(result, index);
    expect(adapted.playerStats['Defender']).toBeUndefined(); // no card ⇒ no stat row created
    expect(filterNotableEvents(adapted.events).some((e) => e.type === 'foul')).toBe(true);
  });
});

describe('adaptSpatialResult — offside', () => {
  it('keeps offside in the notable feed with caught-offside commentary and no stat change', () => {
    const index = makeIndex([{ id: 'fw', name: 'Striker', teamName: 'Rovers', side: 'home' }]);
    const result = baseResult([ev({ type: 'offside', playerId: 'fw', side: 'home' })]);
    const adapted = adaptSpatialResult(result, index);
    expect(adapted.events[0]!.payload['commentary']).toBe('Striker is caught offside.');
    expect(filterNotableEvents(adapted.events).some((e) => e.type === 'offside')).toBe(true);
    expect(adapted.playerStats['Striker']).toBeUndefined(); // offside isn't a player stat
  });
});

// ── adaptSpatialResult ────────────────────────────────────────────────────────

describe('adaptSpatialResult — event shape', () => {
  it('preserves minute and type on each adapted event', () => {
    const index = makeIndex([{ id: 'p1', name: 'Striker', teamName: 'Rovers', side: 'home' }]);
    const result = baseResult([ev({ type: 'goal', minute: 22, tSec: 22 * 60, playerId: 'p1', side: 'home' })]);
    const adapted = adaptSpatialResult(result, index);
    expect(adapted.events[0]!.minute).toBe(22);
    expect(adapted.events[0]!.type).toBe('goal');
  });

  it('subminute is in [0, 0.999] for every event', () => {
    // 0 tSec and boundary tSec values.
    const index = makeIndex([]);
    const events: SimEvent[] = [
      ev({ type: 'kickoff', tSec: 0, minute: 1 }),
      ev({ type: 'pass',    tSec: 59.99, minute: 1 }),
      ev({ type: 'tackle',  tSec: 60, minute: 2 }),   // exactly on a minute boundary
      ev({ type: 'goal',    tSec: 5399, minute: 90 }),
    ];
    const { events: out } = adaptSpatialResult(baseResult(events), index);
    for (const e of out) {
      expect(e.subminute).toBeGreaterThanOrEqual(0);
      expect(e.subminute).toBeLessThanOrEqual(0.999);
    }
  });

  it('subminute sorts events within the same minute in arrival order', () => {
    const index = makeIndex([]);
    // Two events in minute 10: at 10:05 and 10:45.
    const e1 = ev({ type: 'pass', tSec: 605, minute: 10 });
    const e2 = ev({ type: 'tackle', tSec: 645, minute: 10 });
    const { events: out } = adaptSpatialResult(baseResult([e1, e2]), index);
    expect(out[0]!.subminute).toBeLessThan(out[1]!.subminute);
  });

  it('payload.isGoal is true only for goal events', () => {
    const index = makeIndex([{ id: 'p1', name: 'Scorer', teamName: 'Rovers', side: 'home' }]);
    const events: SimEvent[] = [
      ev({ type: 'goal', playerId: 'p1', side: 'home' }),
      ev({ type: 'shot' }),
      ev({ type: 'tackle' }),
    ];
    const { events: out } = adaptSpatialResult(baseResult(events), index);
    expect(out[0]!.payload.isGoal).toBe(true);
    expect(out[1]!.payload.isGoal).toBe(false);
    expect(out[2]!.payload.isGoal).toBe(false);
  });

  it('payload includes player name and team for events with a known playerId', () => {
    const index = makeIndex([{ id: 'p1', name: 'Luca Vega', teamName: 'Rovers', side: 'home' }]);
    const { events: out } = adaptSpatialResult(
      baseResult([ev({ type: 'goal', playerId: 'p1', side: 'home' })]),
      index,
    );
    expect(out[0]!.payload.player).toBe('Luca Vega');
    expect(out[0]!.payload.team).toBe('Rovers');
  });

  it('payload includes keeper name on shot events with a known otherId', () => {
    const index = makeIndex([
      { id: 'p1', name: 'Striker', teamName: 'Rovers', side: 'home' },
      { id: 'gk', name: 'Keeper',  teamName: 'City',   side: 'away' },
    ]);
    const { events: out } = adaptSpatialResult(
      baseResult([ev({ type: 'shot', playerId: 'p1', otherId: 'gk', side: 'home' })]),
      index,
    );
    expect(out[0]!.payload.keeper).toBe('Keeper');
  });

  it('payload.commentary is a non-empty string for every event type', () => {
    const index = makeIndex([{ id: 'p1', name: 'Any', teamName: 'Team', side: 'home' }]);
    const types: SimEvent['type'][] = [
      'kickoff', 'goal', 'shot', 'save', 'tackle', 'interception',
      'pass', 'out_throw', 'out_goalkick', 'out_corner',
    ];
    const events = types.map((type) => ev({ type, playerId: 'p1', side: 'home' }));
    const { events: out } = adaptSpatialResult(baseResult(events), index);
    for (const e of out) {
      expect(typeof e.payload.commentary).toBe('string');
      expect((e.payload.commentary as string).length).toBeGreaterThan(0);
    }
  });

  it('goal commentary names the scorer and team', () => {
    const index = makeIndex([{ id: 'p1', name: 'Rico Cruz', teamName: 'Stellar', side: 'home' }]);
    const { events: out } = adaptSpatialResult(
      baseResult([ev({ type: 'goal', playerId: 'p1', side: 'home' })]),
      index,
    );
    const text = out[0]!.payload.commentary as string;
    expect(text).toContain('Rico Cruz');
    expect(text).toContain('Stellar');
  });

  it('passes frames through unchanged', () => {
    const frame: PositionFrame = { tSec: 0, players: [], ball: { x: 52.5, y: 34, ownerId: null } };
    const result: SpatialMatchResult = { finalScore: [0, 0], events: [], frames: [frame] };
    const adapted = adaptSpatialResult(result, new Map());
    expect(adapted.frames).toStrictEqual([frame]);
  });

  it('preserves finalScore', () => {
    const adapted = adaptSpatialResult(baseResult([], [2, 1]), new Map());
    expect(adapted.finalScore).toEqual([2, 1]);
  });
});

describe('filterNotableEvents (#519)', () => {
  const aev = (type: string, payload: Record<string, unknown> = {}): AdaptedEvent =>
    ({ minute: 5, subminute: 0, type, payload });

  it('drops the per-tick flood and keeps only the notable beats', () => {
    const events: AdaptedEvent[] = [
      aev('kickoff'), aev('goal'), aev('save'), aev('out_corner'),
      aev('tackle'), aev('interception'), aev('pass'), aev('out_throw'), aev('out_goalkick'),
    ];
    const out = filterNotableEvents(events);
    expect(out.map((e) => e.type).sort()).toEqual(['goal', 'kickoff', 'out_corner', 'save']);
  });

  it('always keeps worker-injected mvp + architect_interference events', () => {
    const out = filterNotableEvents([aev('mvp'), aev('architect_interference'), aev('tackle')]);
    expect(out.map((e) => e.type).sort()).toEqual(['architect_interference', 'mvp']);
  });

  it('keeps any Architect-touched event even on a dropped type', () => {
    // A force_red_card-promoted tackle and a curse-downgraded goal (now a 'shot')
    // both carry interferenceApplied and must survive the trim, while a plain
    // tackle is dropped.
    const out = filterNotableEvents([
      aev('tackle', { interferenceApplied: 'force_red_card', cardType: 'red' }),
      aev('shot',   { interferenceApplied: 'curse', isGoal: false }),
      aev('tackle'),
    ]);
    expect(out).toHaveLength(2);
    expect(out.every((e) => e.payload['interferenceApplied'] != null)).toBe(true);
  });

  it('does not mutate the input array', () => {
    const events = [aev('tackle'), aev('goal')];
    const out = filterNotableEvents(events);
    expect(events).toHaveLength(2); // input untouched
    expect(out).toHaveLength(1);
  });

  it('keeps woodwork near-misses as first-class beats (#588)', () => {
    const out = filterNotableEvents([aev('woodwork'), aev('pass'), aev('tackle')]);
    expect(out.map((e) => e.type)).toEqual(['woodwork']);
  });
});

describe('adaptSpatialResult — playerStats accumulation', () => {
  it('counts goals for the acting player', () => {
    const index = makeIndex([{ id: 'p1', name: 'Scorer', teamName: 'A', side: 'home' }]);
    const result = baseResult([
      ev({ type: 'goal', playerId: 'p1', side: 'home' }),
      ev({ type: 'goal', playerId: 'p1', side: 'home' }),
    ]);
    const { playerStats } = adaptSpatialResult(result, index);
    expect(playerStats['Scorer']!.goals).toBe(2);
  });

  it('counts shots for the shooter', () => {
    const index = makeIndex([{ id: 'p1', name: 'Shooter', teamName: 'A', side: 'home' }]);
    const { playerStats } = adaptSpatialResult(
      baseResult([ev({ type: 'shot', playerId: 'p1', side: 'home' })]),
      index,
    );
    expect(playerStats['Shooter']!.shots).toBe(1);
  });

  it('credits a keeper save to otherId on shot events', () => {
    const index = makeIndex([
      { id: 'p1', name: 'Shooter', teamName: 'A', side: 'home' },
      { id: 'gk', name: 'GoalKeeper', teamName: 'B', side: 'away' },
    ]);
    const { playerStats } = adaptSpatialResult(
      baseResult([ev({ type: 'shot', playerId: 'p1', otherId: 'gk', side: 'home' })]),
      index,
    );
    expect(playerStats['GoalKeeper']!.saves).toBe(1);
  });

  it('does not double-count saves on standalone save events (playerId only)', () => {
    // A 'save' event where the keeper is in playerId (no otherId) should give
    // exactly 1 save to the keeper.
    const index = makeIndex([{ id: 'gk', name: 'Keeper', teamName: 'B', side: 'away' }]);
    const { playerStats } = adaptSpatialResult(
      baseResult([ev({ type: 'save', playerId: 'gk', side: 'away' })]),
      index,
    );
    expect(playerStats['Keeper']!.saves).toBe(1);
  });

  it('counts tackles for the tackler', () => {
    const index = makeIndex([{ id: 'df', name: 'Defender', teamName: 'B', side: 'away' }]);
    const { playerStats } = adaptSpatialResult(
      baseResult([ev({ type: 'tackle', playerId: 'df', side: 'away' })]),
      index,
    );
    expect(playerStats['Defender']!.tackles).toBe(1);
  });

  it('initialises all stat fields so no field is undefined', () => {
    const index = makeIndex([{ id: 'p1', name: 'P', teamName: 'T', side: 'home' }]);
    const { playerStats } = adaptSpatialResult(
      baseResult([ev({ type: 'goal', playerId: 'p1', side: 'home' })]),
      index,
    );
    const s = playerStats['P']!;
    expect(s.goals).toBeDefined();
    expect(s.assists).toBeDefined();
    expect(s.shots).toBeDefined();
    expect(s.saves).toBeDefined();
    expect(s.tackles).toBeDefined();
    expect(s.yellowCard).toBe(false);
    expect(s.redCard).toBe(false);
  });
});

describe('adaptSpatialResult — MVP', () => {
  it('names the goal-scorer when one player scored', () => {
    const index = makeIndex([
      { id: 'p1', name: 'HeroStriker', teamName: 'A', side: 'home' },
      { id: 'p2', name: 'OtherPlayer', teamName: 'B', side: 'away' },
    ]);
    const result = baseResult([
      ev({ type: 'goal', playerId: 'p1', side: 'home' }),
      ev({ type: 'tackle', playerId: 'p2', side: 'away' }),
    ]);
    const { mvp } = adaptSpatialResult(result, index);
    expect(mvp).toBe('HeroStriker');
  });

  it('returns "—" when no player accumulated any stats', () => {
    const { mvp } = adaptSpatialResult(baseResult([ev({ type: 'kickoff' })]), new Map());
    expect(mvp).toBe('—');
  });

  it('prefers goals over saves over tackles', () => {
    const index = makeIndex([
      { id: 'scorer', name: 'Scorer',   teamName: 'A', side: 'home' },
      { id: 'keeper', name: 'Keeper',   teamName: 'B', side: 'away' },
      { id: 'dfer',   name: 'Defender', teamName: 'B', side: 'away' },
    ]);
    const result = baseResult([
      ev({ type: 'goal',   playerId: 'scorer', side: 'home' }),
      ev({ type: 'shot',   playerId: 'scorer', otherId: 'keeper', side: 'home' }),
      ev({ type: 'tackle', playerId: 'dfer',   side: 'away' }),
      ev({ type: 'tackle', playerId: 'dfer',   side: 'away' }),
      ev({ type: 'tackle', playerId: 'dfer',   side: 'away' }),
    ]);
    // Scorer: 1 goal × 3 = 3; Keeper: 1 save × 2 = 2; Defender: 3 tackles × 1 = 3
    // Tie at 3 — first alphabetically/insertion order depends on Map; we just assert
    // neither the Keeper (score=2) wins.
    const { mvp } = adaptSpatialResult(result, index);
    expect(mvp).not.toBe('Keeper');
  });
});

// ── buildPlayerIndex ──────────────────────────────────────────────────────────

describe('buildPlayerIndex', () => {
  const home = {
    name: 'Stellar FC', short_name: 'STL',
    players: [
      { id: 'h1', name: 'Alpha' },
      { id: 'h2', name: 'Beta' },
    ],
  };
  const away = {
    name: 'Rovers United', short_name: 'ROV',
    players: [
      { id: 'a1', name: 'Gamma' },
    ],
  };

  it('indexes all players from both teams', () => {
    const idx = buildPlayerIndex(home, away);
    expect(idx.size).toBe(3);
  });

  it('uses short_name as teamName when available', () => {
    const idx = buildPlayerIndex(home, away);
    expect(idx.get('h1')?.teamName).toBe('STL');
    expect(idx.get('a1')?.teamName).toBe('ROV');
  });

  it('falls back to full name when short_name is null', () => {
    const noShort = { ...home, short_name: null };
    const idx = buildPlayerIndex(noShort, away);
    expect(idx.get('h1')?.teamName).toBe('Stellar FC');
  });

  it('tags home players with side=home and away with side=away', () => {
    const idx = buildPlayerIndex(home, away);
    expect(idx.get('h1')?.side).toBe('home');
    expect(idx.get('a1')?.side).toBe('away');
  });

  it('handles missing players arrays gracefully', () => {
    const empty = { name: 'Ghost FC' };
    expect(() => buildPlayerIndex(empty as any, empty as any)).not.toThrow();
    expect(buildPlayerIndex(empty as any, empty as any).size).toBe(0);
  });
});

// ── deriveSimStats ────────────────────────────────────────────────────────────

describe('deriveSimStats', () => {
  it('returns all 9 stat keys', () => {
    const s = deriveSimStats({ attacking: 70, defending: 70, mental: 70, athletic: 70, technical: 70 });
    for (const key of ['shooting', 'passing', 'dribbling', 'speed', 'stamina', 'tackling', 'positioning', 'goalkeeping', 'vision']) {
      expect(s).toHaveProperty(key);
      expect(typeof (s as unknown as Record<string, unknown>)[key]).toBe('number');
    }
  });

  it('all output values are integers in [1, 99]', () => {
    for (const val of [1, 50, 70, 99]) {
      const s = deriveSimStats({ attacking: val, defending: val, mental: val, athletic: val, technical: val });
      for (const v of Object.values(s)) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(99);
      }
    }
  });

  it('high attacking produces higher shooting than high defending', () => {
    const atk = deriveSimStats({ attacking: 90, defending: 40, mental: 70, athletic: 70, technical: 70 });
    const def = deriveSimStats({ attacking: 40, defending: 90, mental: 70, athletic: 70, technical: 70 });
    expect(atk.shooting).toBeGreaterThan(def.shooting);
  });

  it('high defending produces higher goalkeeping and tackling', () => {
    const high = deriveSimStats({ attacking: 70, defending: 90, mental: 70, athletic: 70, technical: 70 });
    const low  = deriveSimStats({ attacking: 70, defending: 40, mental: 70, athletic: 70, technical: 70 });
    expect(high.goalkeeping).toBeGreaterThan(low.goalkeeping);
    expect(high.tackling).toBeGreaterThan(low.tackling);
  });

  it('high athletic produces higher speed and stamina', () => {
    const fast = deriveSimStats({ attacking: 70, defending: 70, mental: 70, athletic: 90, technical: 70 });
    const slow = deriveSimStats({ attacking: 70, defending: 70, mental: 70, athletic: 40, technical: 70 });
    expect(fast.speed).toBeGreaterThan(slow.speed);
    expect(fast.stamina).toBeGreaterThan(slow.stamina);
  });

  it('high technical produces higher passing and dribbling', () => {
    const tech  = deriveSimStats({ attacking: 70, defending: 70, mental: 70, athletic: 70, technical: 90 });
    const plain = deriveSimStats({ attacking: 70, defending: 70, mental: 70, athletic: 70, technical: 40 });
    expect(tech.passing).toBeGreaterThan(plain.passing);
    expect(tech.dribbling).toBeGreaterThan(plain.dribbling);
  });

  it('defaults all missing fields to 70 (neutral baseline)', () => {
    const defaults = deriveSimStats({});
    const explicit = deriveSimStats({ attacking: 70, defending: 70, mental: 70, athletic: 70, technical: 70 });
    expect(defaults).toEqual(explicit);
  });

  it('leaves a league-average (70) rating unchanged — the contrast pivot (#589)', () => {
    const s = deriveSimStats({ attacking: 70, defending: 70, mental: 70, athletic: 70, technical: 70 });
    expect(s.shooting).toBe(70);
    expect(s.passing).toBe(70);
    expect(s.tackling).toBe(70);
    expect(s.goalkeeping).toBe(70);
  });

  it('widens elite-vs-great separation beyond the raw rating gap, and pushes the weak down (#589)', () => {
    const elite = deriveSimStats({ attacking: 90, defending: 70, mental: 70, athletic: 70, technical: 90 });
    const great = deriveSimStats({ attacking: 80, defending: 70, mental: 70, athletic: 70, technical: 80 });
    const weak  = deriveSimStats({ attacking: 50, defending: 70, mental: 70, athletic: 70, technical: 50 });
    // The convex transform + finishing weight stretch the top: the elite→great
    // shooting gap exceeds the raw 10-point composite gap a linear blend gives.
    expect(elite.shooting - great.shooting).toBeGreaterThan(10);
    // ...and a sub-average finisher lands below their raw rating.
    expect(weak.shooting).toBeLessThan(50);
  });
});

// ── toSpatialTeamInput ────────────────────────────────────────────────────────

describe('toSpatialTeamInput', () => {
  const rawTeam = {
    managers: [{ preferred_formation: '3-4-3' }],
    players: [
      { id: 'g', name: 'GK One',  position: 'GK', starter: true,  is_active: true, attacking: 30, defending: 80, mental: 70, athletic: 65, technical: 60 },
      { id: 'm', name: 'MF One',  position: 'MF', starter: true,  is_active: true, attacking: 70, defending: 55, mental: 75, athletic: 70, technical: 72 },
      { id: 'b', name: 'Bench',   position: 'FW', starter: false, is_active: true, attacking: 80, defending: 40, mental: 65, athletic: 80, technical: 65 },
      { id: 'x', name: 'Injured', position: 'DF', starter: true,  is_active: false },
    ],
  };

  it('reads formation from managers[0].preferred_formation', () => {
    const { formation } = toSpatialTeamInput(rawTeam);
    expect(formation).toBe('3-4-3');
  });

  it('falls back to 4-4-2 when no manager row is present', () => {
    const { formation } = toSpatialTeamInput({ players: [] });
    expect(formation).toBe('4-4-2');
  });

  it('includes only active starters', () => {
    const { players } = toSpatialTeamInput(rawTeam);
    // 'Bench' is excluded (starter=false); 'Injured' excluded (is_active=false)
    expect(players.map((p) => p.name)).toContain('GK One');
    expect(players.map((p) => p.name)).toContain('MF One');
    expect(players.map((p) => p.name)).not.toContain('Bench');
    expect(players.map((p) => p.name)).not.toContain('Injured');
  });

  it('maps DB position string to Role', () => {
    const { players } = toSpatialTeamInput(rawTeam);
    const gk = players.find((p) => p.name === 'GK One');
    const mf = players.find((p) => p.name === 'MF One');
    expect(gk?.role).toBe('GK');
    expect(mf?.role).toBe('MF');
  });

  it('derives stats and returns all 9 stat fields', () => {
    const { players } = toSpatialTeamInput(rawTeam);
    const gk = players.find((p) => p.name === 'GK One');
    expect(gk?.stats).toBeDefined();
    expect(gk?.stats.goalkeeping).toBeGreaterThan(gk!.stats.shooting);
  });

  it('handles missing players array without throwing', () => {
    expect(() => toSpatialTeamInput({ managers: [] })).not.toThrow();
    const { players } = toSpatialTeamInput({ managers: [] });
    expect(players).toHaveLength(0);
  });
});
