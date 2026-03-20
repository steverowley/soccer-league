-- ═══════════════════════════════════════════════════════════════════════════
-- ISL DATABASE SCHEMA
-- ───────────────────────────────────────────────────────────────────────────
-- Run this in the Supabase SQL Editor (dashboard → SQL Editor → New Query)
-- before running seed.sql.  It is safe to re-run: every statement uses
-- CREATE TABLE IF NOT EXISTS / CREATE UNIQUE INDEX IF NOT EXISTS.
--
-- DATA MODEL OVERVIEW
-- ───────────────────
-- The schema is organised around two top-level concepts:
--
--   seasons        – a calendar year of play ("Season 1 — 2600", etc.)
--   competitions   – a specific tournament or league run within a season
--
-- This two-level structure means:
--   • The same four leagues run every season as separate competition rows
--   • A cross-league cup (ISL Champions Cup) is also a competition row, with
--     league_id = NULL and teams drawn from multiple leagues
--   • Standings for any competition are derived at read-time by aggregating
--     its completed match rows — no separate standings table is maintained
--
-- TEAM IDENTITY
-- ─────────────
-- Teams use text slugs as primary keys ('mercury-runners', 'saturn-rings')
-- rather than generated UUIDs.  This matches the id values already used in
-- leagueData.js so the front-end never needs to translate between the two
-- identifier systems.
--
-- ROW LEVEL SECURITY
-- ──────────────────
-- All tables are publicly readable (anon key is safe in the browser bundle).
-- Insert / update / delete require an authenticated Supabase session.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. LEAGUES ────────────────────────────────────────────────────────────────
-- Static reference table.  IDs match the keys used in leagueData.js so that
-- the front-end can look up DB rows by the same slug it already uses for
-- routing (/leagues/rocky-inner, etc.).
CREATE TABLE IF NOT EXISTS leagues (
  id          text PRIMARY KEY,   -- URL slug: 'rocky-inner' | 'gas-giants' | 'outer-reaches' | 'kuiper-belt'
  name        text NOT NULL,      -- Display name, e.g. 'Rocky Inner League'
  short_name  text NOT NULL,      -- Abbreviation shown in tight spaces, e.g. 'RIL'
  description text                -- Long-form prose for the league detail page
);

-- ── 2. TEAMS ──────────────────────────────────────────────────────────────────
-- One row per club.  The id slug is the canonical team identifier used
-- everywhere: routing (/teams/mercury-runners), FK references, and the
-- match simulator's team objects.
CREATE TABLE IF NOT EXISTS teams (
  id          text PRIMARY KEY,       -- URL slug matching leagueData.js, e.g. 'mercury-runners'
  league_id   text REFERENCES leagues(id),  -- parent league; NULL would mean an unaffiliated/guest team
  name        text NOT NULL,          -- Full club name, e.g. 'Mercury Runners FC'
  location    text,                   -- Planet / moon / body the club represents
  home_ground text,                   -- Stadium name with nickname, e.g. 'Solar Sprint Stadium "The Heat Box"'
  capacity    text,                   -- Formatted seating capacity, e.g. '35,000'
  color       text,                   -- Primary brand hex colour used for UI accents
  tagline     text,                   -- One-line descriptor shown on the teams listing card
  description text                    -- Long-form prose for the team detail page
);

