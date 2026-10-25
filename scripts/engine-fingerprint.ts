// ── scripts/engine-fingerprint.ts ───────────────────────────────────────────
// Correctness oracle for engine refactors that must not change any result
// (performance work in particular).  Runs a fixed set of full matches and
// prints one SHA-256 per case over the COMPLETE serialized result: final
// score, every event, every replay frame, both phase timelines, and (for the
// traced cases) every instrumentation record.
//
// The cases mix the standard uniform-rating test fixtures, every style
// preset, all four formations, personalities, benches (so substitutions
// happen), an all-ablations-off run, and the six real ISL squads in
// scripts/fixtures/bench-teams.json with their managers' own game models.
// Three cases sample a frame on every tick, so a drift that has not yet
// changed an event still changes a position within a tenth of a metre.
//
// Usage:
//   npx tsx scripts/engine-fingerprint.ts            # print the fingerprints
//   npx tsx scripts/engine-fingerprint.ts --check    # diff against the baseline
//
// The baseline lives in docs/reports/engine-fingerprint-baseline.txt and was
// produced from main before any optimisation.  Any difference is a behaviour
// change, never noise: the engine is deterministic for a fixed seed.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  simulateSpatialMatch, type SpatialTeamInput, type SpatialPlayerInput,
} from '../src/features/match/logic/spatial/simulateSpatialMatch';
import { toSpatialTeamInput } from '../src/features/match/logic/spatial/spatialEventAdapter';
import { STYLE_PRESETS } from '../src/features/match/logic/spatial/gameModel';
import type { SimPlayerStats, Role, TraceRecord, EngineFlags } from '../src/features/match/logic/spatial/types';
import squads from './fixtures/bench-teams.json';

// ── Fixtures ────────────────────────────────────────────────────────────────

/** Uniform stat line, as in the engine's own test fixtures. */
function stats(base: number): SimPlayerStats {
  return {
    shooting: base, passing: base, dribbling: base, speed: base, stamina: base,
    tackling: base, positioning: base, goalkeeping: base, vision: base,
  };
}

const PERSONALITIES = ['selfish', 'team_player', 'aggressive', 'cautious', 'creative', 'lazy', 'workhorse', 'balanced'];

/** A 4-4-2-shaped squad (the formation string decides the slots). */
function fixtureTeam(prefix: string, base: number, opts: {
  formation?: string; style?: string; personalities?: boolean; bench?: boolean;
} = {}): SpatialTeamInput {
  const roles: Role[] = ['GK', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'FW', 'FW'];
  const players: SpatialPlayerInput[] = roles.map((role, i) => ({
    id: `${prefix}-${i}`, name: `${prefix} ${i}`, role,
    // A gentle spread so players are not interchangeable.
    stats: stats(base + ((i * 7) % 9) - 4),
    ...(opts.personalities ? { personality: PERSONALITIES[i % PERSONALITIES.length] } : {}),
  }));
  const bench: SpatialPlayerInput[] = opts.bench
    ? (['DF', 'MF', 'MF', 'FW', 'GK'] as Role[]).map((role, i) => ({
      id: `${prefix}-b${i}`, name: `${prefix} bench ${i}`, role, stats: stats(base - 2),
    }))
    : [];
  return {
    formation: opts.formation ?? '4-4-2',
    players,
    ...(opts.bench ? { bench } : {}),
    ...(opts.style ? { playStyle: opts.style, gameModel: STYLE_PRESETS[opts.style] } : {}),
  };
}

