-- ── 0085_security_advisor_hardening.sql ─────────────────────────────────────
-- Closes the Supabase security-advisor findings from the 2026-06-11 production
-- run (#572): 7 SECURITY DEFINER views (ERROR), 4 functions with a mutable
-- search_path (WARN), the admin_* RPC grant model (WARN), a trigger function
-- reachable as a direct RPC (WARN), and two RLS-enabled tables with no policy
-- at all (INFO).
--
-- THE SHAPE OF THIS MIGRATION
--   Most of the ERROR-level findings are resolved by DOCUMENTING them, not by
--   changing them. That needs justifying up front, because "the linter is
--   wrong" is usually a smell. Here it is load-bearing history:
--
--   Migration 0031 already tried the obvious fix. It flipped eight views to
--   `security_invoker = true` to clear this exact advisor ERROR, on the stated
--   assumption that "all eight views read only publicly-readable tables."
--   That assumption was false for six of them, and 0069 reverted it after the
--   leaderboards, the live-watcher count, the vote tally and the public profile
--   directory all silently collapsed to the caller's own rows (or, for anon, to
--   nothing). 0017 had already fixed that same bug once for wager_volume_v;
--   0031 re-broke it.
--
--   So this migration does NOT re-litigate 0069. It extends it: every one of
--   the seven flagged views gets an explicit, recorded verdict, a column-level
--   audit of what it actually exposes, and a COMMENT so the next person to read
--   an advisor report does not have to reconstruct this reasoning a third time.
--
-- WHY `security_invoker = false` IS THE CORRECT PRIMITIVE HERE
--   Three base tables are own-row-only on SELECT:
--     • profiles      — profiles_select_own     (0001, re-wrapped in 0058)
--     • wagers        — wagers_select_own       (0004, re-wrapped in 0058)
--     • focus_votes   — focus_votes_select_own  (0006, re-wrapped in 0058)
--   A cross-user aggregate over an own-row-only table is arithmetically
--   impossible to compute as the invoker. The two honest options are:
--     (a) a definer view that exposes ONLY the aggregate, or
--     (b) granting anon/authenticated direct SELECT on profiles / wagers /
--         focus_votes and letting them aggregate client-side.
--   (b) is strictly worse: it hands out every row to get at the total. (a) is
--   the narrower grant and is what the app does. The advisor cannot see that
--   distinction, so it reports a false positive.
--
--   This is not a blanket exemption. 0031 flipped `player_idol_movers` and
--   `match_referee_v` to invoker and 0069 deliberately LEFT them there, because
--   they read only public tables. The test applied below is per-view: does an
--   invoker read actually return the right answer, and if not, does the view
--   leak anything beyond the aggregate it exists to publish?
--
-- ACCEPTANCE-CRITERIA HONESTY
--   #572 asks for "zero ERROR-level lints". That target is not reachable
--   without breaking the application, for the reasons above. The achievable
--   and correct outcome is seven ERROR-level lints that are individually
--   understood, column-audited and annotated in the database itself. Stated
--   plainly here so a future reader does not treat the remaining count as
--   unfinished work.
--
-- IDEMPOTENT: ALTER VIEW … SET is a no-op when the property already holds,
-- COMMENT ON overwrites, DROP … IF EXISTS tolerates absence, ALTER FUNCTION …
-- SET is guarded by a pg_proc lookup, and the new policies are DROP-then-
-- CREATE. Safe to re-run against any environment.
--
-- UNAPPLIED AT TIME OF WRITING: the production project is restricted (HTTP 402,
-- disk quota) so this migration has not been applied and no follow-up advisor
-- run has confirmed it. See the PR body.


-- ═══════════════════════════════════════════════════════════════════════════
-- Part 1: the seven SECURITY DEFINER views (advisor ERROR)
-- ═══════════════════════════════════════════════════════════════════════════
-- Verdict for all seven: KEEP DEFINER. Each one is re-asserted rather than
-- assumed, because 0077 found the live definition of admin_reset_season had
-- drifted from the migration history, so "0069 already set this" is not proof
-- that production still holds it.
--
-- Each COMMENT records the verdict where `\d+` and the Supabase dashboard will
-- show it, not only in this file.


