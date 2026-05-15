-- ── 0018_active_watchers_view.sql ────────────────────────────────────────────
-- Phase 6+ engagement layer: live-watcher count widget.
--
-- WHY THIS EXISTS
-- ────────────────
-- The plan calls out:
--   "Aggregate sentiment widgets — SQL views and small UI components:
--    live-watcher count, betting-volume per match, idol-board hottest
--    movers. Reused across pages."
--
-- The wager-volume view (0017) and idol-movers view (0016) already cover
-- two of those three.  This migration adds the third: a public,
-- single-row view exposing how many fans are currently "present" — i.e.
-- have updated `profiles.last_seen_at` in the trailing FAN_PRESENCE
-- window.
--
-- WHY A VIEW (not a direct profiles query)
-- ─────────────────────────────────────────
-- `profiles` table-level RLS exposes only the row matching auth.uid().
-- Anonymous users see zero rows, signed-in users see only themselves —
-- neither can read a real cosmos-wide count from the table directly.
-- Aggregating in a view that runs as the view OWNER (PG default
-- security_invoker = false, RLS-exempt) and exposing ONLY the aggregate
-- column means anonymous users see the same count as signed-in users
-- without ever leaking per-user data.  Same pattern as wager_volume_v
-- (0017), wager_leaderboard (0004), focus_tally, player_idol_score, etc.
--
-- WINDOW: 5 MINUTES
-- ──────────────────
-- Mirrors FAN_PRESENCE_WINDOW_MS in src/features/finance/logic/fanBoost.ts
-- (currently 5 minutes).  Keeping the window identical means the
-- live-watcher count surfaced in the UI reflects the same population the
-- fan-boost calculation uses to award stat bumps — a fan sees their own
-- presence reflected in the room count the moment they log in.

CREATE OR REPLACE VIEW active_watchers_v AS
SELECT
  -- COUNT(*) returns bigint by default; cast to int because the JS
  -- consumer treats it as a number and the count is always well below
  -- 2^31 (the ISL is one league of a few thousand fans max).  Naming
  -- the column `count` would shadow the SQL keyword in some clients,
  -- so we use `watcher_count` for clarity.
  COUNT(*)::int AS watcher_count
FROM profiles
WHERE last_seen_at > (now() - interval '5 minutes');

-- ── PostgREST exposure ───────────────────────────────────────────────────────
-- Same grant pattern as every other public aggregate view in this app.
-- Without this grant the browser receives a permission error.
GRANT SELECT ON active_watchers_v TO anon, authenticated;
