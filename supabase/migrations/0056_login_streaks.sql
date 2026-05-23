-- ── 0056_login_streaks.sql ───────────────────────────────────────────────
-- Closes #380 (login streaks + badges).
--
-- Pre-#380 the account never visibly grew over time. Profile rendered
-- credits + Member Since and stopped. No habit-forming D1/D7 hook,
-- nothing for a fan to chase between matches.
--
-- This migration adds two integer columns + a tracking date to
-- profiles, and a SECURITY DEFINER RPC that AuthProvider calls once
-- per session to bump the streak atomically.
--
-- COLUMNS
-- ───────
--   login_streak       — current consecutive UTC-day count. Reset to
--                        1 when the user signs in after missing a day.
--   longest_streak     — best ever, never decreases. Drives the badge
--                        unlock display: a user who hit 30 once keeps
--                        the 30-day badge even after a break.
--   last_streak_day    — UTC date of the last increment. Used by the
--                        RPC to decide bump-vs-reset-vs-noop.
--
-- RPC bump_login_streak()
-- ────────────────────────
-- Called by AuthProvider on the first heartbeat per session. Reads the
-- caller's profile row FOR UPDATE, then:
--   - if last_streak_day = today (UTC)         → no-op
--   - if last_streak_day = yesterday (UTC)     → login_streak += 1,
--                                                 update longest if needed
--   - if last_streak_day = NULL or older       → login_streak := 1
-- Always stamps last_streak_day = today.
--
-- Returns the new login_streak so AuthProvider can refresh the cached
-- profile without a separate SELECT.
--
-- ANON CALLS: rejected. Service-role bypass present for the SeasonClose
-- worker which may want to backfill (though doesn't today).
--
-- MILESTONE BADGES: pure derivation from longest_streak. No badge table
-- needed — UI computes [3, 7, 30, 100, 365] thresholds against the
-- column. Schema stays clean; new milestones added without a migration.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS login_streak    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS longest_streak  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_streak_day DATE    NULL;

COMMENT ON COLUMN profiles.login_streak IS
  'Consecutive UTC-day login count. Bumped by bump_login_streak() RPC; resets to 1 on missed day. See migration 0056.';
COMMENT ON COLUMN profiles.longest_streak IS
  'Best-ever value of login_streak. Drives badge unlock display. Never decreases.';
COMMENT ON COLUMN profiles.last_streak_day IS
  'UTC date of the most recent streak increment. NULL for users who have never logged in since this migration.';

CREATE OR REPLACE FUNCTION public.bump_login_streak()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller        UUID;
  v_role          TEXT;
  v_today         DATE;
  v_last_day      DATE;
  v_streak        INTEGER;
  v_longest       INTEGER;
  v_new_streak    INTEGER;
BEGIN
  -- Auth: anon-lockdown variant per migration 0051. Service-role
  -- callers (NULL uid + role='service_role') pass through for future
  -- backfill scripts; everyone else needs a valid auth.uid().
  v_caller := auth.uid();
  v_role   := (current_setting('request.jwt.claims', true)::jsonb ->> 'role');
  IF v_caller IS NULL THEN
    IF v_role IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION 'bump_login_streak requires authentication' USING ERRCODE = '28000';
    END IF;
    -- Service-role with no specific user: nothing to do.
    RETURN 0;
  END IF;

  v_today := (now() AT TIME ZONE 'UTC')::date;

  -- Lock the profile row for the duration of the transaction. Two
  -- concurrent heartbeats (e.g. two browser tabs) won't double-bump.
  SELECT login_streak, longest_streak, last_streak_day
    INTO v_streak, v_longest, v_last_day
    FROM profiles
   WHERE id = v_caller
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'bump_login_streak: no profile row for caller' USING ERRCODE = 'P0002';
  END IF;

  -- Decide bump vs reset vs no-op.
  IF v_last_day = v_today THEN
    -- Already counted today. Return current streak unchanged.
    RETURN v_streak;
  ELSIF v_last_day = v_today - 1 THEN
    v_new_streak := v_streak + 1;
  ELSE
    -- NULL (first call) OR older than yesterday: reset to 1.
    v_new_streak := 1;
  END IF;

  UPDATE profiles
     SET login_streak    = v_new_streak,
         longest_streak  = GREATEST(v_longest, v_new_streak),
         last_streak_day = v_today
   WHERE id = v_caller;

  RETURN v_new_streak;
END;
$$;

COMMENT ON FUNCTION public.bump_login_streak() IS
  'Atomic per-user login streak bump. Lock-then-update. See migration 0056.';

REVOKE EXECUTE ON FUNCTION public.bump_login_streak() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.bump_login_streak() FROM anon;
GRANT  EXECUTE ON FUNCTION public.bump_login_streak() TO authenticated;
