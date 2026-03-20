-- ═══════════════════════════════════════════════════════════════════════════
-- ISL SEED DATA
-- ───────────────────────────────────────────────────────────────────────────
-- Run this AFTER schema.sql.  Every statement uses ON CONFLICT … DO NOTHING
-- so it is safe to re-run without creating duplicates.
--
-- WHAT THIS FILE SEEDS
-- ────────────────────
--   1. Four leagues (matching TEAMS_BY_LEAGUE keys in leagueData.js)
--   2. All 28 clubs across those four leagues
--   3. Season 1 (year 2600), marked as active
--   4. Five competitions for Season 1:
--        • Rocky Inner League S1        (league, round_robin, 8 teams)
--        • Gas/Ice Giants League S1     (league, round_robin, 8 teams)
--        • Outer Reaches League S1      (league, round_robin, 6 teams)
--        • Kuiper Belt League S1        (league, round_robin, 6 teams)
--        • ISL Champions Cup S1         (cup, group_knockout, 8 teams)
--   5. competition_teams rows for all five competitions
--
-- LEAGUE ID NOTE
-- ──────────────
-- The LEAGUES array in leagueData.js has 'interstellar' as the 4th entry,
-- but TEAMS_BY_LEAGUE uses 'kuiper-belt' as the 4th key.  The DB follows
-- TEAMS_BY_LEAGUE because it holds the actual team data; 'interstellar' is
-- a future/lore concept with no active clubs yet.
--
-- COMPETITION UUIDs
-- ─────────────────
-- Season and competition rows use fixed "well-known" UUIDs so that seed data
-- can be re-run deterministically and FK references in other scripts can
-- hard-code these IDs without a lookup step.
--
-- ISL CHAMPIONS CUP GROUPS (Season 1 placeholder draw)
-- ─────────────────────────────────────────────────────
-- In a real season the cup draw happens after the league phase concludes and
-- the top 2 finishers per league are known.  For Season 1 we seed placeholder
-- participants (the highest-capacity / most prestigious clubs from each league)
-- so the cup competition row is not empty.  Replace these rows after the
-- league phase is complete.
--   Group A: earth-united (RIL), olympus-mons (RIL), jupiter-titans (GGL), ganymede-united (GGL)
--   Group B: juno-city (ORL), ceres-miners (ORL), pluto-frost (KBL), charon-united (KBL)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── LEAGUES ──────────────────────────────────────────────────────────────────
INSERT INTO leagues (id, name, short_name, description) VALUES

  ('rocky-inner',
   'Rocky Inner League', 'RIL',
   'Founded in the earliest days of the ISL, the Rocky Inner League is the bedrock of interplanetary soccer—both literally and culturally. Born from humanity''s first intra-solar rivalries, its teams hail from the inner planets where soccer evolved under harsh environments and heavy gravity.'),

  ('gas-giants',
   'Gas/Ice Giants League', 'GGL',
   'The Gas Giants League emerged later, but quickly became a powerhouse of spectacle and innovation. With playfields suspended above clouds, wrapped around orbital rings, or drifting inside pressurised spheres, this league had to reinvent the sport.'),

  ('outer-reaches',
   'Outer Reaches League', 'ORL',
   'Cold, dark, and distant—these teams play like survivors. The Outer Reaches League thrives on underdog energy and raw ambition, featuring clubs from the asteroid belt between Mars and Jupiter.'),

  ('kuiper-belt',
   'Kuiper Belt League', 'KBL',
   'The most distant league in the ISL. Clubs from trans-Neptunian objects brave the deepest cold of the outer system. The longest travel distances in the ISL create unique home-advantage effects.')

ON CONFLICT (id) DO NOTHING;

-- ── TEAMS ────────────────────────────────────────────────────────────────────
-- Team IDs are text slugs matching leagueData.js so the front-end never needs
-- to translate between the two identifier systems.