-- ── 1.1 wager_leaderboard (0004) ───────────────────────────────────────────
-- Reads: profiles (own-row SELECT) LEFT JOIN wagers (own-row SELECT).
-- Invoker test: FAILS. The leaderboard would contain exactly one row, the
--   caller's own, and nothing at all for anon. 0069 recorded this outcome.
-- Column audit — exposes: user_id, username, favourite_team_id, total_bets,
--   wins, losses, total_staked, total_won, net_profit.
--   Every numeric column is a per-user rollup (COUNT / SUM over that user's
--   wagers). The view carries NO match_id, NO team_choice, NO per-wager stake,
--   NO placement timestamp and NO odds, so an observer learns a player's
--   career totals but cannot see or reconstruct a single position they hold.
--   That is the aggregates-not-row-level-stakes line, and this view is on the
--   correct side of it. user_id and username are already public through
--   public_profiles, so they add no new exposure.
ALTER VIEW public.wager_leaderboard SET (security_invoker = false);

COMMENT ON VIEW public.wager_leaderboard IS
  'Public betting leaderboard. SECURITY DEFINER by design (advisor false positive): aggregates over wagers + profiles, both own-row-only on SELECT, so an invoker read returns only the caller. Exposes per-user career rollups only, never row-level positions (no match_id / team_choice / per-wager stake). Verdict recorded in migration 0085; see also 0069.';


-- ── 1.2 team_supporter_count_v (0055) ──────────────────────────────────────
-- Reads: profiles (own-row SELECT).
-- Invoker test: FAILS. anon gets zero rows; a signed-in user gets a single row
--   reading "1 supporter" for their own team. The supporter badge in the team
--   UI would be wrong for every user, every time.
-- Column audit — exposes: team_id, supporter_count. No user_id, no username,
--   no way to resolve a count back to the people in it. This view was always
--   owner-run (0055 predates 0031 and was never flipped), so unlike the other
--   six it is not a 0069 restoration, just a never-changed definer aggregate.
ALTER VIEW public.team_supporter_count_v SET (security_invoker = false);

COMMENT ON VIEW public.team_supporter_count_v IS
  'Per-team count of profiles with favourite_team_id set. SECURITY DEFINER by design (advisor false positive): profiles is own-row-only on SELECT, so an invoker read reports 1 supporter for the caller''s own team and nothing else. Exposes (team_id, supporter_count) only, no per-user leakage. Verdict recorded in migration 0085; see also 0055.';


-- ── 1.3 active_watchers_v (0018) ───────────────────────────────────────────
-- Reads: profiles (own-row SELECT), filtered on last_seen_at.
-- Invoker test: FAILS. Returns 0 for anon and 1 for a signed-in user, i.e. the
--   "N people watching" indicator degenerates into "you are here".
-- Column audit — exposes: watcher_count. One integer. There is no narrower
--   thing a view could return, and last_seen_at (a presence timestamp the
--   advisor would otherwise be right to care about) is consumed inside the
--   WHERE clause and never projected.
ALTER VIEW public.active_watchers_v SET (security_invoker = false);

COMMENT ON VIEW public.active_watchers_v IS
  'Count of profiles seen in the last 5 minutes. SECURITY DEFINER by design (advisor false positive): profiles is own-row-only on SELECT, so an invoker read returns 0 (anon) or 1 (yourself). Projects a single integer; last_seen_at is filtered on, never exposed. Verdict recorded in migration 0085; see also 0069.';


