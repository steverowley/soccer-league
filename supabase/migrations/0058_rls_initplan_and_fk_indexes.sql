-- ── 0058_rls_initplan_and_fk_indexes.sql ─────────────────────────────────
-- Closes #392. Two performance fixes flagged by the Supabase advisor.
--
-- PART 1 — RLS init-plan wrapping
-- ──────────────────────────────────
-- The advisor warns that RLS policies which call `auth.uid()` or
-- `auth.role()` directly are re-evaluated PER ROW during a scan. Wrapping
-- the call in a scalar subquery `(SELECT auth.uid())` lets Postgres
-- cache the result for the whole statement (init-plan), which means a
-- 1000-row scan calls the auth helper once instead of a thousand times.
--
-- All policies below preserve their EXACT semantics — we only swap the
-- raw `auth.X()` for the cached `(SELECT auth.X())` form. The check
-- shape (USING / WITH CHECK / cmd / role) is unchanged.
--
-- PART 2 — Foreign-key indexes
-- ──────────────────────────────
-- 24 FK columns had no covering index. Without one, every UPDATE/DELETE
-- on the parent row forces a sequential scan of the child table to find
-- referencing rows. The advisor lifts the exact (table, FK constraint,
-- column) list from `pg_constraint`; we add `CREATE INDEX IF NOT EXISTS`
-- statements for each so future schema rebuilds stay green and the
-- existing indexes don't get re-created on a re-apply.
--
-- INDEX NAMING CONVENTION
-- Matches the existing repo convention: `idx_<table>_<column>`. Where a
-- column name is long or the FK is one of many on the table we keep the
-- index name aligned with the FK constraint stem so future grep finds
-- both together.
--
-- ────────────────────────────────────────────────────────────────────────

-- ════════════════════════════════════════════════════════════════════════
-- PART 1: Wrap auth.uid() / auth.role() with init-plan subqueries
-- ════════════════════════════════════════════════════════════════════════
-- We use DROP + CREATE rather than ALTER POLICY ... USING (...) because
-- ALTER POLICY only accepts USING/WITH CHECK changes individually; doing
-- it in a single DROP/CREATE pair per policy is more readable and lets
-- us audit each rewrite side-by-side with the original below in source.

-- ── agent_runs ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS agent_runs_service_read  ON public.agent_runs;
CREATE POLICY agent_runs_service_read  ON public.agent_runs
  FOR SELECT
  USING ((SELECT auth.role()) = 'service_role'::text);

DROP POLICY IF EXISTS agent_runs_service_write ON public.agent_runs;
CREATE POLICY agent_runs_service_write ON public.agent_runs
  FOR INSERT
  WITH CHECK ((SELECT auth.role()) = 'service_role'::text);

-- ── entities ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS entities_auth_write ON public.entities;
CREATE POLICY entities_auth_write ON public.entities
  FOR ALL
  USING      ((SELECT auth.role()) = 'authenticated'::text)
  WITH CHECK ((SELECT auth.role()) = 'authenticated'::text);

-- ── entity_memories ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS entity_memories_auth_insert ON public.entity_memories;
CREATE POLICY entity_memories_auth_insert ON public.entity_memories
  FOR INSERT
  WITH CHECK ((SELECT auth.role()) = ANY (ARRAY['authenticated'::text, 'service_role'::text]));

DROP POLICY IF EXISTS entity_memories_service_update ON public.entity_memories;
CREATE POLICY entity_memories_service_update ON public.entity_memories
  FOR UPDATE
  USING      ((SELECT auth.role()) = 'service_role'::text)
  WITH CHECK ((SELECT auth.role()) = 'service_role'::text);

DROP POLICY IF EXISTS entity_memories_service_delete ON public.entity_memories;
CREATE POLICY entity_memories_service_delete ON public.entity_memories
  FOR DELETE
  USING ((SELECT auth.role()) = 'service_role'::text);

