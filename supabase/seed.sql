-- ═══════════════════════════════════════════════════════════════════════════
-- ISL SEED DATA
-- ───────────────────────────────────────────────────────────────────────────
-- Run this AFTER schema.sql.  Every statement uses ON CONFLICT … DO NOTHING
-- so it is safe to re-run without creating duplicates.
--
-- WHAT THIS FILE SEEDS
-- ────────────────────
--   1. Four leagues (matching TEAMS_BY_LEAGUE keys in leagueData.js)
--   2. All 32 clubs across those four leagues
--   3. Season 1 (year 2600), marked as active
--   4. Five competitions for Season 1:
--        • Rocky Inner League S1        (league, round_robin, 8 teams)
--        • Gas/Ice Giants League S1     (league, round_robin, 8 teams)
--        • Outer Reaches League S1      (league, round_robin, 8 teams)
--        • Kuiper Belt League S1        (league, round_robin, 8 teams)
--        • ISL Champions Cup S1         (cup, group_knockout, 8 teams)
--   5. competition_teams rows for all five competitions
--   6. 512 players (32 teams × 16 players each):
--        • 11 starters per team: 1 GK, 4 DF, 3 MF, 3 FW  (starter = true)
--        • 5 bench per team:     1 GK, 2 DF, 1 MF, 1 FW  (starter = false)
--      Names are themed to each team's planet/location.
--      Saturn Rings FC uses the exact names from teams.js (the simulator file)
--      so the match simulator and roster browser show the same squad.
--      overall_rating range: 65–90 (starters avg ~81, bench avg ~74).
--
-- PLAYERS IDEMPOTENCY NOTE
-- ────────────────────────
-- Players use gen_random_uuid() so ON CONFLICT DO NOTHING cannot deduplicate
-- them by PK on re-run.  The players section therefore uses TRUNCATE before
-- the INSERT — safe to run on a fresh DB, but will wipe any live player data
-- (match_player_stats references players via FK; truncate cascade if needed).
--
-- LEAGUE ID NOTE
-- ──────────────
-- The DB uses 'kuiper-belt' as the 4th league id, matching TEAMS_BY_LEAGUE
-- in leagueData.js.  The old 'interstellar' placeholder has been removed.
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

-- Outer Reaches League — 8 clubs from the asteroid belt between Mars and Jupiter
INSERT INTO teams (id, league_id, name, location, home_ground, capacity, color, tagline, description) VALUES
  ('ceres-miners',     'outer-reaches', 'Ceres Miners FC',  'Ceres',  'Dwarf Planet Field "The Rock"',        '29,000', '#8B7355',
   'Oldest and toughest club in the Asteroid Belt.',
   'The Miners represent the grit and determination of the asteroid belt. Their grinding style of play wears down opponents like rock against rock.'),
  ('vesta',            'outer-reaches', 'Vesta FC',         'Vesta',  'Protoplanet Arena "The Crater"',       '24,000', '#C0C0C0',
   'Masters of low-gravity football.',
   'Vesta FC have mastered the art of football in low gravity. Their floating passing game and long-range shooting make them one of the most entertaining sides in the league.'),
  ('pallas-wanderers', 'outer-reaches', 'Pallas Wanderers', 'Pallas', 'Nomad Stadium "The Drifter"',          '21,000', '#DEB887',
   'Known for adaptability in tactics.',
   'The Wanderers live up to their name—they adapt their system each match, unpredictable and versatile in equal measure.'),
  ('hygiea-united',    'outer-reaches', 'Hygiea United',    'Hygiea', 'Subterranean Field "The Dark Pitch"',  '18,000', '#696969',
   'Famous for solid defensive structures.',
   'Playing in the darkest reaches of the asteroid belt, Hygiea United have built a fortress. Their defensive record is the best in the outer reaches.'),
  ('psyche-metallics', 'outer-reaches', 'Psyche Metallics', 'Psyche', 'Core Ore Stadium "The Forge"',         '22,000', '#B8860B',
   'Known for physical strength and power.',
   'Playing on a metallic asteroid has given the Metallics an almost supernatural physicality. They are the strongest side in the belt, pound for pound.'),
  ('juno-city',        'outer-reaches', 'Juno City FC',     'Juno',   'Juno Memorial Stadium "The Temple"',   '31,000', '#9370DB',
   'Values discipline and tactical organisation.',
   'Juno City FC are the most tactically disciplined club in the outer reaches. Their rigid organisational structure rarely concedes—or entertains—but delivers results.'),
  ('beltway',          'outer-reaches', 'Beltway FC',       'Asteroid Belt Colony', 'Transit Hub Arena "The Junction"', '19,000', '#4A4A8A',
   'Tactical and gritty, forged in the lawless belt colonies.',
   E'Born from the intersection of a dozen asteroid belt trade routes, Beltway FC represent the pragmatic, opportunistic spirit of colony life. Their tactics mirror the belt itself: adaptable, layered, and always looking for the gap. Formed by workers who played football in cargo bays and pressurised corridors, they carry a blue-collar heart into every match.\n\nWith the smallest budget in the Outer Reaches League, Beltway punch well above their weight through organised counterattacking and relentless set-piece preparation. The Junction has an atmosphere disproportionate to its size—belt colony fans are loud, passionate, and unafraid of a fight.'),
  ('solar-miners',     'outer-reaches', 'Solar Miners FC',  'Asteroid Belt Colony', 'Extraction Field "The Dig"',       '17,000', '#E8C84A',
   'They drill for every inch of the pitch.',
   E'Solar Miners FC channel the exhausting, relentless work ethic of asteroid mining operations directly into their football. They drill through defences, press without mercy, and never stop running—even when the match is lost. Originally a recreational side for workers at the Kepler-7 extraction colony, they earned promotion through sheer collective effort.\n\nPhysical and direct, Solar Miners rarely produce beautiful football—but they produce results. The Dig is an intimidating venue built partly underground in a decommissioned ore shaft, and visiting teams hate its uneven acoustics and faintly sulfurous atmosphere.')
ON CONFLICT (id) DO NOTHING;

-- Kuiper Belt League — 8 clubs from trans-Neptunian objects
INSERT INTO teams (id, league_id, name, location, home_ground, capacity, color, tagline, description) VALUES
  ('pluto-frost',     'kuiper-belt', 'Pluto Frost FC',   'Pluto',    'Nitrogen Icebox "The Deep Freeze"',     '25,000', '#B0E0E6',
   'Former giants of outer solar system football.',
   'Still mourning their planet''s demotion, Pluto Frost channel their righteous anger into football. They are perpetual underdogs with the spirit of former champions.'),
  ('charon-united',   'kuiper-belt', 'Charon United',    'Charon',   'Binary Lagrange Arena "The Moon"',      '18,000', '#A9A9A9',
   'Developing their own identity.',
   'Long overshadowed by their larger neighbour Pluto, Charon United are in the process of forging an identity entirely their own. A young club on the rise.'),
  ('eris-wanderers',  'kuiper-belt', 'Eris Wanderers',   'Eris',     'Distant Objects Stadium "The Outpost"', '16,000', '#DDA0DD',
   'Most distant club in the league.',
   'Eris Wanderers travel the longest distances for away matches, and it shows in their mental fortitude. No club trains harder between fixtures.'),
  ('haumea-spinners', 'kuiper-belt', 'Haumea Spinners',  'Haumea',   'Centrifuge Field "The Oval"',           '14,000', '#F0E68C',
   'Known for unusual elliptical wide-area play.',
   'Playing on Haumea''s egg-shaped surface has given the Spinners an eccentric wide-play style. Their wingers operate at unusual angles that disorient conventional defences.'),
  ('makemake',        'kuiper-belt', 'Makemake FC',      'Makemake', 'Creation Stadium "The Cradle"',         '12,000', '#CD853F',
   'Specialists in creating chances from nothing.',
   'As their planetary name suggests, Makemake FC are creators. Their attacking play conjures chances from almost nothing—one of the most inventive clubs in the ISL.'),
  ('orcus-athletic',  'kuiper-belt', 'Orcus Athletic',   'Orcus',    'Underworld Arena "The Pit"',            '11,000', '#2F4F4F',
   'Dark horses who excel at free-kicks.',
   'From the darkest corner of the Kuiper Belt, Orcus Athletic are the ultimate dark horse. Their dead-ball specialists have decided more matches than any other set-piece team in the league.'),
  ('sedna-mariners',  'kuiper-belt', 'Sedna FC Mariners','Sedna',    'Perihelion Park "The Long Way Round"',  '9,000',  '#8B0000',
   'The most patient team in the outer system.',
   E'Sedna FC Mariners play like their home world orbits: with vast, unhurried patience. Sedna''s extraordinary 11,400-year elliptical orbit has instilled in its inhabitants a philosophical relationship with time—and their football reflects it. They build slowly, absorb pressure without breaking, and strike only when the moment is certain.\n\nPerihelion Park is among the most remote stadiums in the known solar system, and home advantage here is almost mythological. Visiting teams must travel further than anyone else in the ISL, and they arrive already drained. The Mariners have never beaten a top-four side away from home—but they have never been relegated either.'),
  ('scattered-disc',  'kuiper-belt', 'Scattered Disc FC Rangers', 'Outer Kuiper Belt', 'Void Stadium "The Scatter"', '8,000', '#556B2F',
   'Wild, untamed football from the edge of everything.',
   E'Scattered Disc FC Rangers play from the absolute fringe of the solar system, in a region so loosely defined that cartographers argue about whether it technically exists. Their football is similarly hard to classify: chaotic, improvisational, and occasionally brilliant. Tactics arrive by committee, change at half-time, and are abandoned by the 70th minute.\n\nThe Void Stadium''s sparse attendance and enormous silence create a unique atmosphere—not intimidating so much as deeply unsettling. Opponents describe games there as "playing against the cosmos itself." In their few seasons in the Kuiper Belt League, the Rangers have delivered both the highest-scoring victory and the most embarrassing defeat in the division''s history.')
ON CONFLICT (id) DO NOTHING;