-- ── 1.4 focus_tally (0006) ─────────────────────────────────────────────────
-- Reads: focus_options (public SELECT) LEFT JOIN focus_votes (own-row SELECT).
-- Invoker test: FAILS. The join to focus_votes is the half that is restricted,
--   so vote_count and total_credits would count only the caller's own votes.
--   The season voting UI would show every option at or near zero.
-- Column audit — exposes: option_id, team_id, season_id, option_key, label,
--   description, tier (all from focus_options, which is already public SELECT
--   and carries no user data), plus vote_count and total_credits.
--   No user_id, and no per-voter credit attribution: total_credits is a SUM
--   across all voters for an option, so it cannot be read as "this person
--   spent N credits".
ALTER VIEW public.focus_tally SET (security_invoker = false);

COMMENT ON VIEW public.focus_tally IS
  'Per-option season vote tally. SECURITY DEFINER by design (advisor false positive): focus_votes is own-row-only on SELECT, so an invoker read tallies only the caller''s own votes. Exposes public focus_options columns plus aggregate vote_count / total_credits, with no user_id and no per-voter attribution. Verdict recorded in migration 0085; see also 0069.';


-- ── 1.5 wager_volume_v (0017) ──────────────────────────────────────────────
-- Reads: wagers (own-row SELECT).
-- Invoker test: FAILS, and this is the single most-regressed view in the repo:
--   0017 exists ONLY because the page queried wagers directly and anon saw an
--   always-silent market. 0031 reintroduced the bug by flipping to invoker and
--   0069 reverted it. Flipping it a third time would be the third occurrence
--   of one bug.
-- Column audit — exposes: match_id, team_choice, total_stake, bet_count.
--   These are market-level aggregates grouped by (match, side), not by user,
--   and no user_id is projected.
--   Stated honestly: when a (match, side) group has exactly one bettor,
--   total_stake equals that one person's stake. The view still carries nothing
--   that names them, so the amount is unattributable without already knowing
--   who bet, and wagers.user_id is unreachable through this view. That residual
--   is inherent to publishing market volume at all and is accepted, not missed.
ALTER VIEW public.wager_volume_v SET (security_invoker = false);

COMMENT ON VIEW public.wager_volume_v IS
  'Per-match, per-side betting volume. SECURITY DEFINER by design (advisor false positive): wagers is own-row-only on SELECT, so an invoker read shows anon an empty market and shows a signed-in user only their own bets (the exact bug 0017 fixed and 0031 re-broke). Exposes (match_id, team_choice, total_stake, bet_count) with no user_id. Verdict recorded in migration 0085; see also 0017 and 0069.';


-- ── 1.6 public_profiles (0001) ─────────────────────────────────────────────
-- Reads: profiles (own-row SELECT).
-- Invoker test: FAILS, and fails at the view's entire purpose: a public profile
--   directory that can only ever show you yourself is not a directory. anon
--   would see nothing, which breaks every username rendered next to a wager,
--   a vote or a leaderboard row.
-- Column audit — this is the view #572 singles out, so it was checked column by
--   column against the full profiles row type in src/types/database.ts rather
--   than against the 0001 definition alone:
--     EXPOSED  : id, username, favourite_team_id, favourite_player_id,
--                created_at
--     WITHHELD : credits, is_admin, last_seen_at, last_streak_day,
--                login_streak, longest_streak, notify_all_matches,
--                notify_favourite_team
--   Both notification columns (notify_all_matches, notify_favourite_team) are
--   withheld, so the "never leak notification fields" requirement holds.
--   On email specifically: public.profiles has NO email column in any form.
--   Email lives in auth.users, which this view does not reference, and the
--   view's own SELECT list is a fixed five columns rather than a SELECT *, so
--   a future ALTER TABLE profiles ADD COLUMN cannot widen it by accident. The
--   nearest email-adjacent identifiers (push_subscriptions endpoint/auth keys)
--   live in a different table entirely and are not reachable from here.
ALTER VIEW public.public_profiles SET (security_invoker = false);

