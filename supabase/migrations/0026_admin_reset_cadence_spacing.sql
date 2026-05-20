-- Reschedule rounds using cadence_minutes from season_config instead of
-- preserving the original (seeded) spacing.  After reset:
--   round 1  → NOW + 5 minutes
--   round 2  → NOW + 5 minutes + cadence_minutes
--   round 3  → NOW + 5 minutes + 2 × cadence_minutes
--   …
-- Each round keeps all its matches at exactly the same timestamp (the
-- match-worker picks them up together, which is correct).

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
  -- Wipe transient data (TRUNCATE avoids PostgREST WHERE-clause guard)
  TRUNCATE match_events, match_player_stats, match_attendance, match_odds CASCADE;
  TRUNCATE wagers CASCADE;
  TRUNCATE architect_interventions, architect_lore CASCADE;
  TRUNCATE narratives CASCADE;
  TRUNCATE player_training_log CASCADE;
  TRUNCATE team_finances CASCADE;
  TRUNCATE incinerations CASCADE;
  TRUNCATE focus_votes, focus_enacted, season_decrees CASCADE;

  -- Get configured cadence (default 1440 min = 1 day if missing)
  SELECT COALESCE(sc.match_cadence_minutes, 1440)
    INTO v_cadence_minutes
    FROM seasons s
    LEFT JOIN season_config sc ON sc.season_id = s.id
    WHERE s.is_active = true
    LIMIT 1;

  -- Assign each round a new scheduled_at based on its round index.
  -- Rounds are identified by their current relative order of scheduled_at.
  -- round 0 → NOW + 5 min, round 1 → NOW + 5 min + cadence, etc.
  WITH rounds AS (
    SELECT
      scheduled_at AS old_time,
      (DENSE_RANK() OVER (ORDER BY scheduled_at) - 1) AS round_idx
    FROM matches
  )
  UPDATE matches m
  SET
    status       = 'scheduled',
    home_score   = NULL,
    away_score   = NULL,
    played_at    = NULL,
    scheduled_at = (NOW() + INTERVAL '5 minutes')
                   + (r.round_idx * v_cadence_minutes * INTERVAL '1 minute')
  FROM rounds r
  WHERE m.scheduled_at = r.old_time;

  GET DIAGNOSTICS v_matches_reset = ROW_COUNT;

  -- Reset active season to active status
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