-- ── TEAM SHORT NAMES ─────────────────────────────────────────────────────────
-- 3-4 character abbreviations used by the match engine for scoreboard display
-- and event commentary (e.g. "MRC 2-1 SAT").  These UPDATE statements are
-- idempotent; re-running seed.sql will simply overwrite with the same values.
-- Missing short_name is the root cause of "undefined" appearing in match feed
-- commentary for DB-sourced teams, so every team must have a value here.
UPDATE teams SET short_name = 'MRC' WHERE id = 'mercury-runners';
UPDATE teams SET short_name = 'EUN' WHERE id = 'earth-united';
UPDATE teams SET short_name = 'VEN' WHERE id = 'venus-volcanic';
UPDATE teams SET short_name = 'TER' WHERE id = 'terra-nova';
UPDATE teams SET short_name = 'MAR' WHERE id = 'mars-athletic';
UPDATE teams SET short_name = 'OLY' WHERE id = 'olympus-mons';
UPDATE teams SET short_name = 'VAL' WHERE id = 'valles-mariners';
UPDATE teams SET short_name = 'SOL' WHERE id = 'solar-city';
UPDATE teams SET short_name = 'JUP' WHERE id = 'jupiter-titans';
UPDATE teams SET short_name = 'EUR' WHERE id = 'europa-oceanic';
UPDATE teams SET short_name = 'GAN' WHERE id = 'ganymede-united';
UPDATE teams SET short_name = 'CAL' WHERE id = 'callisto-wolves';
UPDATE teams SET short_name = 'SAT' WHERE id = 'saturn-rings';
UPDATE teams SET short_name = 'TTN' WHERE id = 'titan-methane';
UPDATE teams SET short_name = 'ENC' WHERE id = 'enceladus-geysers';
UPDATE teams SET short_name = 'URA' WHERE id = 'uranus-sidewinders';
UPDATE teams SET short_name = 'CER' WHERE id = 'ceres-miners';
UPDATE teams SET short_name = 'VES' WHERE id = 'vesta';
UPDATE teams SET short_name = 'PAL' WHERE id = 'pallas-wanderers';
UPDATE teams SET short_name = 'HYG' WHERE id = 'hygiea-united';
UPDATE teams SET short_name = 'PSY' WHERE id = 'psyche-metallics';
UPDATE teams SET short_name = 'JNO' WHERE id = 'juno-city';
UPDATE teams SET short_name = 'BLT' WHERE id = 'beltway';
UPDATE teams SET short_name = 'SMN' WHERE id = 'solar-miners';
UPDATE teams SET short_name = 'PLU' WHERE id = 'pluto-frost';
UPDATE teams SET short_name = 'CHR' WHERE id = 'charon-united';
UPDATE teams SET short_name = 'ERI' WHERE id = 'eris-wanderers';
UPDATE teams SET short_name = 'HAU' WHERE id = 'haumea-spinners';
UPDATE teams SET short_name = 'MAK' WHERE id = 'makemake';
UPDATE teams SET short_name = 'ORC' WHERE id = 'orcus-athletic';
UPDATE teams SET short_name = 'SDN' WHERE id = 'sedna-mariners';
UPDATE teams SET short_name = 'SCA' WHERE id = 'scattered-disc';

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

  -- Outer Reaches League S1 — 8 teams, home + away = 56 fixtures
  ('10000000-0000-0000-0000-000000000003',
   '00000000-0000-0000-0000-000000000001', 'outer-reaches',
   'Outer Reaches League — Season 1',
   'league', 'round_robin', 'upcoming'),

  -- Kuiper Belt League S1 — 8 teams, home + away = 56 fixtures
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

-- Outer Reaches League S1: all 8 ORL clubs
INSERT INTO competition_teams (competition_id, team_id) VALUES
  ('10000000-0000-0000-0000-000000000003', 'ceres-miners'),
  ('10000000-0000-0000-0000-000000000003', 'vesta'),
  ('10000000-0000-0000-0000-000000000003', 'pallas-wanderers'),
  ('10000000-0000-0000-0000-000000000003', 'hygiea-united'),
  ('10000000-0000-0000-0000-000000000003', 'psyche-metallics'),
  ('10000000-0000-0000-0000-000000000003', 'juno-city'),
  ('10000000-0000-0000-0000-000000000003', 'beltway'),
  ('10000000-0000-0000-0000-000000000003', 'solar-miners')
ON CONFLICT DO NOTHING;

-- Kuiper Belt League S1: all 8 KBL clubs
INSERT INTO competition_teams (competition_id, team_id) VALUES
  ('10000000-0000-0000-0000-000000000004', 'pluto-frost'),
  ('10000000-0000-0000-0000-000000000004', 'charon-united'),
  ('10000000-0000-0000-0000-000000000004', 'eris-wanderers'),
  ('10000000-0000-0000-0000-000000000004', 'haumea-spinners'),
  ('10000000-0000-0000-0000-000000000004', 'makemake'),
  ('10000000-0000-0000-0000-000000000004', 'orcus-athletic'),
  ('10000000-0000-0000-0000-000000000004', 'sedna-mariners'),
  ('10000000-0000-0000-0000-000000000004', 'scattered-disc')
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

-- ── PLAYERS ────────────────────────────────────────────────────────────────────────────
-- 704 players (32 teams × 22 each). TRUNCATE before insert keeps this
-- idempotent; CASCADE drops any match_player_stats referencing old UUIDs.
TRUNCATE TABLE players CASCADE;

INSERT INTO players (team_id, name, position, nationality, age, overall_rating, personality, starter) VALUES
-- earth-united
  ('earth-united','Liu Rashidi','FW','Earthian',22,89,'selfish',true),
  ('earth-united','Amara Kowalski','DF','Earthian',27,90,'lazy',true),
  ('earth-united','Kofi Costa','FW','Earthian',22,88,'balanced',true),
  ('earth-united','Liu Okafor','MF','Earthian',25,86,'team_player',true),
  ('earth-united','Priya Ito','GK','Earthian',26,85,'workhorse',true),
  ('earth-united','Helena Okonkwo','MF','Earthian',22,83,'workhorse',true),
  ('earth-united','Lena Rivera','DF','Earthian',29,82,'lazy',true),
  ('earth-united','Yusuf Park','DF','Earthian',26,80,'aggressive',true),
  ('earth-united','Isabel Fernandez','FW','Earthian',27,79,'aggressive',true),
  ('earth-united','Priya Sharma','MF','Earthian',24,77,'team_player',true),
  ('earth-united','Sam Park','DF','Earthian',24,76,'workhorse',true),
  ('earth-united','Sam Fernandez','MF','Earthian',20,78,'team_player',false),
  ('earth-united','Priya Liu','DF','Earthian',31,76,'workhorse',false),
  ('earth-united','Rafael Morales','FW','Earthian',21,76,'team_player',false),
  ('earth-united','Priya Costa','FW','Earthian',19,74,'aggressive',false),
  ('earth-united','Helena Martinez','MF','Earthian',33,74,'workhorse',false),
  ('earth-united','Emma Kovacs','DF','Earthian',33,71,'aggressive',false),
  ('earth-united','Sophie Costa','MF','Earthian',35,70,'team_player',false),
  ('earth-united','James Delgado','DF','Earthian',29,70,'aggressive',false),
  ('earth-united','Carlos Singh','GK','Earthian',24,69,'team_player',false),
  ('earth-united','Carlos Volkov','GK','Earthian',26,66,'balanced',false),
  ('earth-united','Amara Mehta','DF','Earthian',18,65,'aggressive',false),
-- mars-athletic
  ('mars-athletic','Flux Ito','MF','Martian',23,90,'balanced',true),
  ('mars-athletic','Lira Steele','GK','Martian',23,88,'team_player',true),
  ('mars-athletic','Blaze Voss','MF','Martian',30,86,'creative',true),
  ('mars-athletic','Red Ivanova','FW','Martian',28,85,'team_player',true),
  ('mars-athletic','Nova Kowalski','FW','Martian',22,85,'balanced',true),
  ('mars-athletic','Echo Diallo','DF','Martian',29,83,'team_player',true),
  ('mars-athletic','Zara Santos','FW','Martian',25,80,'aggressive',true),
  ('mars-athletic','Blaze Ferrara','DF','Martian',28,80,'workhorse',true),
  ('mars-athletic','Red Martinez','DF','Martian',22,78,'balanced',true),
  ('mars-athletic','Echo Patel','DF','Martian',22,78,'balanced',true),
  ('mars-athletic','Rift Wang','MF','Martian',21,76,'team_player',true),
  ('mars-athletic','Crater Ito','MF','Martian',19,78,'balanced',false),
  ('mars-athletic','Dash Suzuki','GK','Martian',21,76,'workhorse',false),
  ('mars-athletic','Dust Rivera','DF','Martian',24,74,'aggressive',false),
  ('mars-athletic','Iron Martinez','FW','Martian',31,75,'balanced',false),
  ('mars-athletic','Lira Kane','DF','Martian',35,72,'aggressive',false),
  ('mars-athletic','Rex Asante','FW','Martian',19,71,'team_player',false),
  ('mars-athletic','Nova Singh','DF','Martian',25,71,'team_player',false),
  ('mars-athletic','Flux Wei','MF','Martian',21,68,'balanced',false),
  ('mars-athletic','Crater Papadopoulos','GK','Martian',19,69,'cautious',false),
  ('mars-athletic','Sable Walker','MF','Martian',20,66,'creative',false),
  ('mars-athletic','Nova Fischer','DF','Martian',27,65,'team_player',false),
-- mercury-runners
  ('mercury-runners','Crest Okello','FW','Mercurian',25,90,'selfish',true),
  ('mercury-runners','Blaze Morales','DF','Mercurian',27,90,'aggressive',true),
  ('mercury-runners','Torch Rivera','FW','Mercurian',29,88,'balanced',true),
  ('mercury-runners','Blaze Ribeiro','DF','Mercurian',24,85,'workhorse',true),
  ('mercury-runners','Cinder Asante','MF','Mercurian',27,85,'balanced',true),
  ('mercury-runners','Solara Papadopoulos','DF','Mercurian',24,82,'aggressive',true),
  ('mercury-runners','Vela Ribeiro','DF','Mercurian',23,80,'balanced',true),
  ('mercury-runners','Nova Chandra','FW','Mercurian',21,79,'workhorse',true),
  ('mercury-runners','Vela Liu','MF','Mercurian',27,78,'creative',true),
  ('mercury-runners','Flash Morales','GK','Mercurian',23,78,'balanced',true),
  ('mercury-runners','Glow Volkov','MF','Mercurian',26,75,'creative',true),
  ('mercury-runners','Vela Rivera','DF','Mercurian',26,78,'team_player',false),
  ('mercury-runners','Spark Volkov','DF','Mercurian',34,78,'team_player',false),
  ('mercury-runners','Flare Delgado','FW','Mercurian',30,74,'aggressive',false),
  ('mercury-runners','Lumen Liu','GK','Mercurian',27,73,'cautious',false),
  ('mercury-runners','Prism Zhang','GK','Mercurian',19,74,'cautious',false),
  ('mercury-runners','Flare Ferrara','DF','Mercurian',33,72,'balanced',false),
  ('mercury-runners','Spark Ferrara','MF','Mercurian',18,69,'team_player',false),
  ('mercury-runners','Glow Andersen','DF','Mercurian',30,68,'balanced',false),
  ('mercury-runners','Pyro Fontaine','FW','Mercurian',21,68,'team_player',false),
  ('mercury-runners','Crest Costa','MF','Mercurian',24,66,'balanced',false),
  ('mercury-runners','Glow Kim','MF','Mercurian',19,66,'team_player',false),
