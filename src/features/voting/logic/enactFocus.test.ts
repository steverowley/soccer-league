// ── voting/logic/enactFocus.test.ts ──────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import {
  enactFocus,
  seededRng,
  type PlayerRow,
  type EnactmentMutation,
} from './enactFocus';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SEASON = 'season-uuid-0001';
const TEAM   = 'mars-athletic';

function makePlayer(
  overrides: Partial<PlayerRow> & { id: string },
): PlayerRow {
  return {
    team_id:        TEAM,
    name:           'Test Player',
    position:       'MF',
    age:            24,
    overall_rating: 60,
    attacking:      60,
    defending:      60,
    mental:         60,
    athletic:       60,
    technical:      60,
    starter:        true,
    ...overrides,
  };
}

/** A minimal 14-player squad: 11 starters + 3 bench */
function makeSquad(): PlayerRow[] {
  return [
    makePlayer({ id: 'gk1',  position: 'GK', starter: true,  attacking: 20, defending: 75 }),
    makePlayer({ id: 'df1',  position: 'DF', starter: true,  attacking: 40, defending: 72 }),
    makePlayer({ id: 'df2',  position: 'DF', starter: true,  attacking: 38, defending: 70 }),
    makePlayer({ id: 'df3',  position: 'DF', starter: true,  attacking: 42, defending: 68 }),
    makePlayer({ id: 'df4',  position: 'DF', starter: true,  attacking: 35, defending: 65 }),
    makePlayer({ id: 'mf1',  position: 'MF', starter: true,  attacking: 62, defending: 50 }),
    makePlayer({ id: 'mf2',  position: 'MF', starter: true,  attacking: 64, defending: 48 }),
    makePlayer({ id: 'mf3',  position: 'MF', starter: true,  attacking: 60, defending: 52 }),
    makePlayer({ id: 'fw1',  position: 'FW', starter: true,  attacking: 78, defending: 30 }),
    makePlayer({ id: 'fw2',  position: 'FW', starter: true,  attacking: 80, defending: 28 }),
    makePlayer({ id: 'fw3',  position: 'FW', starter: true,  attacking: 76, defending: 32 }),
    // bench
    makePlayer({ id: 'sub1', position: 'MF', starter: false, age: 18, overall_rating: 55 }),
    makePlayer({ id: 'sub2', position: 'DF', starter: false, age: 20, overall_rating: 58 }),
    makePlayer({ id: 'sub3', position: 'FW', starter: false, age: 25, overall_rating: 62 }),
  ];
}

const rng = () => seededRng(`${SEASON}:${TEAM}:test`);

// ── seededRng ─────────────────────────────────────────────────────────────────

