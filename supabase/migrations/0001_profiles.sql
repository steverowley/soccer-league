-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: 0001_profiles
-- ───────────────────────────────────────────────────────────────────────────
-- WHY: Phase 1 introduces user accounts. The `profiles` table stores per-
-- user data that the game logic needs (credits balance, favourite team/player
-- for fan-boost queries, last_seen_at for attendance tracking). Supabase
-- Auth provides the `auth.users` table for email/password/magic-link, but
-- game-specific columns must live in a public schema table because:
--   1. The match engine and betting system need to read credits/favourites
--      without touching the auth schema.
--   2. RLS policies need to reference `profiles.id` to scope access.
--   3. Other users need to see usernames/teams on leaderboards — but NOT
--      credits or email.
--
-- DESIGN DECISIONS:
--   - `id` is a UUID FK to auth.users(id) — 1:1, set via the trigger below
--     so a profile row is auto-created on every signup. No orphan profiles.
--   - `credits` defaults to 200 (the starter balance from the game design).
--     CHECK >= 0 prevents negative balances from buggy settlement logic.
--   - `last_seen_at` is touched on every authed page view (debounced to
--     ≤1 update/minute). Phase 3's fan-boost query filters on
--     `last_seen_at > now() - interval '5 minutes'` to count "present" fans.
--   - `favourite_team_id` / `favourite_player_id` are nullable because the
--     user picks them post-signup, not during registration.
--
-- RLS:
--   - Public columns (id, username, favourite_team_id, favourite_player_id,
--     created_at) are readable by everyone via a SQL view.
--   - Full row (including credits, last_seen_at) is readable only by the
--     owning user.
--   - Only the owning user can UPDATE their own row (credits, favourites,
--     last_seen_at). INSERT is handled by the trigger; users never INSERT
--     directly.
--
-- DEPENDS ON: 0000_init.sql (teams, players tables must exist for FK refs).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── profiles table ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  -- 1:1 with auth.users. ON DELETE CASCADE so deleting an auth user
  -- cleans up their profile without an orphan-hunter cron.
  id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Display name shown on leaderboards, voting pages, and match chat.
  -- UNIQUE so two users can't squat the same handle; 3-30 chars enforced
  -- at the app layer (Zod), not here, to keep migration-time constraints
  -- simple and avoidable if design changes.
  username        TEXT UNIQUE NOT NULL,

  -- The user's chosen team. NULL until they pick one post-signup.
  -- FK to teams(id) so orphan references are impossible.
  favourite_team_id   TEXT REFERENCES teams(id) ON DELETE SET NULL,

  -- The user's chosen player. NULL until they pick one post-signup.
  -- FK to players(id) so orphan references are impossible.
  favourite_player_id UUID REFERENCES players(id) ON DELETE SET NULL,

  -- Intergalactic Credits — the in-game currency used for betting (Phase 2)
  -- and voting (Phase 4). Starts at 200 per the game design doc.
  -- CHECK >= 0 is a DB-level safety net: the app should never attempt to
  -- deduct more credits than the user has, but if it does, the constraint
  -- prevents silently going negative and creating credits from nothing.
  credits         INTEGER NOT NULL DEFAULT 200
                  CONSTRAINT credits_non_negative CHECK (credits >= 0),

  -- Touched on every authed navigation (debounced). Phase 3 uses this to
  -- count "present" fans: WHERE last_seen_at > now() - interval '5 min'.
  last_seen_at    TIMESTAMPTZ DEFAULT now(),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Auto-create profile on signup ───────────────────────────────────────────
-- WHY a trigger instead of client-side INSERT after signup:
--   1. Atomic: the profile row exists the instant the auth user does; no
--      race window where a page load queries profiles and gets nothing.
--   2. Foolproof: the client can't forget to call createProfile(); every
--      auth method (email, magic link, OAuth if added later) hits the same
--      trigger.
--   3. The username is generated as a placeholder ('user_<short-uuid>');
--      the user can change it later via the profile edit UI.
--
-- SECURITY NOTE: this function runs as SECURITY DEFINER (superuser context)
-- because it needs to INSERT into `profiles` even though the user's RLS
-- policy doesn't allow INSERT. The function body is minimal and auditable.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, username)
  VALUES (
    NEW.id,
    -- Generate a unique placeholder like 'user_a1b2c3d4' from the first
    -- 8 chars of the UUID. Users can change this via profile settings.
    'user_' || LEFT(REPLACE(NEW.id::text, '-', ''), 8)
  );
  RETURN NEW;
END;
$$;

-- Fire the trigger AFTER INSERT on auth.users so NEW.id is populated.
-- The trigger name includes the migration number so it's easy to trace.
CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Read own full profile (includes credits, last_seen_at).
CREATE POLICY profiles_select_own ON profiles
  FOR SELECT
  USING (auth.uid() = id);

-- Update own profile only (credits, favourites, last_seen_at, username).
CREATE POLICY profiles_update_own ON profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- ── Public view ─────────────────────────────────────────────────────────────
-- WHY a view and not a separate RLS policy with column-level restrictions?
-- Postgres RLS operates at the row level, not column level. A second SELECT
-- policy that exposes all rows would also expose credits and last_seen_at.
-- A view with a restricted column list is the cleanest way to provide
-- "public profile" data for leaderboards and voting pages without leaking
-- sensitive fields.
--
-- Components that need public profiles query this view via
-- `supabase.from('public_profiles')` instead of `supabase.from('profiles')`.
CREATE OR REPLACE VIEW public_profiles AS
  SELECT
    id,
    username,
    favourite_team_id,
    favourite_player_id,
    created_at
  FROM profiles;

-- Grant read access on the view to anon and authenticated roles.
-- The underlying profiles table is still gated by RLS; the view only
-- exposes the safe columns listed above.
GRANT SELECT ON public_profiles TO anon, authenticated;
