-- ── 0016_idol_movers_view.sql ────────────────────────────────────────────────
-- Phase 6+ engagement layer: hot idol movers widget.
--
-- WHY THIS EXISTS
-- ────────────────
-- The Phase 2 idol board (`player_idol_score`) shows absolute rankings — who
-- the cosmos currently watches.  But a quiet long-term first-place name reads
-- the same on the board as a player who's surged into the top 20 today.  The
-- "hot movers" widget surfaces the latter: the players whose idolisation is
-- TRENDING right now, not just historically high.
--
-- DESIGN DECISION: training-clicks proxy
-- ───────────────────────────────────────
-- Capturing true rank-shift requires snapshot history of `player_idol_score`
-- which doesn't exist yet (deferred to a future snapshot-table migration).
-- As a deliberate MVP, this view treats *recent training-click volume* as a
-- proxy for trending: a player getting clicked a lot this week is by
-- definition rising in the eyes of the cosmos.  When snapshot history lands,
-- this view's body can be swapped for a true rank-delta join without breaking
-- the caller contract — every consumer of this view reads `player_id`,
-- `name`, `team_id`, `recent_clicks`, and that contract stays stable.
--
-- WINDOW: 7 days
-- ───────────────
-- The Phase 2 idol-score formula already uses a 14-day window for the
-- training half.  Halving that for the movers view means a click 8 days ago
-- still counts towards a player's ABSOLUTE idol score but no longer counts
-- as "trending".  That gap is the design intent: rising vs settled love.
--
-- ZERO-CLICK PLAYERS
-- ───────────────────
-- Players with zero clicks in the window do NOT appear (HAVING clause).  The
-- Phase 2 board surfaces them for the "unidolised → cosmos has not yet
-- noticed" narrative; the movers widget is by definition about activity.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW player_idol_movers AS
WITH

-- ── Clicks per player in the trailing 7-day window ───────────────────────────
-- Aggregate first so we don't recompute the predicate for every joined row.
recent_clicks AS (
  SELECT
    player_id,
    COUNT(*)::int AS click_count
  FROM player_training_log
  WHERE created_at > (now() - interval '7 days')
  GROUP BY player_id
  HAVING COUNT(*) > 0
)

SELECT
  p.id              AS player_id,
  p.name,
  p.team_id,
  p.position,
  p.jersey_number,
  t.name            AS team_name,
  t.color           AS team_color,
  rc.click_count    AS recent_clicks,
  -- Ranked positioning lets the UI render "top 5 movers" without an
  -- ORDER BY + LIMIT in every caller.  Ties broken by name for
  -- deterministic ordering across re-renders.
  RANK() OVER (ORDER BY rc.click_count DESC, p.name) AS mover_rank
FROM recent_clicks rc
JOIN players p ON p.id = rc.player_id
LEFT JOIN teams t ON t.id = p.team_id
-- Exclude incinerated players (consistent with player_idol_score after
-- migration 0013).  A dead player cannot be trending.
WHERE p.is_active = true
ORDER BY rc.click_count DESC, p.name;

-- ── PostgREST exposure ───────────────────────────────────────────────────────
-- Same grant pattern as player_idol_score / match_referee_v / focus_tally.
-- Without this grant the browser receives a permission error.
GRANT SELECT ON player_idol_movers TO anon, authenticated;
