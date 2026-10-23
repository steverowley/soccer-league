// ── matchPipeline.e2e.test.ts ────────────────────────────────────────────────
// The whole broadcast pipeline, on a real simulated match, with no backend.
//
// WHY THIS EXISTS
// Every unit in this chain had passing tests while the chain itself was broken.
// `subminute` was validated as an integer (#695), so the Zod gate silently
// discarded almost every event a real match produced — and nothing failed,
// because each stage was only ever tested against hand-made input that happened
// to satisfy the next stage. The commentary work in #691-#693 would have been
// invisible in production with a fully green suite.
//
// So this test runs the REAL spatial engine and walks its output through every
// stage a fan's screen depends on:
//
//   simulateSpatialMatch
//     -> adaptSpatialResult          (events + terse placeholder commentary)
//     -> decorateCommentary          (three commentator voices)
//     -> filterNotableEvents         (the significance trim)
//     -> cosmicInterjections         (Balance and Chaos)
//     -> serialise to match_events row shape
//     -> parseMatchEventRows         (the Zod gate that was eating everything)
//     -> eventHeading / eventVoice   (what actually renders)
//
// The assertions are deliberately about OUTCOMES a fan would notice — "a match
// produces commentary", "it is not the same sentence repeatedly", "the voices
// are attributed" — rather than about internal shapes, because internal shapes
// were all correct while the screen was empty.

import { describe, it, expect } from 'vitest';
import {
  simulateSpatialMatch,
  type SpatialTeamInput,
  type SpatialPlayerInput,
} from '../logic/spatial/simulateSpatialMatch';
import type { Role, SimPlayerStats } from '../logic/spatial/types';
import {
  adaptSpatialResult,
  buildPlayerIndex,
  filterNotableEvents,
} from '../logic/spatial/spatialEventAdapter';
import { decorateCommentary } from '../../../../supabase/functions/match-worker/commentary.ts';
import { cosmicInterjections } from '../../../../supabase/functions/match-worker/cosmicVoices.ts';
import { parseMatchEventRows } from './matchEvents.schema';
import { eventHeading, eventVoice } from '../../../pages/MatchDetail';
import type { MatchEventRow } from '../index';

const MATCH_ID = '11111111-2222-3333-4444-555555555555';

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

function team(side: string): SpatialTeamInput {
  return {
    formation: '4-4-2',
    players: XI_ROLES.map((role, i): SpatialPlayerInput => ({
      id: `${side}-start-${i}`,
      name: `${side} Player ${i}`,
      role,
      stats: stats(role),
    })),
    bench: BENCH_ROLES.map((role, i): SpatialPlayerInput => ({
      id: `${side}-bench-${i}`,
      name: `${side} Sub ${i}`,
      role,
      stats: stats(role),
    })),
  };
}

/** Minimal raw team rows in the shape buildPlayerIndex expects. */
function rawTeam(side: string, name: string, short: string) {
  return {
    id: `${side}-team`,
    name,
    short_name: short,
    players: [...XI_ROLES, ...BENCH_ROLES].map((role, i) => ({
      id: i < XI_ROLES.length ? `${side}-start-${i}` : `${side}-bench-${i - XI_ROLES.length}`,
      name: i < XI_ROLES.length ? `${side} Player ${i}` : `${side} Sub ${i - XI_ROLES.length}`,
      role,
    })),
  };
}

/**
 * Drive one match all the way to the rows the frontend would render.
 *
 * Mirrors match-worker/index.ts exactly, including the ORDER of the stages —
 * the cosmic voices run AFTER the significance filter, because `cosmic_voice`
 * is in neither allow-set and would otherwise be trimmed away.
 */
function runPipeline(seed: number) {
  const spatial = simulateSpatialMatch(team('H'), team('A'), { seed });
  const index = buildPlayerIndex(
    rawTeam('H', 'Mars United', 'MAR') as never,
    rawTeam('A', 'Venus Rovers', 'VEN') as never,
  );
  const adapted = adaptSpatialResult(spatial, index);

  decorateCommentary(adapted.events, MATCH_ID);
  let events = filterNotableEvents(adapted.events);
  const cosmic = cosmicInterjections(events, MATCH_ID);
  events = [...events, ...cosmic].sort((a, b) => a.minute - b.minute || a.subminute - b.subminute);

  // Serialise exactly as the worker's persist block does, then read back
  // through the real api-boundary parser.
  const dbRows = events.map((ev, i) => ({
    id: `ev-${i}`,
    match_id: MATCH_ID,
    minute: ev.minute,
    subminute: ev.subminute,
    type: ev.type,
    payload: ev.payload,
    created_at: '2026-01-01T00:00:00Z',
  }));

  const parsed = parseMatchEventRows(dbRows, 'e2e') as unknown as MatchEventRow[];
  return { spatial, adapted, events, cosmic, dbRows, parsed };
}