-- olympus-mons
  ('olympus-mons','Ridge Martinez','FW','Martian',23,89,'aggressive',true),
  ('olympus-mons','Granite Voss','FW','Martian',22,88,'balanced',true),
  ('olympus-mons','Ash Delgado','GK','Martian',28,87,'balanced',true),
  ('olympus-mons','Basalt Osei','DF','Martian',26,85,'aggressive',true),
  ('olympus-mons','Caldera Brennan','MF','Martian',23,84,'balanced',true),
  ('olympus-mons','Peak Liu','MF','Martian',28,83,'team_player',true),
  ('olympus-mons','Ash Voss','FW','Martian',27,82,'balanced',true),
  ('olympus-mons','Summit Andersen','DF','Martian',22,79,'team_player',true),
  ('olympus-mons','Granite Ito','DF','Martian',22,79,'team_player',true),
  ('olympus-mons','Basalt Hashimoto','DF','Martian',29,76,'workhorse',true),
  ('olympus-mons','Flow Yamamoto','MF','Martian',24,76,'creative',true),
  ('olympus-mons','Peak Kim','MF','Martian',25,78,'team_player',false),
  ('olympus-mons','Flow Mensah','DF','Martian',30,76,'aggressive',false),
  ('olympus-mons','Magma Okafor','GK','Martian',28,75,'balanced',false),
  ('olympus-mons','Basalt Wang','DF','Martian',28,74,'aggressive',false),
  ('olympus-mons','Vent Fischer','GK','Martian',18,72,'balanced',false),
  ('olympus-mons','Cinder Patel','MF','Martian',35,71,'balanced',false),
  ('olympus-mons','Scoria Zhang','FW','Martian',26,70,'aggressive',false),
  ('olympus-mons','Heights Novak','FW','Martian',30,70,'balanced',false),
  ('olympus-mons','Magma Okello','DF','Martian',33,68,'workhorse',false),
  ('olympus-mons','Flow Cruz','MF','Martian',18,66,'balanced',false),
  ('olympus-mons','Flow Kowalski','DF','Martian',36,65,'balanced',false),
-- venus-volcanic
  ('venus-volcanic','Cyclone Yamamoto','GK','Venusian',22,90,'balanced',true),
  ('venus-volcanic','Cauldron Volkov','MF','Venusian',28,90,'creative',true),
  ('venus-volcanic','Cauldron Patel','MF','Venusian',28,86,'lazy',true),
  ('venus-volcanic','Ruby Kovacs','FW','Venusian',28,85,'aggressive',true),
  ('venus-volcanic','Cauldron Chandra','FW','Venusian',26,85,'aggressive',true),
  ('venus-volcanic','Siren Santos','MF','Venusian',28,84,'creative',true),
  ('venus-volcanic','Kiln Mensah','DF','Venusian',28,80,'aggressive',true),
  ('venus-volcanic','Glass Steele','DF','Venusian',22,81,'aggressive',true),
  ('venus-volcanic','Cauldron Fontaine','FW','Venusian',24,79,'balanced',true),
  ('venus-volcanic','Haze Morales','DF','Venusian',22,78,'aggressive',true),
  ('venus-volcanic','Cyclone Singh','DF','Venusian',29,76,'team_player',true),
  ('venus-volcanic','Corona Sato','DF','Venusian',19,77,'balanced',false),
  ('venus-volcanic','Cauldron Obi','MF','Venusian',27,76,'creative',false),
  ('venus-volcanic','Siren Nkosi','FW','Venusian',22,75,'balanced',false),
  ('venus-volcanic','Haze Ito','DF','Venusian',18,73,'workhorse',false),
  ('venus-volcanic','Haze Kane','GK','Venusian',28,74,'workhorse',false),
  ('venus-volcanic','Siren Park','MF','Venusian',18,73,'workhorse',false),
  ('venus-volcanic','Corona Lee','DF','Venusian',28,70,'balanced',false),
  ('venus-volcanic','Siren Andersen','MF','Venusian',21,68,'balanced',false),
  ('venus-volcanic','Ruby Obi','GK','Venusian',19,68,'cautious',false),
  ('venus-volcanic','Ash Kane','FW','Venusian',36,66,'selfish',false),
  ('venus-volcanic','Magma Patel','DF','Venusian',21,66,'workhorse',false),
-- terra-nova
  ('terra-nova','Rowan Cruz','DF','Earthian',26,89,'balanced',true),
  ('terra-nova','Moss Kowalski','DF','Earthian',34,89,'workhorse',true),
  ('terra-nova','Moss Petrov','DF','Earthian',25,87,'aggressive',true),
  ('terra-nova','Juniper Fernandez','MF','Earthian',27,87,'balanced',true),
  ('terra-nova','Meadow Okonkwo','MF','Earthian',27,84,'creative',true),
  ('terra-nova','Juniper Ivanova','DF','Earthian',23,83,'workhorse',true),
  ('terra-nova','Fern Sato','GK','Earthian',23,81,'balanced',true),
  ('terra-nova','Fern Torres','FW','Earthian',26,79,'workhorse',true),
  ('terra-nova','Orchid Mensah','FW','Earthian',23,78,'selfish',true),
  ('terra-nova','Leaf Kovacs','FW','Earthian',34,77,'team_player',true),
  ('terra-nova','Laurel Kovacs','MF','Earthian',29,75,'creative',true),
  ('terra-nova','Rowan Park','DF','Earthian',34,78,'balanced',false),
  ('terra-nova','Sage Kane','GK','Earthian',19,78,'cautious',false),
  ('terra-nova','Elm Andersen','GK','Earthian',23,74,'cautious',false),
  ('terra-nova','Wren Costa','MF','Earthian',27,75,'balanced',false),
  ('terra-nova','Cedar Zhang','DF','Earthian',18,74,'aggressive',false),
  ('terra-nova','Fern Osei','MF','Earthian',27,71,'creative',false),
  ('terra-nova','Cedar Patel','DF','Earthian',32,69,'aggressive',false),
  ('terra-nova','Sage Kowalski','MF','Earthian',21,69,'lazy',false),
  ('terra-nova','Orchid Wei','FW','Earthian',25,69,'selfish',false),
  ('terra-nova','Leaf Singh','FW','Earthian',18,66,'selfish',false),
  ('terra-nova','Reed Walker','DF','Earthian',23,66,'balanced',false),
-- valles-mariners
  ('valles-mariners','Canyon Morales','MF','Martian',23,89,'balanced',true),
  ('valles-mariners','Echo Cruz','FW','Martian',28,88,'aggressive',true),
  ('valles-mariners','Echo Novak','DF','Martian',26,88,'balanced',true),
  ('valles-mariners','Deep Wei','DF','Martian',20,87,'balanced',true),
  ('valles-mariners','Silent Nakamura','DF','Martian',24,85,'balanced',true),
  ('valles-mariners','Narrow Fontaine','FW','Martian',20,84,'aggressive',true),
  ('valles-mariners','Mesa Suzuki','MF','Martian',27,82,'workhorse',true),
  ('valles-mariners','Mesa Adeyemi','MF','Martian',27,80,'lazy',true),
  ('valles-mariners','Mesa Novak','DF','Martian',24,79,'workhorse',true),
  ('valles-mariners','Canyon Hartmann','GK','Martian',23,78,'cautious',true),
  ('valles-mariners','Dust Nakamura','FW','Martian',28,76,'aggressive',true),
  ('valles-mariners','Depth Liu','FW','Martian',18,78,'team_player',false),
  ('valles-mariners','Wind Fontaine','DF','Martian',32,76,'lazy',false),
  ('valles-mariners','Chasm Kowalski','GK','Martian',30,74,'workhorse',false),
  ('valles-mariners','Deep Martinez','MF','Martian',21,75,'balanced',false),
  ('valles-mariners','Abyss Park','DF','Martian',32,74,'team_player',false),
  ('valles-mariners','Rim Hartmann','GK','Martian',32,72,'balanced',false),
  ('valles-mariners','Canyon Okafor','DF','Martian',24,70,'aggressive',false),
  ('valles-mariners','Shale Ferreira','DF','Martian',30,68,'aggressive',false),
  ('valles-mariners','Gorge Kim','MF','Martian',36,68,'balanced',false),
  ('valles-mariners','Dust Rivera','MF','Martian',27,65,'creative',false),
  ('valles-mariners','Gorge Suzuki','FW','Martian',25,65,'selfish',false),
-- solar-city
  ('solar-city','Halo Patel','FW','Orbital Colonist',28,89,'selfish',true),
  ('solar-city','Perigee Rashidi','DF','Orbital Colonist',22,88,'balanced',true),
  ('solar-city','Mercury Zhang','DF','Orbital Colonist',27,86,'team_player',true),
  ('solar-city','Axis Andersen','FW','Orbital Colonist',25,86,'selfish',true),
  ('solar-city','Orbit Ferreira','DF','Orbital Colonist',29,84,'balanced',true),
  ('solar-city','Stardust Ivanova','DF','Orbital Colonist',27,82,'balanced',true),
  ('solar-city','Dawn Brennan','MF','Orbital Colonist',22,82,'team_player',true),
  ('solar-city','Dawn Yamamoto','FW','Orbital Colonist',30,81,'selfish',true),
  ('solar-city','Comet Steele','MF','Orbital Colonist',29,77,'creative',true),
  ('solar-city','Mercury Diallo','MF','Orbital Colonist',34,77,'balanced',true),
  ('solar-city','Photon Park','GK','Orbital Colonist',27,75,'workhorse',true),
  ('solar-city','Dawn Lee','GK','Orbital Colonist',31,77,'balanced',false),
  ('solar-city','Orbit Volkov','DF','Orbital Colonist',29,77,'balanced',false),
  ('solar-city','Orbit Wang','DF','Orbital Colonist',19,75,'workhorse',false),
  ('solar-city','Apogee Kowalski','DF','Orbital Colonist',19,75,'balanced',false),
  ('solar-city','Lumen Ferreira','MF','Orbital Colonist',20,73,'creative',false),
  ('solar-city','Comet Hartmann','FW','Orbital Colonist',21,72,'aggressive',false),
  ('solar-city','Solstice Hashimoto','FW','Orbital Colonist',21,69,'aggressive',false),
  ('solar-city','Mercury Park','MF','Orbital Colonist',21,70,'creative',false),
  ('solar-city','Beacon Nkosi','MF','Orbital Colonist',19,67,'balanced',false),
  ('solar-city','Aurora Ribeiro','DF','Orbital Colonist',25,66,'team_player',false),
  ('solar-city','Mercury Brennan','GK','Orbital Colonist',22,65,'team_player',false),
-- jupiter-titans
  ('jupiter-titans','Maelstrom Morales','DF','Jovian',27,89,'team_player',true),
  ('jupiter-titans','Cyclone Nakamura','MF','Jovian',23,90,'balanced',true),
  ('jupiter-titans','Rumble Steele','DF','Jovian',26,88,'team_player',true),
  ('jupiter-titans','Crash Torres','DF','Jovian',29,87,'workhorse',true),
  ('jupiter-titans','Storm Singh','FW','Jovian',23,83,'balanced',true),
  ('jupiter-titans','Gust Rivera','DF','Jovian',23,82,'team_player',true),
  ('jupiter-titans','Cyclone Wei','FW','Jovian',29,82,'workhorse',true),
  ('jupiter-titans','Surge Liu','FW','Jovian',29,81,'aggressive',true),
  ('jupiter-titans','Lightning Obi','MF','Jovian',26,78,'workhorse',true),
  ('jupiter-titans','Roar Wei','MF','Jovian',22,77,'balanced',true),
  ('jupiter-titans','Fury Okonkwo','GK','Jovian',22,76,'cautious',true),
  ('jupiter-titans','Cascade Okello','GK','Jovian',33,78,'balanced',false),
  ('jupiter-titans','Bolt Suzuki','MF','Jovian',20,76,'workhorse',false),
  ('jupiter-titans','Roar Zhang','MF','Jovian',31,75,'creative',false),
  ('jupiter-titans','Crash Okafor','DF','Jovian',27,73,'balanced',false),
  ('jupiter-titans','Roar Liu','FW','Jovian',21,72,'team_player',false),
  ('jupiter-titans','Cascade Novak','DF','Jovian',20,71,'team_player',false),
  ('jupiter-titans','Thunder Tanaka','MF','Jovian',21,71,'team_player',false),
  ('jupiter-titans','Surge Rao','DF','Jovian',28,69,'team_player',false),
  ('jupiter-titans','Thunder Sharma','FW','Jovian',25,69,'selfish',false),
  ('jupiter-titans','Roar Vasquez','GK','Jovian',20,65,'cautious',false),
  ('jupiter-titans','Crash Park','DF','Jovian',29,66,'workhorse',false),
