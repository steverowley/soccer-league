-- ── 0082_stagger_matchday_kickoffs.sql ────────────────────────────────────────
-- WHY: berger_round_robin_fixtures computed ONE `v_sched` per matchday and
-- stamped every fixture in that matchday with it, so an entire league kicked off
-- in the same second.  Production (Season 3) had all 48 of a day's fixtures at
-- `15:59:10.840867` — nothing reads as a shared event when everything happens
-- simultaneously, and it handed the match worker a 48-match thundering herd
-- against a MAX_IN_FLIGHT of 4.
--
-- The TypeScript fixture path (src/features/match/logic/roundRobinDraw.ts)
-- already staggered by `slot × kickoffStaggerMs` — that landed in #645 — but the
-- SQL path never did, and the SQL path is what generated Season 3.  This brings
-- the two to parity.
--
-- The new parameter is APPENDED with a DEFAULT of 0, so every existing caller
-- keeps its current behaviour until it opts in.

DROP FUNCTION IF EXISTS berger_round_robin_fixtures(uuid, text[], timestamptz, integer);

CREATE OR REPLACE FUNCTION berger_round_robin_fixtures(
  p_competition_id          uuid,
  p_teams                   text[],
  p_first_kickoff           timestamptz,
  p_cadence_minutes         integer,
  p_kickoff_stagger_minutes integer DEFAULT 0
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n          INTEGER := array_length(p_teams, 1);
  r          INTEGER;   -- round index 0..n-2
  k          INTEGER;   -- pair index 1..n/2-1 (also the kickoff slot)
  home_pos   INTEGER;   -- 1-based position in p_teams
  away_pos   INTEGER;
  v_matchday INTEGER;
  v_sched    TIMESTAMPTZ;
  v_stagger  INTERVAL := COALESCE(p_kickoff_stagger_minutes, 0) * INTERVAL '1 minute';
BEGIN
  -- ── First leg (Matchday 1 .. n-1) ─────────────────────────────────────────
  FOR r IN 0..(n - 2) LOOP
    v_matchday := r + 1;
    v_sched    := p_first_kickoff + (r * p_cadence_minutes * INTERVAL '1 minute');

    -- Slot 0: the anchor fixture opens the matchday on the hour.
    IF r % 2 = 0 THEN
      INSERT INTO matches (competition_id, home_team_id, away_team_id, round, leg, status, scheduled_at)
      VALUES (p_competition_id, p_teams[n], p_teams[r + 1],
              'Matchday ' || v_matchday, 1, 'scheduled', v_sched);
    ELSE
      INSERT INTO matches (competition_id, home_team_id, away_team_id, round, leg, status, scheduled_at)
      VALUES (p_competition_id, p_teams[r + 1], p_teams[n],
              'Matchday ' || v_matchday, 1, 'scheduled', v_sched);
    END IF;

    -- Circle pairs rotate around the (n-1)-element ring.  Pair k is one stagger
    -- step later than the last, so a matchday's fixtures trickle out.
    FOR k IN 1..((n / 2) - 1) LOOP
      home_pos := (r + k)               % (n - 1) + 1;
      away_pos := (r - k + (n - 1))     % (n - 1) + 1;
      INSERT INTO matches (competition_id, home_team_id, away_team_id, round, leg, status, scheduled_at)
      VALUES (p_competition_id, p_teams[home_pos], p_teams[away_pos],
              'Matchday ' || v_matchday, 1, 'scheduled', v_sched + k * v_stagger);
    END LOOP;
  END LOOP;

  -- ── Second leg (Matchday n .. 2*(n-1)) — home/away reversed ───────────────
  FOR r IN 0..(n - 2) LOOP
    v_matchday := n + r;
    v_sched    := p_first_kickoff + ((v_matchday - 1) * p_cadence_minutes * INTERVAL '1 minute');

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
      INSERT INTO matches (competition_id, home_team_id, away_team_id, round, leg, status, scheduled_at)
      VALUES (p_competition_id, p_teams[away_pos], p_teams[home_pos],
              'Matchday ' || v_matchday, 2, 'scheduled', v_sched + k * v_stagger);
    END LOOP;
  END LOOP;
END;
$$;
