// ── client.ts ────────────────────────────────────────────────────────────────
// WHY: A single, typed Supabase client instance shared across the whole app.
// Features never construct their own client — they receive one via the
// SupabaseProvider React context (see SupabaseProvider.tsx). This file is the
// only place the credentials are read from the environment, so:
//
//   1. Unit tests inject a fake client via context — no env vars needed.
//   2. If we ever swap Supabase for a different backend, we change this file
//      and the SupabaseProvider; feature code is untouched.
//   3. The `Database` generic locks every query's column names, insert shapes,
//      and filter values to the actual schema at compile time.
//
// CREDENTIAL SAFETY:
//   - VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are loaded from .env by
//     Vite's build pipeline and baked into the browser bundle at build time.
//   - The anon key is intentionally public — Supabase's Row Level Security
//     policies on the database side are the security boundary, not the key.
//   - Never commit the service-role key to this file or any .env file checked
//     into version control. The service-role key bypasses RLS entirely.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
// NOTE: @types/* alias is reserved by TypeScript for DefinitelyTyped — use @/* instead.
import type { Database } from '@/types/database';

// ── Environment variables ─────────────────────────────────────────────────────
// Vite exposes VITE_* env vars on import.meta.env. These must be defined in
// a local .env file (not committed) or in the deployment environment.
// If either is missing, Supabase queries will fail with auth errors at runtime.
// We intentionally do not throw here to keep the module importable in test
// environments where the values are not set.

const SUPABASE_URL = import.meta.env['VITE_SUPABASE_URL'] as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env['VITE_SUPABASE_ANON_KEY'] as string | undefined;

// ── Typed client ──────────────────────────────────────────────────────────────
// `createClient<Database>` narrows every `.from('table_name')` call to the
// exact Row/Insert/Update shape defined in src/types/database.ts. Querying a
// column that doesn't exist → compile error. Inserting a missing required
// field → compile error.
//
// The fallback empty strings allow the module to be imported in tests without
// throwing; the injected fake client from SupabaseProvider takes precedence
// in any test that renders React components.

/**
 * The application-wide typed Supabase client.
 *
 * Import this only in:
 *   - `src/shared/supabase/SupabaseProvider.tsx` (to put it in context)
 *   - Server-side / Edge Function code that cannot use React context
 *
 * All feature code should consume the client via `useSupabase()` instead,
 * so tests can inject a fake without patching this module.
 */
export const supabaseClient: SupabaseClient<Database> = createClient<Database>(
  SUPABASE_URL ?? '',
  SUPABASE_ANON_KEY ?? '',
);

/**
 * Convenience re-export of the `SupabaseClient` type parameterised over the
 * ISL schema. Feature `api/` modules declare their function signatures with
 * this type so they accept both the real client and test fakes:
 *
 * @example
 * import type { IslSupabaseClient } from '@shared/supabase/client';
 *
 * export async function getActiveSeason(db: IslSupabaseClient) {
 *   return db.from('seasons').select('*').eq('is_active', true).single();
 * }
 */
export type IslSupabaseClient = SupabaseClient<Database>;