-- europa-oceanic
  ('europa-oceanic','Fluke Tanaka','DF','Europan',23,89,'team_player',true),
  ('europa-oceanic','Wave Asante','DF','Europan',26,88,'balanced',true),
  ('europa-oceanic','Kelp Kovacs','MF','Europan',26,88,'balanced',true),
  ('europa-oceanic','Glaze Singh','FW','Europan',27,86,'selfish',true),
  ('europa-oceanic','Current Vasquez','FW','Europan',25,85,'workhorse',true),
  ('europa-oceanic','Swell Nakamura','GK','Europan',26,83,'cautious',true),
  ('europa-oceanic','Lagoon Andersen','MF','Europan',22,81,'creative',true),
  ('europa-oceanic','Current Hartmann','DF','Europan',24,80,'balanced',true),
  ('europa-oceanic','Tide Ivanova','DF','Europan',28,79,'balanced',true),
  ('europa-oceanic','Shoal Rashidi','FW','Europan',25,78,'balanced',true),
  ('europa-oceanic','Current Park','MF','Europan',22,76,'team_player',true),
  ('europa-oceanic','Swell Fontaine','MF','Europan',34,78,'balanced',false),
  ('europa-oceanic','Crest Walker','MF','Europan',20,77,'creative',false),
  ('europa-oceanic','Marina Suzuki','DF','Europan',27,76,'aggressive',false),
  ('europa-oceanic','Glacier Wei','DF','Europan',29,75,'workhorse',false),
  ('europa-oceanic','Abyss Lee','DF','Europan',18,74,'workhorse',false),
  ('europa-oceanic','Current Ribeiro','GK','Europan',18,73,'balanced',false),
  ('europa-oceanic','Frost Adeyemi','FW','Europan',20,69,'selfish',false),
  ('europa-oceanic','Lagoon Martinez','GK','Europan',21,68,'cautious',false),
  ('europa-oceanic','Delta Santos','DF','Europan',21,67,'team_player',false),
  ('europa-oceanic','Frost Rashidi','FW','Europan',22,65,'balanced',false),
  ('europa-oceanic','Glaze Yamamoto','MF','Europan',28,65,'workhorse',false),
-- ganymede-united
  ('ganymede-united','Ore Rashidi','MF','Ganymedean',20,90,'creative',true),
  ('ganymede-united','Rubble Park','MF','Ganymedean',20,90,'team_player',true),
  ('ganymede-united','Crag Tanaka','DF','Ganymedean',28,86,'team_player',true),
  ('ganymede-united','Bedrock Nakamura','MF','Ganymedean',22,85,'creative',true),
  ('ganymede-united','Hammer Vasquez','GK','Ganymedean',27,85,'balanced',true),
  ('ganymede-united','Basalt Chandra','DF','Ganymedean',25,83,'aggressive',true),
  ('ganymede-united','Quarry Chandra','DF','Ganymedean',23,80,'lazy',true),
  ('ganymede-united','Shard Ito','DF','Ganymedean',26,81,'aggressive',true),
  ('ganymede-united','Quarry Okello','FW','Ganymedean',22,77,'selfish',true),
  ('ganymede-united','Pike Vasquez','FW','Ganymedean',26,78,'selfish',true),
  ('ganymede-united','Grit Mehta','FW','Ganymedean',28,76,'aggressive',true),
  ('ganymede-united','Shard Rashidi','DF','Ganymedean',19,77,'workhorse',false),
  ('ganymede-united','Chrome Lee','DF','Ganymedean',21,76,'aggressive',false),
  ('ganymede-united','Chisel Morales','FW','Ganymedean',31,76,'balanced',false),
  ('ganymede-united','Bedrock Torres','DF','Ganymedean',34,73,'balanced',false),
  ('ganymede-united','Ore Zhang','GK','Ganymedean',33,72,'balanced',false),
  ('ganymede-united','Anvil Osei','DF','Ganymedean',19,72,'aggressive',false),
  ('ganymede-united','Quarry Delgado','GK','Ganymedean',21,71,'balanced',false),
  ('ganymede-united','Rubble Sato','MF','Ganymedean',33,70,'balanced',false),
  ('ganymede-united','Chisel Mehta','MF','Ganymedean',27,68,'creative',false),
  ('ganymede-united','Quarry Kovacs','FW','Ganymedean',27,67,'workhorse',false),
  ('ganymede-united','Hammer Kowalski','MF','Ganymedean',34,66,'workhorse',false),
-- callisto-wolves
  ('callisto-wolves','Hunter Tanaka','FW','Callistoan',29,89,'selfish',true),
  ('callisto-wolves','Predator Diallo','DF','Callistoan',34,89,'aggressive',true),
  ('callisto-wolves','Lupin Hartmann','FW','Callistoan',22,86,'balanced',true),
  ('callisto-wolves','Frost Andersen','DF','Callistoan',29,85,'balanced',true),
  ('callisto-wolves','Moon Rivera','MF','Callistoan',27,83,'creative',true),
  ('callisto-wolves','Moon Martinez','DF','Callistoan',28,84,'workhorse',true),
  ('callisto-wolves','Prowl Suzuki','DF','Callistoan',26,82,'balanced',true),
  ('callisto-wolves','Fang Ferreira','GK','Callistoan',29,79,'balanced',true),
  ('callisto-wolves','Maul Petrov','MF','Callistoan',26,78,'creative',true),
  ('callisto-wolves','Maul Mensah','FW','Callistoan',30,76,'aggressive',true),
  ('callisto-wolves','Predator Steele','MF','Callistoan',30,75,'balanced',true),
  ('callisto-wolves','Silent Cruz','MF','Callistoan',36,77,'team_player',false),
  ('callisto-wolves','Lupin Petrov','DF','Callistoan',24,78,'balanced',false),
  ('callisto-wolves','Maul Adeyemi','GK','Callistoan',19,76,'balanced',false),
  ('callisto-wolves','Howl Rashidi','DF','Callistoan',22,74,'aggressive',false),
  ('callisto-wolves','Howl Steele','FW','Callistoan',30,73,'team_player',false),
  ('callisto-wolves','Silent Ferreira','DF','Callistoan',32,72,'balanced',false),
  ('callisto-wolves','Prowl Liu','MF','Callistoan',19,71,'balanced',false),
  ('callisto-wolves','Stalker Santos','GK','Callistoan',20,70,'cautious',false),
  ('callisto-wolves','Stalker Andersen','FW','Callistoan',18,69,'aggressive',false),
  ('callisto-wolves','Fang Papadopoulos','MF','Callistoan',18,66,'balanced',false),
  ('callisto-wolves','Stalker Steele','DF','Callistoan',18,66,'workhorse',false),
-- saturn-rings
  ('saturn-rings','Cosmo Vasquez','MF','Saturnian',23,89,'team_player',true),
  ('saturn-rings','Vesper Fischer','FW','Saturnian',29,88,'selfish',true),
  ('saturn-rings','Halcyon Fontaine','GK','Saturnian',25,88,'balanced',true),
  ('saturn-rings','Cosmo Steele','DF','Saturnian',22,87,'workhorse',true),
  ('saturn-rings','Crown Liu','DF','Saturnian',27,85,'workhorse',true),
  ('saturn-rings','Astra Ribeiro','FW','Saturnian',27,84,'aggressive',true),
  ('saturn-rings','Nebula Suzuki','DF','Saturnian',25,82,'aggressive',true),
  ('saturn-rings','Halo Walker','MF','Saturnian',34,80,'team_player',true),
  ('saturn-rings','Orbit Petrov','FW','Saturnian',29,77,'team_player',true),
  ('saturn-rings','Ringo Osei','MF','Saturnian',23,76,'balanced',true),
  ('saturn-rings','Astra Yamamoto','DF','Saturnian',28,76,'balanced',true),
  ('saturn-rings','Ringo Wei','FW','Saturnian',25,78,'team_player',false),
  ('saturn-rings','Helios Torres','DF','Saturnian',19,77,'aggressive',false),
  ('saturn-rings','Nebula Mensah','MF','Saturnian',32,75,'team_player',false),
  ('saturn-rings','Diadem Wei','MF','Saturnian',33,75,'creative',false),
  ('saturn-rings','Nebula Fernandez','DF','Saturnian',19,72,'workhorse',false),
  ('saturn-rings','Nebula Wei','DF','Saturnian',26,72,'workhorse',false),
  ('saturn-rings','Ringo Cruz','DF','Saturnian',25,70,'lazy',false),
  ('saturn-rings','Arc Cruz','FW','Saturnian',26,70,'selfish',false),
  ('saturn-rings','Orbit Wang','GK','Saturnian',33,69,'balanced',false),
  ('saturn-rings','Diadem Kim','GK','Saturnian',30,67,'team_player',false),
  ('saturn-rings','Rondo Osei','MF','Saturnian',32,66,'creative',false),
-- titan-methane
  ('titan-methane','Brume Okello','MF','Titanian',29,89,'creative',true),
  ('titan-methane','Mist Yamamoto','MF','Titanian',28,90,'workhorse',true),
  ('titan-methane','Fog Volkov','FW','Titanian',24,87,'balanced',true),
  ('titan-methane','Smog Yamamoto','GK','Titanian',31,87,'balanced',true),
  ('titan-methane','Brume Nkosi','DF','Titanian',20,84,'aggressive',true),
  ('titan-methane','Aether Volkov','DF','Titanian',24,84,'lazy',true),
  ('titan-methane','Methyl Wei','DF','Titanian',33,81,'aggressive',true),
  ('titan-methane','Cloud Rao','FW','Titanian',34,79,'balanced',true),
  ('titan-methane','Drift Morales','DF','Titanian',25,78,'balanced',true),
  ('titan-methane','Methyl Vasquez','FW','Titanian',28,76,'balanced',true),
  ('titan-methane','Drift Novak','MF','Titanian',24,76,'creative',true),
  ('titan-methane','Mist Osei','DF','Titanian',22,78,'aggressive',false),
  ('titan-methane','Gas Okello','FW','Titanian',18,77,'selfish',false),
  ('titan-methane','Reek Patel','DF','Titanian',18,74,'aggressive',false),
  ('titan-methane','Thick Wang','DF','Titanian',32,73,'aggressive',false),
  ('titan-methane','Orange Mensah','MF','Titanian',29,74,'creative',false),
  ('titan-methane','Hydro Mensah','GK','Titanian',23,73,'cautious',false),
  ('titan-methane','Brume Ferreira','GK','Titanian',21,69,'balanced',false),
  ('titan-methane','Aether Singh','FW','Titanian',27,68,'workhorse',false),
  ('titan-methane','Methyl Patel','DF','Titanian',21,69,'aggressive',false),
  ('titan-methane','Reek Volkov','MF','Titanian',30,66,'balanced',false),
  ('titan-methane','Thick Okonkwo','MF','Titanian',18,65,'creative',false),
