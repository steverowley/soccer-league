-- Add WHERE clauses to UPDATE statements so PostgREST's safety guard
-- doesn't reject them when the function is called via the REST API.
-- Both UPDATEs intentionally touch every row; WHERE true makes the
-- intent explicit and satisfies the guard without changing behaviour.
CREATE OR REPLACE FUNCTION admin_reset_season()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_min_scheduled TIMESTAMPTZ;
  v_offset INTERVAL;
  v_matches_reset INTEGER := 0;
BEGIN
  -- Wipe transient data using TRUNCATE (avoids PostgREST WHERE-clause guard)
  TRUNCATE match_events, match_player_stats, match_attendance, match_odds CASCADE;
  TRUNCATE wagers CASCADE;
  TRUNCATE architect_interventions, architect_lore CASCADE;
  TRUNCATE narratives CASCADE;
  TRUNCATE player_training_log CASCADE;
  TRUNCATE team_finances CASCADE;
  TRUNCATE incinerations CASCADE;
  TRUNCATE focus_votes, focus_enacted, season_decrees CASCADE;

  -- Reschedule all matches starting 5 minutes from now,
  -- preserving relative spacing.
  SELECT MIN(scheduled_at) INTO v_min_scheduled FROM matches;
  IF v_min_scheduled IS NOT NULL THEN
    v_offset := (NOW() + INTERVAL '5 minutes') - v_min_scheduled;
    UPDATE matches SET
      status       = 'scheduled',
      home_score   = NULL,
      away_score   = NULL,
      played_at    = NULL,
      scheduled_at = scheduled_at + v_offset
    WHERE true;
    GET DIAGNOSTICS v_matches_reset = ROW_COUNT;
  END IF;

  -- Reset active season to active status
  UPDATE seasons SET
    status             = 'active',
    ended_at           = NULL,
    election_opens_at  = NULL,
    election_closes_at = NULL
  WHERE is_active = true;

  RETURN json_build_object(
    'success',       true,
    'matches_reset', v_matches_reset
  );
END;
$$;
