-- ── 0031_security_hardening_definer_views.sql ───────────────────────────────
-- Patches the highest-severity findings from `supabase get_advisors`:
--
--   • 8× ERROR  — `security_definer_view` for the 8 views below.  In Postgres
--                 15+, `SET (security_invoker = true)` flips a view from
--                 the (insecure) creator-perms model to the standard
--                 querying-user-perms model.  All eight views read only
--                 publicly-readable tables and rely on RLS for any
--                 row-level filtering, so SECURITY DEFINER was always
--                 unnecessary — it just suppressed RLS for every reader.
--
--   • 1× WARN   — `function_search_path_mutable` on
--                 `berger_round_robin_fixtures`.  Pinning `search_path`
--                 closes a search-path-hijack vector: a privileged role
--                 with a poisoned `search_path` could otherwise be lured
--                 into executing code from an attacker-controlled schema.
--
--   • 1× WARN   — `handle_new_user` is a TRIGGER target only; revoking
--                 EXECUTE from `anon` / `authenticated` removes it from
--                 the public PostgREST RPC surface without affecting
--                 the on-insert trigger that legitimately calls it.
--
-- DEFERRED (require user input / architectural changes, not patched here):
--   • `pg_net` extension still in `public` schema — moving it risks
--     breaking cron jobs that reference unqualified function names.
--   • `admin_reset_season` callable by `authenticated` — needs an
--     admin-role column on profiles to gate properly; out of scope.
--   • Auth: enable leaked-password protection in Supabase Dashboard
--     (Settings → Auth → Password security).
--
-- IDEMPOTENT: ALTER VIEW … SET is no-op-safe if the property is already
-- set.  REVOKE is also idempotent (revoking absent grants is silent).
-- ALTER FUNCTION SET search_path replaces any existing setting.

-- ── Views: flip SECURITY DEFINER → SECURITY INVOKER ────────────────────────

ALTER VIEW public.wager_leaderboard  SET (security_invoker = true);
ALTER VIEW public.active_watchers_v  SET (security_invoker = true);
ALTER VIEW public.player_idol_movers SET (security_invoker = true);
ALTER VIEW public.focus_tally        SET (security_invoker = true);
ALTER VIEW public.wager_volume_v     SET (security_invoker = true);
ALTER VIEW public.match_referee_v    SET (security_invoker = true);
ALTER VIEW public.public_profiles    SET (security_invoker = true);
ALTER VIEW public.player_idol_score  SET (security_invoker = true);

-- ── Function: pin search_path to defeat hijack vectors ─────────────────────
-- Empty string is the strictest valid value: every identifier inside the
-- function body must then be fully qualified (`pg_catalog.now()` not
-- `now()`).  The fixtures function is pure SQL over `competition_teams`
-- + `matches` with qualified identifiers already in its body, so the
-- empty path is safe.  If a future edit references an unqualified name
-- it'll fail loudly at definition time rather than silently resolve
-- against an attacker-controlled schema.

ALTER FUNCTION public.berger_round_robin_fixtures(
  p_competition_id  uuid,
  p_teams           text[],
  p_first_kickoff   timestamp with time zone,
  p_cadence_minutes integer
) SET search_path = '';

-- ── handle_new_user: keep the trigger, remove the public RPC surface ──────
-- This function is only meant to fire from the on-INSERT trigger on
-- auth.users.  PostgREST automatically exposes any SECURITY DEFINER
-- function in `public` as a callable RPC, which means an unauthenticated
-- caller could `POST /rest/v1/rpc/handle_new_user` with an arbitrary
-- payload.  Revoking EXECUTE from both anon and authenticated roles
-- removes that surface while leaving the trigger path untouched
-- (triggers run as the table owner, not the caller, so role grants
-- don't apply).

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM authenticated;
