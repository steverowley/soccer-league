// ── auth/types.ts ────────────────────────────────────────────────────────────
// WHY: Typed shapes consumed by the auth feature's api/, logic/, and ui/
// layers. These types are derived from the DB schema (via database.ts) but
// narrowed to the subset the auth feature actually cares about. Downstream
// features import them via the barrel (`@features/auth`) — never directly.
//
// DESIGN RULE: every type here has a single source of truth:
//   - `Profile` matches `profiles` Row from database.ts
//   - `PublicProfile` matches the `public_profiles` view (subset of Profile)
//   - `UpdateProfileInput` is the shape the UI sends to the api layer
//
// When the DB schema changes (new migration → regenerated database.ts),
// update these types in lockstep. TypeScript will surface mismatches at
// compile time because the api/ layer maps between DB rows and these types.

// NOTE: When database.ts is regenerated after applying migration
// 0001_profiles.sql, switch to:
//   import type { Tables } from '@/types/database';
//   export type Profile = Tables<'profiles'>;
// For now, the profile shape is defined manually below.

// ── Profile ─────────────────────────────────────────────────────────────────
/**
 * Full user profile as returned by `profiles` table SELECT. Includes
 * sensitive fields (credits, last_seen_at) that are only visible to the
 * owning user via RLS.
 *
 * NOTE: The `profiles` table is created by migration 0001_profiles.sql and
 * is NOT yet in the generated database.ts (the types will be regenerated
 * after the migration is applied). Until then we define the shape manually
 * here. When database.ts is regenerated, switch to:
 *   `export type Profile = Tables<'profiles'>;`
 */
export interface Profile {
  id: string;
  username: string;
  favourite_team_id: string | null;
  favourite_player_id: string | null;
  credits: number;
  last_seen_at: string | null;
  created_at: string;
}

/**
 * Public-facing profile fields exposed via the `public_profiles` SQL view.
 * Used on leaderboards, voting pages, and match attendance displays where
 * we need the username and team affiliation but must NOT leak credits or
 * activity timestamps.
 */
export interface PublicProfile {
  id: string;
  username: string;
  favourite_team_id: string | null;
  favourite_player_id: string | null;
  created_at: string;
}

/**
 * Shape accepted by the profile update endpoint. Only fields the user is
 * allowed to change via the UI are included — `id`, `created_at`, and
 * `credits` are never user-editable (credits change via betting settlement
 * and voting spend, not direct profile edits).
 *
 * All fields are optional: the API merges them with the existing row.
 */
export interface UpdateProfileInput {
  username?: string;
  favourite_team_id?: string | null;
  favourite_player_id?: string | null;
}

/**
 * Signup form input shape. Email + password are handled by Supabase Auth
 * directly; the username is written to profiles via the trigger's default
 * and then immediately updated if the user provided one during signup.
 */
export interface SignupInput {
  email: string;
  password: string;
  username: string;
}

/**
 * Login form input shape. Supabase Auth handles the actual verification;
 * the app only needs to pass these two fields to `signInWithPassword`.
 */
export interface LoginInput {
  email: string;
  password: string;
}