COMMENT ON VIEW public.public_profiles IS
  'Curated public columns of profiles. SECURITY DEFINER by design (advisor false positive): profiles is own-row-only on SELECT, so an invoker read shows a user only themselves and shows anon nothing. Exposes exactly id, username, favourite_team_id, favourite_player_id, created_at. Deliberately withholds credits, is_admin, last_seen_at, streak columns and BOTH notify_* columns; profiles has no email column at all (email lives in auth.users, never referenced here). Column list is explicit, not SELECT *, so new profiles columns cannot widen it. Verdict recorded in migration 0085; see also 0001 and 0069.';


-- ── 1.7 player_idol_score (0020, redefined 0021) ───────────────────────────
-- Reads: profiles (own-row SELECT) for favourite-player counts,
--        player_training_log (public SELECT) for recent training clicks,
--        players + teams (public SELECT).
-- Invoker test: FAILS on the profiles half. favourite_count would be 1 for the
--   caller's own idol and 0 for every other player, so idol_score and both
--   rank columns would be meaningless, and the ranks feed the top-10 targeting
--   threshold in 0021 rather than only a display board.
-- Column audit — exposes: player_id, name, team_id, position, jersey_number,
--   team_name, team_color, favourite_count, training_count, idol_score,
--   global_rank, team_rank. Every identity column belongs to a player or team
--   (game entities, already public). favourite_count is a COUNT over profiles
--   with no user_id projected, so the board shows how many people picked a
--   player, never which people.
ALTER VIEW public.player_idol_score SET (security_invoker = false);

COMMENT ON VIEW public.player_idol_score IS
  'Per-player idol board and ranks. SECURITY DEFINER by design (advisor false positive): favourite_count aggregates profiles, which is own-row-only on SELECT, so an invoker read scores only the caller''s own pick and corrupts the ranks that gate 0021 targeting. Exposes player/team columns (already public) plus aggregate counts and ranks, with no user_id. Verdict recorded in migration 0085; see also 0020, 0021 and 0069.';


-- ═══════════════════════════════════════════════════════════════════════════
-- Part 2: orphaned roadmap trigger functions (advisor WARN)
-- ═══════════════════════════════════════════════════════════════════════════
-- #572 suspected these were orphaned because "no roadmap table exists". That
-- phrasing is slightly off and the near-miss is worth recording: the table was
-- never called `roadmap`, it was `roadmap_items` (0034). So the suspicion was
-- checked against the real name before acting:
--
--   • 0034 created roadmap_items and attached both functions as triggers.
--   • 0050 ran DROP TABLE IF EXISTS public.roadmap_items CASCADE. CASCADE drops
--     the dependent TRIGGERS but NOT the trigger functions, which is exactly
--     how a function ends up orphaned in pg_proc with nothing calling it.
--   • grep across supabase/migrations: the only file naming either function is
--     0034 itself.
--   • grep across src/: zero references.
--   • src/types/database.ts (generated from the live schema): zero occurrences
--     of "roadmap" anywhere, confirming the table is genuinely gone from
--     production and not merely dropped in a file.
--
-- Verdict: genuinely orphaned. Dropping is better than pinning search_path,
-- because pinning would leave two permanently dead functions that the next
-- audit has to re-investigate from scratch. Ties into the #548 dead-code sweep.
--
-- Safe because a SECURITY INVOKER trigger function with no trigger attached has
-- no caller and no grant anyone can exercise usefully.

DROP FUNCTION IF EXISTS public.set_roadmap_shipped_at();
DROP FUNCTION IF EXISTS public.set_roadmap_shipped_at_on_insert();


