-- ── 0051_admin_rpc_anon_lockdown.sql ──────────────────────────────────────
-- Closes the H1 finding from the May-2026 senior-SRE audit: every admin
-- SECURITY DEFINER RPC contained a `IF auth.uid() IS NULL THEN NULL` branch
-- intended to let the service-role bypass the is_admin check. But
-- unauthenticated callers (anon API key) ALSO have `auth.uid() = NULL`, so
-- they fell into the same "pass" branch and could invoke every destructive
-- admin RPC over `POST /rest/v1/rpc/...`.
--
-- ATTACK (before this migration)
-- ──────────────────────────────
--   curl -X POST \
--     -H "apikey: $SUPABASE_ANON_KEY" \
--     -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
--     -H "Content-Type: application/json" \
--     -d '{"p_match_id":"<uuid>","p_home_score":99,"p_away_score":0}' \
--     "https://<project>.supabase.co/rest/v1/rpc/admin_complete_match"
--
-- And the match flips to completed with any score — without any session.
-- Same shape works for admin_inject_narrative, admin_add_player,
-- admin_set_season_status, admin_fast_forward_matches, admin_reset_season.
--
-- FIX
-- ───
-- 1. Replace the NULL-uid "pass" branch with a JWT-role check. The Supabase
--    `request.jwt.claims` GUC carries `"role": "service_role"` only when
--    the request was signed with the service-role key; anon and
--    authenticated keys produce different values (`"anon"` /
--    `"authenticated"`). We treat ONLY `service_role` as a bypass; every
--    other NULL-uid context is an authentication failure.
-- 2. Belt-and-suspenders: explicitly `REVOKE EXECUTE FROM anon` on every
--    affected function. The original migrations only revoked from PUBLIC,
--    which on some Postgres versions / Supabase configurations leaves
--    `anon` with execute via the role inheritance chain. Explicit revoke
--    makes the gate impossible to mis-grant later.
-- 3. The check helper is duplicated inline in each RPC (matching the
--    existing pattern in 0032 / 0042) rather than extracted — keeps each
--    RPC's definer logic legible at the callsite without a follow-along.
--
-- AFFECTED RPCS
-- ─────────────
--   admin_reset_season                              (from 0032)
--   admin_complete_match(UUID, INTEGER, INTEGER)    (from 0042)
--   admin_set_season_status(UUID, TEXT)             (from 0042)
--   admin_fast_forward_matches(NUMERIC)             (from 0042)
--   admin_add_player(UUID, TEXT, TEXT, INTEGER, BOOLEAN, INTEGER) (from 0042)
--   admin_inject_narrative(TEXT, TEXT)              (from 0042)

-- ── 1. admin_reset_season ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_reset_season()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller    UUID;
  v_role      TEXT;
  v_is_admin  BOOLEAN;
  v_cadence   INTEGER;
  v_kickoff   TIMESTAMPTZ;
  v_comp      RECORD;
  v_count     INTEGER;
BEGIN
  -- ── Role gate (anon-lockdown variant per 0051) ─────────────────────────
  v_caller := auth.uid();
  v_role   := (current_setting('request.jwt.claims', true)::jsonb ->> 'role');

  IF v_caller IS NULL THEN
    -- NULL uid is service_role (bypass) OR anon (reject). The JWT role
    -- claim is the only reliable discriminator.
    IF v_role IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION 'admin_reset_season requires authentication'
        USING ERRCODE = '28000';
    END IF;
  ELSE
    SELECT is_admin INTO v_is_admin FROM profiles WHERE id = v_caller;
    IF v_is_admin IS NOT TRUE THEN
      RAISE EXCEPTION 'admin_reset_season requires is_admin = true on the caller profile'
        USING ERRCODE = '28000';
    END IF;
  END IF;

  -- ── Original body (unchanged from migration 0032) ──────────────────────
  -- Wipes every per-season dynamic table and re-seeds the round-robin
  -- league fixtures plus the cup brackets for the active season.

  SELECT match_cadence_minutes INTO v_cadence FROM season_config LIMIT 1;
  IF v_cadence IS NULL THEN v_cadence := 240; END IF;
  v_kickoff := now() + interval '5 minutes';

  TRUNCATE TABLE
    match_events,
    match_player_stats,
    match_attendance,
    match_odds,
    wagers,
    focus_votes,
    focus_tally,
    focus_enacted,
    incinerations,
    season_decrees,
    narratives,
    architect_lore,
    architect_interventions,
    player_training_log,
    team_finances
  RESTART IDENTITY;

  DELETE FROM matches;
  DELETE FROM competition_teams;
  DELETE FROM competitions;
  UPDATE seasons SET status = 'active',
                     election_opens_at  = NULL,
                     election_closes_at = NULL;

  -- Round-robin re-seed (unchanged shape from 0032).
  FOR v_comp IN
    SELECT id, league_id FROM competitions WHERE type = 'league'
  LOOP
    INSERT INTO matches (competition_id, home_team_id, away_team_id, scheduled_at, status)
    SELECT v_comp.id, a.id, b.id, v_kickoff + (row_number() OVER () * (v_cadence || ' minutes')::interval), 'scheduled'
      FROM teams a JOIN teams b ON a.id <> b.id
     WHERE a.league_id = v_comp.league_id AND b.league_id = v_comp.league_id;
  END LOOP;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN json_build_object('matches_scheduled', v_count, 'first_kickoff', v_kickoff);
END;
$$;

COMMENT ON FUNCTION public.admin_reset_season() IS
  'Admin-only: wipe per-season dynamic tables and re-seed fixtures. Rejects anon (NULL uid + non-service-role JWT) per migration 0051.';

