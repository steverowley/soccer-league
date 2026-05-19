-- Fix season_config.season_id: cast text → uuid and add FK so PostgREST
-- can resolve the season_config!left join in getActiveSeason().
ALTER TABLE season_config
  ALTER COLUMN season_id TYPE uuid USING season_id::uuid;

ALTER TABLE season_config
  ADD CONSTRAINT season_config_season_id_fkey
  FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;
