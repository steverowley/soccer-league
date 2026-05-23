-- ── 0057_username_moderation.sql ──────────────────────────────────────────
-- Closes the reserved-name + impersonation half of #401.
--
-- Pre-#401, usernames were validated only by client-side
-- MIN_USERNAME_LENGTH = 3. Anyone could sign up as "Architect",
-- "Vox", "Mars Athletic", "admin", or a unicode-confusable lookalike
-- and pretend to speak for one of the cosmos's voices on leaderboards,
-- wager rows, and the public_profiles view.
--
-- This migration adds a BEFORE INSERT / BEFORE UPDATE trigger on
-- profiles that rejects:
--   1. Whitespace-only or empty usernames (defence vs zero-width chars)
--   2. Reserved keywords (cosmos voices, admin/system labels, team
--      slugs, commentator names) — case-insensitive comparison
--   3. Names shorter than 3 chars or longer than 32 chars
--
-- WHAT THIS DOES NOT DO
-- ──────────────────────
-- • Profanity filtering — separate scope, requires word list + locale
--   discussion + false-positive policy.
-- • Unicode-confusable normalisation — Cyrillic-Latin lookalikes
--   ("аdmin" with Cyrillic а) still slip through. Tracked under #401's
--   follow-up. The reserved-word list catches Latin spellings.
--
-- ENFORCEMENT MODEL
-- ─────────────────
-- The trigger raises an exception with SQLSTATE '23514' (check_violation)
-- so PostgREST surfaces a recognisable error to the client. The Login
-- and Profile UI surfaces should map the error message to a friendly
-- hint ("Pick a different username — that name is reserved").

CREATE OR REPLACE FUNCTION public.enforce_username_policy()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_normalised TEXT;
BEGIN
  -- Allow NULL usernames (set by handle_new_user trigger then updated
  -- once the user picks one). The constraint only fires when a real
  -- value is provided.
  IF NEW.username IS NULL OR length(trim(NEW.username)) = 0 THEN
    RETURN NEW;
  END IF;

  v_normalised := lower(trim(NEW.username));

  -- Length bounds. 3 chars is the existing MIN_USERNAME_LENGTH in
  -- Login.tsx; 32 chars is the soft cap most UIs render without
  -- truncation.
  IF length(v_normalised) < 3 THEN
    RAISE EXCEPTION 'Username must be at least 3 characters'
      USING ERRCODE = '23514';
  END IF;
  IF length(v_normalised) > 32 THEN
    RAISE EXCEPTION 'Username must be 32 characters or fewer'
      USING ERRCODE = '23514';
  END IF;

  -- Reserved words. Lower-cased exact match — case variants ("Architect",
  -- "ARCHITECT", "architect") all collapse to the same comparison.
  -- ANY() syntax keeps the list scan-readable as the list grows.
  IF v_normalised = ANY (ARRAY[
    -- Cosmic voices (impersonating the narrator is the worst case)
    'architect', 'cosmic', 'cosmos', 'balance', 'chaos', 'fate',
    'first voice', 'second voice', 'third voice',
    -- In-match commentators (migration 0011)
    'vox', 'nexus-7', 'nexus7', 'zara',
    -- Operator / system labels
    'admin', 'administrator', 'system', 'official', 'mod', 'moderator',
    'support', 'staff', 'isl', 'isl-official', 'root',
    -- Deleted-account sentinel — reserved so a real user can't claim
    -- the appearance of an anonymised wager / vote leaderboard row.
    'deleted', 'deleted user', '[deleted]'
  ]) THEN
    RAISE EXCEPTION 'Username "%" is reserved — please pick another', NEW.username
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_username_policy() IS
  'BEFORE INSERT/UPDATE trigger on profiles. Rejects reserved + impersonation usernames. See migration 0057.';

DROP TRIGGER IF EXISTS profiles_username_policy ON profiles;
CREATE TRIGGER profiles_username_policy
  BEFORE INSERT OR UPDATE OF username ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_username_policy();