-- enceladus-geysers
  ('enceladus-geysers','Geyser Liu','FW','Enceladean',22,90,'workhorse',true),
  ('enceladus-geysers','Frost Park','FW','Enceladean',23,90,'workhorse',true),
  ('enceladus-geysers','Droplet Fontaine','DF','Enceladean',31,87,'balanced',true),
  ('enceladus-geysers','Fountain Wang','FW','Enceladean',23,86,'team_player',true),
  ('enceladus-geysers','Spritz Kim','MF','Enceladean',22,84,'team_player',true),
  ('enceladus-geysers','Sleet Okonkwo','MF','Enceladean',25,82,'balanced',true),
  ('enceladus-geysers','Droplet Wei','DF','Enceladean',27,81,'aggressive',true),
  ('enceladus-geysers','Crystal Yamamoto','MF','Enceladean',28,80,'creative',true),
  ('enceladus-geysers','Plume Costa','GK','Enceladean',25,79,'balanced',true),
  ('enceladus-geysers','Frost Mehta','DF','Enceladean',28,76,'balanced',true),
  ('enceladus-geysers','Rime Osei','DF','Enceladean',25,76,'workhorse',true),
  ('enceladus-geysers','Fountain Kane','MF','Enceladean',24,78,'team_player',false),
  ('enceladus-geysers','Spritz Vasquez','FW','Enceladean',21,77,'team_player',false),
  ('enceladus-geysers','Jet Okello','DF','Enceladean',21,76,'aggressive',false),
  ('enceladus-geysers','Eruption Voss','MF','Enceladean',36,74,'creative',false),
  ('enceladus-geysers','Spray Rivera','GK','Enceladean',18,73,'team_player',false),
  ('enceladus-geysers','Prism Rivera','DF','Enceladean',21,72,'lazy',false),
  ('enceladus-geysers','Plume Yamamoto','GK','Enceladean',24,69,'team_player',false),
  ('enceladus-geysers','Rime Kim','FW','Enceladean',19,69,'workhorse',false),
  ('enceladus-geysers','Ice Ito','DF','Enceladean',22,69,'workhorse',false),
  ('enceladus-geysers','Spritz Andersen','DF','Enceladean',27,67,'aggressive',false),
  ('enceladus-geysers','Steam Ribeiro','MF','Enceladean',21,65,'creative',false),
-- uranus-sidewinders
  ('uranus-sidewinders','Pivot Torres','DF','Uranian',28,89,'aggressive',true),
  ('uranus-sidewinders','Spiral Costa','FW','Uranian',22,88,'selfish',true),
  ('uranus-sidewinders','Pivot Papadopoulos','FW','Uranian',22,87,'balanced',true),
  ('uranus-sidewinders','Axis Brennan','MF','Uranian',27,86,'team_player',true),
  ('uranus-sidewinders','Turn Singh','MF','Uranian',24,83,'team_player',true),
  ('uranus-sidewinders','Slant Asante','DF','Uranian',28,84,'aggressive',true),
  ('uranus-sidewinders','Wobble Singh','MF','Uranian',29,81,'lazy',true),
  ('uranus-sidewinders','Swerve Santos','GK','Uranian',28,79,'balanced',true),
  ('uranus-sidewinders','Drift Mensah','DF','Uranian',24,79,'aggressive',true),
  ('uranus-sidewinders','Yaw Kowalski','DF','Uranian',29,78,'aggressive',true),
  ('uranus-sidewinders','Yaw Cruz','FW','Uranian',24,75,'team_player',true),
  ('uranus-sidewinders','Bank Mehta','MF','Uranian',19,78,'workhorse',false),
  ('uranus-sidewinders','Lean Singh','DF','Uranian',20,76,'balanced',false),
  ('uranus-sidewinders','Cant Mensah','DF','Uranian',18,74,'aggressive',false),
  ('uranus-sidewinders','Skew Fischer','MF','Uranian',26,73,'workhorse',false),
  ('uranus-sidewinders','Rotate Ito','DF','Uranian',22,72,'workhorse',false),
  ('uranus-sidewinders','Twist Sharma','GK','Uranian',19,73,'team_player',false),
  ('uranus-sidewinders','Pivot Petrov','FW','Uranian',18,69,'selfish',false),
  ('uranus-sidewinders','Cant Chen','FW','Uranian',21,69,'team_player',false),
  ('uranus-sidewinders','Spiral Santos','MF','Uranian',22,67,'balanced',false),
  ('uranus-sidewinders','Skew Martinez','GK','Uranian',19,67,'cautious',false),
  ('uranus-sidewinders','Bank Nkosi','DF','Uranian',18,65,'team_player',false),
-- ceres-miners
  ('ceres-miners','Quartz Suzuki','FW','Cerean',32,90,'aggressive',true),
  ('ceres-miners','Stone Patel','DF','Cerean',28,90,'balanced',true),
  ('ceres-miners','Basin Morales','FW','Cerean',29,87,'workhorse',true),
  ('ceres-miners','Ridge Hashimoto','GK','Cerean',29,86,'balanced',true),
  ('ceres-miners','Ridge Park','MF','Cerean',25,84,'balanced',true),
  ('ceres-miners','Quartz Wei','DF','Cerean',21,82,'aggressive',true),
  ('ceres-miners','Chalk Delgado','MF','Cerean',22,80,'balanced',true),
  ('ceres-miners','Stone Yamamoto','MF','Cerean',27,81,'lazy',true),
  ('ceres-miners','Scree Chandra','FW','Cerean',28,79,'selfish',true),
  ('ceres-miners','Slate Ferrara','DF','Cerean',34,77,'balanced',true),
  ('ceres-miners','Quartz Novak','DF','Cerean',26,76,'workhorse',true),
  ('ceres-miners','Cinder Steele','FW','Cerean',18,78,'team_player',false),
  ('ceres-miners','Cinder Mehta','MF','Cerean',28,76,'balanced',false),
  ('ceres-miners','Quartz Fischer','DF','Cerean',36,74,'balanced',false),
  ('ceres-miners','Cinder Nkosi','DF','Cerean',25,73,'balanced',false),
  ('ceres-miners','Ledge Voss','GK','Cerean',21,73,'workhorse',false),
  ('ceres-miners','Quartz Adeyemi','GK','Cerean',20,73,'balanced',false),
  ('ceres-miners','Slate Sato','MF','Cerean',18,71,'balanced',false),
  ('ceres-miners','Ledge Obi','DF','Cerean',18,70,'aggressive',false),
  ('ceres-miners','Ledge Diallo','DF','Cerean',29,68,'workhorse',false),
  ('ceres-miners','Cinder Costa','FW','Cerean',27,67,'workhorse',false),
  ('ceres-miners','Crater Kane','MF','Cerean',26,65,'team_player',false),
-- vesta
  ('vesta','Aero Park','DF','Vestan',22,89,'team_player',true),
  ('vesta','Puff Ribeiro','MF','Vestan',25,89,'creative',true),
  ('vesta','Aero Delgado','FW','Vestan',27,86,'aggressive',true),
  ('vesta','Gossamer Rivera','DF','Vestan',24,87,'balanced',true),
  ('vesta','Breeze Okonkwo','MF','Vestan',29,83,'balanced',true),
  ('vesta','Wisp Torres','FW','Vestan',28,84,'selfish',true),
  ('vesta','Breeze Santos','DF','Vestan',25,81,'balanced',true),
  ('vesta','Svelte Singh','FW','Vestan',29,80,'selfish',true),
  ('vesta','Aero Kowalski','GK','Vestan',23,78,'workhorse',true),
  ('vesta','Gossamer Fernandez','DF','Vestan',27,77,'balanced',true),
  ('vesta','Feather Chandra','MF','Vestan',23,75,'balanced',true),
  ('vesta','Puff Voss','MF','Vestan',32,77,'creative',false),
  ('vesta','Lift Fontaine','DF','Vestan',21,78,'aggressive',false),
  ('vesta','Puff Hartmann','FW','Vestan',29,75,'selfish',false),
  ('vesta','Feather Mensah','MF','Vestan',30,75,'balanced',false),
  ('vesta','Gossamer Kim','DF','Vestan',18,74,'lazy',false),
  ('vesta','Airy Nakamura','DF','Vestan',28,72,'aggressive',false),
  ('vesta','Glide Costa','GK','Vestan',23,70,'team_player',false),
  ('vesta','Weightless Diallo','DF','Vestan',35,70,'team_player',false),
  ('vesta','Gossamer Mehta','MF','Vestan',28,67,'team_player',false),
  ('vesta','Svelte Fontaine','GK','Vestan',35,65,'cautious',false),
  ('vesta','Float Chen','FW','Vestan',26,65,'balanced',false),
-- pallas-wanderers
  ('pallas-wanderers','Errant Kane','DF','Palladian',29,89,'lazy',true),
  ('pallas-wanderers','Traveler Ferreira','MF','Palladian',29,90,'team_player',true),
  ('pallas-wanderers','Nomad Kim','GK','Palladian',29,87,'cautious',true),
  ('pallas-wanderers','Errant Voss','DF','Palladian',26,87,'balanced',true),
  ('pallas-wanderers','Errant Andersen','FW','Palladian',25,84,'aggressive',true),
  ('pallas-wanderers','Drifter Martinez','DF','Palladian',26,83,'balanced',true),
  ('pallas-wanderers','Journeyer Chen','FW','Palladian',28,80,'balanced',true),
  ('pallas-wanderers','Errant Okello','DF','Palladian',25,81,'workhorse',true),
  ('pallas-wanderers','Journeyer Walker','MF','Palladian',23,77,'creative',true),
  ('pallas-wanderers','Errant Sharma','FW','Palladian',28,76,'aggressive',true),
  ('pallas-wanderers','Wanderer Fernandez','MF','Palladian',24,76,'workhorse',true),
  ('pallas-wanderers','Itinerant Park','FW','Palladian',22,78,'team_player',false),
  ('pallas-wanderers','Errant Vasquez','MF','Palladian',18,77,'team_player',false),
  ('pallas-wanderers','Exile Novak','FW','Palladian',22,75,'balanced',false),
  ('pallas-wanderers','Voyager Ivanova','DF','Palladian',20,75,'aggressive',false),
  ('pallas-wanderers','Drifter Delgado','GK','Palladian',21,72,'workhorse',false),
  ('pallas-wanderers','Exile Mensah','GK','Palladian',21,72,'balanced',false),
  ('pallas-wanderers','Drifter Hartmann','DF','Palladian',23,71,'balanced',false),
  ('pallas-wanderers','Journeyer Petrov','DF','Palladian',23,69,'aggressive',false),
  ('pallas-wanderers','Exile Ferreira','MF','Palladian',18,68,'lazy',false),
  ('pallas-wanderers','Nomad Brennan','DF','Palladian',18,65,'team_player',false),
  ('pallas-wanderers','Passing Brennan','MF','Palladian',18,66,'team_player',false),
