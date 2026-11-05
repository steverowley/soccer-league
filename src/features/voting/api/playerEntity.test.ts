// ── voting/api/playerEntity.test.ts ──────────────────────────────────────────
// Every new player gets his people at creation: the entity built for him
// carries `speciesForNewPlayer(team_id, player id)` and the matching race line
// in `meta.profile`, and provisioning writes exactly one entity, links it and
// seeds a persona.

import { describe, expect, it, vi } from 'vitest';

import type { IslSupabaseClient } from '@shared/supabase/client';

import { isSpecies, raceLine, speciesForNewPlayer, SQUAD_MIX } from '../../../data/peoples';
import { parseStoredProfile } from '../../entities/logic/entityProfile';

import { newPlayerEntityPayload, provisionPlayerEntity } from './playerEntity';

const { upsertPersona } = vi.hoisted(() => ({ upsertPersona: vi.fn(async (..._args: unknown[]) => null) }));
vi.mock('@features/agents', () => ({
  createPersona: () => ({ entity_id: 'e-1' }),
  upsertPersona: (...args: unknown[]) => upsertPersona(...args),
}));

describe('newPlayerEntityPayload', () => {
  it('writes the player people (speciesForNewPlayer) and race line into meta.profile for every club', () => {
    for (const teamId of Object.keys(SQUAD_MIX)) {
      const id = `00000000-0000-4000-8000-${teamId.length.toString().padStart(12, '0')}`;
      const payload = newPlayerEntityPayload({ id, name: 'New Signing', team_id: teamId, position: 'MF' });
      const species = speciesForNewPlayer(teamId, id);
      expect(payload.kind).toBe('player');
      expect(payload.meta).toEqual({
        team_id: teamId,
        position: 'MF',
        nationality: null,
        profile: { race: raceLine(species), species },
      });
      expect(isSpecies((payload.meta['profile'] as { species: unknown }).species)).toBe(true);
      expect(() => parseStoredProfile('player', payload.meta['profile'])).not.toThrow();
    }
  });

  it('is stable for the same player id', () => {
    const p = { id: 'abc', name: 'A', team_id: 'europa-oceanic', position: 'FW' };
    expect(newPlayerEntityPayload(p)).toEqual(newPlayerEntityPayload(p));
  });
});

/** Fake client recording each table touched and each payload written. */
function fakeDb(entityResult: { data: unknown; error: unknown }) {
  const calls: Array<{ table: string; op: string; payload?: unknown }> = [];
  const db = {
    from(table: string) {
      return {
        insert(payload: unknown) {
          calls.push({ table, op: 'insert', payload });
          return { select: () => ({ single: async () => entityResult }) };
        },
        update(payload: unknown) {
          calls.push({ table, op: 'update', payload });
          return { eq: async () => ({ error: null }) };
        },
      };
    },
  };
  return { db: db as unknown as IslSupabaseClient, calls };
}

describe('provisionPlayerEntity', () => {
  const player = { id: 'p-1', name: 'Oru Vass', team_id: 'europa-oceanic', position: 'MF', nationality: 'Europan' };

  it('inserts one entity with his people, links it and seeds a persona', async () => {
    upsertPersona.mockClear();
    const { db, calls } = fakeDb({
      data: { id: 'e-1', kind: 'player', name: 'Oru Vass', display_name: 'Oru Vass', meta: {} },
      error: null,
    });
    const id = await provisionPlayerEntity(db, player, 'test');
    expect(id).toBe('e-1');
    expect(calls.map((c) => `${c.op}:${c.table}`)).toEqual(['insert:entities', 'update:players']);
    const meta = (calls[0]!.payload as { meta: Record<string, unknown> }).meta;
    const species = speciesForNewPlayer(player.team_id, player.id);
    expect(meta['profile']).toEqual({ race: raceLine(species), species });
    expect(meta['nationality']).toBe('Europan');
    expect(calls[1]!.payload).toEqual({ entity_id: 'e-1' });
    expect(upsertPersona).toHaveBeenCalledTimes(1);
  });

  it('returns null without linking when the entity insert fails', async () => {
    upsertPersona.mockClear();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { db, calls } = fakeDb({ data: null, error: { message: 'denied' } });
    expect(await provisionPlayerEntity(db, player, 'test')).toBeNull();
    expect(calls.map((c) => `${c.op}:${c.table}`)).toEqual(['insert:entities']);
    expect(upsertPersona).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
