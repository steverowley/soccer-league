-- ── 0077_fix_admin_reset_season.sql ────────────────────────────────────────
-- Fixes admin_reset_season(), which was erroring in production (the admin
-- "Reset Season Results" button) for two reasons:
--
--   1. It ran `TRUNCATE … focus_tally …`, but `focus_tally` is a VIEW, not a
--      table.  Postgres rejects TRUNCATE on a view (SQLSTATE 42809), so the
--      function aborted before touching any data — the reset always failed.
--   2. It did `DELETE FROM competitions` and then immediately looped over
--      `competitions WHERE type = 'league'` to rebuild fixtures.  The loop ran
--      over zero rows, so a "successful" reset would have left the season with
--      no matches at all.
--
-- The live definition had also drifted from this migration history — it
-- existed in no committed migration file.  This migration restores the repo as
-- the source of truth.
--
-- BEHAVIOUR  (matches the admin UI copy: "wipe results, reschedule all matches
-- starting 5 minutes from now, reset season to active"):
--   * Wipes transient / result data: match events, stats, positions, lineups,
--     odds, attendance, notification sends, shadow results, wagers, narratives
--     (cascades to drama_consequences), architect lore + interventions,
--     training logs, finances, focus votes/enactments, incinerations, decrees.
--     `focus_tally` is a view over focus_votes, so clearing the table is enough.
--   * Resets every match row IN PLACE to `scheduled` with null scores, and
--     reschedules each round to NOW()+5min plus (round_index × cadence),
--     ordering rounds by their current chronological position.  This keeps the
--     league matchdays in order and pulls the cup rounds — whose dates were
--     seeded centuries in the future (#569) — back to immediately after the
--     league, so they are reachable again.
--   * Resets the active season to `active` and clears its end/election stamps.
--
-- The is_admin / service-role gate is preserved verbatim.

CREATE OR REPLACE FUNCTION public.admin_reset_season()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller   UUID;
  v_role     TEXT;
  v_is_admin BOOLEAN;
  v_cadence  INTEGER;
  v_kickoff  TIMESTAMPTZ;
  v_count    INTEGER := 0;
BEGIN
  -- ── Role gate (unchanged) ────────────────────────────────────────────────
  -- auth.uid() is NULL for service-role callers (allowed) and anon (rejected
  -- via the role claim).  Authenticated callers must have profiles.is_admin.
  v_caller := auth.uid();
  v_role   := (current_setting('request.jwt.claims', true)::jsonb ->> 'role');
  IF v_caller IS NULL THEN
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

  -- ── Resolve cadence for the active season ────────────────────────────────
  SELECT COALESCE(sc.match_cadence_minutes, 1440)
    INTO v_cadence
    FROM seasons s
    LEFT JOIN season_config sc ON sc.season_id = s.id
    WHERE s.is_active = true
    LIMIT 1;
  IF v_cadence IS NULL THEN v_cadence := 1440; END IF;

  v_kickoff := now() + interval '5 minutes';

  -- ── Wipe transient / result data (real tables only — no views) ───────────
  -- CASCADE only reaches drama_consequences (FK → narratives, ON DELETE
  -- CASCADE); no persistent lore/entity table references this set.
  TRUNCATE TABLE
    match_events,
    match_player_stats,
    match_attendance,
    match_odds,
    match_positions,
    match_lineups,
    match_notification_sends,
    shadow_match_results,
    wagers,
    focus_votes,
    focus_enacted,
    incinerations,
    season_decrees,
    narratives,
    architect_lore,
    architect_interventions,
    player_training_log,
    team_finances
  RESTART IDENTITY CASCADE;

  -- ── Reschedule every match in place ──────────────────────────────────────
  -- Rank rounds by their current earliest kickoff so league matchdays stay in
  -- order; each round group shares one slot so the match-worker picks them up
  -- together.  Robust to non-numeric round labels (cup rounds, test rows).
  WITH round_rank AS (
    SELECT round,
           (DENSE_RANK() OVER (ORDER BY MIN(scheduled_at)) - 1) AS idx
    FROM matches
    GROUP BY round
  )
  UPDATE matches m
  SET status       = 'scheduled',
      home_score   = NULL,
      away_score   = NULL,
      played_at    = NULL,
      scheduled_at = v_kickoff + ((rr.idx * v_cadence) * interval '1 minute')
  FROM round_rank rr
  WHERE m.round IS NOT DISTINCT FROM rr.round;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- ── Reset the active season ──────────────────────────────────────────────
  UPDATE seasons SET
    status             = 'active',
    ended_at           = NULL,
    election_opens_at  = NULL,
    election_closes_at = NULL
  WHERE is_active = true;

  RETURN json_build_object(
    'success',         true,
    'matches_reset',   v_count,
    'cadence_minutes', v_cadence,
    'first_kickoff',   v_kickoff
  );
END;
$$;

COMMENT ON FUNCTION public.admin_reset_season() IS
  'Destructive: wipes match/event/wager/lore/narrative/training state and reschedules every match in place starting 5 min from now (rounds re-spaced by cadence). Gated on profiles.is_admin. See migration 0077.';