-- hygiea-united
  ('hygiea-united','Cipher Singh','GK','Hygiean',22,90,'balanced',true),
  ('hygiea-united','Onyx Rivera','FW','Hygiean',29,89,'aggressive',true),
  ('hygiea-united','Ebon Okello','FW','Hygiean',28,87,'selfish',true),
  ('hygiea-united','Mute Torres','DF','Hygiean',26,87,'balanced',true),
  ('hygiea-united','Void Adeyemi','DF','Hygiean',22,83,'team_player',true),
  ('hygiea-united','Eclipse Kane','FW','Hygiean',29,82,'selfish',true),
  ('hygiea-united','Mute Patel','MF','Hygiean',22,80,'lazy',true),
  ('hygiea-united','Ebon Lee','MF','Hygiean',24,81,'creative',true),
  ('hygiea-united','Cipher Ferrara','MF','Hygiean',23,79,'balanced',true),
  ('hygiea-united','Hush Kowalski','DF','Hygiean',26,77,'aggressive',true),
  ('hygiea-united','Shadow Patel','DF','Hygiean',28,76,'balanced',true),
  ('hygiea-united','Murk Liu','FW','Hygiean',28,77,'aggressive',false),
  ('hygiea-united','Nightshade Wang','MF','Hygiean',34,77,'balanced',false),
  ('hygiea-united','Obsidian Ribeiro','GK','Hygiean',18,76,'balanced',false),
  ('hygiea-united','Nightshade Rivera','DF','Hygiean',20,75,'balanced',false),
  ('hygiea-united','Dusk Kowalski','DF','Hygiean',25,73,'balanced',false),
  ('hygiea-united','Dim Liu','DF','Hygiean',27,73,'workhorse',false),
  ('hygiea-united','Dusk Martinez','DF','Hygiean',19,69,'aggressive',false),
  ('hygiea-united','Dusk Ferrara','MF','Hygiean',24,70,'workhorse',false),
  ('hygiea-united','Umbra Singh','MF','Hygiean',21,69,'team_player',false),
  ('hygiea-united','Silent Asante','GK','Hygiean',26,65,'team_player',false),
  ('hygiea-united','Gloam Ivanova','FW','Hygiean',26,65,'workhorse',false),
-- psyche-metallics
  ('psyche-metallics','Chrome Rivera','GK','Psychean',25,90,'cautious',true),
  ('psyche-metallics','Smelt Hartmann','FW','Psychean',24,90,'selfish',true),
  ('psyche-metallics','Titanium Diallo','MF','Psychean',25,88,'balanced',true),
  ('psyche-metallics','Tungsten Wang','FW','Psychean',29,86,'aggressive',true),
  ('psyche-metallics','Nickel Ferreira','MF','Psychean',27,85,'team_player',true),
  ('psyche-metallics','Titanium Wei','DF','Psychean',24,82,'workhorse',true),
  ('psyche-metallics','Forge Adeyemi','MF','Psychean',27,81,'balanced',true),
  ('psyche-metallics','Temper Kowalski','FW','Psychean',28,79,'balanced',true),
  ('psyche-metallics','Smelt Adeyemi','DF','Psychean',22,77,'workhorse',true),
  ('psyche-metallics','Temper Vasquez','DF','Psychean',29,76,'team_player',true),
  ('psyche-metallics','Iron Sharma','DF','Psychean',29,75,'workhorse',true),
  ('psyche-metallics','Rivet Delgado','FW','Psychean',34,78,'balanced',false),
  ('psyche-metallics','Steel Hashimoto','MF','Psychean',26,76,'balanced',false),
  ('psyche-metallics','Steel Delgado','GK','Psychean',27,75,'balanced',false),
  ('psyche-metallics','Cobalt Lee','MF','Psychean',20,74,'balanced',false),
  ('psyche-metallics','Forge Morales','MF','Psychean',34,72,'balanced',false),
  ('psyche-metallics','Temper Nkosi','DF','Psychean',34,71,'lazy',false),
  ('psyche-metallics','Rivet Martinez','DF','Psychean',24,71,'lazy',false),
  ('psyche-metallics','Smelt Rashidi','GK','Psychean',31,68,'balanced',false),
  ('psyche-metallics','Hammer Fernandez','DF','Psychean',31,68,'aggressive',false),
  ('psyche-metallics','Anvil Fernandez','FW','Psychean',21,65,'aggressive',false),
  ('psyche-metallics','Cobalt Steele','DF','Psychean',23,65,'aggressive',false),
-- juno-city
  ('juno-city','Codex Rashidi','FW','Junoan',25,89,'balanced',true),
  ('juno-city','Vestal Kovacs','DF','Junoan',26,90,'team_player',true),
  ('juno-city','Vesper Kovacs','FW','Junoan',27,88,'team_player',true),
  ('juno-city','Temple Costa','GK','Junoan',23,87,'cautious',true),
  ('juno-city','Temple Martinez','FW','Junoan',29,83,'team_player',true),
  ('juno-city','Doctrine Mensah','MF','Junoan',25,82,'workhorse',true),
  ('juno-city','Order Singh','DF','Junoan',26,80,'aggressive',true),
  ('juno-city','Archon Obi','MF','Junoan',22,79,'lazy',true),
  ('juno-city','Archon Walker','MF','Junoan',34,77,'balanced',true),
  ('juno-city','Rite Steele','DF','Junoan',22,78,'aggressive',true),
  ('juno-city','Canon Rao','DF','Junoan',27,75,'team_player',true),
  ('juno-city','Temple Singh','GK','Junoan',20,77,'cautious',false),
  ('juno-city','Rite Delgado','FW','Junoan',20,77,'aggressive',false),
  ('juno-city','Sacrament Okafor','MF','Junoan',23,74,'lazy',false),
  ('juno-city','Order Osei','DF','Junoan',19,75,'balanced',false),
  ('juno-city','Solemn Martinez','MF','Junoan',18,74,'lazy',false),
  ('juno-city','Creed Kane','DF','Junoan',27,73,'aggressive',false),
  ('juno-city','Codex Morales','MF','Junoan',21,70,'creative',false),
  ('juno-city','Doctrine Wang','GK','Junoan',28,70,'balanced',false),
  ('juno-city','Solemn Fontaine','DF','Junoan',18,67,'balanced',false),
  ('juno-city','Rite Diallo','DF','Junoan',27,66,'workhorse',false),
  ('juno-city','Sacrament Rashidi','FW','Junoan',20,65,'aggressive',false),
-- beltway
  ('beltway','Freight Andersen','FW','Belt Colonist',31,89,'selfish',true),
  ('beltway','Rail Hartmann','DF','Belt Colonist',25,88,'balanced',true),
  ('beltway','Freight Santos','GK','Belt Colonist',26,87,'balanced',true),
  ('beltway','Passage Singh','DF','Belt Colonist',29,86,'aggressive',true),
  ('beltway','Shunt Liu','FW','Belt Colonist',24,83,'balanced',true),
  ('beltway','Traverse Singh','MF','Belt Colonist',27,82,'creative',true),
  ('beltway','Junction Hashimoto','FW','Belt Colonist',26,80,'aggressive',true),
  ('beltway','Switch Hashimoto','DF','Belt Colonist',26,79,'team_player',true),
  ('beltway','Hub Rao','DF','Belt Colonist',24,77,'aggressive',true),
  ('beltway','Passage Okafor','MF','Belt Colonist',25,77,'team_player',true),
  ('beltway','Shunt Mehta','MF','Belt Colonist',27,76,'balanced',true),
  ('beltway','Shunt Fernandez','MF','Belt Colonist',36,78,'balanced',false),
  ('beltway','Haul Park','GK','Belt Colonist',35,77,'cautious',false),
  ('beltway','Passage Nkosi','MF','Belt Colonist',18,74,'lazy',false),
  ('beltway','Shunt Vasquez','DF','Belt Colonist',19,75,'team_player',false),
  ('beltway','Switch Nakamura','GK','Belt Colonist',26,73,'team_player',false),
  ('beltway','Rail Yamamoto','MF','Belt Colonist',22,72,'balanced',false),
  ('beltway','Junction Kowalski','DF','Belt Colonist',21,70,'team_player',false),
  ('beltway','Switch Okello','DF','Belt Colonist',18,68,'balanced',false),
  ('beltway','Crossing Wei','FW','Belt Colonist',31,68,'selfish',false),
  ('beltway','Transit Rivera','FW','Belt Colonist',29,67,'workhorse',false),
  ('beltway','Route Rashidi','DF','Belt Colonist',34,66,'balanced',false),
-- solar-miners
  ('solar-miners','Grind Rao','FW','Belt Colonist',22,90,'workhorse',true),
  ('solar-miners','Drill Kowalski','MF','Belt Colonist',22,90,'creative',true),
  ('solar-miners','Dig Ito','FW','Belt Colonist',22,88,'selfish',true),
  ('solar-miners','Excavate Petrov','MF','Belt Colonist',28,86,'team_player',true),
  ('solar-miners','Bore Zhang','MF','Belt Colonist',22,83,'workhorse',true),
  ('solar-miners','Tunnel Petrov','DF','Belt Colonist',25,84,'aggressive',true),
  ('solar-miners','Tunnel Lee','FW','Belt Colonist',29,81,'balanced',true),
  ('solar-miners','Excavate Osei','DF','Belt Colonist',27,80,'team_player',true),
  ('solar-miners','Pit Morales','GK','Belt Colonist',22,77,'balanced',true),
  ('solar-miners','Extract Wei','DF','Belt Colonist',22,78,'aggressive',true),
  ('solar-miners','Extract Rashidi','DF','Belt Colonist',22,76,'workhorse',true),
  ('solar-miners','Excavate Vasquez','GK','Belt Colonist',32,78,'balanced',false),
  ('solar-miners','Strata Okonkwo','MF','Belt Colonist',23,77,'creative',false),
  ('solar-miners','Sift Steele','GK','Belt Colonist',28,74,'balanced',false),
  ('solar-miners','Vein Diallo','DF','Belt Colonist',36,73,'aggressive',false),
  ('solar-miners','Seam Andersen','FW','Belt Colonist',18,72,'selfish',false),
  ('solar-miners','Extract Ferrara','DF','Belt Colonist',20,71,'balanced',false),
  ('solar-miners','Pan Costa','DF','Belt Colonist',36,69,'balanced',false),
  ('solar-miners','Shaft Ribeiro','DF','Belt Colonist',27,68,'workhorse',false),
  ('solar-miners','Seam Delgado','MF','Belt Colonist',20,69,'workhorse',false),
  ('solar-miners','Tunnel Torres','FW','Belt Colonist',34,65,'aggressive',false),
  ('solar-miners','Extract Okafor','MF','Belt Colonist',23,66,'creative',false),
