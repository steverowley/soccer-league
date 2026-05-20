-- Fix league fixture scheduling using Berger/Circle round-robin algorithm.
--
-- PROBLEM: The original fixture seed used a naive pair-enumeration approach
-- (all of team A's pairs first, then team B's, etc.) which caused some teams
-- to play 4 games on Matchday 1 and 0 games on later matchdays.
--
-- FIX: Berger/Circle method guarantees each team plays exactly once per matchday.
-- For n teams: fix team[n] as anchor; rotate remaining n-1 teams around it.
-- Each round r (0..n-2) produces exactly n/2 conflict-free pairs.

-- ── Helper function ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION berger_round_robin_fixtures(
  p_competition_id UUID,
  p_teams          TEXT[],   -- team IDs in any fixed order (sorted for determinism)
  p_first_kickoff  TIMESTAMPTZ,
  p_cadence_minutes INTEGER
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  n         INTEGER := array_length(p_teams, 1);
  r         INTEGER;   -- round index 0..n-2
  k         INTEGER;   -- pair index 1..n/2-1
  home_pos  INTEGER;   -- 1-based position in p_teams
  away_pos  INTEGER;
  v_matchday INTEGER;
  v_sched    TIMESTAMPTZ;
BEGIN
  -- ── First leg (Matchday 1 .. n-1) ─────────────────────────────────────────
  FOR r IN 0..(n - 2) LOOP
    v_matchday := r + 1;
    v_sched    := p_first_kickoff + (r * p_cadence_minutes * INTERVAL '1 minute');

    -- Anchor (p_teams[n]) vs rotating team (p_teams[r+1]).
    -- Alternate which side the anchor is home on each round.
    IF r % 2 = 0 THEN
      INSERT INTO matches (competition_id, home_team_id, away_team_id, round, leg, status, scheduled_at)
      VALUES (p_competition_id, p_teams[n], p_teams[r + 1],
              'Matchday ' || v_matchday, 1, 'scheduled', v_sched);
    ELSE
      INSERT INTO matches (competition_id, home_team_id, away_team_id, round, leg, status, scheduled_at)
      VALUES (p_competition_id, p_teams[r + 1], p_teams[n],
              'Matchday ' || v_matchday, 1, 'scheduled', v_sched);
    END IF;

    -- Circle pairs: positions rotate around the (n-1)-element ring.
    FOR k IN 1..((n / 2) - 1) LOOP
      home_pos := (r + k)               % (n - 1) + 1;
      away_pos := (r - k + (n - 1))     % (n - 1) + 1;
      INSERT INTO matches (competition_id, home_team_id, away_team_id, round, leg, status, scheduled_at)
      VALUES (p_competition_id, p_teams[home_pos], p_teams[away_pos],
              'Matchday ' || v_matchday, 1, 'scheduled', v_sched);
    END LOOP;
  END LOOP;

  -- ── Second leg (Matchday n .. 2*(n-1)) — home/away reversed ───────────────
  FOR r IN 0..(n - 2) LOOP
    v_matchday := n + r;
    v_sched    := p_first_kickoff + ((v_matchday - 1) * p_cadence_minutes * INTERVAL '1 minute');

    -- Anchor: reverse sides from first leg.
    IF r % 2 = 0 THEN
      INSERT INTO matches (competition_id, home_team_id, away_team_id, round, leg, status, scheduled_at)
      VALUES (p_competition_id, p_teams[r + 1], p_teams[n],
              'Matchday ' || v_matchday, 2, 'scheduled', v_sched);
    ELSE
      INSERT INTO matches (competition_id, home_team_id, away_team_id, round, leg, status, scheduled_at)
      VALUES (p_competition_id, p_teams[n], p_teams[r + 1],
              'Matchday ' || v_matchday, 2, 'scheduled', v_sched);
    END IF;

    FOR k IN 1..((n / 2) - 1) LOOP
      home_pos := (r + k)           % (n - 1) + 1;
      away_pos := (r - k + (n - 1)) % (n - 1) + 1;
      -- Swap home/away vs first leg
      INSERT INTO matches (competition_id, home_team_id, away_team_id, round, leg, status, scheduled_at)
      VALUES (p_competition_id, p_teams[away_pos], p_teams[home_pos],
              'Matchday ' || v_matchday, 2, 'scheduled', v_sched);
    END LOOP;
  END LOOP;
END;
$$;

-- ── Regenerate current fixtures ───────────────────────────────────────────────

TRUNCATE match_events, match_player_stats, match_attendance, match_odds CASCADE;
TRUNCATE wagers CASCADE;
DELETE FROM matches;

DO $$
DECLARE
  v_comp    RECORD;
  v_cadence INTEGER;
  v_kickoff TIMESTAMPTZ;
BEGIN
  SELECT COALESCE(sc.match_cadence_minutes, 1440)
    INTO v_cadence
    FROM seasons s
    LEFT JOIN season_config sc ON sc.season_id = s.id
    WHERE s.is_active = true
    LIMIT 1;

  v_kickoff := NOW() + INTERVAL '5 minutes';

  FOR v_comp IN (
    SELECT c.id AS comp_id,
           ARRAY_AGG(ct.team_id ORDER BY ct.team_id) AS team_ids
    FROM competitions c
    JOIN competition_teams ct ON ct.competition_id = c.id
    WHERE c.type = 'league'
    GROUP BY c.id
  ) LOOP
    PERFORM berger_round_robin_fixtures(
      v_comp.comp_id, v_comp.team_ids, v_kickoff, v_cadence
    );
  END LOOP;
END;
$$;

-- ── Update admin_reset_season() to regenerate fixtures ───────────────────────

CREATE OR REPLACE FUNCTION admin_reset_season()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cadence INTEGER;
  v_kickoff TIMESTAMPTZ;
  v_comp    RECORD;
  v_count   INTEGER;
BEGIN
  TRUNCATE match_events, match_player_stats, match_attendance, match_odds CASCADE;
  TRUNCATE wagers CASCADE;
  TRUNCATE architect_interventions, architect_lore CASCADE;
  TRUNCATE narratives CASCADE;
  TRUNCATE player_training_log CASCADE;
  TRUNCATE team_finances CASCADE;
  TRUNCATE incinerations CASCADE;
  TRUNCATE focus_votes, focus_enacted, season_decrees CASCADE;

  DELETE FROM matches;

  SELECT COALESCE(sc.match_cadence_minutes, 1440)
    INTO v_cadence
    FROM seasons s
    LEFT JOIN season_config sc ON sc.season_id = s.id
    WHERE s.is_active = true
    LIMIT 1;

  v_kickoff := NOW() + INTERVAL '5 minutes';

  FOR v_comp IN (
    SELECT c.id AS comp_id,
           ARRAY_AGG(ct.team_id ORDER BY ct.team_id) AS team_ids
    FROM competitions c
    JOIN competition_teams ct ON ct.competition_id = c.id
    WHERE c.type = 'league'
    GROUP BY c.id
  ) LOOP
    PERFORM berger_round_robin_fixtures(
      v_comp.comp_id, v_comp.team_ids, v_kickoff, v_cadence
    );
  END LOOP;

  SELECT COUNT(*) INTO v_count FROM matches;

  UPDATE seasons SET
    status             = 'active',
    ended_at           = NULL,
    election_opens_at  = NULL,
    election_closes_at = NULL
  WHERE is_active = true;

  RETURN json_build_object(
    'success',         true,
    'matches_created', v_count,
    'cadence_minutes', v_cadence
  );
END;
$$;