-- ── entity_persona ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS entity_persona_service_write ON public.entity_persona;
CREATE POLICY entity_persona_service_write ON public.entity_persona
  FOR ALL
  USING      ((SELECT auth.role()) = 'service_role'::text)
  WITH CHECK ((SELECT auth.role()) = 'service_role'::text);

-- ── entity_relationships ────────────────────────────────────────────────
DROP POLICY IF EXISTS entity_relationships_auth_write ON public.entity_relationships;
CREATE POLICY entity_relationships_auth_write ON public.entity_relationships
  FOR ALL
  USING      ((SELECT auth.role()) = 'authenticated'::text)
  WITH CHECK ((SELECT auth.role()) = 'authenticated'::text);

-- ── entity_snippets ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS entity_snippets_service_write ON public.entity_snippets;
CREATE POLICY entity_snippets_service_write ON public.entity_snippets
  FOR ALL
  USING      ((SELECT auth.role()) = 'service_role'::text)
  WITH CHECK ((SELECT auth.role()) = 'service_role'::text);

-- ── entity_traits ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS entity_traits_auth_write ON public.entity_traits;
CREATE POLICY entity_traits_auth_write ON public.entity_traits
  FOR ALL
  USING      ((SELECT auth.role()) = 'authenticated'::text)
  WITH CHECK ((SELECT auth.role()) = 'authenticated'::text);

-- ── focus_votes ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS focus_votes_select_own ON public.focus_votes;
CREATE POLICY focus_votes_select_own ON public.focus_votes
  FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS focus_votes_insert_own ON public.focus_votes;
CREATE POLICY focus_votes_insert_own ON public.focus_votes
  FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- ── player_training_log ─────────────────────────────────────────────────
DROP POLICY IF EXISTS player_training_log_insert_own ON public.player_training_log;
CREATE POLICY player_training_log_insert_own ON public.player_training_log
  FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- ── profiles ────────────────────────────────────────────────────────────
-- profiles_select_own — own row only.
DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT
  USING ((SELECT auth.uid()) = id);

-- profiles_update_own — same column-lockdown shape from migration 0041
-- (is_admin must not change, credits must not increase). The shape is
-- preserved exactly; only the four `auth.uid()` calls are wrapped.
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE
  USING      ((SELECT auth.uid()) = id)
  WITH CHECK (
    (SELECT auth.uid()) = id
    AND NOT (is_admin IS DISTINCT FROM (
      SELECT p.is_admin
      FROM profiles p
      WHERE p.id = (SELECT auth.uid())
    ))
    AND credits <= (
      SELECT p.credits
      FROM profiles p
      WHERE p.id = (SELECT auth.uid())
    )
  );

-- ── push_subscriptions ──────────────────────────────────────────────────
DROP POLICY IF EXISTS push_subscriptions_select_own ON public.push_subscriptions;
CREATE POLICY push_subscriptions_select_own ON public.push_subscriptions
  FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS push_subscriptions_insert_own ON public.push_subscriptions;
CREATE POLICY push_subscriptions_insert_own ON public.push_subscriptions
  FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS push_subscriptions_delete_own ON public.push_subscriptions;
CREATE POLICY push_subscriptions_delete_own ON public.push_subscriptions
  FOR DELETE
  USING ((SELECT auth.uid()) = user_id);

-- ── shadow_match_results ────────────────────────────────────────────────
DROP POLICY IF EXISTS shadow_match_results_service_read  ON public.shadow_match_results;
CREATE POLICY shadow_match_results_service_read ON public.shadow_match_results
  FOR SELECT
  USING ((SELECT auth.role()) = 'service_role'::text);

DROP POLICY IF EXISTS shadow_match_results_service_write ON public.shadow_match_results;
CREATE POLICY shadow_match_results_service_write ON public.shadow_match_results
  FOR ALL
  USING      ((SELECT auth.role()) = 'service_role'::text)
  WITH CHECK ((SELECT auth.role()) = 'service_role'::text);

-- ── wagers ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS wagers_select_own ON public.wagers;
CREATE POLICY wagers_select_own ON public.wagers
  FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS wagers_insert_own ON public.wagers;