-- pluto-frost
  ('pluto-frost','Tundra Santos','FW','Plutonian',23,90,'aggressive',true),
  ('pluto-frost','Winter Morales','DF','Plutonian',24,90,'workhorse',true),
  ('pluto-frost','Kelvin Tanaka','FW','Plutonian',29,86,'selfish',true),
  ('pluto-frost','Hoarfrost Fontaine','DF','Plutonian',29,86,'aggressive',true),
  ('pluto-frost','Hoarfrost Nakamura','FW','Plutonian',29,84,'selfish',true),
  ('pluto-frost','Kelvin Torres','MF','Plutonian',25,84,'creative',true),
  ('pluto-frost','Tundra Suzuki','MF','Plutonian',24,82,'lazy',true),
  ('pluto-frost','Permafrost Park','DF','Plutonian',26,80,'aggressive',true),
  ('pluto-frost','Freeze Fernandez','DF','Plutonian',26,78,'workhorse',true),
  ('pluto-frost','Kelvin Nkosi','GK','Plutonian',28,77,'cautious',true),
  ('pluto-frost','Tundra Osei','MF','Plutonian',22,76,'team_player',true),
  ('pluto-frost','Glacis Sato','MF','Plutonian',20,77,'balanced',false),
  ('pluto-frost','Methane Brennan','DF','Plutonian',22,76,'team_player',false),
  ('pluto-frost','Hoarfrost Ito','MF','Plutonian',18,74,'workhorse',false),
  ('pluto-frost','Cold Walker','FW','Plutonian',30,75,'aggressive',false),
  ('pluto-frost','Glacis Nakamura','DF','Plutonian',32,73,'balanced',false),
  ('pluto-frost','Ice Kim','DF','Plutonian',18,72,'aggressive',false),
  ('pluto-frost','Snowpack Andersen','GK','Plutonian',34,69,'cautious',false),
  ('pluto-frost','Freeze Petrov','MF','Plutonian',21,68,'balanced',false),
  ('pluto-frost','Arctic Mensah','FW','Plutonian',18,69,'selfish',false),
  ('pluto-frost','Frost Martinez','GK','Plutonian',25,66,'balanced',false),
  ('pluto-frost','Frost Brennan','DF','Plutonian',27,65,'lazy',false),
-- charon-united
  ('charon-united','Orbit Fontaine','FW','Charonian',24,90,'aggressive',true),
  ('charon-united','Pivot Torres','FW','Charonian',22,90,'team_player',true),
  ('charon-united','Conjoined Sato','DF','Charonian',28,87,'balanced',true),
  ('charon-united','Bound Lee','MF','Charonian',24,86,'balanced',true),
  ('charon-united','Moored Voss','MF','Charonian',31,84,'team_player',true),
  ('charon-united','Bound Singh','MF','Charonian',26,83,'team_player',true),
  ('charon-united','Echo Singh','DF','Charonian',29,81,'team_player',true),
  ('charon-united','Echo Zhang','FW','Charonian',25,79,'workhorse',true),
  ('charon-united','Bound Mensah','GK','Charonian',26,77,'team_player',true),
  ('charon-united','Companion Kane','DF','Charonian',27,77,'balanced',true),
  ('charon-united','Shadowing Ferrara','DF','Charonian',24,75,'balanced',true),
  ('charon-united','Anchor Okonkwo','MF','Charonian',21,78,'workhorse',false),
  ('charon-united','Binary Nkosi','FW','Charonian',23,77,'selfish',false),
  ('charon-united','Moored Tanaka','DF','Charonian',25,74,'aggressive',false),
  ('charon-united','Echo Park','MF','Charonian',21,73,'balanced',false),
  ('charon-united','Pivot Patel','GK','Charonian',26,73,'cautious',false),
  ('charon-united','Libra Walker','GK','Charonian',35,73,'balanced',false),
  ('charon-united','Mirror Ferrara','FW','Charonian',22,71,'selfish',false),
  ('charon-united','Shadowing Papadopoulos','DF','Charonian',36,70,'balanced',false),
  ('charon-united','Balance Ferrara','DF','Charonian',24,68,'team_player',false),
  ('charon-united','Moored Santos','MF','Charonian',27,66,'balanced',false),
  ('charon-united','Mirror Chandra','DF','Charonian',32,66,'workhorse',false),
-- eris-wanderers
  ('eris-wanderers','Exiled Singh','FW','Eridean',33,90,'balanced',true),
  ('eris-wanderers','Clash Papadopoulos','FW','Eridean',29,88,'selfish',true),
  ('eris-wanderers','Rancor Osei','MF','Eridean',27,88,'balanced',true),
  ('eris-wanderers','Rancor Nakamura','FW','Eridean',30,87,'aggressive',true),
  ('eris-wanderers','Discord Brennan','GK','Eridean',31,85,'balanced',true),
  ('eris-wanderers','Riven Ribeiro','DF','Eridean',34,84,'team_player',true),
  ('eris-wanderers','Faraway Ribeiro','MF','Eridean',23,82,'workhorse',true),
  ('eris-wanderers','Distant Okonkwo','DF','Eridean',28,79,'balanced',true),
  ('eris-wanderers','Banished Steele','MF','Eridean',25,79,'creative',true),
  ('eris-wanderers','Quarrel Rivera','DF','Eridean',25,76,'aggressive',true),
  ('eris-wanderers','Banished Nkosi','DF','Eridean',25,76,'balanced',true),
  ('eris-wanderers','Discord Nakamura','DF','Eridean',30,77,'team_player',false),
  ('eris-wanderers','Spite Asante','FW','Eridean',36,78,'team_player',false),
  ('eris-wanderers','Clash Delgado','GK','Eridean',22,74,'cautious',false),
  ('eris-wanderers','Rancor Nkosi','DF','Eridean',20,73,'balanced',false),
  ('eris-wanderers','Faraway Nkosi','FW','Eridean',30,74,'selfish',false),
  ('eris-wanderers','Faraway Yamamoto','MF','Eridean',31,72,'creative',false),
  ('eris-wanderers','Sundered Chen','DF','Eridean',35,69,'aggressive',false),
  ('eris-wanderers','Exiled Vasquez','DF','Eridean',32,69,'team_player',false),
  ('eris-wanderers','Discord Patel','GK','Eridean',29,69,'cautious',false),
  ('eris-wanderers','Faraway Petrov','MF','Eridean',27,67,'team_player',false),
  ('eris-wanderers','Dispute Ivanova','MF','Eridean',18,65,'workhorse',false),
-- haumea-spinners
  ('haumea-spinners','Swirl Steele','MF','Haumeian',22,90,'workhorse',true),
  ('haumea-spinners','Wheel Torres','FW','Haumeian',22,88,'selfish',true),
  ('haumea-spinners','Curve Tanaka','DF','Haumeian',25,87,'balanced',true),
  ('haumea-spinners','Rotor Okello','GK','Haumeian',27,85,'cautious',true),
  ('haumea-spinners','Eddy Nakamura','DF','Haumeian',33,85,'workhorse',true),
  ('haumea-spinners','Twirl Santos','FW','Haumeian',22,84,'balanced',true),
  ('haumea-spinners','Spiral Fontaine','DF','Haumeian',29,81,'aggressive',true),
  ('haumea-spinners','Swirl Costa','MF','Haumeian',26,80,'creative',true),
  ('haumea-spinners','Eddy Asante','DF','Haumeian',27,77,'team_player',true),
  ('haumea-spinners','Curve Papadopoulos','FW','Haumeian',26,77,'balanced',true),
  ('haumea-spinners','Twirl Okello','MF','Haumeian',26,75,'balanced',true),
  ('haumea-spinners','Wheel Morales','GK','Haumeian',26,78,'balanced',false),
  ('haumea-spinners','Gyre Vasquez','MF','Haumeian',26,77,'workhorse',false),
  ('haumea-spinners','Wheel Hashimoto','FW','Haumeian',21,76,'balanced',false),
  ('haumea-spinners','Spin Morales','DF','Haumeian',31,74,'aggressive',false),
  ('haumea-spinners','Oval Voss','MF','Haumeian',23,74,'balanced',false),
  ('haumea-spinners','Swirl Wang','MF','Haumeian',21,72,'balanced',false),
  ('haumea-spinners','Orbit Kane','DF','Haumeian',21,70,'aggressive',false),
  ('haumea-spinners','Ellipse Walker','DF','Haumeian',35,69,'balanced',false),
  ('haumea-spinners','Spiral Mehta','DF','Haumeian',28,67,'aggressive',false),
  ('haumea-spinners','Curve Andersen','GK','Haumeian',18,66,'cautious',false),
  ('haumea-spinners','Gyre Walker','FW','Haumeian',33,66,'selfish',false),
-- makemake
  ('makemake','Smith Brennan','GK','Makemakean',26,90,'workhorse',true),
  ('makemake','Origin Obi','FW','Makemakean',28,88,'selfish',true),
  ('makemake','Inception Ribeiro','FW','Makemakean',33,88,'selfish',true),
  ('makemake','Kindle Okafor','DF','Makemakean',29,86,'workhorse',true),
  ('makemake','Potter Morales','MF','Makemakean',24,84,'balanced',true),
  ('makemake','Ignite Mehta','DF','Makemakean',33,84,'team_player',true),
  ('makemake','Genesis Voss','DF','Makemakean',24,80,'team_player',true),
  ('makemake','Inception Kim','FW','Makemakean',29,80,'workhorse',true),
  ('makemake','Forge Morales','MF','Makemakean',22,77,'creative',true),
  ('makemake','Builder Okafor','MF','Makemakean',27,76,'workhorse',true),
  ('makemake','Cradle Vasquez','DF','Makemakean',23,76,'aggressive',true),
  ('makemake','Ignite Yamamoto','DF','Makemakean',20,78,'team_player',false),
  ('makemake','Smith Park','MF','Makemakean',36,77,'balanced',false),
  ('makemake','Builder Fontaine','MF','Makemakean',24,75,'creative',false),
  ('makemake','Potter Asante','DF','Makemakean',21,74,'workhorse',false),
  ('makemake','Dawn Brennan','FW','Makemakean',19,72,'team_player',false),
  ('makemake','Spark Zhang','GK','Makemakean',28,73,'balanced',false),
  ('makemake','Shaper Obi','GK','Makemakean',19,70,'balanced',false),
  ('makemake','Potter Chen','DF','Makemakean',29,70,'team_player',false),
  ('makemake','Genesis Hartmann','MF','Makemakean',21,68,'team_player',false),
  ('makemake','Weaver Cruz','DF','Makemakean',34,66,'balanced',false),
  ('makemake','Weaver Delgado','FW','Makemakean',33,65,'selfish',false),
-- orcus-athletic
  ('orcus-athletic','Underworld Kowalski','DF','Orcian',26,89,'workhorse',true),
  ('orcus-athletic','Shade Ferrara','DF','Orcian',32,89,'aggressive',true),
  ('orcus-athletic','Abyss Volkov','MF','Orcian',24,86,'team_player',true),
  ('orcus-athletic','Hollow Tanaka','GK','Orcian',27,87,'cautious',true),
  ('orcus-athletic','Grave Okonkwo','FW','Orcian',23,85,'workhorse',true),
  ('orcus-athletic','Phantom Ivanova','FW','Orcian',23,84,'team_player',true),
  ('orcus-athletic','Oath Novak','MF','Orcian',29,81,'team_player',true),
  ('orcus-athletic','Phantom Rashidi','FW','Orcian',29,79,'selfish',true),
  ('orcus-athletic','Hollow Fernandez','MF','Orcian',28,77,'creative',true),
  ('orcus-athletic','Oath Steele','DF','Orcian',23,78,'balanced',true),
  ('orcus-athletic','Underworld Rashidi','DF','Orcian',25,75,'aggressive',true),
  ('orcus-athletic','Depth Martinez','DF','Orcian',22,77,'team_player',false),
  ('orcus-athletic','Bind Hashimoto','MF','Orcian',31,78,'lazy',false),
  ('orcus-athletic','Depth Fontaine','DF','Orcian',28,76,'team_player',false),
  ('orcus-athletic','Wraith Fischer','FW','Orcian',21,73,'balanced',false),
  ('orcus-athletic','Pit Mehta','DF','Orcian',28,74,'balanced',false),
  ('orcus-athletic','Oath Nakamura','FW','Orcian',19,72,'workhorse',false),
  ('orcus-athletic','Specter Fernandez','GK','Orcian',18,69,'cautious',false),
  ('orcus-athletic','Bind Ito','MF','Orcian',34,68,'team_player',false),
  ('orcus-athletic','Hollow Ferreira','MF','Orcian',19,67,'workhorse',false),
  ('orcus-athletic','Silence Fernandez','DF','Orcian',26,65,'balanced',false),
  ('orcus-athletic','Bind Chen','GK','Orcian',22,66,'cautious',false),
