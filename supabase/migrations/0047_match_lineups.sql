-- ── 0047_match_lineups.sql ─────────────────────────────────────────────────
-- Creates `match_lineups` to capture per-match participation for ALL
-- starters, not just players who recorded a stat (isl-pfm).
--
-- WHY A NEW TABLE
--   match_player_stats only carries rows for players who registered
--   goals/assists/cards, so a defender with 30 clean sheets shows zero
--   rows there and reads as "never played" on /players/:playerId.
--   match_lineups gives every starter a row regardless of contribution
--   and keeps match_player_stats focused on outcomes.
--
-- SHAPE
--   (match_id, player_id) is the PK so the worker can ON CONFLICT DO
--   NOTHING on a replay.  team_id + position + jersey_number captured
--   from the player row at insert time so the player_detail page
--   doesn't need a second join just to render the row.
--
-- BACKFILL
--   Every completed match gets lineups for the players currently
--   flagged starter=true on each team.  Imperfect for matches played
--   before a manager reshuffled the starting XI (the current starter
--   flag may not match who actually played) — but the dominant case
--   is "long-serving starter played the whole season" and that case
--   reconstructs cleanly.  Walking the event log for a better
--   reconstruction is a follow-up.
--
-- RLS
--   Public read (matches the existing match_player_stats policy).
--   Writes are service-role only since the worker is the only writer.

CREATE TABLE IF NOT EXISTS match_lineups (
  match_id        UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  player_id       UUID NOT NULL REFERENCES players(id),
  team_id         TEXT NOT NULL REFERENCES teams(id),
  position        TEXT NOT NULL,
  jersey_number   INTEGER,
  starter         BOOLEAN NOT NULL DEFAULT true,
  minutes_played  INTEGER NOT NULL DEFAULT 90,
  PRIMARY KEY (match_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_match_lineups_player ON match_lineups (player_id);
CREATE INDEX IF NOT EXISTS idx_match_lineups_match  ON match_lineups (match_id);
CREATE INDEX IF NOT EXISTS idx_match_lineups_team   ON match_lineups (team_id);

ALTER TABLE match_lineups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS match_lineups_select ON match_lineups;
CREATE POLICY match_lineups_select ON match_lineups FOR SELECT USING (true);

INSERT INTO match_lineups (match_id, player_id, team_id, position, jersey_number, starter, minutes_played)
SELECT
  m.id                       AS match_id,
  p.id                       AS player_id,
  p.team_id                  AS team_id,
  COALESCE(p.position, 'MF') AS position,
  p.jersey_number            AS jersey_number,
  true                       AS starter,
  90                         AS minutes_played
FROM matches m
JOIN players p
  ON p.team_id IN (m.home_team_id, m.away_team_id)
WHERE m.status = 'completed'
  AND p.starter = true
ON CONFLICT (match_id, player_id) DO NOTHING;

COMMENT ON TABLE match_lineups IS
  'One row per player per match — captures participation independently '
  'of match_player_stats (which stays contribution-only).  Seeded by the '
  'match-worker on match completion (isl-pfm).';