describe('a simulated match survives the whole pipeline', () => {
  const run = runPipeline(4242);

  it('the engine produces a real match', () => {
    expect(run.spatial.events.length).toBeGreaterThan(100);
    expect(run.adapted.events.length).toBeGreaterThan(100);
  });

  it('the significance filter trims the flood but keeps the beats', () => {
    expect(run.events.length).toBeLessThan(run.adapted.events.length);
    expect(run.events.length).toBeGreaterThan(5);
  });

  it('NOTHING is lost at the Zod gate', () => {
    // The #695 regression, asserted on real engine output rather than on a
    // hand-made row. Before that fix this dropped nearly everything.
    expect(run.parsed.length).toBe(run.dbRows.length);
  });

  it('every persisted row satisfies the DB CHECK constraints', () => {
    for (const r of run.dbRows) {
      expect(r.minute, 'minute 0..120').toBeGreaterThanOrEqual(0);
      expect(r.minute).toBeLessThanOrEqual(120);
      expect(r.subminute, 'subminute >= 0').toBeGreaterThanOrEqual(0);
      expect(r.subminute, 'subminute < 1').toBeLessThan(1);
    }
  });

  it('a fan sees commentary, not event-type labels', () => {
    const withProse = run.parsed.filter((e) => {
      const p = (e.payload ?? {}) as Record<string, unknown>;
      return typeof p['commentary'] === 'string' && p['commentary'].length > 0;
    });
    expect(withProse.length).toBe(run.parsed.length);
  });

  it('the commentary does not repeat itself', () => {
    // The failure the whole commentary layer exists to prevent: sixteen
    // hardcoded strings on loop for ninety minutes.
    const lines = run.parsed.map((e) =>
      String((e.payload as Record<string, unknown>)['commentary']),
    );
    const unique = new Set(lines);
    expect(unique.size).toBeGreaterThan(Math.min(20, Math.floor(lines.length * 0.6)));
  });

  it('all three commentators appear', () => {
    const voices = new Set(
      run.parsed
        .map((e) => (e.payload as Record<string, unknown>)['voice'])
        .filter((v): v is string => typeof v === 'string'),
    );
    for (const v of ['vox', 'nexus', 'zara']) {
      expect(voices.has(v), `${v} never spoke`).toBe(true);
    }
  });

  it('voiced rows render with a commentator byline', () => {
    const voiced = run.parsed.filter((e) => eventVoice(e) !== null);
    expect(voiced.length).toBeGreaterThan(0);
    for (const e of voiced.slice(0, 20)) {
      const heading = eventHeading(e);
      expect(['Captain Vox', 'Nexus-7', 'Zara Bloom']).toContain(heading);
    }
  });

  it('no row renders an unsubstituted template marker', () => {
    for (const e of run.parsed) {
      const text = String((e.payload as Record<string, unknown>)['commentary'] ?? '');
      expect(text).not.toMatch(/\{[a-z0-9_|]+\}/);
      expect(text).not.toMatch(/<[a-z0-9_]+>/);
      expect(text).not.toMatch(/\bundefined\b|\bnull\b|\band and\b/);
    }
  });

  it('is byte-identical on a replay', () => {
    // A fixture is a fixed record: same seed and match id, same broadcast.
    const again = runPipeline(4242);
    expect(again.parsed.map((e) => e.payload)).toEqual(run.parsed.map((e) => e.payload));
  });

  it('produces a different broadcast for a different match', () => {
    const other = runPipeline(99);
    const a = run.parsed.map((e) => String((e.payload as Record<string, unknown>)['commentary']));
    const b = other.parsed.map((e) => String((e.payload as Record<string, unknown>)['commentary']));
    expect(a.join('|')).not.toBe(b.join('|'));
  });
});

describe('across several matches', () => {
  const seeds = [1, 7, 101, 2026, 31337];

  // Simulating a full 90 minutes is genuinely expensive (roughly a second per
  // match), so the runs are shared between the assertions below rather than
  // repeated. Done naively this block ran ten matches and blew the default
  // 5s budget under parallel load while passing in isolation, which is a
  // confusing way for a suite to fail.
  let runs: ReturnType<typeof runPipeline>[] | null = null;
  const allRuns = () => (runs ??= seeds.map(runPipeline));

  it(
    'every match yields a readable broadcast',
    () => {
      allRuns().forEach((r, i) => {
        expect(r.parsed.length, `seed ${seeds[i]} lost rows at the Zod gate`).toBe(r.dbRows.length);
        expect(r.parsed.length, `seed ${seeds[i]} produced no events`).toBeGreaterThan(5);
      });
    },
    30_000,
  );

  it(
    'the cosmic voices speak at least once somewhere',
    () => {
      // Sparse by design, so this is asserted across matches rather than
      // within one. If it ever reaches zero, they have been silently unwired.
      const total = allRuns().reduce((n, r) => n + r.cosmic.length, 0);
      expect(total).toBeGreaterThan(0);
    },
    30_000,
  );
});