REVOKE EXECUTE ON FUNCTION public.admin_reset_season() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_reset_season() FROM anon;
GRANT  EXECUTE ON FUNCTION public.admin_reset_season() TO authenticated;


-- ── 2. admin_complete_match ───────────────────────────────────────────────

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
  v_role       TEXT;
  v_is_admin   BOOLEAN;
  v_match      RECORD;
  v_comp_type  TEXT;
  v_updated    INTEGER;
BEGIN
  -- ── Role gate (anon-lockdown variant per 0051) ─────────────────────────
  v_caller := auth.uid();
  v_role   := (current_setting('request.jwt.claims', true)::jsonb ->> 'role');
  IF v_caller IS NULL THEN
    IF v_role IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION 'admin_complete_match requires authentication' USING ERRCODE = '28000';
    END IF;
  ELSE
    SELECT is_admin INTO v_is_admin FROM profiles WHERE id = v_caller;
    IF v_is_admin IS NOT TRUE THEN
      RAISE EXCEPTION 'admin_complete_match requires is_admin = true on the caller profile'
        USING ERRCODE = '28000';
    END IF;
  END IF;

  -- ── Input validation ──────────────────────────────────────────────────
  IF p_match_id IS NULL THEN
    RAISE EXCEPTION 'admin_complete_match: match_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_home_score IS NULL OR p_home_score < 0 OR p_home_score > 99 THEN
    RAISE EXCEPTION 'admin_complete_match: home_score must be in [0, 99]' USING ERRCODE = '22023';
  END IF;
  IF p_away_score IS NULL OR p_away_score < 0 OR p_away_score > 99 THEN
    RAISE EXCEPTION 'admin_complete_match: away_score must be in [0, 99]' USING ERRCODE = '22023';
  END IF;

  SELECT id, home_team_id, away_team_id, competition_id, status
    INTO v_match
    FROM matches
   WHERE id = p_match_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_complete_match: match % not found', p_match_id USING ERRCODE = 'P0002';
  END IF;

  IF p_home_score = p_away_score AND v_match.competition_id IS NOT NULL THEN
    SELECT type INTO v_comp_type FROM competitions WHERE id = v_match.competition_id;
    IF v_comp_type = 'cup' THEN
      RAISE EXCEPTION 'Cup matches cannot end in a draw — enter a tiebreak winner'
        USING ERRCODE = '23514';
    END IF;
  END IF;

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

REVOKE EXECUTE ON FUNCTION public.admin_complete_match(UUID, INTEGER, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_complete_match(UUID, INTEGER, INTEGER) FROM anon;
GRANT  EXECUTE ON FUNCTION public.admin_complete_match(UUID, INTEGER, INTEGER) TO authenticated;


-- ── 3. admin_set_season_status ────────────────────────────────────────────

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
  v_role     TEXT;
  v_is_admin BOOLEAN;
BEGIN
  v_caller := auth.uid();
  v_role   := (current_setting('request.jwt.claims', true)::jsonb ->> 'role');
  IF v_caller IS NULL THEN
    IF v_role IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION 'admin_set_season_status requires authentication' USING ERRCODE = '28000';
    END IF;
  ELSE
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

REVOKE EXECUTE ON FUNCTION public.admin_set_season_status(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_set_season_status(UUID, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.admin_set_season_status(UUID, TEXT) TO authenticated;


-- ── 4. admin_fast_forward_matches ─────────────────────────────────────────

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
  v_role     TEXT;
  v_is_admin BOOLEAN;
  v_shifted  INTEGER;
BEGIN
  v_caller := auth.uid();
  v_role   := (current_setting('request.jwt.claims', true)::jsonb ->> 'role');
  IF v_caller IS NULL THEN
    IF v_role IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION 'admin_fast_forward_matches requires authentication' USING ERRCODE = '28000';
    END IF;
  ELSE
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

REVOKE EXECUTE ON FUNCTION public.admin_fast_forward_matches(NUMERIC) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_fast_forward_matches(NUMERIC) FROM anon;
GRANT  EXECUTE ON FUNCTION public.admin_fast_forward_matches(NUMERIC) TO authenticated;


-- ── 5. admin_add_player ───────────────────────────────────────────────────

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
  v_role     TEXT;
  v_is_admin BOOLEAN;
  v_id       UUID;
BEGIN
  v_caller := auth.uid();
  v_role   := (current_setting('request.jwt.claims', true)::jsonb ->> 'role');
  IF v_caller IS NULL THEN
    IF v_role IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION 'admin_add_player requires authentication' USING ERRCODE = '28000';
    END IF;
  ELSE
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

REVOKE EXECUTE ON FUNCTION public.admin_add_player(UUID, TEXT, TEXT, INTEGER, BOOLEAN, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_add_player(UUID, TEXT, TEXT, INTEGER, BOOLEAN, INTEGER) FROM anon;
GRANT  EXECUTE ON FUNCTION public.admin_add_player(UUID, TEXT, TEXT, INTEGER, BOOLEAN, INTEGER) TO authenticated;


-- ── 6. admin_inject_narrative ─────────────────────────────────────────────

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
  v_role     TEXT;
  v_is_admin BOOLEAN;
BEGIN
  v_caller := auth.uid();
  v_role   := (current_setting('request.jwt.claims', true)::jsonb ->> 'role');
  IF v_caller IS NULL THEN
    IF v_role IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION 'admin_inject_narrative requires authentication' USING ERRCODE = '28000';
    END IF;
  ELSE
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

REVOKE EXECUTE ON FUNCTION public.admin_inject_narrative(TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_inject_narrative(TEXT, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.admin_inject_narrative(TEXT, TEXT) TO authenticated;
