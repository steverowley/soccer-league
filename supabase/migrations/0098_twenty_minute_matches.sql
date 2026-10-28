-- 0098_twenty_minute_matches.sql
--
-- Matches are revealed over 20 real minutes instead of 10 (owner decision,
-- docs/match-viewer.md section 5): at 600 s the match ran at 9x and a pass
-- was on screen for about 0.15 s; at 1200 s it runs at 4.5x.
--
-- 1. New seasons default to 1200 s.
-- 2. Seasons whose config is still the old 600 s default move to 1200 s.
--    Applied between matchdays (nothing live), so no match changes speed
--    part way through; completed matches are past either window.
-- The browser, the rollover and the worker carry the same fallback
-- (src/features/match/api/matchDuration.test.ts holds them equal).

ALTER TABLE season_config ALTER COLUMN match_duration_seconds SET DEFAULT 1200;

UPDATE season_config
SET match_duration_seconds = 1200,
    updated_at = now()
WHERE match_duration_seconds = 600;