/** A real ISL squad from the bench fixture, through the production adapter. */
function squad(i: number): SpatialTeamInput {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = (squads as any[])[i];
  const row = {
    id: t.id, name: t.name,
    managers: [{ preferred_formation: t.f, style: t.s, game_model: t.gm }],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    players: t.ps.map((p: any[], j: number) => ({
      id: `${t.id}-${j}`, name: p[0], position: p[1], starter: p[2], team_id: t.id,
      attacking: p[3], defending: p[4], mental: p[5], athletic: p[6], technical: p[7],
    })),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return toSpatialTeamInput(row as any);
}

const ALL_OFF: Partial<EngineFlags> = {
  imprecision: false, utilitySoftness: false, personality: false, confidence: false,
  homeAdvantage: false, momentum: false, scoreClockTerm: false, bodyContact: false, gameModel: false,
};

interface Case {
  name: string;
  home: () => SpatialTeamInput;
  away: () => SpatialTeamInput;
  seed: number;
  frameEverySec?: number;
  flags?: Partial<EngineFlags>;
  trace?: boolean;
}

const CASES: Case[] = [
  // The six real squads, each manager's own game model, in mixed pairings.
  { name: 'squad-earth-v-jupiter',   home: () => squad(0), away: () => squad(2), seed: 1000 },
  { name: 'squad-ceres-v-mars',      home: () => squad(4), away: () => squad(1), seed: 1001 },
  { name: 'squad-europa-v-pluto',    home: () => squad(3), away: () => squad(5), seed: 1002 },
  { name: 'squad-jupiter-v-earth',   home: () => squad(2), away: () => squad(0), seed: 2026 },
  { name: 'squad-mars-v-europa',     home: () => squad(1), away: () => squad(3), seed: 31337 },
  { name: 'squad-pluto-v-ceres',     home: () => squad(5), away: () => squad(4), seed: 7 },
  // Standard test fixtures.
  { name: 'fixture-70-v-70',         home: () => fixtureTeam('H', 70), away: () => fixtureTeam('A', 70), seed: 99 },
  { name: 'fixture-72-v-68',         home: () => fixtureTeam('H', 72), away: () => fixtureTeam('A', 68), seed: 21 },
  // Style presets, formations, personalities and benches.
  { name: 'direct343-v-possession451', seed: 3,
    home: () => fixtureTeam('H', 70, { formation: '3-4-3', style: 'Direct', bench: true }),
    away: () => fixtureTeam('A', 70, { formation: '4-5-1', style: 'Possession', bench: true }) },
  { name: 'counter541-v-aggressive442', seed: 5,
    home: () => fixtureTeam('H', 66, { formation: '5-4-1', style: 'Counterattacking', personalities: true, bench: true }),
    away: () => fixtureTeam('A', 74, { style: 'Aggressive', personalities: true, bench: true }) },
  { name: 'offensive-v-defensive', seed: 11,
    home: () => fixtureTeam('H', 71, { style: 'Offensive', personalities: true }),
    away: () => fixtureTeam('A', 69, { formation: '5-4-1', style: 'Defensive' }) },
  // Every ablation switch off (the bare physics and neutral model).
  { name: 'ablations-off', seed: 13, flags: ALL_OFF,
    home: () => fixtureTeam('H', 70, { style: 'Direct', personalities: true }),
    away: () => fixtureTeam('A', 70, { style: 'Possession' }) },
  // Every-tick frames plus the full trace stream: the finest-grained checks.
  { name: 'trace-squad-earth-v-mars', seed: 4242, frameEverySec: 0.1, trace: true,
    home: () => squad(0), away: () => squad(1) },
  { name: 'trace-balanced-80-v-60', seed: 77, frameEverySec: 0.1, trace: true,
    home: () => fixtureTeam('H', 80, { style: 'Balanced', bench: true }),
    away: () => fixtureTeam('A', 60, { bench: true }) },
  { name: 'everytick-squad-pluto-v-jupiter', seed: 555, frameEverySec: 0.1,
    home: () => squad(5), away: () => squad(2) },
];

// ── Canonical serialisation ─────────────────────────────────────────────────

/**
 * JSON with sorted object keys, so the hash depends only on values and not on
 * property insertion order (which a refactor may legitimately change).
 * Numbers use JSON's shortest round-trip form, so every bit of a double that
 * reaches the output is covered.
 */
function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') {
    if (typeof v === 'number' && !Number.isFinite(v)) return `"${String(v)}"`;
    return JSON.stringify(v) ?? 'null';
  }
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
}

function sha(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

// ── Run ─────────────────────────────────────────────────────────────────────

const lines: string[] = [];
for (const c of CASES) {
  const traces: TraceRecord[] = [];
  const r = simulateSpatialMatch(c.home(), c.away(), {
    seed: c.seed,
    ...(c.frameEverySec ? { frameEverySec: c.frameEverySec } : {}),
    ...(c.flags ? { flags: c.flags as EngineFlags } : {}),
    ...(c.trace ? { trace: (t: TraceRecord) => { traces.push(t); } } : {}),
  });
  const payload = canonical({ result: r, traces });
  const line = `${c.name.padEnd(34)} ${sha(payload)}  score=${r.finalScore.join('-')} events=${r.events.length} frames=${r.frames.length} traces=${traces.length}`;
  lines.push(line);
  console.log(line);
}

if (process.argv.includes('--check')) {
  const base = readFileSync(resolve('docs/reports/engine-fingerprint-baseline.txt'), 'utf8')
    .split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
  const diffs = lines.filter((l, i) => l !== base[i]);
  if (diffs.length > 0 || base.length !== lines.length) {
    console.log(`FINGERPRINT MISMATCH: ${diffs.length} of ${lines.length} cases differ from the baseline`);
    process.exit(1);
  }
  console.log(`fingerprints identical to baseline (${lines.length} cases)`);
}
