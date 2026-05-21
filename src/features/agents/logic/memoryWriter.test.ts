// ── memoryWriter.test.ts ────────────────────────────────────────────────────
// Unit tests for the pure memory-writer in `memoryWriter.ts`.
//
// Test focus:
//   1. Match completion — correct memory count per supplied context;
//      payload JSONB is correctly assembled; salience escalates on
//      lopsided scorelines.
//   2. Season ended — one memory per manager ID, salience matches the
//      published constant.
//   3. Architect intervention — one memory per entity ID, subjects
//      array excludes the entity itself (so a featured pair memoralises
//      each other reciprocally).
//
// PURE TESTS — no Supabase, no listener.  Pinning a fixed `occurredAt`
// keeps the assertions deterministic.

import { describe, expect, it } from 'vitest';

import {
  ARCHITECT_TOUCHED_SALIENCE,
  buildArchitectMemories,
  buildMatchCompletionMemories,
  buildSeasonEndedMemories,
  LOPSIDED_SCORE_DELTA,
  MATCH_RESULT_SALIENCE,
  SEASON_CONCLUDED_SALIENCE,
} from './memoryWriter';

// ── Fixtures ────────────────────────────────────────────────────────────────

/** Fixed timestamp so assertions don't depend on wall clock. */
const OCCURRED_AT = '2026-05-21T12:00:00Z';

/** A canonical match completion payload used across match-completion tests. */
const MATCH_PAYLOAD = {
  matchId: '11111111-1111-1111-1111-111111111111',
  homeTeamId: 'mars-athletic',
  awayTeamId: 'venus-volcanic',
  homeScore: 2,
  awayScore: 1,
  competitionId: '22222222-2222-2222-2222-222222222222',
};

/** Entity IDs for the involved roles. */
const REF = '33333333-3333-3333-3333-333333333333';
const HOME_MGR = '44444444-4444-4444-4444-444444444444';
const AWAY_MGR = '55555555-5555-5555-5555-555555555555';

// ── buildMatchCompletionMemories ───────────────────────────────────────────

describe('buildMatchCompletionMemories', () => {
  /**
   * When no entity context is supplied (no ref, no managers resolved by
   * the caller), the function returns an empty array — never emits an
   * orphan memory.
   */
  it('returns no memories when no involved entities are supplied', () => {
    const result = buildMatchCompletionMemories(MATCH_PAYLOAD, { occurredAt: OCCURRED_AT });
    expect(result).toEqual([]);
  });

  /**
   * Three involved entities (referee + both managers) → three memories.
   * Verifies the basic count + entity_id wiring.
   */
  it('emits one memory per supplied entity (ref + both managers)', () => {
    const result = buildMatchCompletionMemories(MATCH_PAYLOAD, {
      refereeId: REF,
      homeManagerId: HOME_MGR,
      awayManagerId: AWAY_MGR,
      occurredAt: OCCURRED_AT,
    });

    expect(result).toHaveLength(3);
    expect(result.map((m) => m.entity_id)).toEqual([REF, HOME_MGR, AWAY_MGR]);
    expect(result.every((m) => m.fact_kind === 'match_result')).toBe(true);
    expect(result.every((m) => m.occurred_at === OCCURRED_AT)).toBe(true);
  });

  /**
   * The manager memories should carry a `perspective` field distinguishing
   * home vs away — Phase 5 enricher needs this to phrase "your home win"
   * vs "your away defeat" without re-querying matches.
   */
  it('tags manager memories with home/away perspective in payload', () => {
    const result = buildMatchCompletionMemories(MATCH_PAYLOAD, {
      refereeId: REF,
      homeManagerId: HOME_MGR,
      awayManagerId: AWAY_MGR,
      occurredAt: OCCURRED_AT,
    });

    const refPayload = result[0]?.payload as { perspective?: string };
    const homePayload = result[1]?.payload as { perspective?: string };
    const awayPayload = result[2]?.payload as { perspective?: string };

    // Referee has no perspective tag — they're neutral.
    expect(refPayload.perspective).toBeUndefined();
    expect(homePayload.perspective).toBe('home');
    expect(awayPayload.perspective).toBe('away');
  });

  /**
   * Salience escalates from the default to 6 when the absolute score
   * delta hits {@link LOPSIDED_SCORE_DELTA}.  Pins the LOPSIDED constant.
   */
  it('escalates salience on lopsided scorelines', () => {
    const closeResult = buildMatchCompletionMemories(MATCH_PAYLOAD, {
      refereeId: REF,
      occurredAt: OCCURRED_AT,
    });
    expect(closeResult[0]?.salience).toBe(MATCH_RESULT_SALIENCE);

    const lopsided = buildMatchCompletionMemories(
      { ...MATCH_PAYLOAD, homeScore: 5, awayScore: 1 }, // delta = 4 >= LOPSIDED_SCORE_DELTA
      { refereeId: REF, occurredAt: OCCURRED_AT },
    );
    expect(lopsided[0]?.salience).toBeGreaterThan(MATCH_RESULT_SALIENCE);
  });

  /** Boundary check: exactly LOPSIDED_SCORE_DELTA triggers the escalation. */
  it('treats score delta == LOPSIDED_SCORE_DELTA as lopsided', () => {
    const boundary = buildMatchCompletionMemories(
      { ...MATCH_PAYLOAD, homeScore: LOPSIDED_SCORE_DELTA, awayScore: 0 },
      { refereeId: REF, occurredAt: OCCURRED_AT },
    );
    expect(boundary[0]?.salience).toBeGreaterThan(MATCH_RESULT_SALIENCE);
  });
});

