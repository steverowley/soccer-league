-- ── 0042_league_tables_lockdown.sql ────────────────────────────────────────
-- Closes the H1 finding from the security review of branch
-- claude/great-allen-wOGHA: every authenticated user could write to the
-- core league tables (matches, competitions, competition_teams, seasons,
-- teams, players, managers, match_player_stats, leagues) because the
-- original 0000_init.sql created a `"auth write {table}"` policy that
-- said `FOR ALL USING (auth.role() = 'authenticated')`.
--
-- ATTACK
-- ──────
--   await supabase.from('matches')
--     .update({ status: 'completed', home_score: 99, away_score: 0 })
--     .eq('id', '<favourite-cup-match>');
-- The CupRoundAdvancerListener in another user's open tab would then
-- advance the attacker's favourite team to the next round.  Bet markets,
-- standings, idol leaderboards and the news feed cascade off the same
-- corrupted row.
--
-- MITIGATION
-- ──────────
-- 1. Drop the permissive `"auth write {table}"` policies on every league
--    table.  RLS becomes deny-by-default for writes — only the service
--    role (which bypasses RLS entirely) can mutate these tables.
-- 2. The match-worker and other edge functions already use the service
--    role, so their writes continue unchanged.
-- 3. The five admin operations that genuinely require authenticated user
--    writes (manual match completion, season-status flips, schedule fast-
--    forward, player creation, narrative injection) are reimplemented as
--    SECURITY DEFINER RPCs gated on `profiles.is_admin = true`, mirroring
--    the pattern established by migration 0032's admin_reset_season.
-- 4. The browser-side CupRoundAdvancerListener becomes a silent no-op
--    when called by non-service-role contexts.  This is the correct
--    behaviour: cup advancement already runs inline in the match-worker
--    (see supabase/functions/match-worker/index.ts:481), so the client-
--    side listener is redundant in production.

-- ── 1. Drop the legacy auth-write policies ─────────────────────────────────
-- The policies were named `"auth write {table}"` (with a single space) by
-- the DO-loop in 0000_init.sql.  DROP IF EXISTS lets this migration run
-- twice safely.

DROP POLICY IF EXISTS "auth write leagues"            ON public.leagues;
DROP POLICY IF EXISTS "auth write teams"              ON public.teams;
DROP POLICY IF EXISTS "auth write seasons"            ON public.seasons;
DROP POLICY IF EXISTS "auth write competitions"       ON public.competitions;
DROP POLICY IF EXISTS "auth write competition_teams"  ON public.competition_teams;
DROP POLICY IF EXISTS "auth write matches"            ON public.matches;
DROP POLICY IF EXISTS "auth write players"            ON public.players;
DROP POLICY IF EXISTS "auth write managers"           ON public.managers;
DROP POLICY IF EXISTS "auth write match_player_stats" ON public.match_player_stats;

-- Public SELECT policies on these tables stay in place — the anon key
-- continues to drive the public-facing UI.

-- ── 2. Helper: standard is_admin gate ──────────────────────────────────────
-- All five admin RPCs below share the same prelude.  Inlining keeps the
-- definer logic explicit at every callsite, matching the pattern in 0032
-- (admin_reset_season) rather than introducing a separate helper function.

-- ── 3. RPC: admin_complete_match ───────────────────────────────────────────
-- Replaces src/features/admin/api/admin.ts:completeMatchManually.
-- Validates inputs, enforces the cup-draw guard, and applies the optimistic-
-- concurrency check identically to the TS version.  Returns the updated
-- match row so the client can keep its toast state in sync.

