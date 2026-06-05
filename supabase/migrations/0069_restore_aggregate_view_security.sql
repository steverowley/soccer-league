-- ── 0069_restore_aggregate_view_security.sql ─────────────────────────────────
-- Reverses the part of migration 0031 that silently broke six aggregate / public
-- views.
--
-- 0031 ran `ALTER VIEW … SET (security_invoker = true)` on eight views to clear
-- the `security_definer_view` advisor ERROR, on the stated assumption that "all
-- eight views read only publicly-readable tables." That assumption is FALSE for
-- six of them: they read tables whose RLS restricts SELECT to the current user
-- (profiles, wagers, focus_votes are all own-row-only), so running as the
-- querying user (security_invoker = true) collapses every cross-user aggregate
-- to the caller's own rows — or, for anon, to nothing.
--
-- Concretely, after 0031:
--   • wager_volume_v    — anon: 0 rows; signed-in: only own bets.  This re-breaks
--                         the EXACT bug 0017 was written to fix.
--   • active_watchers_v — live-watcher count shows 0 (anon) or 1 (yourself).
--   • focus_tally       — season vote tally counts only your own votes.
--   • wager_leaderboard — the leaderboard shows only your own row.
--   • public_profiles   — other users' public profiles return 0 rows (profiles
--                         SELECT is own-row only); anon sees nothing at all.
--   • player_idol_score — favourite-player tallies count only your own pick.
--
-- These six must run as the view OWNER (security_invoker = false) to aggregate
-- across users / expose the curated public columns — the original, intentional
-- design (see 0001, 0004, 0006, 0017, 0018; same owner-run pattern as
-- team_supporter_count_v in 0055). Each exposes ONLY safe data: aggregate
-- counts/sums with no user_id (volume, watchers, tally), an intentionally-public
-- leaderboard / idol board, or the explicitly-curated safe columns of
-- public_profiles (never credits / email). There is no path back to per-user PII.
--
-- This deliberately re-introduces the `security_definer_view` advisor finding for
-- these six views. That finding is a false positive here: a definer aggregate
-- view is the correct, RLS-respecting way to expose cross-user totals without
-- granting anon/authenticated direct read on the sensitive base tables.
--
-- The other two views 0031 touched are LEFT as security_invoker = true — they
-- read only public tables, so invoker is both correct and advisor-clean:
--   • player_idol_movers — reads player_training_log (public SELECT) + players.
--   • match_referee_v    — reads matches + entities (public).
--
-- IDEMPOTENT: ALTER VIEW … SET is no-op-safe if the property is already set, so
-- this is harmless whether or not 0031 was applied to a given environment.

ALTER VIEW public.wager_volume_v     SET (security_invoker = false);
ALTER VIEW public.active_watchers_v  SET (security_invoker = false);
ALTER VIEW public.focus_tally        SET (security_invoker = false);
ALTER VIEW public.wager_leaderboard  SET (security_invoker = false);
ALTER VIEW public.public_profiles    SET (security_invoker = false);
ALTER VIEW public.player_idol_score  SET (security_invoker = false);
