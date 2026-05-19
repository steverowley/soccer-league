-- ── 0017_wager_volume_view.sql ───────────────────────────────────────────────
-- Codex review on PR #202 caught a real bug: the wagers table has
-- `wagers_select_own` RLS restricting SELECTs to `auth.uid() = user_id`.
-- The page-level `getWagerVolumeForMatch` queried `wagers` directly, which
-- meant:
--   • Anonymous users          → 0 rows back, always "market silent"
--   • Signed-in users          → only their own bets, mislabelled as
--                                "the room's market pulse"
--
-- FIX: introduce a public-readable AGGREGATE view that exposes ONLY
-- match-level totals (no user_id, no individual bet rows) and bypasses
-- the row-level filter at the view-owner level.  Aggregating before
-- exposing means the view never leaks per-user information even though
-- the underlying table contains it.
--
-- WHY VIEWS BYPASS RLS HERE
-- ──────────────────────────
-- PostgreSQL views run as the view OWNER by default (security_invoker =
-- false on PG14+).  The migration role owning this view is the postgres
-- super-role, which is exempt from RLS policies on the wagers table.
-- The view aggregates first, then the GRANT below exposes only the
-- aggregate columns — `match_id`, `team_choice`, `total_stake`, and
-- `bet_count`.  There is no path from the view back to user_id.
--
-- Same pattern as `wager_leaderboard` (introduced in 0004_betting.sql),
-- which also aggregates over the wagers table and is readable by all.
--
-- WHY READ ALL STATUSES (not just 'open')
-- ────────────────────────────────────────
-- The widget shows market sentiment around the fixture as a whole.
-- Settled wagers (won/lost) were placed BEFORE settlement and represent
-- committed sentiment that should still count toward "the room leaned X."
-- Filtering to 'open' would erase the history of every finished match the
-- moment its wagers settle.

CREATE OR REPLACE VIEW wager_volume_v AS
SELECT
  match_id,
  team_choice,
  -- Cast to bigint because COUNT() in PG returns bigint by default and
  -- SUM() on integer returns bigint too — keeping types consistent
  -- with the generated TS types (`number` either way in JS).
  SUM(stake)::bigint AS total_stake,
  COUNT(*)::bigint   AS bet_count
FROM wagers
GROUP BY match_id, team_choice;

-- ── PostgREST exposure ───────────────────────────────────────────────────────
-- Same grant pattern as the other public aggregate views
-- (focus_tally, wager_leaderboard, player_idol_score, etc.).  Without
-- this grant the browser receives a permission error from PostgREST.
GRANT SELECT ON wager_volume_v TO anon, authenticated;