CREATE OR REPLACE FUNCTION public.admin_complete_match(
  p_match_id   UUID,
  p_home_score INTEGER,
  p_away_score INTEGER
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller     UUID;
  v_is_admin   BOOLEAN;
  v_match      RECORD;
  v_comp_type  TEXT;
  v_updated    INTEGER;
BEGIN
  -- ── Role gate ─────────────────────────────────────────────────────────────
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    -- Service-role callers reach here with auth.uid() = NULL; allow them
    -- through unconditionally (mirrors admin_reset_season).
    NULL;
  ELSE
    SELECT is_admin INTO v_is_admin
      FROM profiles
     WHERE id = v_caller;
    IF v_is_admin IS NOT TRUE THEN
      RAISE EXCEPTION 'admin_complete_match requires is_admin = true on the caller profile'
        USING ERRCODE = '28000';
    END IF;
  END IF;

  -- ── Input validation ──────────────────────────────────────────────────────
  IF p_match_id IS NULL THEN
    RAISE EXCEPTION 'admin_complete_match: match_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_home_score IS NULL OR p_home_score < 0 OR p_home_score > 99 THEN
    RAISE EXCEPTION 'admin_complete_match: home_score must be in [0, 99]' USING ERRCODE = '22023';
  END IF;
  IF p_away_score IS NULL OR p_away_score < 0 OR p_away_score > 99 THEN
    RAISE EXCEPTION 'admin_complete_match: away_score must be in [0, 99]' USING ERRCODE = '22023';
  END IF;

  -- ── Match lookup ──────────────────────────────────────────────────────────
  SELECT id, home_team_id, away_team_id, competition_id, status
    INTO v_match
    FROM matches
   WHERE id = p_match_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_complete_match: match % not found', p_match_id USING ERRCODE = 'P0002';
  END IF;

  -- ── Cup draw guard ────────────────────────────────────────────────────────
  -- CupRoundAdvancerListener (and the worker's maybeAdvanceCupBracket)
  -- refuse to advance the bracket on a tied scoreline.  Block early so the
  -- match doesn't end up `completed` with the bracket stuck.
  IF p_home_score = p_away_score AND v_match.competition_id IS NOT NULL THEN
    SELECT type INTO v_comp_type
      FROM competitions
     WHERE id = v_match.competition_id;
    IF v_comp_type = 'cup' THEN
      RAISE EXCEPTION 'Cup matches cannot end in a draw — enter a tiebreak winner'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  -- ── Optimistic-concurrency write ─────────────────────────────────────────
  -- Same `status = 'scheduled'` guard as the TS version.  GET DIAGNOSTICS
  -- lets us tell apart "row missed the guard" from "row was updated".
  UPDATE matches
     SET status     = 'completed',
         home_score = p_home_score,
         away_score = p_away_score,
         played_at  = now()
   WHERE id = p_match_id
     AND status = 'scheduled';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'Match is no longer scheduled — refresh and try again'
      USING ERRCODE = '40001';
  END IF;

  -- Note: cup-bracket advancement, wager settlement, memory writes, and the
  -- match.completed bus event remain the responsibility of the worker /
  -- client listeners.  The browser caller emits `match.completed` on the
  -- in-app bus after this RPC resolves successfully.

  RETURN json_build_object(
    'match_id',    p_match_id,
    'home_score',  p_home_score,
    'away_score',  p_away_score,
    'home_team_id', v_match.home_team_id,
    'away_team_id', v_match.away_team_id,
    'competition_id', v_match.competition_id
  );
END;
$$;

COMMENT ON FUNCTION public.admin_complete_match(UUID, INTEGER, INTEGER) IS
  'Admin-only: flips a scheduled match to completed with manual scores. is_admin gated. See migration 0042.';

-- Anon callers should never reach this; authenticated callers need it.
REVOKE EXECUTE ON FUNCTION public.admin_complete_match(UUID, INTEGER, INTEGER) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_complete_match(UUID, INTEGER, INTEGER) TO authenticated;


-- ── 4. RPC: admin_set_season_status ────────────────────────────────────────
-- Replaces src/features/admin/api/admin.ts:setSeasonStatus.

CREATE OR REPLACE FUNCTION public.admin_set_season_status(
  p_season_id UUID,
  p_status    TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller   UUID;
  v_is_admin BOOLEAN;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NOT NULL THEN
    SELECT is_admin INTO v_is_admin FROM profiles WHERE id = v_caller;
    IF v_is_admin IS NOT TRUE THEN
      RAISE EXCEPTION 'admin_set_season_status requires is_admin = true on the caller profile'
        USING ERRCODE = '28000';
    END IF;
  END IF;

  IF p_status NOT IN ('active', 'voting', 'completed') THEN
    RAISE EXCEPTION 'admin_set_season_status: status must be active/voting/completed (got %)', p_status
      USING ERRCODE = '22023';
  END IF;

  UPDATE seasons
     SET status              = p_status,
         election_opens_at   = CASE WHEN p_status = 'voting'    THEN now() ELSE election_opens_at  END,
         election_closes_at  = CASE WHEN p_status = 'completed' THEN now() ELSE election_closes_at END
   WHERE id = p_season_id;
END;
$$;

COMMENT ON FUNCTION public.admin_set_season_status(UUID, TEXT) IS
  'Admin-only: flip a season''s status (active/voting/completed). Stamps election_opens_at / election_closes_at as appropriate.';

REVOKE EXECUTE ON FUNCTION public.admin_set_season_status(UUID, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_set_season_status(UUID, TEXT) TO authenticated;


-- ── 5. RPC: admin_fast_forward_matches ─────────────────────────────────────
-- Replaces src/features/admin/api/admin.ts:fastForwardScheduledMatches.
-- A single UPDATE replaces the per-row loop the TS version was forced
-- into; Postgres does the interval arithmetic natively.

CREATE OR REPLACE FUNCTION public.admin_fast_forward_matches(
  p_hours NUMERIC
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller   UUID;
  v_is_admin BOOLEAN;
  v_shifted  INTEGER;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NOT NULL THEN
    SELECT is_admin INTO v_is_admin FROM profiles WHERE id = v_caller;
    IF v_is_admin IS NOT TRUE THEN
      RAISE EXCEPTION 'admin_fast_forward_matches requires is_admin = true on the caller profile'
        USING ERRCODE = '28000';
    END IF;
  END IF;

  IF p_hours IS NULL OR p_hours <= 0 THEN
    RAISE EXCEPTION 'admin_fast_forward_matches: hours must be > 0 (got %)', p_hours
      USING ERRCODE = '22023';
  END IF;

  UPDATE matches
     SET scheduled_at = scheduled_at - (p_hours || ' hours')::interval
   WHERE status = 'scheduled'
     AND scheduled_at IS NOT NULL;

  GET DIAGNOSTICS v_shifted = ROW_COUNT;
  RETURN v_shifted;
END;
$$;

COMMENT ON FUNCTION public.admin_fast_forward_matches(NUMERIC) IS
  'Admin-only: shift every scheduled match back by p_hours so the worker picks them up sooner.';

REVOKE EXECUTE ON FUNCTION public.admin_fast_forward_matches(NUMERIC) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_fast_forward_matches(NUMERIC) TO authenticated;


-- ── 6. RPC: admin_add_player ───────────────────────────────────────────────
-- Replaces src/features/admin/api/admin.ts:addPlayer.

CREATE OR REPLACE FUNCTION public.admin_add_player(
  p_team_id        UUID,
  p_name           TEXT,
  p_position       TEXT,
  p_overall_rating INTEGER,
  p_starter        BOOLEAN,
  p_jersey_number  INTEGER
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller   UUID;
  v_is_admin BOOLEAN;
  v_id       UUID;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NOT NULL THEN
    SELECT is_admin INTO v_is_admin FROM profiles WHERE id = v_caller;
    IF v_is_admin IS NOT TRUE THEN
      RAISE EXCEPTION 'admin_add_player requires is_admin = true on the caller profile'
        USING ERRCODE = '28000';
    END IF;
  END IF;

  IF p_overall_rating IS NULL OR p_overall_rating < 1 OR p_overall_rating > 99 THEN
    RAISE EXCEPTION 'admin_add_player: overall_rating must be in [1, 99]'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO players (
    team_id, name, position, overall_rating, starter, jersey_number,
    attacking, defending, mental, athletic, technical
  ) VALUES (
    p_team_id, p_name, p_position, p_overall_rating, p_starter, p_jersey_number,
    p_overall_rating, p_overall_rating, p_overall_rating, p_overall_rating, p_overall_rating
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.admin_add_player(UUID, TEXT, TEXT, INTEGER, BOOLEAN, INTEGER) IS
  'Admin-only: insert a player row, deriving the five stat columns from p_overall_rating.';

REVOKE EXECUTE ON FUNCTION public.admin_add_player(UUID, TEXT, TEXT, INTEGER, BOOLEAN, INTEGER) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_add_player(UUID, TEXT, TEXT, INTEGER, BOOLEAN, INTEGER) TO authenticated;


-- ── 7. RPC: admin_inject_narrative ─────────────────────────────────────────
-- Replaces src/features/admin/api/admin.ts:injectNarrative.
-- narratives_auth_write was already dropped in migration 0030, so the
-- client-side path was dead.  This RPC restores admin-only access.

CREATE OR REPLACE FUNCTION public.admin_inject_narrative(
  p_kind    TEXT,
  p_summary TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller   UUID;
  v_is_admin BOOLEAN;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NOT NULL THEN
    SELECT is_admin INTO v_is_admin FROM profiles WHERE id = v_caller;
    IF v_is_admin IS NOT TRUE THEN
      RAISE EXCEPTION 'admin_inject_narrative requires is_admin = true on the caller profile'
        USING ERRCODE = '28000';
    END IF;
  END IF;

  IF p_kind IS NULL OR length(p_kind) = 0 THEN
    RAISE EXCEPTION 'admin_inject_narrative: kind is required' USING ERRCODE = '22023';
  END IF;
  IF p_summary IS NULL OR length(p_summary) = 0 THEN
    RAISE EXCEPTION 'admin_inject_narrative: summary is required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO narratives (kind, summary, source)
  VALUES (p_kind, p_summary, 'admin');
END;
$$;

COMMENT ON FUNCTION public.admin_inject_narrative(TEXT, TEXT) IS
  'Admin-only: hand-write a narrative row into the Galaxy Dispatch feed with source=admin.';

REVOKE EXECUTE ON FUNCTION public.admin_inject_narrative(TEXT, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_inject_narrative(TEXT, TEXT) TO authenticated;
