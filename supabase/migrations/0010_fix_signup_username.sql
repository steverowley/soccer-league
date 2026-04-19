-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: 0010_fix_signup_username
-- ───────────────────────────────────────────────────────────────────────────
-- WHY: The original `handle_new_user` trigger always generated a placeholder
-- username ('user_<short-uuid>'). The SignupForm then tried to UPDATE the
-- username in a second round-trip — but when Supabase email confirmation is
-- enabled there is no active session at signup time, so the RLS policy
-- (`profiles_update_own`) blocks the UPDATE and the user is stuck with the
-- placeholder forever.
--
-- FIX: Read `raw_user_meta_data->>'username'` from the new auth user row.
-- Supabase stores the `options.data` object passed to `auth.signUp()` in
-- this JSONB column. The SignupForm now passes `{ username }` there, so the
-- trigger can set the real username atomically — no second round-trip, no
-- RLS race, no email-confirmation bug.
--
-- FALLBACK: If the metadata has no username (e.g. OAuth signup in a future
-- phase, or a direct API call without metadata), we generate the same
-- 'user_<8-char-uuid>' placeholder as before so existing behaviour is
-- preserved.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_username TEXT;
BEGIN
  -- Prefer the username from signup metadata; fall back to a generated placeholder.
  v_username := COALESCE(
    NULLIF(TRIM(NEW.raw_user_meta_data->>'username'), ''),
    'user_' || LEFT(REPLACE(NEW.id::text, '-', ''), 8)
  );

  INSERT INTO public.profiles (id, username)
  VALUES (NEW.id, v_username);

  RETURN NEW;
END;
$$;
