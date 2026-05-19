-- SECURITY DEFINER so it bypasses RLS (only callable by authenticated users via PostgREST, but resets are admin-UI-gated client-side)
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
  -- 1. Wipe all transient/result data
  DELETE FROM match_events;
  DELETE FROM match_player_stats;
  DELETE FROM match_attendance;
  DELETE FROM match_odds;
  DELETE FROM wagers;
  DELETE FROM architect_interventions;
  DELETE FROM architect_lore;
  DELETE FROM narratives;
  DELETE FROM player_training_log;
  DELETE FROM team_finances;
  DELETE FROM incinerations;
  DELETE FROM focus_votes;
  DELETE FROM focus_enacted;
  DELETE FROM season_decrees;

  -- 2. Reschedule all matches starting 5 minutes from now,
  --    preserving their relative spacing.
  SELECT MIN(scheduled_at) INTO v_min_scheduled FROM matches;
  IF v_min_scheduled IS NOT NULL THEN
    v_offset := (NOW() + INTERVAL '5 minutes') - v_min_scheduled;
    UPDATE matches SET
      status       = 'scheduled',
      home_score   = NULL,
      away_score   = NULL,
      played_at    = NULL,
      scheduled_at = scheduled_at + v_offset;
    GET DIAGNOSTICS v_matches_reset = ROW_COUNT;
  END IF;

  -- 3. Reset active season to active status
  UPDATE seasons SET
    status             = 'active',
    ended_at           = NULL,
    election_opens_at  = NULL,
    election_closes_at = NULL
  WHERE is_active = true;

  RETURN json_build_object(
    'success',        true,
    'matches_reset',  v_matches_reset
  );
END;
$$;