CREATE POLICY wagers_insert_own ON public.wagers
  FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = user_id);


-- ════════════════════════════════════════════════════════════════════════
-- PART 2: Foreign-key covering indexes
-- ════════════════════════════════════════════════════════════════════════
-- Each index covers the FK column flagged by the advisor as having no
-- covering index. We use IF NOT EXISTS so a manual operator who indexed
-- one of these before this migration ran doesn't trip a duplicate error.
-- All indexes are b-tree (the default) — these are equality-only FK
-- lookups, so no GIN/GIST or partial-index trickery is warranted.
--
-- Why each one matters in this app:
--   • Parent-row deletes / updates need to scan the child for references.
--   • Hot reads do FK-keyed lookups (e.g. fetching every match for a
--     team via matches.home_team_id) that benefit from the same index.

CREATE INDEX IF NOT EXISTS idx_competition_teams_team_id            ON public.competition_teams      (team_id);
CREATE INDEX IF NOT EXISTS idx_competitions_league_id               ON public.competitions           (league_id);
CREATE INDEX IF NOT EXISTS idx_drama_consequences_narrative_id      ON public.drama_consequences     (narrative_id);
CREATE INDEX IF NOT EXISTS idx_entity_relationships_to_id           ON public.entity_relationships   (to_id);
CREATE INDEX IF NOT EXISTS idx_entity_snippets_seed_memory_id       ON public.entity_snippets        (seed_memory_id);
CREATE INDEX IF NOT EXISTS idx_focus_enacted_intervention_id        ON public.focus_enacted          (intervention_id);
CREATE INDEX IF NOT EXISTS idx_focus_options_season_id              ON public.focus_options          (season_id);
CREATE INDEX IF NOT EXISTS idx_incinerations_replacement_player_id  ON public.incinerations          (replacement_player_id);
CREATE INDEX IF NOT EXISTS idx_managers_entity_id                   ON public.managers               (entity_id);
CREATE INDEX IF NOT EXISTS idx_managers_team_id                     ON public.managers               (team_id);
CREATE INDEX IF NOT EXISTS idx_match_attendance_team_id             ON public.match_attendance       (team_id);
CREATE INDEX IF NOT EXISTS idx_match_notification_sends_user_id     ON public.match_notification_sends (user_id);
CREATE INDEX IF NOT EXISTS idx_match_player_stats_player_id         ON public.match_player_stats     (player_id);
CREATE INDEX IF NOT EXISTS idx_match_player_stats_team_id           ON public.match_player_stats     (team_id);
CREATE INDEX IF NOT EXISTS idx_matches_away_team_id                 ON public.matches                (away_team_id);
CREATE INDEX IF NOT EXISTS idx_matches_home_team_id                 ON public.matches                (home_team_id);
CREATE INDEX IF NOT EXISTS idx_players_entity_id                    ON public.players                (entity_id);
CREATE INDEX IF NOT EXISTS idx_profiles_favourite_player_id         ON public.profiles               (favourite_player_id);
CREATE INDEX IF NOT EXISTS idx_profiles_favourite_team_id           ON public.profiles               (favourite_team_id);
CREATE INDEX IF NOT EXISTS idx_season_decrees_player_id             ON public.season_decrees         (player_id);
CREATE INDEX IF NOT EXISTS idx_season_decrees_team_id               ON public.season_decrees         (team_id);
CREATE INDEX IF NOT EXISTS idx_team_finances_season_id              ON public.team_finances          (season_id);
CREATE INDEX IF NOT EXISTS idx_teams_entity_id                      ON public.teams                  (entity_id);
CREATE INDEX IF NOT EXISTS idx_teams_league_id                      ON public.teams                  (league_id);

COMMENT ON INDEX public.idx_matches_home_team_id IS
  'Speeds up the home-team filter on /teams/:id fixture lists. See migration 0058.';
COMMENT ON INDEX public.idx_matches_away_team_id IS
  'Speeds up the away-team filter on /teams/:id fixture lists. See migration 0058.';