-- ═══════════════════════════════════════════════════════════════════════════
-- Part 3: pin search_path on the surviving mutable functions (advisor WARN)
-- ═══════════════════════════════════════════════════════════════════════════
-- A function without a pinned search_path resolves unqualified names against
-- the CALLER's search_path, so a caller who puts a schema of their own in front
-- of `public` can shadow a table or operator the function body depends on.
--
-- WHY `ALTER FUNCTION … SET` RATHER THAN `CREATE OR REPLACE`
--   Re-stating these bodies would mean copying sync_team_entity's definition
--   out of 0068 and hoping the live version matches. 0077 found exactly that
--   assumption to be false for admin_reset_season ("the live definition had
--   drifted from this migration history"). ALTER FUNCTION changes only the
--   search_path setting and cannot clobber a body that has drifted.
--
-- WHY `public` AND NOT `''`
--   sync_team_entity's body references `entities` unqualified, so an empty
--   search_path would break it at runtime. `public` is still a pinned,
--   non-mutable path and satisfies the advisor. It also matches the existing
--   house convention (0051, 0057 and the other hardened functions all use
--   `SET search_path = public`), so the schema stays internally consistent
--   rather than acquiring a second style.
--
-- Guarded by a pg_proc lookup so the migration does not fail on an environment
-- where one of these was never created.

DO $$
BEGIN
  -- set_updated_at (0034) is NOT orphaned despite arriving in the roadmap
  -- migration: claude_sessions (0035) still attaches it as an updated_at
  -- trigger, so it is pinned rather than dropped alongside its two neighbours.
  IF EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'set_updated_at'
       AND p.pronargs = 0
  ) THEN
    ALTER FUNCTION public.set_updated_at() SET search_path = public;
  END IF;

  -- sync_team_entity (0048, body updated by 0068) mirrors teams rows into the
  -- entities graph. Still live: the trigger on public.teams is intact.
  IF EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'sync_team_entity'
       AND p.pronargs = 0
  ) THEN
    ALTER FUNCTION public.sync_team_entity() SET search_path = public;
  END IF;
END
$$;

COMMENT ON FUNCTION public.set_updated_at() IS
  'Trigger helper: stamps NEW.updated_at = now() on every UPDATE. Used by claude_sessions (0035). search_path pinned to public in 0085.';


-- ═══════════════════════════════════════════════════════════════════════════
-- Part 4: enforce_username_policy — revoke direct EXECUTE (advisor WARN)
-- ═══════════════════════════════════════════════════════════════════════════
-- enforce_username_policy() (0057) is a BEFORE INSERT/UPDATE trigger function
-- on profiles. It is SECURITY DEFINER with search_path already pinned, so the
-- only finding against it is that anon and authenticated can call it directly
-- as an RPC over PostgREST.
--
-- Calling it directly is not currently exploitable (a trigger function invoked
-- outside a trigger context errors on the missing NEW record), but it has no
-- legitimate caller either, so the grant is pure surface area.
--
-- WHY THIS DOES NOT BREAK THE profiles TRIGGER
--   Postgres checks EXECUTE on a trigger function at CREATE TRIGGER time, not
--   on each fire. The profiles_username_policy trigger already exists, so
--   revoking EXECUTE from anon and authenticated leaves username validation
--   firing exactly as before on every INSERT and UPDATE OF username. The only
--   thing lost is the ability to POST to /rest/v1/rpc/enforce_username_policy.
--   (A future CREATE TRIGGER using this function must run as owner or
--   service-role, which every migration already does.)

REVOKE EXECUTE ON FUNCTION public.enforce_username_policy() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_username_policy() FROM anon;
REVOKE EXECUTE ON FUNCTION public.enforce_username_policy() FROM authenticated;

COMMENT ON FUNCTION public.enforce_username_policy() IS
  'BEFORE INSERT/UPDATE trigger on profiles. Rejects reserved + impersonation usernames. See migration 0057. Direct EXECUTE revoked from PUBLIC/anon/authenticated in 0085: trigger EXECUTE is checked at CREATE TRIGGER time, so the profiles trigger is unaffected.';