-- sedna-mariners
  ('sedna-mariners','Outcast Ribeiro','DF','Sednan',26,90,'balanced',true),
  ('sedna-mariners','Exile Singh','MF','Sednan',28,89,'balanced',true),
  ('sedna-mariners','Outcast Voss','DF','Sednan',24,88,'balanced',true),
  ('sedna-mariners','Deep Kovacs','MF','Sednan',20,86,'team_player',true),
  ('sedna-mariners','Glacier Ito','MF','Sednan',34,85,'team_player',true),
  ('sedna-mariners','Solitude Adeyemi','GK','Sednan',22,84,'team_player',true),
  ('sedna-mariners','Solitude Suzuki','FW','Sednan',26,81,'selfish',true),
  ('sedna-mariners','Patient Ferrara','DF','Sednan',23,79,'aggressive',true),
  ('sedna-mariners','Silent Ivanova','DF','Sednan',24,77,'balanced',true),
  ('sedna-mariners','Solitary Suzuki','FW','Sednan',28,77,'workhorse',true),
  ('sedna-mariners','Lonely Hartmann','FW','Sednan',28,76,'selfish',true),
  ('sedna-mariners','Abandoned Hashimoto','MF','Sednan',19,78,'workhorse',false),
  ('sedna-mariners','Solitude Chen','DF','Sednan',20,77,'balanced',false),
  ('sedna-mariners','Outcast Morales','MF','Sednan',19,75,'creative',false),
  ('sedna-mariners','Glacier Ferreira','GK','Sednan',19,73,'team_player',false),
  ('sedna-mariners','Deep Nakamura','DF','Sednan',19,74,'balanced',false),
  ('sedna-mariners','Glacier Lee','DF','Sednan',28,71,'balanced',false),
  ('sedna-mariners','Isolated Petrov','MF','Sednan',18,69,'creative',false),
  ('sedna-mariners','Solitude Park','GK','Sednan',19,68,'balanced',false),
  ('sedna-mariners','Remote Brennan','DF','Sednan',18,69,'team_player',false),
  ('sedna-mariners','Patient Yamamoto','FW','Sednan',36,66,'team_player',false),
  ('sedna-mariners','Deep Suzuki','FW','Sednan',24,65,'selfish',false),
-- scattered-disc
  ('scattered-disc','Expelled Costa','FW','Scattered',23,90,'aggressive',true),
  ('scattered-disc','Banished Hartmann','DF','Scattered',26,90,'workhorse',true),
  ('scattered-disc','Erratic Rivera','FW','Scattered',28,87,'selfish',true),
  ('scattered-disc','Strewn Nakamura','DF','Scattered',25,86,'balanced',true),
  ('scattered-disc','Irregular Hartmann','DF','Scattered',34,85,'balanced',true),
  ('scattered-disc','Thrown Wei','MF','Scattered',26,83,'workhorse',true),
  ('scattered-disc','Ejected Walker','GK','Scattered',26,80,'balanced',true),
  ('scattered-disc','Launched Hashimoto','MF','Scattered',29,79,'team_player',true),
  ('scattered-disc','Cast Nakamura','FW','Scattered',24,77,'selfish',true),
  ('scattered-disc','Eccentric Novak','DF','Scattered',34,77,'team_player',true),
  ('scattered-disc','Ejected Chandra','MF','Scattered',28,76,'creative',true),
  ('scattered-disc','Scatter Santos','DF','Scattered',32,77,'balanced',false),
  ('scattered-disc','Irregular Yamamoto','DF','Scattered',25,76,'balanced',false),
  ('scattered-disc','Flung Ivanova','FW','Scattered',30,75,'aggressive',false),
  ('scattered-disc','Random Morales','FW','Scattered',18,75,'workhorse',false),
  ('scattered-disc','Flung Costa','GK','Scattered',30,73,'cautious',false),
  ('scattered-disc','Thrown Ivanova','DF','Scattered',18,71,'balanced',false),
  ('scattered-disc','Strewn Okafor','MF','Scattered',35,71,'workhorse',false),
  ('scattered-disc','Thrown Okonkwo','MF','Scattered',21,70,'balanced',false),
  ('scattered-disc','Chaotic Kovacs','MF','Scattered',18,67,'creative',false),
  ('scattered-disc','Launched Fontaine','GK','Scattered',21,67,'cautious',false),
  ('scattered-disc','Scatter Ito','DF','Scattered',22,66,'aggressive',false);

-- ── PLAYER SIMULATION STATS ───────────────────────────────────────────────────
-- Derive attacking/defending/mental/athletic/technical from overall_rating and
-- position.  Values are clamped to [38, 95] to keep the engine rolls balanced.
-- GK:  high defending, low attacking
-- DF:  high defending, moderate attacking
-- MF:  balanced across all stats, slight mental/technical lean
-- FW:  high attacking and athletic, low defending
UPDATE players SET
  attacking = CASE position
    WHEN 'GK' THEN GREATEST(38, overall_rating - 30)
    WHEN 'DF' THEN GREATEST(42, overall_rating - 15)
    WHEN 'MF' THEN GREATEST(48, overall_rating - 5)
    WHEN 'FW' THEN LEAST(95, overall_rating + 10)
  END,
  defending = CASE position
    WHEN 'GK' THEN LEAST(95, overall_rating + 10)
    WHEN 'DF' THEN LEAST(95, overall_rating + 8)
    WHEN 'MF' THEN GREATEST(42, overall_rating - 10)
    WHEN 'FW' THEN GREATEST(38, overall_rating - 20)
  END,
  mental = CASE position
    WHEN 'GK' THEN overall_rating
    WHEN 'DF' THEN overall_rating - 2
    WHEN 'MF' THEN LEAST(95, overall_rating + 5)
    WHEN 'FW' THEN overall_rating - 3
  END,
  athletic = CASE position
    WHEN 'GK' THEN GREATEST(38, overall_rating - 5)
    WHEN 'DF' THEN overall_rating
    WHEN 'MF' THEN overall_rating
    WHEN 'FW' THEN LEAST(95, overall_rating + 5)
  END,
  technical = CASE position
    WHEN 'GK' THEN GREATEST(38, overall_rating - 15)
    WHEN 'DF' THEN GREATEST(42, overall_rating - 10)
    WHEN 'MF' THEN LEAST(95, overall_rating + 3)
    WHEN 'FW' THEN GREATEST(42, overall_rating - 5)
  END;

-- ── JERSEY NUMBERS ────────────────────────────────────────────────────────────
-- Assign shirt numbers per team: starters first (GK=1, DF=2–5, MF=6–8,
-- FW=9–11), bench from 12 upward.  Within each position+starter group players
-- are ordered by overall_rating DESC so the best player gets the lower number.
UPDATE players p SET jersey_number = sub.rn
FROM (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY team_id
      ORDER BY
        starter DESC,
        CASE position WHEN 'GK' THEN 1 WHEN 'DF' THEN 2 WHEN 'MF' THEN 3 WHEN 'FW' THEN 4 END,
        overall_rating DESC
    ) AS rn
  FROM players
) sub
WHERE p.id = sub.id;

-- ── MANAGERS ──────────────────────────────────────────────────────────────────
-- One manager per team. DELETE before insert keeps this idempotent since
-- the managers table has no unique constraint on team_id.
DELETE FROM managers;

INSERT INTO managers (team_id, name, nationality, style) VALUES
  -- Rocky Inner League
  ('mercury-runners',   'Solano Vex',          'Mercurian',         'High Pressing'),
  ('earth-united',      'Priya Okafor',         'Earthian',          'Possession'),
  ('venus-volcanic',    'Ignis Ferrara',        'Venusian',          'Aggressive'),
  ('terra-nova',        'Dominic Harrow',       'Earthian',          'Offensive'),
  ('mars-athletic',     'Dustin Kael',          'Martian',           'Counterattacking'),
  ('olympus-mons',      'Caldera Osei',         'Martian',           'Direct'),
  ('valles-mariners',   'Rift Nkosi',           'Martian',           'Possession'),
  ('solar-city',        'Luma Vasquez',         'Orbital Colonist',  'Balanced'),
  -- Gas/Ice Giants League
  ('jupiter-titans',    'Titan Krell',          'Jovian',            'Aggressive'),
  ('europa-oceanic',    'Marina Crestfall',     'Europan',           'Possession'),
  ('ganymede-united',   'Ore Iwata',            'Ganymedean',        'Defensive'),
  ('callisto-wolves',   'Frost Adeyemi',        'Callistoan',        'High Pressing'),
  ('saturn-rings',      'Helios Voss',          'Saturnian',         'Possession'),
  ('titan-methane',     'Haze Kowalski',        'Titanian',          'Counterattacking'),
  ('enceladus-geysers', 'Crystal Murai',        'Enceladean',        'High Pressing'),
  ('uranus-sidewinders','Axis Brennan',         'Uranian',           'Offensive'),
  -- Outer Reaches League
  ('ceres-miners',      'Gravel Asante',        'Cerean',            'Defensive'),
  ('vesta',             'Float Inoue',          'Vestan',            'Direct'),
  ('pallas-wanderers',  'Nomad Ferreira',       'Palladian',         'Balanced'),
  ('hygiea-united',     'Shadow Diallo',        'Hygiean',           'Defensive'),
  ('psyche-metallics',  'Forge Petrov',         'Psychean',          'Aggressive'),
  ('juno-city',         'Order Mensah',         'Junoan',            'Balanced'),
  ('beltway',           'Transit Obi',          'Belt Colonist',     'Counterattacking'),
  ('solar-miners',      'Drill Rashidi',        'Belt Colonist',     'High Pressing'),
  -- Kuiper Belt League
  ('pluto-frost',       'Glacis Montoya',       'Plutonian',         'Defensive'),
  ('charon-united',     'Binary Nakamura',      'Charonian',         'Balanced'),
  ('eris-wanderers',    'Distant Cruz',         'Eridean',           'Counterattacking'),
  ('haumea-spinners',   'Ellipse Yamamoto',     'Haumeian',          'Offensive'),
  ('makemake',          'Genesis Solano',       'Makemakean',        'Possession'),
  ('orcus-athletic',    'Abyss Ivanova',        'Orcian',            'Direct'),
  ('sedna-mariners',    'Patient Okonkwo',      'Sednan',            'Defensive'),
  ('scattered-disc',    'Void Larsen',          'Trans-Neptunian',   'Balanced');