-- ── 3. SEASONS ────────────────────────────────────────────────────────────────
-- A season is the outermost container for all competition activity.
-- Exactly one season may be active at any time; the partial unique index
-- below enforces this without needing application-layer logic.
CREATE TABLE IF NOT EXISTS seasons (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text    NOT NULL,  -- Human-readable label, e.g. 'Season 1 — 2600'
  year       integer NOT NULL,  -- In-universe calendar year, e.g. 2600
  is_active  boolean NOT NULL DEFAULT false,  -- true for the season currently being played
  start_date date,              -- Optional: first match date of the season
  end_date   date,              -- Optional: last match date / cup final date
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enforce the single-active-season rule at the database level.
-- A partial unique index on a boolean column is the cleanest way:
-- only one row where is_active=true can ever exist.
CREATE UNIQUE INDEX IF NOT EXISTS seasons_one_active
  ON seasons (is_active)
  WHERE is_active = true;

-- ── 4. COMPETITIONS ───────────────────────────────────────────────────────────
-- A competition is either a league run (type='league') or a cup (type='cup')
-- or a playoff (type='playoff') within a specific season.
--
-- TYPE values:
--   'league'   – a single league's home-and-away round-robin run
--   'cup'      – a knockout or group+knockout tournament, potentially cross-league
--   'playoff'  – end-of-season promotion / relegation or title decider
--
-- FORMAT values:
--   'round_robin'     – every team plays every other team home and away
--   'knockout'        – single-elimination brackets
--   'group_knockout'  – group stage followed by knockout rounds (like a World Cup)
--
-- STATUS values:
--   'upcoming'   – fixtures not yet generated or played
--   'active'     – season is in progress, matches being played
--   'completed'  – all matches finished, final standings locked
--
-- league_id is NULL for cross-league competitions (e.g. ISL Champions Cup)
-- because those draw participants from multiple leagues.
CREATE TABLE IF NOT EXISTS competitions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id  uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  league_id  text REFERENCES leagues(id),  -- NULL for cross-league cups
  name       text NOT NULL,                -- e.g. 'Rocky Inner League — Season 1'
  type       text NOT NULL CHECK (type   IN ('league', 'cup', 'playoff')),
  format     text NOT NULL CHECK (format IN ('round_robin', 'knockout', 'group_knockout')),
  status     text NOT NULL DEFAULT 'upcoming'
               CHECK (status IN ('upcoming', 'active', 'completed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── 5. COMPETITION_TEAMS ──────────────────────────────────────────────────────
-- Junction table linking teams to their competitions.
-- For league competitions this is simply all teams in that league.
-- For cups it records the qualified teams along with optional group assignments
-- (group_name) and seeding numbers used during the draw.
--
-- group_name examples: 'Group A', 'Group B' — NULL for knockout-only cups
-- seeding:   1 = top seed; used to ensure top seeds are spread across groups
CREATE TABLE IF NOT EXISTS competition_teams (
  competition_id uuid NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  team_id        text NOT NULL REFERENCES teams(id),
  group_name     text,      -- cup group stage assignment; NULL for league/knockout
  seeding        smallint,  -- cup draw seeding; NULL for league competitions
  PRIMARY KEY (competition_id, team_id)
);

-- ── 6. MATCHES ────────────────────────────────────────────────────────────────
-- Every fixture (whether a league matchday or a cup round) is one match row.
-- Scores are NULL until the match is completed.
--
-- round examples:
--   League:  'Matchday 1' … 'Matchday 14'
--   Cup:     'Group Stage', 'Quarter Final', 'Semi Final', 'Final'
--
-- leg is used for two-legged ties (value: 1 or 2).  NULL for single-leg.
--
-- STATUS values mirror competitions.status:
--   'scheduled'   – fixture exists but has not been played
--   'in_progress' – match is live (used during simulation)
--   'completed'   – final score recorded
CREATE TABLE IF NOT EXISTS matches (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  home_team_id   text NOT NULL REFERENCES teams(id),
  away_team_id   text NOT NULL REFERENCES teams(id),
  round          text,          -- 'Matchday 1', 'Quarter Final', 'Final', …
  leg            smallint,      -- 1 or 2 for two-legged ties; NULL otherwise
  home_score     smallint,      -- NULL = not yet played
  away_score     smallint,      -- NULL = not yet played
  status         text NOT NULL DEFAULT 'scheduled'
                   CHECK (status IN ('scheduled', 'in_progress', 'completed')),
  played_at      timestamptz,   -- NULL until match is completed
  weather        text,          -- weather condition key from WX constants, e.g. 'dust_storm'
  stadium        text,          -- stadium name as a display string
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- A team cannot play itself.  This should never happen in practice but the
  -- constraint prevents accidental seed / fixture-generation bugs.
  CONSTRAINT no_self_match CHECK (home_team_id <> away_team_id)
);

-- ── 7. PLAYERS ────────────────────────────────────────────────────────────────
-- Squad members for each team.  Players are created by the roster-generation
-- step (not yet implemented) and are referenced by match_player_stats.
--
-- position values: 'GK' | 'DF' | 'MF' | 'FW'  (matches POS_ORDER in constants.js)
-- overall_rating: 1–99 scale used by the match simulator for shot/tackle rolls
-- personality:    one of the PERS keys from constants.js (balanced, selfish, etc.)
CREATE TABLE IF NOT EXISTS players (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id        text REFERENCES teams(id),
  name           text NOT NULL,
  position       text CHECK (position IN ('GK', 'DF', 'MF', 'FW')),
  nationality    text,
  age            smallint,
  overall_rating smallint CHECK (overall_rating BETWEEN 1 AND 99),
  personality    text,   -- maps to PERS constants: 'balanced' | 'selfish' | 'aggressive' | …
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ── 8. MANAGERS ───────────────────────────────────────────────────────────────
-- One row per manager.  A team can have multiple manager rows over its history
-- (past managers are kept for record purposes) but typically has one active one.
-- style examples: 'gegenpressing', 'park_the_bus', 'tiki_taka'
CREATE TABLE IF NOT EXISTS managers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     text REFERENCES teams(id),
  name        text NOT NULL,
  nationality text,
  style       text,   -- tactical philosophy; flavour text only, not yet mechanically enforced
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── 9. MATCH_PLAYER_STATS ─────────────────────────────────────────────────────
-- One row per player per match.  Written after the simulator finishes via
-- saveMatchPlayerStats() in supabase.js.  The unique constraint on
-- (match_id, player_id) means upsert is safe — re-simulating a match
-- overwrites rather than duplicates stats.
--
-- rating: 1.0–10.0 match performance rating (numeric(3,1) gives e.g. 7.5)
CREATE TABLE IF NOT EXISTS match_player_stats (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id       uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  player_id      uuid NOT NULL REFERENCES players(id),
  team_id        text NOT NULL REFERENCES teams(id),
  goals          smallint NOT NULL DEFAULT 0,
  assists        smallint NOT NULL DEFAULT 0,
  yellow_cards   smallint NOT NULL DEFAULT 0,
  red_cards      smallint NOT NULL DEFAULT 0,
  minutes_played smallint NOT NULL DEFAULT 0,
  rating         numeric(3,1),  -- 1.0–10.0 match performance rating; NULL if not yet rated
  UNIQUE (match_id, player_id)  -- upsert conflict target in saveMatchPlayerStats()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ───────────────────────────────────────────────────────────────────────────
-- Every table is publicly readable so the front-end can use the anon key
-- without authentication.  All mutations (INSERT / UPDATE / DELETE) require
-- auth.role() = 'authenticated', which corresponds to a logged-in admin user
-- or a server-side call using the service-role key.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE leagues             ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams               ENABLE ROW LEVEL SECURITY;
ALTER TABLE seasons             ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE competition_teams   ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches             ENABLE ROW LEVEL SECURITY;
ALTER TABLE players             ENABLE ROW LEVEL SECURITY;
ALTER TABLE managers            ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_player_stats  ENABLE ROW LEVEL SECURITY;

-- Public SELECT on all tables.
-- We loop instead of writing 9 identical policy statements to keep this
-- maintainable; adding a new table only requires appending it to the array.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'leagues','teams','seasons','competitions',
    'competition_teams','matches','players','managers','match_player_stats'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY IF NOT EXISTS "public read %1$s" ON %1$s FOR SELECT USING (true)', t
    );
  END LOOP;
END $$;

-- Authenticated INSERT / UPDATE / DELETE on all tables.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'leagues','teams','seasons','competitions',
    'competition_teams','matches','players','managers','match_player_stats'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY IF NOT EXISTS "auth write %1$s" ON %1$s
       FOR ALL USING (auth.role() = ''authenticated'')
       WITH CHECK (auth.role() = ''authenticated'')', t
    );
  END LOOP;
END $$;