-- ═══════════════════════════════════════════════════════════════════════════
-- Part 5: the admin_* RPC grant model (advisor WARN) — DELIBERATELY UNCHANGED
-- ═══════════════════════════════════════════════════════════════════════════
-- FINDING: admin_add_player, admin_complete_match, admin_fast_forward_matches,
-- admin_inject_narrative, admin_reset_season and admin_set_season_status are
-- all EXECUTE-able by the `authenticated` role. The advisor is correct about
-- the fact and wrong about the remedy.
--
-- VERDICT: do NOT revoke EXECUTE from `authenticated`. Doing so would break
-- every admin action in the product. Reasoning, traced end to end:
--
--   1. CALL PATH. src/features/admin/api/admin.ts invokes all six through
--      supabase-js: db.rpc('admin_fast_forward_matches', …) (line 77),
--      db.rpc('admin_set_season_status', …) (475), db.rpc('admin_reset_season')
--      (495), db.rpc('admin_inject_narrative', …) (524), db.rpc(
--      'admin_add_player', …) (567) and db.rpc('admin_complete_match', …)
--      (696). There is no server-side proxy and no edge function in front of
--      them.
--
--   2. THE ROLE THAT ARRIVES. src/shared/supabase/client.ts builds a single
--      browser client with the anon publishable key. Once a user signs in,
--      PostgREST executes their requests as the Postgres role `authenticated`,
--      carried by the user JWT. "Admin" is a column on profiles (is_admin), not
--      a Postgres role, and Supabase mints no separate role for it. So an
--      admin's RPC call arrives as `authenticated` and nothing else. The
--      service-role key is never shipped to the browser and must not be.
--
--   3. CONSEQUENCE. REVOKE EXECUTE … FROM authenticated makes every one of
--      those six calls fail with HTTP 403 for ADMINS TOO. There is no role left
--      that the admin UI could use. The entire /admin surface stops working,
--      and the advisor warning would be "cleared" by deleting the feature.
--
--   4. THE GRANT IS ALREADY DELIBERATE, NOT ACCIDENTAL. 0051
--      (admin_rpc_anon_lockdown) is the migration that closed the real version
--      of this hole: before it, each RPC treated a NULL auth.uid() as a pass,
--      so an unauthenticated caller holding only the anon key could POST to
--      /rest/v1/rpc/admin_complete_match and flip any match to any score. 0051
--      replaced that branch with an explicit service_role JWT check and then,
--      for each of the six, ran REVOKE EXECUTE FROM PUBLIC, REVOKE EXECUTE
--      FROM anon, and GRANT EXECUTE TO authenticated. The surviving grant to
--      `authenticated` is the narrowest grant that keeps the admin UI working,
--      chosen on purpose, and re-revoking it here would silently undo 0051.
--
--   5. WHAT ACTUALLY GATES THEM. Two layers, both server-side and both inside
--      the SECURITY DEFINER body where the client cannot reach them: the caller
--      is either service_role (verified from request.jwt.claims, which only the
--      service-role key can produce) or a signed-in user whose profiles.is_admin
--      is true. Everyone else gets SQLSTATE 28000. AdminAccessGate.tsx and the
--      /admin route guard are UX only, as their own comments say.
--
--   6. RESIDUAL RISK, STATED PLAINLY. A non-admin signed-in user can still
--      reach the function and be rejected by it, rather than being rejected one
--      layer earlier by the grant. That costs an error round-trip and means the
--      is_admin check is a single point of failure: if a future edit to one of
--      these bodies drops the check, the grant will not catch it. The mitigation
--      is to keep the check in the body, not to break the client. If the
--      defense-in-depth is wanted for real, the correct design is a dedicated
--      Postgres role or an edge function holding the service-role key, which is
--      a product change and belongs in its own issue rather than in a
--      lint-clearing migration.
--
-- No DDL is emitted for these six functions. That is the finding, not an
-- omission. The COMMENTs below record the verdict against each function so the
-- next advisor run has the answer attached to the object itself.

COMMENT ON FUNCTION public.admin_reset_season() IS
  'Admin RPC: wipes transient season data and reschedules matches. See 0077. EXECUTE intentionally retained for `authenticated` (0051, re-affirmed 0085): the admin UI calls this via supabase-js as the signed-in admin, whose Postgres role is `authenticated`, so revoking would break the admin UI for admins. Access is gated inside the body by service_role JWT check OR profiles.is_admin.';

