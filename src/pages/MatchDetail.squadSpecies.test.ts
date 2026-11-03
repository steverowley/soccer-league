// ── pages/MatchDetail.squadSpecies.test.ts ──────────────────────────────────
// The viewer's squads carry each player's people from his bio: toViewerPlayer
// maps species through the batched read's result, and squadEntityIds names
// exactly the picked squads' entities (one request for both sides).

import { describe, expect, it } from 'vitest';

import type { Species } from '../data/peoples';
import { pickSquad, squadEntityIds, toViewerPlayer, type MatchPlayerRow } from './MatchDetail';

const row = (i: number, over: Partial<MatchPlayerRow> = {}): MatchPlayerRow => ({
  id: `p-${String(i).padStart(2, '0')}`,
  name: `Player ${i}`,
  jersey_number: i,
  position: i === 1 ? 'GK' : 'MF',
  starter: i <= 11,
  overall_rating: 90 - i,
  entity_id: `e-${String(i).padStart(2, '0')}`,
  ...over,
});

describe('toViewerPlayer species', () => {
  const species = new Map<string, Species | null>([
    ['e-01', 'grey'],
    ['e-02', null],
  ]);

  it('passes the people from his bio', () => {
    expect(toViewerPlayer(row(1), species)).toEqual({
      id: 'p-01',
      position: 'GK',
      name: 'Player 1',
      number: 1,
      species: 'grey',
    });
  });

  it('is null when his bio has no species, he has no entity, or no map was loaded', () => {
    expect(toViewerPlayer(row(2), species).species).toBeNull();
    expect(toViewerPlayer(row(3), species).species).toBeNull();
    expect(toViewerPlayer(row(1, { entity_id: null }), species).species).toBeNull();
    expect(toViewerPlayer(row(1)).species).toBeNull();
  });

  it('never passes a value that is not one of the peoples', () => {
    const bad = new Map([['e-01', 'martian' as unknown as Species]]);
    expect(toViewerPlayer(row(1), bad).species).toBeNull();
  });
});

describe('squadEntityIds', () => {
  it('names the entities of both picked squads (16 a side at most), skipping players without one', () => {
    const home = Array.from({ length: 18 }, (_, i) => row(i + 1));
    const away = Array.from({ length: 16 }, (_, i) => row(i + 21, { entity_id: i === 0 ? null : `a-${i}` }));
    const ids = squadEntityIds(home, away);
    expect(ids).toEqual([
      ...pickSquad(home).map((p) => p.entity_id),
      ...pickSquad(away).map((p) => p.entity_id).filter(Boolean),
    ]);
    expect(ids).toHaveLength(16 + 15);
    expect(ids).not.toContain('e-17');
  });
});