-- Rocky Inner League — 8 clubs from the four inner rocky planets plus orbital colonies
INSERT INTO teams (id, league_id, name, location, home_ground, capacity, color, tagline) VALUES
  ('mercury-runners', 'rocky-inner', 'Mercury Runners FC',   'Mercury',                'Solar Sprint Stadium "The Heat Box"',     '35,000', '#CD7F32',
   'Notable for their extraordinary speed on the pitch.'),
  ('earth-united',    'rocky-inner', 'Earth United FC',      'Earth',                  'Blue Marble Arena "The Blue Marble"',     '95,000', '#4169E1',
   'The oldest club in the league with a balanced play style.'),
  ('venus-volcanic',  'rocky-inner', 'Venus Volcanic SC',    'Venus',                  'Pressure Cooker Stadium',                 '52,000', '#FF6B35',
   'Known for their aggressive pressing style.'),
  ('terra-nova',      'rocky-inner', 'Terra Nova SC',        'Earth',                  'The World Park "The Greenhouse"',         '58,000', '#A5D6A7',
   'Focused on youth development and attacking football.'),
  ('mars-athletic',   'rocky-inner', 'Mars Athletic',        'Mars',                   'Red Planet Arena "The Dust Bowl"',        '48,000', '#FF4500',
   'Disciplined defensive structure and counter-attacks.'),
  ('olympus-mons',    'rocky-inner', 'Olympus Mons FC',      'Mars',                   'Limeil Stadium "The Mountain"',           '89,000', '#CC4444',
   'Specialists in aerial duels.'),
  ('valles-mariners', 'rocky-inner', 'Valles Mariners SC',   'Mars',                   'Canyon Complex "The Trench"',             '61,000', '#8B4513',
   'Famous for technical midfielders and positional play.'),
  ('solar-city',      'rocky-inner', 'Solar City FC',        'Largest Orbital Colony', 'Orbital Stadium "The Ring"',              '72,000', '#FFD700',
   'A diverse team representing the largest inhabited colony.')
ON CONFLICT (id) DO NOTHING;

-- Gas/Ice Giants League — 8 clubs from Jupiter/Saturn moon systems, Uranus, Neptune
INSERT INTO teams (id, league_id, name, location, home_ground, capacity, color, tagline) VALUES
  ('jupiter-titans',     'gas-giants', 'Jupiter Titans FC',   'Jupiter',     'Storm Arena "The Red Spot"',              '110,000', '#D2691E',
   'Known for their physical power and fearsome defensive line.'),
  ('europa-oceanic',     'gas-giants', 'Europa Oceanic SC',   'Europa',      'Subsurface Stadium "The Ice Bowl"',        '53,000', '#87CEEB',
   'Pioneers of fluid football.'),
  ('ganymede-united',    'gas-giants', 'Ganymede United',     'Ganymede',    'Crater Fields "The Cradle"',               '67,000', '#708090',
   'Founded by miners; emphasises endurance.'),
  ('callisto-wolves',    'gas-giants', 'Callisto Wolves',     'Callisto',    'Frozen Plains Stadium "The Howling Den"',  '45,000', '#B0C4DE',
   'Famous for pack mentality and coordinated pressing.'),
  ('saturn-rings',       'gas-giants', 'Saturn Rings FC',     'Saturn Rings','Cassini Colosseum "The Halo"',             '65,000', '#9A5CF4',
   'Known for fluid movement and beautiful passing patterns.'),
  ('titan-methane',      'gas-giants', 'Titan Methane SC',    'Titan',       'Hydrocarbon Park "The Orange Haze"',       '46,000', '#FFA500',
   'Specialists in high-pressing games in thick atmosphere.'),
  ('enceladus-geysers',  'gas-giants', 'Enceladus Geysers',   'Enceladus',   'Geyser Stadium "The Spray"',               '38,000', '#E0F7FA',
   'Known for explosive counterattacks.'),
  ('uranus-sidewinders', 'gas-giants', 'Uranus Sidewinders',  'Uranus',      'Polar Tilt Arena "The Tilted Field"',      '55,000', '#40E0D0',
   'Famous for unpredictable play style.')
ON CONFLICT (id) DO NOTHING;

-- Outer Reaches League — 6 clubs from the asteroid belt between Mars and Jupiter
INSERT INTO teams (id, league_id, name, location, home_ground, capacity, color, tagline) VALUES
  ('ceres-miners',     'outer-reaches', 'Ceres Miners FC',  'Ceres',  'Dwarf Planet Field "The Rock"',        '29,000', '#8B7355',
   'Oldest and toughest club in the Asteroid Belt.'),
  ('vesta',            'outer-reaches', 'Vesta FC',         'Vesta',  'Protoplanet Arena "The Crater"',       '24,000', '#C0C0C0',
   'Masters of low-gravity football.'),
  ('pallas-wanderers', 'outer-reaches', 'Pallas Wanderers', 'Pallas', 'Nomad Stadium "The Drifter"',          '21,000', '#DEB887',
   'Known for adaptability in tactics.'),
  ('hygiea-united',    'outer-reaches', 'Hygiea United',    'Hygiea', 'Subterranean Field "The Dark Pitch"',  '18,000', '#696969',
   'Famous for solid defensive structures.'),
  ('psyche-metallics', 'outer-reaches', 'Psyche Metallics', 'Psyche', 'Core Ore Stadium "The Forge"',         '22,000', '#B8860B',
   'Known for physical strength and power.'),
  ('juno-city',        'outer-reaches', 'Juno City FC',     'Juno',   'Juno Memorial Stadium "The Temple"',   '31,000', '#9370DB',
   'Values discipline and tactical organisation.')