COMMENT ON FUNCTION public.admin_complete_match(UUID, INTEGER, INTEGER) IS
  'Admin RPC: completes a match and settles its wagers. See 0075. EXECUTE intentionally retained for `authenticated` (0051, re-affirmed 0085): the admin UI calls this via supabase-js as the signed-in admin, whose Postgres role is `authenticated`. Access is gated inside the body by service_role JWT check OR profiles.is_admin.';

COMMENT ON FUNCTION public.admin_set_season_status(UUID, TEXT) IS
  'Admin RPC: sets a season''s status. See 0042, 0051. EXECUTE intentionally retained for `authenticated` (re-affirmed 0085): the admin UI calls this via supabase-js as the signed-in admin, whose Postgres role is `authenticated`. Access is gated inside the body by service_role JWT check OR profiles.is_admin.';

COMMENT ON FUNCTION public.admin_fast_forward_matches(NUMERIC) IS
  'Admin RPC: shifts scheduled_at backwards for scheduled matches. See 0042, 0051. EXECUTE intentionally retained for `authenticated` (re-affirmed 0085): the admin UI calls this via supabase-js as the signed-in admin, whose Postgres role is `authenticated`. Access is gated inside the body by service_role JWT check OR profiles.is_admin.';

COMMENT ON FUNCTION public.admin_add_player(UUID, TEXT, TEXT, INTEGER, BOOLEAN, INTEGER) IS
  'Admin RPC: inserts a player. See 0042, 0051. EXECUTE intentionally retained for `authenticated` (re-affirmed 0085): the admin UI calls this via supabase-js as the signed-in admin, whose Postgres role is `authenticated`. Access is gated inside the body by service_role JWT check OR profiles.is_admin.';

COMMENT ON FUNCTION public.admin_inject_narrative(TEXT, TEXT) IS
  'Admin RPC: inserts a narrative row. See 0042, 0051. EXECUTE intentionally retained for `authenticated` (re-affirmed 0085): the admin UI calls this via supabase-js as the signed-in admin, whose Postgres role is `authenticated`. Access is gated inside the body by service_role JWT check OR profiles.is_admin.';

-- Belt-and-braces re-assert of the half of 0051 that IS safe to repeat: anon
-- and PUBLIC must never hold EXECUTE on these. Idempotent, and cheap insurance
-- against a manual GRANT or a restore that widened them again.
REVOKE EXECUTE ON FUNCTION public.admin_reset_season()                      FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_complete_match(UUID, INTEGER, INTEGER) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_season_status(UUID, TEXT)       FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_fast_forward_matches(NUMERIC)       FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_add_player(UUID, TEXT, TEXT, INTEGER, BOOLEAN, INTEGER) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_inject_narrative(TEXT, TEXT)        FROM PUBLIC, anon;


-- ═══════════════════════════════════════════════════════════════════════════
-- Part 6: RLS-enabled tables with no policies (advisor INFO)
-- ═══════════════════════════════════════════════════════════════════════════
-- app_config (0044) and match_notification_sends (0039) both run
-- ENABLE ROW LEVEL SECURITY with zero policies. That is already secure: RLS
-- denies by default, and the only writers (the cron job as postgres, the
-- match-notify worker as service-role) bypass RLS entirely. The advisor cannot
-- tell deliberate default-deny apart from someone enabling RLS and forgetting
-- the policies, which is a fair thing for it to flag.
--
-- Fixed the way 0073 fixed the same ambiguity on the entity tables: add an
-- explicit service-role policy that is functionally redundant but makes the
-- intended access model greppable in pg_policies, instead of leaving the
-- intent recorded only in a migration comment nobody greps.
--
-- These policies GRANT NOTHING NEW. service_role already bypasses RLS, and no
-- other role satisfies the predicate, so anon and authenticated remain fully
-- denied on both tables exactly as before.

-- ── app_config ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS app_config_service_only ON public.app_config;

