// ── features/entities/api/playerSpecies.test.ts ─────────────────────────────
// The match page reads every squad player's people in ONE request through the
// public read cache, selecting only the id and the bio's species path; the
// mapping tolerates bios without a species and unknown values.

import { describe, expect, it, vi } from 'vitest';

import type { PublicReadClient } from '@shared/supabase/publicReadClient';

import { getPlayerSpeciesByEntityId } from './playerSpecies';
import { parsePlayerSpeciesRows } from './playerSpecies.schema';

/** Fake public client that records every query it is asked to build. */
function fakeDb(result: { data: unknown; error: unknown }) {
  const calls: Array<{ table: string; select: string; column: string; ids: string[] }> = [];
  const db = {
    from(table: string) {
      return {
        select(select: string) {
          return {
            in: async (column: string, ids: string[]) => {
              calls.push({ table, select, column, ids });
              return result;
            },
          };
        },
      };
    },
  };
  return { db: db as unknown as PublicReadClient, calls };
}

describe('parsePlayerSpeciesRows', () => {
  it('maps entity id to species, null for a missing or unknown people', () => {
    const map = parsePlayerSpeciesRows([
      { id: 'a', species: 'cephalid' },
      { id: 'b', species: null },
      { id: 'c' },
      { id: 'd', species: 'martian' },
    ]);
    expect([...map]).toEqual([
      ['a', 'cephalid'],
      ['b', null],
      ['c', null],
      ['d', null],
    ]);
  });

  it('drops rows it cannot match to a player, and tolerates a non-array', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect([...parsePlayerSpeciesRows([{ species: 'grey' }, { id: 7 }, { id: 'ok', species: 'grey' }])]).toEqual([
      ['ok', 'grey'],
    ]);
    expect(parsePlayerSpeciesRows(null).size).toBe(0);
    warn.mockRestore();
  });
});

describe('getPlayerSpeciesByEntityId', () => {
  it('makes ONE request for all ids, de-duplicated and sorted, selecting only id + species', async () => {
    const { db, calls } = fakeDb({ data: [{ id: 'e1', species: 'grey' }, { id: 'e2', species: 'terran' }], error: null });
    const map = await getPlayerSpeciesByEntityId(db, ['e2', 'e1', null, 'e2', undefined, '']);
    expect(calls).toEqual([
      { table: 'entities', select: 'id, species:meta->profile->>species', column: 'id', ids: ['e1', 'e2'] },
    ]);
    expect(map.get('e1')).toBe('grey');
    expect(map.get('e2')).toBe('terran');
  });

  it('makes no request when there are no ids', async () => {
    const { db, calls } = fakeDb({ data: [], error: null });
    expect((await getPlayerSpeciesByEntityId(db, [null, undefined])).size).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('returns an empty map on a read error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { db } = fakeDb({ data: null, error: { message: 'boom' } });
    expect((await getPlayerSpeciesByEntityId(db, ['e1'])).size).toBe(0);
    warn.mockRestore();
  });
});