ON CONFLICT (id) DO NOTHING;

-- Kuiper Belt League — 6 clubs from trans-Neptunian objects
INSERT INTO teams (id, league_id, name, location, home_ground, capacity, color, tagline) VALUES
  ('pluto-frost',     'kuiper-belt', 'Pluto Frost FC',   'Pluto',    'Nitrogen Icebox "The Deep Freeze"',     '25,000', '#B0E0E6',
   'Former giants of outer solar system football.'),
  ('charon-united',   'kuiper-belt', 'Charon United',    'Charon',   'Binary Lagrange Arena "The Moon"',      '18,000', '#A9A9A9',
   'Developing their own identity.'),
  ('eris-wanderers',  'kuiper-belt', 'Eris Wanderers',   'Eris',     'Distant Objects Stadium "The Outpost"', '16,000', '#DDA0DD',
   'Most distant club in the league.'),
  ('haumea-spinners', 'kuiper-belt', 'Haumea Spinners',  'Haumea',   'Centrifuge Field "The Oval"',           '14,000', '#F0E68C',
   'Known for unusual elliptical wide-area play.'),
  ('makemake',        'kuiper-belt', 'Makemake FC',      'Makemake', 'Creation Stadium "The Cradle"',         '12,000', '#CD853F',
   'Specialists in creating chances from nothing.'),
  ('orcus-athletic',  'kuiper-belt', 'Orcus Athletic',   'Orcus',    'Underworld Arena "The Pit"',            '11,000', '#2F4F4F',
   'Dark horses who excel at free-kicks.')
ON CONFLICT (id) DO NOTHING;

-- ── SEASON 1 ─────────────────────────────────────────────────────────────────
-- Fixed UUID so downstream scripts can reference it without a lookup.
-- is_active = true; the partial unique index in schema.sql ensures only one
-- season can ever have this flag set.
INSERT INTO seasons (id, name, year, is_active, start_date, end_date)
VALUES (
  '00000000-0000-0000-0000-000000000001',  -- well-known Season 1 UUID
  'Season 1 — 2600',
  2600,
  true,
  '2600-01-01',
  '2600-12-31'
) ON CONFLICT (id) DO NOTHING;

-- ── SEASON 1 COMPETITIONS ─────────────────────────────────────────────────────
-- Fixed UUIDs in the 1000…-series for leagues, 2000…-series for cups,
-- keeping them visually distinct and easy to reference in scripts.
INSERT INTO competitions (id, season_id, league_id, name, type, format, status) VALUES

  -- Rocky Inner League S1 — 8 teams, home + away = 56 fixtures
  ('10000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001', 'rocky-inner',
   'Rocky Inner League — Season 1',
   'league', 'round_robin', 'upcoming'),

  -- Gas/Ice Giants League S1 — 8 teams, home + away = 56 fixtures
  ('10000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000001', 'gas-giants',
   'Gas/Ice Giants League — Season 1',
   'league', 'round_robin', 'upcoming'),

  -- Outer Reaches League S1 — 6 teams, home + away = 30 fixtures
  ('10000000-0000-0000-0000-000000000003',
   '00000000-0000-0000-0000-000000000001', 'outer-reaches',
   'Outer Reaches League — Season 1',
   'league', 'round_robin', 'upcoming'),

  -- Kuiper Belt League S1 — 6 teams, home + away = 30 fixtures
  ('10000000-0000-0000-0000-000000000004',
   '00000000-0000-0000-0000-000000000001', 'kuiper-belt',
   'Kuiper Belt League — Season 1',
   'league', 'round_robin', 'upcoming'),

  -- ISL Champions Cup S1 — cross-league, league_id = NULL
  -- format: 2 groups of 4 (group stage) → semi-finals → final = group_knockout
  -- top 2 per group advance; 2 semi-finals; 1 final = 13 cup matches total
  ('20000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001', NULL,
   'ISL Champions Cup — Season 1',
   'cup', 'group_knockout', 'upcoming')

ON CONFLICT (id) DO NOTHING;

-- ── COMPETITION TEAMS ────────────────────────────────────────────────────────

