-- ── 0012_idol_score.sql ──────────────────────────────────────────────────────
-- Phase 2: Idol board + love-is-dangerous.
--
-- WHY: Fans declare allegiance to players via two actions:
--   1. Setting a favourite_player in their profile (deep commitment, ~3× weight).
--   2. Clicking "train" on a player in the training facility (active engagement).
--
-- This migration creates a VIEW — not a table — because idol scores must always
-- reflect live data without ETL.  The view is cheap to query (both source tables
-- are small and indexed on player_id / user_id) and can be materialised later
-- if it becomes a bottleneck.
--
-- COSMIC MECHANIC (see CLAUDE.md Phase 2):
--   The most-idolized players are weighted 2× as curse/incineration targets by
--   the Cosmic Architect.  Idolising a player is an offering, not pure love.
--   This creates the Blaseball "love-is-dangerous" loop:
--     fan love → idol rank rises → Architect notices → fate intervenes.
--
-- TABLES CONSUMED:
--   profiles.favourite_player_id — UUID FK, set once per user on the Profile page.
--   player_training_log.player_id — append-only clicks, one row per click.
--
-- IDOL SCORE FORMULA:
--   idol_score = (fav_count × 3) + training_count_14d
--   where:
--     fav_count        = number of profiles with favourite_player_id = this player.
--     training_count_14d = training clicks for this player in the last 14 days
--                          (one 2-week season window — older clicks are considered
--                          "cold" engagement and are excluded to keep the board live).
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW player_idol_score AS
WITH

-- ── Favourite-player picks ─────────────────────────────────────────────────────
-- Each row in profiles that has a favourite_player_id set counts as one deep
-- declaration of allegiance.  Grouped by player so we get a per-player total.
fav_counts AS (
  SELECT
    favourite_player_id  AS player_id,
    COUNT(*)             AS fav_count
  FROM profiles
  WHERE favourite_player_id IS NOT NULL
  GROUP BY favourite_player_id
),

-- ── Recent training clicks ─────────────────────────────────────────────────────
-- Only the last 14 days (one season cycle).  Older clicks are "historical noise"
-- and should not permanently boost a player who was trained once in Season 1.
-- This gives the board a living, season-by-season feel.
training_counts AS (
  SELECT
    player_id,
    COUNT(*) AS click_count
  FROM player_training_log
  WHERE created_at > (now() - interval '14 days')
  GROUP BY player_id
),

-- ── Combined score per player ─────────────────────────────────────────────────
scored AS (
  SELECT
    p.id              AS player_id,
    p.name,
    p.team_id,
    p.position,
    p.jersey_number,
    t.name            AS team_name,
    t.color           AS team_color,
    -- Raw component counts (exposed for the UI to show breakdown if needed).
    COALESCE(f.fav_count,    0)  AS favourite_count,
    COALESCE(tc.click_count, 0) AS training_count,
    -- Weighted composite. Each favourite pick is worth 3 training clicks because
    -- a profile declaration is a persistent, considered act of allegiance whereas
    -- a training click is a single session interaction.
    (COALESCE(f.fav_count, 0) * 3 + COALESCE(tc.click_count, 0)) AS idol_score
  FROM players p
  LEFT JOIN teams            t  ON t.id  = p.team_id
  LEFT JOIN fav_counts       f  ON f.player_id  = p.id
  LEFT JOIN training_counts  tc ON tc.player_id = p.id
)

SELECT
  player_id,
  name,
  team_id,
  position,
  jersey_number,
  team_name,
  team_color,
  favourite_count,
  training_count,
  idol_score,
  -- Global rank across the entire 32-team league.
  -- Used by the /idols page top-20 board and by the Architect targeting system.
  -- Ties broken by name for deterministic ordering; RANK() is used (not
  -- ROW_NUMBER) so tied players share the same rank value — visually honest.
  RANK() OVER (ORDER BY idol_score DESC, name)                       AS global_rank,
  -- Per-team rank within the player's own club.
  -- Used by the /idols page per-team top-5 section.
  RANK() OVER (PARTITION BY team_id ORDER BY idol_score DESC, name)  AS team_rank
FROM scored;

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- Views inherit RLS from their underlying tables.  profiles and player_training_log
-- are both public-read (see their respective migrations), so player_idol_score is
-- readable by everyone — no explicit RLS policy is needed.
-- No writes go to this view; it is SELECT-only.

-- ── PostgREST grants ──────────────────────────────────────────────────────────
-- PostgREST runs as the `anon` or `authenticated` Postgres role depending on
-- whether the caller supplies a JWT.  Unlike base tables (which get privileges
-- automatically when added to the public schema's default permissions), newly
-- created views require an explicit GRANT before PostgREST can expose them via
-- the REST API.  Without this grant the browser receives a permission error and
-- the idol board falls into the empty/error fallback path.
-- Pattern matches focus_tally, wager_leaderboard, and other public views in
-- this codebase.
GRANT SELECT ON player_idol_score TO anon, authenticated;

-- ── Index note ────────────────────────────────────────────────────────────────
-- The view's CTE scans:
--   profiles(favourite_player_id)           — indexed via idx in 0001.
--   player_training_log(player_id, created_at) — indexed via idx_player_training_log_player.
-- Both indexes exist from prior migrations; no new indexes needed.
