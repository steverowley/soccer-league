-- One-off pre-launch reset, run 2026-10-26 with the owner's approval.
-- Removes everything the four dry-run seasons (2600 to 2603) generated, keeps
-- everything seeded as canon (teams, players, managers, entities, personas,
-- traits, relationships, snippets, lore). Verified before running: no player
-- or entity was created or retired during the test seasons, and nothing in
-- code writes entity_relationships, so those rows are all seeded.
BEGIN;

-- Match data (all of it belongs to test seasons). TRUNCATE frees the space at
-- once instead of leaving 600 MB of dead rows for vacuum on a small instance.
TRUNCATE public.match_positions, public.match_position_rosters, public.match_events,
         public.match_player_stats, public.match_odds, public.match_notification_sends,
         public.match_lineups, public.match_attendance, public.shadow_match_results,
         public.wagers, public.sim_tickets;

-- Seasons cascade to competitions, competition_teams, matches, season_config,
-- focus_options, focus_enacted, season_decrees, incinerations, team_finances.
DELETE FROM public.seasons;

-- The universe's memory of matches that no longer exist.
DELETE FROM public.narratives;               -- omens, columns, whispers about test seasons
DELETE FROM public.entity_memories;          -- all fact_kind = match_result
DELETE FROM public.architect_interventions;  -- all target_table = matches
DELETE FROM public.agent_runs;               -- run logs
DELETE FROM public.architect_lore WHERE key = 'match_ledger';

COMMIT;
