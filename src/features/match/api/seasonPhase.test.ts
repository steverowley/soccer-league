// ── seasonPhase.test.ts ─────────────────────────────────────────────────────
// deriveSeasonPhase decides between the season view and the pre-season view
// on Home, Fixtures, Leagues, Standings and Leaderboards.

import { describe, expect, it } from 'vitest';
import { deriveSeasonPhase, type SeasonPhaseRow } from './seasons';

const NOW = new Date('2026-10-26T12:00:00Z');
const row = (over: Partial<SeasonPhaseRow>): SeasonPhaseRow => ({
  id: 's', name: 'Season 1 (2600)', is_active: false, start_date: null, started_at: null, ...over,
});

describe('deriveSeasonPhase', () => {
  it('is pre-season with "Season 1" and no date when no season exists (the reset state)', () => {
    expect(deriveSeasonPhase([], NOW)).toEqual({
      phase: 'pre-season', active: null, nextName: 'Season 1', startsAt: null,
    });
  });

  it('is in season when an active season has started', () => {
    const active = row({ is_active: true, started_at: '2026-10-01T00:00:00Z', start_date: '2026-10-01' });
    const p = deriveSeasonPhase([active], NOW);
    expect(p.phase).toBe('in-season');
    expect(p.active).toBe(active);
  });

  it('is pre-season, with the DB start date, when the active season starts in the future', () => {
    const active = row({ is_active: true, start_date: '2026-11-15' });
    expect(deriveSeasonPhase([active], NOW)).toMatchObject({
      phase: 'pre-season', nextName: 'Season 1', startsAt: '2026-11-15',
    });
  });

  it('uses a scheduled future season when none is active', () => {
    const past = row({ id: 'a', name: 'Season 1 (2600)', started_at: '2026-01-01T00:00:00Z', start_date: '2026-01-01' });
    const next = row({ id: 'b', name: 'Season 2 (2601)', start_date: '2026-12-01' });
    expect(deriveSeasonPhase([next, past], NOW)).toMatchObject({
      phase: 'pre-season', nextName: 'Season 2', startsAt: '2026-12-01',
    });
  });

  it('counts on from past seasons when nothing is scheduled', () => {
    const past = row({ started_at: '2026-01-01T00:00:00Z' });
    expect(deriveSeasonPhase([past], NOW)).toMatchObject({ phase: 'pre-season', nextName: 'Season 2', startsAt: null });
  });

  it('treats an active season with no start date as in season', () => {
    expect(deriveSeasonPhase([row({ is_active: true })], NOW).phase).toBe('in-season');
  });
});