-- Rocky Inner League S1: all 8 RIL clubs
INSERT INTO competition_teams (competition_id, team_id) VALUES
  ('10000000-0000-0000-0000-000000000001', 'mercury-runners'),
  ('10000000-0000-0000-0000-000000000001', 'earth-united'),
  ('10000000-0000-0000-0000-000000000001', 'venus-volcanic'),
  ('10000000-0000-0000-0000-000000000001', 'terra-nova'),
  ('10000000-0000-0000-0000-000000000001', 'mars-athletic'),
  ('10000000-0000-0000-0000-000000000001', 'olympus-mons'),
  ('10000000-0000-0000-0000-000000000001', 'valles-mariners'),
  ('10000000-0000-0000-0000-000000000001', 'solar-city')
ON CONFLICT DO NOTHING;

-- Gas/Ice Giants League S1: all 8 GGL clubs
INSERT INTO competition_teams (competition_id, team_id) VALUES
  ('10000000-0000-0000-0000-000000000002', 'jupiter-titans'),
  ('10000000-0000-0000-0000-000000000002', 'europa-oceanic'),
  ('10000000-0000-0000-0000-000000000002', 'ganymede-united'),
  ('10000000-0000-0000-0000-000000000002', 'callisto-wolves'),
  ('10000000-0000-0000-0000-000000000002', 'saturn-rings'),
  ('10000000-0000-0000-0000-000000000002', 'titan-methane'),
  ('10000000-0000-0000-0000-000000000002', 'enceladus-geysers'),
  ('10000000-0000-0000-0000-000000000002', 'uranus-sidewinders')
ON CONFLICT DO NOTHING;

-- Outer Reaches League S1: all 6 ORL clubs
INSERT INTO competition_teams (competition_id, team_id) VALUES
  ('10000000-0000-0000-0000-000000000003', 'ceres-miners'),
  ('10000000-0000-0000-0000-000000000003', 'vesta'),
  ('10000000-0000-0000-0000-000000000003', 'pallas-wanderers'),
  ('10000000-0000-0000-0000-000000000003', 'hygiea-united'),
  ('10000000-0000-0000-0000-000000000003', 'psyche-metallics'),
  ('10000000-0000-0000-0000-000000000003', 'juno-city')
ON CONFLICT DO NOTHING;

-- Kuiper Belt League S1: all 6 KBL clubs
INSERT INTO competition_teams (competition_id, team_id) VALUES
  ('10000000-0000-0000-0000-000000000004', 'pluto-frost'),
  ('10000000-0000-0000-0000-000000000004', 'charon-united'),
  ('10000000-0000-0000-0000-000000000004', 'eris-wanderers'),
  ('10000000-0000-0000-0000-000000000004', 'haumea-spinners'),
  ('10000000-0000-0000-0000-000000000004', 'makemake'),
  ('10000000-0000-0000-0000-000000000004', 'orcus-athletic')
ON CONFLICT DO NOTHING;

-- ISL Champions Cup S1: 8 placeholder qualifiers, 2 groups of 4.
--
-- Group assignment logic for the real draw:
--   Top seed from each league → pot 1; 2nd seed → pot 2.
--   Draw ensures no two teams from the same league share a group.
--
-- Season 1 placeholder draw (by stadium capacity as a proxy for prestige):
--   Group A: earth-united (RIL, 95k), olympus-mons (RIL, 89k),
--            jupiter-titans (GGL, 110k), ganymede-united (GGL, 67k)
--   Group B: juno-city (ORL, 31k), ceres-miners (ORL, 29k),
--            pluto-frost (KBL, 25k), charon-united (KBL, 18k)
INSERT INTO competition_teams (competition_id, team_id, group_name, seeding) VALUES
  ('20000000-0000-0000-0000-000000000001', 'earth-united',    'Group A', 1),
  ('20000000-0000-0000-0000-000000000001', 'olympus-mons',    'Group A', 2),
  ('20000000-0000-0000-0000-000000000001', 'jupiter-titans',  'Group A', 3),
  ('20000000-0000-0000-0000-000000000001', 'ganymede-united', 'Group A', 4),
  ('20000000-0000-0000-0000-000000000001', 'juno-city',       'Group B', 1),
  ('20000000-0000-0000-0000-000000000001', 'ceres-miners',    'Group B', 2),
  ('20000000-0000-0000-0000-000000000001', 'pluto-frost',     'Group B', 3),
  ('20000000-0000-0000-0000-000000000001', 'charon-united',   'Group B', 4)
ON CONFLICT DO NOTHING;
