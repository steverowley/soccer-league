-- Use the `round` column (which is correct) instead of scheduled_at
-- to group matches. Each round gets spaced by cadence_minutes.
CREATE OR REPLACE FUNCTION admin_reset_season()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cadence_minutes INTEGER;
  v_matches_reset   INTEGER := 0;
BEGIN
  TRUNCATE match_events, match_player_stats, match_attendance, match_odds CASCADE;
  TRUNCATE wagers CASCADE;
  TRUNCATE architect_interventions, architect_lore CASCADE;
  TRUNCATE narratives CASCADE;
  TRUNCATE player_training_log CASCADE;
  TRUNCATE team_finances CASCADE;
  TRUNCATE incinerations CASCADE;
  TRUNCATE focus_votes, focus_enacted, season_decrees CASCADE;

  SELECT COALESCE(sc.match_cadence_minutes, 1440)
    INTO v_cadence_minutes
    FROM seasons s
    LEFT JOIN season_config sc ON sc.season_id = s.id
    WHERE s.is_active = true
    LIMIT 1;

  -- Assign each matchday a new scheduled_at based on round order.
  -- Extract round number from round string (e.g., "Matchday 1" → 0).
  WITH round_map AS (
    SELECT DISTINCT round,
      (DENSE_RANK() OVER (ORDER BY round) - 1) as round_idx
    FROM matches
  )
  UPDATE matches m
  SET
    status       = 'scheduled',
    home_score   = NULL,
    away_score   = NULL,
    played_at    = NULL,
    scheduled_at = (NOW() + INTERVAL '5 minutes')
                   + (rm.round_idx * v_cadence_minutes * INTERVAL '1 minute')
  FROM round_map rm
  WHERE m.round = rm.round;

  GET DIAGNOSTICS v_matches_reset = ROW_COUNT;

  UPDATE seasons SET
    status             = 'active',
    ended_at           = NULL,
    election_opens_at  = NULL,
    election_closes_at = NULL
  WHERE is_active = true;

  RETURN json_build_object(
    'success',        true,
    'matches_reset',  v_matches_reset,
    'cadence_minutes', v_cadence_minutes
  );
END;
$$;
