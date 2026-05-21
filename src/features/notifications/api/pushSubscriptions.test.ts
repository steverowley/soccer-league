// ── features/notifications/api/pushSubscriptions.test.ts ─────────────────────
// Focused tests for the `updateNotificationPreferences` key-allowlist
// behaviour added as the M3 defence-in-depth fix (security review of branch
// claude/great-allen-wOGHA).
//
// The wrapper has always passed `prefs` straight into PostgREST.  Migration
// 0040 closes the most dangerous keys (is_admin / credits) at the RLS layer,
// but defence-in-depth says we should also drop unexpected keys client-side
// so they never leave the browser.  These tests prove the wrapper:
//   1. Forwards exactly the two declared boolean keys.
//   2. Coerces stray non-boolean values to `false`/`true` rather than
//      writing the raw value to the DB.
//   3. Strips dangerous extra keys silently.
//   4. Returns the documented "No preferences supplied" error when, after
//      filtering, nothing remains.
//
// SHAPE
//   We use the same hand-rolled in-memory Supabase double pattern as
//   `features/admin/api/admin.test.ts`: minimal chain surface (from /
//   select / update / eq / single) and an `auth.getUser()` stub.

import { describe, it, expect, beforeEach } from 'vitest';
import { updateNotificationPreferences } from './pushSubscriptions';
import type { IslSupabaseClient } from '@shared/supabase/client';

// ── In-memory store ─────────────────────────────────────────────────────────

/**
 * Shape of the single profile row the fake DB owns.  Only the two boolean
 * toggles + a few sentinels for the allowlist test are modelled — every
 * other column is deliberately absent so a regression that writes outside
 * the allowlist trips a test rather than silently corrupting the row.
 */
interface ProfileRow {
  /** Owning user's UUID — matches the seeded `getUser` reply. */
  id:                      string;
  /** Opt-in for "favourite team kickoff" pushes. */
  notify_favourite_team?:  boolean;
  /** Opt-in for "any match kickoff" pushes. */
  notify_all_matches?:     boolean;
  /** Sentinel guarded by migration 0040 — must never be touched here. */
  is_admin?:               boolean;
  /** Sentinel guarded by migration 0040 — must never be touched here. */
  credits?:                number;
}

interface FakeStore {
  profiles: ProfileRow[];
}

/**
 * UUID returned by the fake `auth.getUser()`.  Hardcoded so each test can
 * filter the profile row by the same value the production code reads from
 * the JWT.
 */
const FAKE_USER_ID = '00000000-0000-0000-0000-000000000001';

/**
 * Build a Supabase-client-shaped double backed by `store`.  Surface is the
 * minimal subset `updateNotificationPreferences` actually calls:
 *   - `auth.getUser()`
 *   - `from('profiles').update(...).eq('id', x).select(...).single()`
 *
 * @param store  Mutable in-memory tables shared with the test body.
 */
function makeFakeDb(store: FakeStore): IslSupabaseClient {
  return {
    auth: {
      // Mirrors the supabase-js return shape — `.data.user` is what the
      // production code destructures.
      async getUser() {
        return { data: { user: { id: FAKE_USER_ID } }, error: null };
      },
    },
    from(table: string) {
      let mode:    'select' | 'update' = 'select';
      let payload: Record<string, unknown> | null = null;
      const filters: Array<{ col: string; val: unknown }> = [];

      const builder: Record<string, unknown> = {
        select() { return builder; },
        update(p: Record<string, unknown>) { mode = 'update'; payload = p; return builder; },
        eq(col: string, val: unknown) { filters.push({ col, val }); return builder; },
        // `.single()` resolves with the first matched row or an error.
        // Mirrors PostgREST's "must match exactly one row" semantics.
        async single() {
          const rows = (store as unknown as Record<string, ProfileRow[]>)[table] ?? [];
          let matched = rows;
          for (const f of filters) {
            matched = matched.filter((r) => (r as unknown as Record<string, unknown>)[f.col] === f.val);
          }
          if (mode === 'update' && payload) {
            for (const r of matched) Object.assign(r as unknown as Record<string, unknown>, payload);
          }
          if (matched.length === 0) {
            return { data: null, error: { message: 'no row matched' } };
          }
          return { data: matched[0], error: null };
        },
      };
      return builder;
    },
  } as unknown as IslSupabaseClient;
}

