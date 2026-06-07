-- ── 0075_admin_complete_match_settles_wagers.sql ──────────────────────────────
-- Follow-on to 0074 (#557).
--
-- 0074 locked settle_wager to the service role. That closed the credit-minting
-- hole, but it also removed the path the admin manual-completion flow used:
-- admin_complete_match only flips the match to `completed` and (historically)
-- left wager settlement to the browser WagerSettlementListener, which called
-- settle_wager as an authenticated user. With settle_wager now service-role only
-- AND the browser listener removed, admin-completed matches would leave their
-- wagers `open` forever (the match-worker only settles matches IT completes).
--
-- FIX: settle the match's open wagers inline here, in definer context, the moment
-- the match flips scheduled -> completed. This mirrors the worker's settlement
-- and the pure resolveWager logic (logic/settlement.ts): a wager wins iff its
-- team_choice equals the outcome; payout = floor(stake * odds_snapshot); winners
-- are credited. No 'void' branch (resolveWager never produces one). The
-- `status = 'scheduled'` guard + GET DIAGNOSTICS above make this run exactly once
-- per match, so there's no double-credit on a re-invocation.
--
-- Everything else is byte-identical to the 0051 definition.

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

  -- ── Settle this match's open wagers inline (server-side) ───────────────
  -- settle_wager is service-role only (#557) and the worker only settles
  -- matches it completes, so admin completion settles its own wagers here.
  -- Mirrors resolveWager: won iff team_choice = outcome, payout =
  -- floor(stake * odds_snapshot); winners credited (summed per user, since a
  -- user may hold several winning wagers on one match). Runs once — the
  -- scheduled->completed guard above already gated re-invocation.
  WITH result AS (
    SELECT CASE WHEN p_home_score > p_away_score THEN 'home'
                WHEN p_away_score > p_home_score THEN 'away'
                ELSE 'draw' END AS outcome
  ),
  settled AS (
    UPDATE wagers w
       SET status = CASE WHEN w.team_choice = (SELECT outcome FROM result) THEN 'won' ELSE 'lost' END,
           payout = CASE WHEN w.team_choice = (SELECT outcome FROM result)
                         THEN floor(w.stake * w.odds_snapshot)::INTEGER
                         ELSE NULL END
     WHERE w.match_id = p_match_id
       AND w.status = 'open'
    RETURNING w.user_id, w.status, w.payout
  )
  UPDATE profiles p
     SET credits = credits + agg.total
    FROM (
      SELECT user_id, SUM(payout)::INTEGER AS total
        FROM settled
       WHERE status = 'won' AND payout IS NOT NULL
       GROUP BY user_id
    ) agg
   WHERE p.id = agg.user_id;

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
