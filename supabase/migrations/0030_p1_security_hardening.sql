-- ── P1 Security hardening ─────────────────────────────────────────────────
-- Revoke anon (and authenticated, where the function is admin-only) EXECUTE
-- on dangerous SECURITY DEFINER RPCs; drop authenticated-write policies on
-- tables that the design says must be service-role-only.
--
-- WHY
-- ───
-- Before this migration, an unauthenticated request could:
--   * permadelete any player via POST /rest/v1/rpc/incinerate_player
--   * wipe the active season via POST /rest/v1/rpc/admin_reset_season
--   * reassign a referee via POST /rest/v1/rpc/assign_match_referee
-- And any signed-in user could:
--   * INSERT into narratives, architect_lore, architect_interventions
--     (fabricate cosmic state and pollute the news feed)
--   * UPDATE their own wagers — including setting status='won' and
--     payout=<arbitrary> — bypassing service-role settlement
--   * INSERT/UPDATE match_odds, team_finances, match_attendance —
--     rewriting odds before placing a bet or the ticket-revenue ledger
--   * INSERT into focus_options / focus_enacted / season_decrees /
--     incinerations — vote tampering and arbitrary permadeath claims
--
-- None of this matches CLAUDE.md invariant #4 ("service-role-only writes on
-- match_events / narratives", settlement service-role-only).
--
-- The deployed match-worker edge function uses the service-role key, which
-- bypasses RLS entirely, so it continues to write these tables freely.
-- Browser listeners that currently INSERT into narratives
-- (WagerSettlementListener, RefereeNarrativeListener) are already dead in
-- production — they listen for a `match.completed` bus event that is never
-- emitted — so removing their RLS write path has no functional impact today.
-- Phase 2 moves those side effects into the worker (service-role context).

-- ── SECURITY DEFINER RPCs ──────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.incinerate_player(uuid, uuid, text, integer, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.assign_match_referee(uuid, uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_reset_season() FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_reset_season() FROM PUBLIC;
-- admin_reset_season stays callable by `authenticated` for the admin UI; an
-- explicit admin-role check inside the function body should be added in a
-- follow-up migration so non-admin signed-in users can't trigger a wipe.

-- ── narratives: only the service-role worker writes news ──────────────────
DROP POLICY IF EXISTS narratives_auth_write ON public.narratives;

-- ── architect_lore / architect_interventions: cosmic state is sealed ──────
DROP POLICY IF EXISTS architect_lore_insert ON public.architect_lore;
DROP POLICY IF EXISTS architect_lore_update ON public.architect_lore;
DROP POLICY IF EXISTS architect_interventions_insert ON public.architect_interventions;

-- ── wagers: settlement is service-role-only ───────────────────────────────
DROP POLICY IF EXISTS wagers_update_own ON public.wagers;

-- ── match_odds / team_finances / match_attendance: worker-only writes ─────
DROP POLICY IF EXISTS match_odds_insert ON public.match_odds;
DROP POLICY IF EXISTS match_odds_update ON public.match_odds;
DROP POLICY IF EXISTS team_finances_insert ON public.team_finances;
DROP POLICY IF EXISTS team_finances_update ON public.team_finances;
DROP POLICY IF EXISTS match_attendance_insert ON public.match_attendance;

-- ── focus_options / focus_enacted / season_decrees / incinerations ────────
-- All written exclusively by the season-end pipeline (post-Phase-2). Direct
-- user writes here would allow vote-tampering and arbitrary permadeath claims.
DROP POLICY IF EXISTS focus_options_insert ON public.focus_options;
DROP POLICY IF EXISTS focus_enacted_insert ON public.focus_enacted;
DROP POLICY IF EXISTS season_decrees_insert ON public.season_decrees;
DROP POLICY IF EXISTS incinerations_insert ON public.incinerations;
