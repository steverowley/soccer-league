// ── features/entities/api/entityProfiles.test.ts ────────────────────────────
// Guards the boundary read: a valid profile parses through, and every failure
// mode (missing row, missing profile, unprofiled kind, drifted profile, network
// error) degrades to null instead of throwing into the detail page.

import { describe, expect, it, vi } from 'vitest';

import type { IslSupabaseClient } from '@shared/supabase/client';

import { getEntityProfile } from './entityProfiles';

const validPlayerProfile = {
  gender: 'Male',
  race: 'Human',
  appearance: 'Tall',
  bio: 'A player.',
  personality: 'Calm.',
  political_leaning: 'Centrist',
  culture: 'Loyal',
  achievements: ['Cap'],
  injuries: 'Fully fit.',
};

/** Build a stub client whose entities query resolves to the given row/error. */
function makeDb(result: { data: unknown; error: unknown }): IslSupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => result,
        }),
      }),
    }),
  } as unknown as IslSupabaseClient;
}

describe('getEntityProfile', () => {
  it('returns the validated profile + kind for a well-formed row', async () => {
    const db = makeDb({ data: { kind: 'player', meta: { profile: validPlayerProfile } }, error: null });
    const res = await getEntityProfile(db, 'abc');
    expect(res?.kind).toBe('player');
    expect(res?.profile['bio']).toBe('A player.');
  });

  it('returns null when the entity has no profile key', async () => {
    const db = makeDb({ data: { kind: 'player', meta: { team_id: 'x' } }, error: null });
    expect(await getEntityProfile(db, 'abc')).toBeNull();
  });

  it('returns null for an unprofiled kind even if a profile blob is present', async () => {
    const db = makeDb({ data: { kind: 'planet', meta: { profile: validPlayerProfile } }, error: null });
    expect(await getEntityProfile(db, 'abc')).toBeNull();
  });

  it('returns null (no throw) for a drifted profile that fails its schema', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const db = makeDb({ data: { kind: 'player', meta: { profile: { bio: 'incomplete' } } }, error: null });
    expect(await getEntityProfile(db, 'abc')).toBeNull();
    warn.mockRestore();
  });

  it('returns null on a query error', async () => {
    const db = makeDb({ data: null, error: { message: 'boom' } });
    expect(await getEntityProfile(db, 'abc')).toBeNull();
  });
});