// ── buildSeasonEndedMemories ───────────────────────────────────────────────

describe('buildSeasonEndedMemories', () => {
  /** Empty manager list → no memories. */
  it('emits zero memories when no managers supplied', () => {
    const result = buildSeasonEndedMemories(
      { seasonId: 's1', seasonName: 'Season 1' },
      [],
      OCCURRED_AT,
    );
    expect(result).toEqual([]);
  });

  /** One memory per manager, all carrying the season payload. */
  it('emits one season_concluded memory per manager', () => {
    const result = buildSeasonEndedMemories(
      { seasonId: 's1', seasonName: 'Season 1 — 2600' },
      ['mgr-a', 'mgr-b', 'mgr-c'],
      OCCURRED_AT,
    );
    expect(result).toHaveLength(3);
    expect(result.every((m) => m.fact_kind === 'season_concluded')).toBe(true);
    expect(result.every((m) => m.salience === SEASON_CONCLUDED_SALIENCE)).toBe(true);
    const payload = result[0]?.payload as { seasonName?: string };
    expect(payload.seasonName).toBe('Season 1 — 2600');
  });
});

// ── buildArchitectMemories ─────────────────────────────────────────────────

describe('buildArchitectMemories', () => {
  /** No featured entities → no memories. */
  it('emits zero memories when entityIds is missing/empty', () => {
    const noField = buildArchitectMemories(
      { kind: 'cosmic_edict', description: 'A general decree' },
      OCCURRED_AT,
    );
    const emptyField = buildArchitectMemories(
      { kind: 'cosmic_edict', description: 'A general decree', entityIds: [] },
      OCCURRED_AT,
    );
    expect(noField).toEqual([]);
    expect(emptyField).toEqual([]);
  });

  /**
   * For two featured entities, both should remember being touched and
   * each should have the OTHER as a subject — the "tied fates" pattern
   * Phase 5 enricher can voice.
   */
  it('cross-links featured entities reciprocally via subjects', () => {
    const result = buildArchitectMemories(
      {
        kind: 'sealed_fate',
        description: 'Two stars bound for the same hour',
        entityIds: ['ent-a', 'ent-b'],
        matchId: 'match-77',
      },
      OCCURRED_AT,
    );

    expect(result).toHaveLength(2);
    expect(result.every((m) => m.fact_kind === 'architect_touched')).toBe(true);
    expect(result.every((m) => m.salience === ARCHITECT_TOUCHED_SALIENCE)).toBe(true);

    // ent-a's row references ent-b in subjects, and vice versa — the
    // entity never appears in its own subjects list.
    const aRow = result.find((m) => m.entity_id === 'ent-a');
    const bRow = result.find((m) => m.entity_id === 'ent-b');
    expect(aRow?.subjects).toEqual(['ent-b']);
    expect(bRow?.subjects).toEqual(['ent-a']);
  });
});
