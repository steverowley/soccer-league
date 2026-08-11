-- ── 0083_fix_profiles_update_recursion.sql ────────────────────────────────────
-- WHY: `profiles_update_own` (migration 0041, re-created unchanged in 0058) put
-- the privilege guard in a `WITH CHECK` that SUBQUERIES `public.profiles`:
--
--   AND is_admin IS NOT DISTINCT FROM (SELECT p.is_admin FROM profiles p …)
--   AND credits   <=                  (SELECT p.credits   FROM profiles p …)
--
-- Evaluating those subqueries re-enters RLS on `profiles`, which re-evaluates
-- the policy that contains them.  Postgres refuses:
--
--   42P17: infinite recursion detected in policy for relation "profiles"
--
-- So the policy did not merely fail to guard — it made EVERY authenticated
-- UPDATE on `profiles` fail.  Reproduced against production on 2026-08-11, and
-- re-derivable at any time: in a transaction you roll back, restore the policy
-- body above, then as role `authenticated` (with `request.jwt.claims` set to a
-- real profile id) run `UPDATE profiles SET last_seen_at = now()`.  It raises
-- 42P17 with the pre-0083 policy and succeeds with the one below.
--
-- USER-VISIBLE DAMAGE (all of it silent — every caller only warn-logs):
--   * `touchLastSeen` — the presence heartbeat, on mount and every 90 s.  With
--     it dead, `active_watchers_v` never sees a signed-in fan, so match
--     attendance, ticket revenue and the fan-support stat boost all read zero.
--   * `updateProfile` — username / favourite team / favourite player edits.
--   * `updateNotificationPreferences` — the two /profile notification toggles.
--
-- FIX
-- ───
-- Move the guard OFF the policy and into a BEFORE UPDATE trigger.  A trigger
-- sees OLD and NEW as locals, so it needs no subquery, touches no policy, and
-- cannot recurse.  The policy goes back to the plain owner-row predicate.
--
-- WHY NOT COLUMN GRANTS: 0041 rejected them for a real reason worth keeping in
-- the record — a partial column-level UPDATE grant makes PostgREST reject
-- `.update({a, b})` whenever the caller lacks write on `b`, even if `b` is
-- unchanged.  The trigger keeps the 0041 property that a payload passes
-- whenever it did not actually try to escalate.
--
-- WHICH CALLERS ARE GUARDED: the trigger is a no-op for `service_role`,
-- `postgres` and `supabase_admin`.  That is what keeps the legitimate credit
-- movers working — `place_wager`, `settle_wager`, `cast_focus_vote`,
-- `bump_login_streak`, `incinerate_player` and the `admin_*` RPCs are all
-- SECURITY DEFINER owned by `postgres`, so inside them `current_user` is
-- `postgres`, not the caller.  Every other role — `authenticated`, `anon`,
-- anything added later — is guarded by default.
--
-- CREDITS ARE NOW IMMUTABLE FROM THE CLIENT, not merely non-increasing.  0041
-- had to allow a decrease because bet placement and focus voting debited the
-- column straight from the browser; both have since moved to SECURITY DEFINER
-- RPCs (`place_wager`, `cast_focus_vote`), and no `from('profiles').update()`
-- in `src/` sends `credits` any more.  This is the tightening 0041's own
-- FOLLOW-UP note asked for.

-- ── The guard ─────────────────────────────────────────────────────────────────
-- SECURITY INVOKER (the default, stated explicitly because the function depends
-- on it): the whole point is to read `current_user` as the role that issued the
-- UPDATE.  A SECURITY DEFINER copy would always see the owner and never guard
-- anyone.

CREATE OR REPLACE FUNCTION public.profiles_guard_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
  IF current_user IN ('service_role', 'postgres', 'supabase_admin') THEN
    RETURN new;
  END IF;

  IF new.is_admin IS DISTINCT FROM old.is_admin THEN
    RAISE EXCEPTION 'profiles.is_admin cannot be changed by its owner'
      USING errcode = '42501';
  END IF;

  IF new.credits IS DISTINCT FROM old.credits THEN
    RAISE EXCEPTION 'profiles.credits cannot be changed by its owner'
      USING errcode = '42501';
  END IF;

  RETURN new;
END;
$$;

COMMENT ON FUNCTION public.profiles_guard_privileged_columns() IS
  'BEFORE UPDATE guard on profiles: is_admin and credits are immutable for every role except service_role/postgres/supabase_admin. Replaces the self-referencing WITH CHECK from migration 0041, which recursed (42P17). See migration 0083.';

DROP TRIGGER IF EXISTS profiles_guard_privileged_columns_trg ON public.profiles;

CREATE TRIGGER profiles_guard_privileged_columns_trg
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_guard_privileged_columns();

-- ── The policy, minus the recursion ───────────────────────────────────────────
-- `(SELECT auth.uid())` rather than a bare `auth.uid()` keeps the initplan
-- optimisation migration 0058 applied to every policy in this schema.

DROP POLICY IF EXISTS profiles_update_own ON public.profiles;

CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE
  USING ((SELECT auth.uid()) = id)
  WITH CHECK ((SELECT auth.uid()) = id);

COMMENT ON POLICY profiles_update_own ON public.profiles IS
  'Owner-row UPDATE. The is_admin / credits escalation guard lives in the profiles_guard_privileged_columns trigger — expressing it here required subquerying profiles, which recursed. See migrations 0041 (threat model) and 0083 (recursion fix).';