CREATE POLICY app_config_service_only ON public.app_config
  FOR ALL
  USING      ((SELECT auth.role()) = 'service_role'::text)
  WITH CHECK ((SELECT auth.role()) = 'service_role'::text);

COMMENT ON POLICY app_config_service_only ON public.app_config IS
  'Service-role-only access, declared explicitly so the intent is visible in pg_policies rather than implied by an empty policy list. Functionally redundant (service_role bypasses RLS) and grants nothing to anon/authenticated. Added by 0085 to resolve the rls_enabled_no_policy advisor INFO; mirrors the 0073 pattern.';

-- ── match_notification_sends ───────────────────────────────────────────────
DROP POLICY IF EXISTS match_notification_sends_service_only ON public.match_notification_sends;

CREATE POLICY match_notification_sends_service_only ON public.match_notification_sends
  FOR ALL
  USING      ((SELECT auth.role()) = 'service_role'::text)
  WITH CHECK ((SELECT auth.role()) = 'service_role'::text);

COMMENT ON POLICY match_notification_sends_service_only ON public.match_notification_sends IS
  'Service-role-only access for the match-notify worker''s idempotency ledger. Declared explicitly so the intent is visible in pg_policies. Users learn about their own pushes from the OS notification, never by querying this table. Functionally redundant (service_role bypasses RLS) and grants nothing to anon/authenticated. Added by 0085 to resolve the rls_enabled_no_policy advisor INFO; mirrors the 0073 pattern.';

COMMENT ON TABLE public.match_notification_sends IS
  'Idempotency ledger for match-start push notifications (0039). Service-role only: RLS enabled with a single explicit service_role policy (0085).';


-- ═══════════════════════════════════════════════════════════════════════════
-- Verification (run after apply, once the project is unrestricted)
-- ═══════════════════════════════════════════════════════════════════════════
--   -- 1. All seven views still owner-run (expect security_invoker absent/false):
--   SELECT c.relname, c.reloptions
--     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname = 'public' AND c.relkind = 'v'
--      AND c.relname IN ('wager_leaderboard','team_supporter_count_v',
--                        'active_watchers_v','focus_tally','wager_volume_v',
--                        'public_profiles','player_idol_score');
--
--   -- 2. public_profiles exposes exactly 5 columns and no notify_*/credits:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='public_profiles'
--    ORDER BY ordinal_position;
--
--   -- 3. Roadmap functions gone (expect 0 rows):
--   SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--    WHERE n.nspname='public' AND proname LIKE 'set_roadmap_shipped_at%';
--
--   -- 4. search_path pinned (expect proconfig containing search_path=public):
--   SELECT proname, proconfig FROM pg_proc p
--     JOIN pg_namespace n ON n.oid=p.pronamespace
--    WHERE n.nspname='public' AND proname IN ('set_updated_at','sync_team_entity');
--
--   -- 5. admin_* still EXECUTE-able by authenticated, never by anon:
--   SELECT p.proname,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_ok,
--          has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon_bad
--     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--    WHERE n.nspname='public' AND p.proname LIKE 'admin\_%';
--   -- Expect auth_ok = true and anon_bad = false for all six.
--
--   -- 6. enforce_username_policy no longer callable by anon/authenticated,
--   --    and the profiles trigger still fires:
--   SELECT has_function_privilege('anon','public.enforce_username_policy()','EXECUTE');
--   SELECT tgname FROM pg_trigger WHERE tgrelid='public.profiles'::regclass
--      AND NOT tgisinternal;
--
--   -- 7. Both INFO tables now report a policy:
--   SELECT tablename, policyname FROM pg_policies
--    WHERE schemaname='public'
--      AND tablename IN ('app_config','match_notification_sends');
--
--   -- 8. Re-run get_advisors(security). Expect: the 7 view ERRORs remain and
--   --    are now explained by COMMENTs; the search_path, roadmap,
--   --    enforce_username_policy and rls_enabled_no_policy WARN/INFO entries
--   --    are gone; the admin_* entries remain and are documented as accepted.