describe('seededRng', () => {
  it('is deterministic — same seed produces identical sequence', () => {
    const a = seededRng('test-seed');
    const b = seededRng('test-seed');
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it('different seeds produce different sequences', () => {
    const a = seededRng('seed-alpha');
    const b = seededRng('seed-beta');
    const seqA = Array.from({ length: 5 }, () => a());
    const seqB = Array.from({ length: 5 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });

  it('values are in [0, 1)', () => {
    const gen = seededRng('bounds-test');
    for (let i = 0; i < 100; i++) {
      const v = gen();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

// ── Unknown focus key ─────────────────────────────────────────────────────────

describe('enactFocus — unknown key', () => {
  it('returns null for an unrecognised focus_key', () => {
    const result = enactFocus('does_not_exist', TEAM, SEASON, makeSquad(), rng());
    expect(result).toBeNull();
  });
});

// ── sign_star_player ──────────────────────────────────────────────────────────

describe('sign_star_player', () => {
  it('returns exactly one insert_player mutation', () => {
    const spec = enactFocus('sign_star_player', TEAM, SEASON, makeSquad(), rng());
    expect(spec).not.toBeNull();
    expect(spec!.focus_key).toBe('sign_star_player');
    const inserts = spec!.mutations.filter((m) => m.kind === 'insert_player');
    expect(inserts).toHaveLength(1);
  });

  it('new player has stats clamped to 1–99', () => {
    const spec = enactFocus('sign_star_player', TEAM, SEASON, makeSquad(), rng())!;
    const mut = spec.mutations[0] as Extract<EnactmentMutation, { kind: 'insert_player' }>;
    const { attacking, defending, mental, athletic, technical } = mut.player;
    for (const stat of [attacking, defending, mental, athletic, technical]) {
      expect(stat).toBeGreaterThanOrEqual(1);
      expect(stat).toBeLessThanOrEqual(99);
    }
  });

  it('assigns team_id correctly to the new player', () => {
    const spec = enactFocus('sign_star_player', TEAM, SEASON, makeSquad(), rng())!;
    const mut = spec.mutations[0] as Extract<EnactmentMutation, { kind: 'insert_player' }>;
    expect(mut.player.team_id).toBe(TEAM);
  });

  it('assigns starter: true to the new signing', () => {
    const spec = enactFocus('sign_star_player', TEAM, SEASON, makeSquad(), rng())!;
    const mut = spec.mutations[0] as Extract<EnactmentMutation, { kind: 'insert_player' }>;
    expect(mut.player.starter).toBe(true);
  });

  it('jersey_number is higher than the highest existing jersey', () => {
    const squad = makeSquad().map((p, i) => ({
      ...p,
      jersey_number: i + 1,
    } as unknown as PlayerRow));
    const spec = enactFocus('sign_star_player', TEAM, SEASON, squad, rng())!;
    const mut = spec.mutations[0] as Extract<EnactmentMutation, { kind: 'insert_player' }>;
    expect(mut.player.jersey_number).toBeGreaterThan(squad.length);
  });

  it('is deterministic — same RNG seed produces identical player', () => {
    const spec1 = enactFocus('sign_star_player', TEAM, SEASON, makeSquad(), rng())!;
    const spec2 = enactFocus('sign_star_player', TEAM, SEASON, makeSquad(), rng())!;
    const p1 = (spec1.mutations[0] as Extract<EnactmentMutation, { kind: 'insert_player' }>).player;
    const p2 = (spec2.mutations[0] as Extract<EnactmentMutation, { kind: 'insert_player' }>).player;
    expect(p1).toEqual(p2);
  });

  it('overall_rating above 1', () => {
    const spec = enactFocus('sign_star_player', TEAM, SEASON, makeSquad(), rng())!;
    const mut = spec.mutations[0] as Extract<EnactmentMutation, { kind: 'insert_player' }>;
    expect(mut.player.overall_rating).toBeGreaterThan(1);
  });

  it('signing age is between 22 and 29', () => {
    const spec = enactFocus('sign_star_player', TEAM, SEASON, makeSquad(), rng())!;
    const mut = spec.mutations[0] as Extract<EnactmentMutation, { kind: 'insert_player' }>;
    expect(mut.player.age).toBeGreaterThanOrEqual(22);
    expect(mut.player.age).toBeLessThanOrEqual(29);
  });
});

// ── youth_academy ─────────────────────────────────────────────────────────────

describe('youth_academy', () => {
  it('promotes the youngest bench player aged ≤21', () => {
    const spec = enactFocus('youth_academy', TEAM, SEASON, makeSquad(), rng())!;
    expect(spec).not.toBeNull();
    const promos = spec.mutations.filter((m) => m.kind === 'promote_player');
    expect(promos).toHaveLength(1);
    const promo = promos[0] as Extract<EnactmentMutation, { kind: 'promote_player' }>;
    // sub1 (age 18) is the youngest ≤21
    expect(promo.player_id).toBe('sub1');
  });

  it('stat_bumps are non-zero for the promoted player', () => {
    const spec = enactFocus('youth_academy', TEAM, SEASON, makeSquad(), rng())!;
    const promo = spec.mutations[0] as Extract<EnactmentMutation, { kind: 'promote_player' }>;
    const bumps = Object.values(promo.stat_bumps);
    expect(bumps.length).toBeGreaterThan(0);
    for (const bump of bumps) {
      expect(bump).toBeGreaterThan(0);
    }
  });

  it('returns empty mutations when bench is empty', () => {
    const startersOnly = makeSquad().filter((p) => p.starter);
    const spec = enactFocus('youth_academy', TEAM, SEASON, startersOnly, rng())!;
    expect(spec.mutations).toHaveLength(0);
    expect(spec.focus_key).toBe('youth_academy');
  });

  it('falls back to any bench player when none are ≤21', () => {
    const squadNoYouth = makeSquad().map((p) =>
      p.starter ? p : { ...p, age: 30 },
    );
    const spec = enactFocus('youth_academy', TEAM, SEASON, squadNoYouth, rng())!;
    const promos = spec.mutations.filter((m) => m.kind === 'promote_player');
    expect(promos).toHaveLength(1);
  });

  it('is deterministic — same squad + seed yields same promotion', () => {
    const spec1 = enactFocus('youth_academy', TEAM, SEASON, makeSquad(), rng())!;
    const spec2 = enactFocus('youth_academy', TEAM, SEASON, makeSquad(), rng())!;
    expect(spec1.mutations).toEqual(spec2.mutations);
  });
});

// ── tactical_overhaul ─────────────────────────────────────────────────────────

describe('tactical_overhaul', () => {
  it('produces one mental bump per starter', () => {
    const squad = makeSquad();
    const starters = squad.filter((p) => p.starter);
    const spec = enactFocus('tactical_overhaul', TEAM, SEASON, squad, rng())!;
    expect(spec.mutations).toHaveLength(starters.length);
    for (const mut of spec.mutations) {
      expect(mut.kind).toBe('player_stat_bump');
      const bump = mut as Extract<EnactmentMutation, { kind: 'player_stat_bump' }>;
      expect(bump.stat).toBe('mental');
      expect(bump.delta).toBe(4);
    }
  });

  it('does not touch bench players', () => {
    const squad = makeSquad();
    const benchIds = new Set(squad.filter((p) => !p.starter).map((p) => p.id));
    const spec = enactFocus('tactical_overhaul', TEAM, SEASON, squad, rng())!;
    for (const mut of spec.mutations) {
      const bump = mut as Extract<EnactmentMutation, { kind: 'player_stat_bump' }>;
      expect(benchIds.has(bump.player_id)).toBe(false);
    }
  });

  it('returns empty mutations with a squad of only bench players', () => {
    const benchOnly = makeSquad().map((p) => ({ ...p, starter: false }));
    const spec = enactFocus('tactical_overhaul', TEAM, SEASON, benchOnly, rng())!;
    expect(spec.mutations).toHaveLength(0);
  });
});

// ── stadium_upgrade ───────────────────────────────────────────────────────────

describe('stadium_upgrade', () => {
  it('produces exactly one team_finances_delta mutation', () => {
    const spec = enactFocus('stadium_upgrade', TEAM, SEASON, [], rng())!;
    expect(spec.mutations).toHaveLength(1);
    expect(spec.mutations[0]!.kind).toBe('team_finances_delta');
  });

  it('adds 5000 to ticket_revenue and balance', () => {
    const spec = enactFocus('stadium_upgrade', TEAM, SEASON, [], rng())!;
    const mut = spec.mutations[0] as Extract<EnactmentMutation, { kind: 'team_finances_delta' }>;
    expect(mut.ticket_revenue_delta).toBe(5_000);
    expect(mut.balance_delta).toBe(5_000);
  });

  it('sets the correct team_id and season_id', () => {
    const spec = enactFocus('stadium_upgrade', TEAM, SEASON, [], rng())!;
    const mut = spec.mutations[0] as Extract<EnactmentMutation, { kind: 'team_finances_delta' }>;
    expect(mut.team_id).toBe(TEAM);
    expect(mut.season_id).toBe(SEASON);
  });
});

// ── preseason_camp ────────────────────────────────────────────────────────────

describe('preseason_camp', () => {
  it('produces one athletic bump per player (starters + bench)', () => {
    const squad = makeSquad();
    const spec = enactFocus('preseason_camp', TEAM, SEASON, squad, rng())!;
    expect(spec.mutations).toHaveLength(squad.length);
    for (const mut of spec.mutations) {
      expect(mut.kind).toBe('player_stat_bump');
      const bump = mut as Extract<EnactmentMutation, { kind: 'player_stat_bump' }>;
      expect(bump.stat).toBe('athletic');
      expect(bump.delta).toBe(2);
    }
  });

  it('covers each player exactly once', () => {
    const squad = makeSquad();
    const spec = enactFocus('preseason_camp', TEAM, SEASON, squad, rng())!;
    const ids = spec.mutations.map(
      (m) => (m as Extract<EnactmentMutation, { kind: 'player_stat_bump' }>).player_id,
    );
    const expected = squad.map((p) => p.id);
    expect(ids.sort()).toEqual(expected.sort());
  });
});

// ── scout_network ─────────────────────────────────────────────────────────────

describe('scout_network', () => {
  it('promotes the highest-rated bench player', () => {
    // sub3 has overall_rating: 62, highest bench
    const spec = enactFocus('scout_network', TEAM, SEASON, makeSquad(), rng())!;
    const promos = spec.mutations.filter((m) => m.kind === 'promote_player');
    expect(promos).toHaveLength(1);
    const promo = promos[0] as Extract<EnactmentMutation, { kind: 'promote_player' }>;
    expect(promo.player_id).toBe('sub3');
  });

  it('applies technical +2 and mental +1 to the promoted player', () => {
    const spec = enactFocus('scout_network', TEAM, SEASON, makeSquad(), rng())!;
    const promo = spec.mutations[0] as Extract<EnactmentMutation, { kind: 'promote_player' }>;
    expect(promo.stat_bumps.technical).toBe(2);
    expect(promo.stat_bumps.mental).toBe(1);
  });

  it('returns empty mutations when bench is empty', () => {
    const startersOnly = makeSquad().filter((p) => p.starter);
    const spec = enactFocus('scout_network', TEAM, SEASON, startersOnly, rng())!;
    expect(spec.mutations).toHaveLength(0);
  });
});

// ── fan_engagement ────────────────────────────────────────────────────────────

describe('fan_engagement', () => {
  it('produces exactly one team_finances_delta mutation', () => {
    const spec = enactFocus('fan_engagement', TEAM, SEASON, [], rng())!;
    expect(spec.mutations).toHaveLength(1);
    expect(spec.mutations[0]!.kind).toBe('team_finances_delta');
  });

  it('adds 2000 to ticket_revenue and balance', () => {
    const spec = enactFocus('fan_engagement', TEAM, SEASON, [], rng())!;
    const mut = spec.mutations[0] as Extract<EnactmentMutation, { kind: 'team_finances_delta' }>;
    expect(mut.ticket_revenue_delta).toBe(2_000);
    expect(mut.balance_delta).toBe(2_000);
  });

  it('fan_engagement deltas are smaller than stadium_upgrade', () => {
    const fan = enactFocus('fan_engagement', TEAM, SEASON, [], rng())!;
    const stadium = enactFocus('stadium_upgrade', TEAM, SEASON, [], rng())!;
    const fanMut = fan.mutations[0] as Extract<EnactmentMutation, { kind: 'team_finances_delta' }>;
    const stadMut = stadium.mutations[0] as Extract<EnactmentMutation, { kind: 'team_finances_delta' }>;
    expect(fanMut.ticket_revenue_delta).toBeLessThan(stadMut.ticket_revenue_delta);
  });
});

// ── sports_science ────────────────────────────────────────────────────────────

describe('sports_science', () => {
  it('produces two mutations per player (athletic +1 and defending +1)', () => {
    const squad = makeSquad();
    const spec = enactFocus('sports_science', TEAM, SEASON, squad, rng())!;
    expect(spec.mutations).toHaveLength(squad.length * 2);
  });

  it('each mutation is a player_stat_bump of +1', () => {
    const spec = enactFocus('sports_science', TEAM, SEASON, makeSquad(), rng())!;
    for (const mut of spec.mutations) {
      expect(mut.kind).toBe('player_stat_bump');
      const bump = mut as Extract<EnactmentMutation, { kind: 'player_stat_bump' }>;
      expect(bump.delta).toBe(1);
      expect(['athletic', 'defending']).toContain(bump.stat);
    }
  });

  it('each player gets exactly one athletic and one defending bump', () => {
    const squad = makeSquad();
    const spec = enactFocus('sports_science', TEAM, SEASON, squad, rng())!;
    for (const player of squad) {
      const bumps = spec.mutations.filter(
        (m) => (m as Extract<EnactmentMutation, { kind: 'player_stat_bump' }>).player_id === player.id,
      ) as Array<Extract<EnactmentMutation, { kind: 'player_stat_bump' }>>;
      expect(bumps).toHaveLength(2);
      const stats = bumps.map((b) => b.stat).sort();
      expect(stats).toEqual(['athletic', 'defending']);
    }
  });
});

// ── mental_coaching ───────────────────────────────────────────────────────────

describe('mental_coaching', () => {
  it('produces one mental bump per starter', () => {
    const squad = makeSquad();
    const starters = squad.filter((p) => p.starter);
    const spec = enactFocus('mental_coaching', TEAM, SEASON, squad, rng())!;
    expect(spec.mutations).toHaveLength(starters.length);
    for (const mut of spec.mutations) {
      const bump = mut as Extract<EnactmentMutation, { kind: 'player_stat_bump' }>;
      expect(bump.stat).toBe('mental');
      expect(bump.delta).toBe(3);
    }
  });

  it('tactical_overhaul delta (4) > mental_coaching delta (3)', () => {
    const squad = makeSquad();
    const overhaul = enactFocus('tactical_overhaul', TEAM, SEASON, squad, rng())!;
    const coaching = enactFocus('mental_coaching', TEAM, SEASON, squad, rng())!;
    const ovDelta = (overhaul.mutations[0] as Extract<EnactmentMutation, { kind: 'player_stat_bump' }>).delta;
    const coachDelta = (coaching.mutations[0] as Extract<EnactmentMutation, { kind: 'player_stat_bump' }>).delta;
    expect(ovDelta).toBeGreaterThan(coachDelta);
  });
});

// ── Stat clamping ─────────────────────────────────────────────────────────────

describe('stat clamping via sign_star_player', () => {
  it('stats do not exceed 99 when squad has all 99 stats', () => {
    const maxSquad: PlayerRow[] = Array.from({ length: 11 }, (_, i) =>
      makePlayer({
        id:        `max${i}`,
        position:  'MF',
        starter:   true,
        attacking: 99, defending: 99, mental: 99, athletic: 99, technical: 99,
      }),
    );
    const spec = enactFocus('sign_star_player', TEAM, SEASON, maxSquad, rng())!;
    const mut = spec.mutations[0] as Extract<EnactmentMutation, { kind: 'insert_player' }>;
    for (const stat of [
      mut.player.attacking, mut.player.defending,
      mut.player.mental,    mut.player.athletic, mut.player.technical,
    ]) {
      expect(stat).toBeLessThanOrEqual(99);
    }
  });

  it('stats are at least 1 when squad has all 1 stats', () => {
    const minSquad: PlayerRow[] = Array.from({ length: 11 }, (_, i) =>
      makePlayer({
        id:        `min${i}`,
        position:  'DF',
        starter:   true,
        attacking: 1, defending: 1, mental: 1, athletic: 1, technical: 1,
      }),
    );
    const spec = enactFocus('sign_star_player', TEAM, SEASON, minSquad, rng())!;
    const mut = spec.mutations[0] as Extract<EnactmentMutation, { kind: 'insert_player' }>;
    for (const stat of [
      mut.player.attacking, mut.player.defending,
      mut.player.mental,    mut.player.athletic, mut.player.technical,
    ]) {
      expect(stat).toBeGreaterThanOrEqual(1);
    }
  });
});

// ── Focus labels ──────────────────────────────────────────────────────────────

describe('focus_label correctness', () => {
  const cases: Array<[string, string]> = [
    ['sign_star_player',  'Sign a Star Player'],
    ['youth_academy',     'Invest in Youth Academy'],
    ['tactical_overhaul', 'Tactical Overhaul'],
    ['stadium_upgrade',   'Upgrade the Stadium'],
    ['preseason_camp',    'Intensive Preseason Camp'],
    ['scout_network',     'Expand Scout Network'],
    ['fan_engagement',    'Fan Engagement Drive'],
    ['sports_science',    'Sports Science Programme'],
    ['mental_coaching',   'Mental Resilience Coaching'],
  ];

  it.each(cases)('%s → label "%s"', (key, label) => {
    const spec = enactFocus(key, TEAM, SEASON, makeSquad(), rng());
    expect(spec).not.toBeNull();
    expect(spec!.focus_label).toBe(label);
  });
});

// ── reason field ──────────────────────────────────────────────────────────────

describe('reason field', () => {
  it('is non-empty for every known focus key', () => {
    const keys = [
      'sign_star_player', 'youth_academy', 'tactical_overhaul', 'stadium_upgrade',
      'preseason_camp', 'scout_network', 'fan_engagement', 'sports_science', 'mental_coaching',
    ];
    for (const key of keys) {
      const spec = enactFocus(key, TEAM, SEASON, makeSquad(), rng());
      expect(spec).not.toBeNull();
      expect(spec!.reason.length).toBeGreaterThan(0);
    }
  });

  it('reason does not contain raw numeric stat values', () => {
    const keys = [
      'sign_star_player', 'youth_academy', 'tactical_overhaul', 'stadium_upgrade',
      'preseason_camp', 'scout_network', 'fan_engagement', 'sports_science', 'mental_coaching',
    ];
    // We check that no bare 2-3 digit numbers representing stats appear in reason.
    // Numbers like years or thematic numbers are OK; the regex targets "stat +N" patterns.
    const statPattern = /\+\s*\d+|\bstat\s+\d+/i;
    for (const key of keys) {
      const spec = enactFocus(key, TEAM, SEASON, makeSquad(), rng());
      expect(spec!.reason).not.toMatch(statPattern);
    }
  });
});