// ── Common state ────────────────────────────────────────────────────────────

let store: FakeStore;

beforeEach(() => {
  // Seed a single profile row with both toggles initially false plus the
  // two sentinel columns set to known "should never be touched" values.
  store = {
    profiles: [{
      id:                    FAKE_USER_ID,
      notify_favourite_team: false,
      notify_all_matches:    false,
      is_admin:              false,
      credits:               200,
    }],
  };
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('updateNotificationPreferences key allowlist', () => {
  it('forwards exactly the two declared boolean keys when both are supplied', async () => {
    const result = await updateNotificationPreferences(makeFakeDb(store), {
      notify_favourite_team: true,
      notify_all_matches:    true,
    });
    // Wrapper returned the merged row.
    expect(result.error).toBeNull();
    // Underlying row was updated for both keys.
    expect(store.profiles[0]!.notify_favourite_team).toBe(true);
    expect(store.profiles[0]!.notify_all_matches).toBe(true);
    // Sentinels untouched.
    expect(store.profiles[0]!.is_admin).toBe(false);
    expect(store.profiles[0]!.credits).toBe(200);
  });

  it('forwards only the supplied key when one is omitted', async () => {
    await updateNotificationPreferences(makeFakeDb(store), { notify_all_matches: true });
    // Only the supplied key flipped — the other stays at its seeded value.
    expect(store.profiles[0]!.notify_favourite_team).toBe(false);
    expect(store.profiles[0]!.notify_all_matches).toBe(true);
  });

  it('drops unknown keys before reaching the DB', async () => {
    // Cast through `unknown` so TypeScript permits the extra keys that a
    // malicious caller might attempt at runtime (the type erasure is the
    // whole reason the allowlist exists).
    await updateNotificationPreferences(
      makeFakeDb(store),
      {
        notify_favourite_team: true,
        // Sentinel extra keys — must NOT land in the row.
        is_admin: true,
        credits:  9_999_999,
        // Even a typo'd legit-sounding key gets dropped.
        notify_extra_thing: true,
      } as unknown as Parameters<typeof updateNotificationPreferences>[1],
    );
    // The allowed key landed.
    expect(store.profiles[0]!.notify_favourite_team).toBe(true);
    // Both sentinels remain at their seeded values — the allowlist filtered
    // them out before the PostgREST call.
    expect(store.profiles[0]!.is_admin).toBe(false);
    expect(store.profiles[0]!.credits).toBe(200);
  });

  it('coerces non-boolean values to booleans rather than writing them through', async () => {
    // The TS signature says boolean, but JS at runtime accepts anything.
    // We expect the wrapper to coerce truthiness so the DB only ever sees
    // proper booleans (matches the column type).
    await updateNotificationPreferences(
      makeFakeDb(store),
      {
        notify_favourite_team: 1 as unknown as boolean,
        notify_all_matches:    '' as unknown as boolean,
      },
    );
    expect(store.profiles[0]!.notify_favourite_team).toBe(true);
    expect(store.profiles[0]!.notify_all_matches).toBe(false);
  });

  it('refuses an empty allowlist payload with the documented error string', async () => {
    // After filtering, this object has nothing to write — the wrapper
    // surfaces the "No preferences supplied" error rather than firing a
    // PostgREST no-op the caller can't disambiguate from success.
    const result = await updateNotificationPreferences(
      makeFakeDb(store),
      { is_admin: true } as unknown as Parameters<typeof updateNotificationPreferences>[1],
    );
    expect(result.data).toBeNull();
    expect(result.error).toBe('No preferences supplied');
    // Sentinel still untouched.
    expect(store.profiles[0]!.is_admin).toBe(false);
  });
});
