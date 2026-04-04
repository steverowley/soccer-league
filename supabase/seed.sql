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
-- 512 players (32 teams × 16 each). TRUNCATE before insert keeps this
-- idempotent; CASCADE drops any match_player_stats referencing old UUIDs.
TRUNCATE TABLE players CASCADE;

INSERT INTO players (team_id, name, position, nationality, age, overall_rating, personality, starter) VALUES
-- ── Rocky Inner League ───────────────────────────────────────────────────────
-- earth-united
  ('earth-united','Rafael Costa','FW','Earthian',22,88,'selfish',true),
  ('earth-united','Sophie Hartmann','DF','Earthian',26,86,'aggressive',true),
  ('earth-united','Emma Volkov','FW','Earthian',25,85,'workhorse',true),
  ('earth-united','Marco Delgado','GK','Earthian',30,85,'balanced',true),
  ('earth-united','Aiko Nakajima','MF','Earthian',24,85,'team_player',true),
  ('earth-united','Kofi Asante','FW','Earthian',29,83,'balanced',true),
  ('earth-united','Yusuf Mensah','DF','Earthian',28,83,'team_player',true),
  ('earth-united','Carlos Ribeiro','MF','Earthian',27,82,'creative',true),
  ('earth-united','Lena Kovacs','DF','Earthian',25,81,'balanced',true),
  ('earth-united','Priya Sharma','MF','Earthian',23,80,'balanced',true),
  ('earth-united','James Okello','DF','Earthian',32,79,'workhorse',true),
  ('earth-united','Sven Andersen','FW','Earthian',18,77,'selfish',false),
  ('earth-united','Amara Diallo','MF','Earthian',21,76,'team_player',false),
  ('earth-united','Liu Wei','GK','Earthian',22,74,'cautious',false),
  ('earth-united','Helena Papadopoulos','DF','Earthian',19,71,'balanced',false),
  ('earth-united','Sam Obi','DF','Earthian',34,69,'lazy',false),
-- mars-athletic
  ('mars-athletic','Blaze Adeyemi','FW','Martian',21,87,'selfish',true),
  ('mars-athletic','Nova Cruz','FW','Martian',23,85,'workhorse',true),
  ('mars-athletic','Echo Nakamura','MF','Martian',22,84,'creative',true),
  ('mars-athletic','Zara Kwan','DF','Martian',25,84,'aggressive',true),
  ('mars-athletic','Rift Osei','FW','Martian',25,83,'balanced',true),
  ('mars-athletic','Rex Volkov','GK','Martian',30,82,'balanced',true),
  ('mars-athletic','Orion Steele','DF','Martian',28,82,'team_player',true),
  ('mars-athletic','Flux Santos','MF','Martian',27,81,'team_player',true),
  ('mars-athletic','Lira Solano','DF','Martian',24,80,'balanced',true),
  ('mars-athletic','Sable Torres','MF','Martian',26,78,'balanced',true),
  ('mars-athletic','Dash Petrov','DF','Martian',31,78,'workhorse',true),
  ('mars-athletic','Crater Diaz','FW','Martian',18,75,'selfish',false),
  ('mars-athletic','Canyon Joshi','MF','Martian',20,74,'team_player',false),
  ('mars-athletic','Iron Kato','GK','Martian',32,72,'cautious',false),
  ('mars-athletic','Red Fontaine','DF','Martian',19,70,'balanced',false),
  ('mars-athletic','Dust Mensah','DF','Martian',35,67,'lazy',false),
-- mercury-runners
  ('mercury-runners','Nova Hashimoto','FW','Mercurian',21,87,'selfish',true),
  ('mercury-runners','Scorch Lindqvist','FW','Mercurian',26,84,'balanced',true),
  ('mercury-runners','Flare Nakamura','DF','Mercurian',24,83,'aggressive',true),
  ('mercury-runners','Ember Kosi','FW','Mercurian',24,82,'workhorse',true),
  ('mercury-runners','Prism Osei','MF','Mercurian',25,82,'creative',true),
  ('mercury-runners','Blaze Corsen','GK','Mercurian',29,81,'balanced',true),
  ('mercury-runners','Solara Vex','DF','Mercurian',27,80,'team_player',true),
  ('mercury-runners','Flint Reyes','MF','Mercurian',23,79,'balanced',true),
  ('mercury-runners','Cinder Kato','DF','Mercurian',22,78,'balanced',true),
  ('mercury-runners','Vela Cruz','MF','Mercurian',28,77,'team_player',true),
  ('mercury-runners','Torch Hadley','DF','Mercurian',31,76,'workhorse',true),
  ('mercury-runners','Pyro Okafor','FW','Mercurian',18,74,'selfish',false),
  ('mercury-runners','Spark Tanaka','MF','Mercurian',20,73,'creative',false),
  ('mercury-runners','Crest Fontaine','GK','Mercurian',32,71,'cautious',false),
  ('mercury-runners','Glow Petrov','DF','Mercurian',19,70,'balanced',false),
  ('mercury-runners','Lumen Diaz','DF','Mercurian',33,68,'lazy',false),
-- olympus-mons
  ('olympus-mons','Crater Mensah','FW','Martian',22,88,'selfish',true),
  ('olympus-mons','Shield Petrov','FW','Martian',24,85,'workhorse',true),
  ('olympus-mons','Caldera Nkosi','DF','Martian',26,85,'aggressive',true),
  ('olympus-mons','Vent Suzuki','MF','Martian',23,84,'creative',true),
  ('olympus-mons','Apex Voss','GK','Martian',29,83,'balanced',true),
  ('olympus-mons','Peak Osei','FW','Martian',20,83,'creative',true),
  ('olympus-mons','Summit Ivanova','DF','Martian',28,82,'workhorse',true),
  ('olympus-mons','Flow Ferreira','MF','Martian',27,81,'team_player',true),
  ('olympus-mons','Ridge Okonkwo','DF','Martian',24,80,'team_player',true),
  ('olympus-mons','Magma Park','MF','Martian',25,79,'balanced',true),
  ('olympus-mons','Plateau Walsh','DF','Martian',31,78,'balanced',true),
  ('olympus-mons','Dome Aziz','FW','Martian',17,76,'selfish',false),
  ('olympus-mons','Fissure Kim','MF','Martian',21,74,'team_player',false),
  ('olympus-mons','Crust Yamamoto','GK','Martian',33,73,'cautious',false),
  ('olympus-mons','Flow Dubois','DF','Martian',19,71,'balanced',false),
  ('olympus-mons','Pump Rashidi','DF','Martian',35,68,'lazy',false),
-- solar-city
  ('solar-city','Launch Osei','FW','Orbital Colonist',22,88,'selfish',true),
  ('solar-city','Thrust Kimura','FW','Orbital Colonist',24,85,'workhorse',true),
  ('solar-city','Station Kwan','DF','Orbital Colonist',25,84,'aggressive',true),
  ('solar-city','Signal Torres','MF','Orbital Colonist',23,84,'creative',true),
  ('solar-city','Boost Novak','FW','Orbital Colonist',21,83,'balanced',true),
  ('solar-city','Orbit Delgado','GK','Orbital Colonist',28,83,'balanced',true),
  ('solar-city','Module Petrov','DF','Orbital Colonist',27,82,'team_player',true),
  ('solar-city','Beacon Sharma','MF','Orbital Colonist',26,81,'team_player',true),
  ('solar-city','Dock Mbeki','DF','Orbital Colonist',24,80,'balanced',true),
  ('solar-city','Relay Santos','MF','Orbital Colonist',28,79,'balanced',true),
  ('solar-city','Hub Tanaka','DF','Orbital Colonist',30,78,'workhorse',true),
  ('solar-city','Flare Okafor','FW','Orbital Colonist',18,76,'selfish',false),
  ('solar-city','Array Fontaine','MF','Orbital Colonist',20,75,'team_player',false),
  ('solar-city','Drone Reyes','GK','Orbital Colonist',33,73,'cautious',false),
  ('solar-city','Satellite Obi','DF','Orbital Colonist',19,71,'balanced',false),
  ('solar-city','Lens Park','DF','Orbital Colonist',34,68,'lazy',false),
-- terra-nova
  ('terra-nova','Horizon Kim','FW','Terran',22,87,'selfish',true),
  ('terra-nova','Genesis Okafor','MF','Terran',23,84,'creative',true),
  ('terra-nova','Drift Bergmann','FW','Terran',24,84,'workhorse',true),
  ('terra-nova','Colony Bauer','DF','Terran',24,83,'team_player',true),
  ('terra-nova','Pulse Nkosi','FW','Terran',21,82,'creative',true),
  ('terra-nova','Pioneer Reyes','GK','Terran',28,82,'balanced',true),
  ('terra-nova','Origin Moreau','MF','Terran',29,81,'team_player',true),
  ('terra-nova','Frontier Walsh','DF','Terran',27,80,'workhorse',true),
  ('terra-nova','Settler Yildiz','DF','Terran',26,79,'balanced',true),
  ('terra-nova','Epoch Santos','MF','Terran',25,78,'balanced',true),
  ('terra-nova','Habitat Park','DF','Terran',31,77,'aggressive',true),
  ('terra-nova','Crux Amara','FW','Terran',18,75,'selfish',false),
  ('terra-nova','Signal Hayashi','MF','Terran',20,73,'team_player',false),
  ('terra-nova','Vault Schneider','GK','Terran',30,70,'cautious',false),
  ('terra-nova','Core Petrov','DF','Terran',19,69,'balanced',false),
  ('terra-nova','Dome Rashidi','DF','Terran',34,67,'lazy',false),
-- valles-mariners
  ('valles-mariners','Depth Kim','FW','Martian',21,87,'selfish',true),
  ('valles-mariners','Mesa Cruz','FW','Martian',23,84,'workhorse',true),
  ('valles-mariners','Gorge Bauer','DF','Martian',24,83,'aggressive',true),
  ('valles-mariners','Abyss Nakamura','MF','Martian',22,83,'creative',true),
  ('valles-mariners','Canyon Reyes','GK','Martian',27,82,'balanced',true),
  ('valles-mariners','Plateau Mensah','FW','Martian',27,82,'balanced',true),
  ('valles-mariners','Valley Petrov','DF','Martian',29,81,'workhorse',true),
  ('valles-mariners','Gully Santos','MF','Martian',28,80,'team_player',true),
  ('valles-mariners','Trench Yamada','DF','Martian',26,79,'balanced',true),
  ('valles-mariners','Chasm Okafor','MF','Martian',25,78,'balanced',true),
  ('valles-mariners','Rift Diallo','DF','Martian',31,77,'team_player',true),
  ('valles-mariners','Erosion Park','FW','Martian',18,75,'selfish',false),
  ('valles-mariners','Flood Walsh','MF','Martian',20,73,'team_player',false),
  ('valles-mariners','Basin Volkov','GK','Martian',32,71,'cautious',false),
  ('valles-mariners','Silt Ferreira','DF','Martian',19,69,'balanced',false),
  ('valles-mariners','Ravine Osei','DF','Martian',35,67,'lazy',false),
-- venus-volcanic
  ('venus-volcanic','Crater Mwangi','FW','Venusian',24,87,'selfish',true),
  ('venus-volcanic','Tectonic Leroy','FW','Venusian',21,85,'workhorse',true),
  ('venus-volcanic','Fume Nakamura','MF','Venusian',22,84,'creative',true),
  ('venus-volcanic','Magma Torres','DF','Venusian',25,84,'aggressive',true),
  ('venus-volcanic','Acid Rynn','GK','Venusian',27,83,'aggressive',true),
  ('venus-volcanic','Pyrex Stavros','FW','Venusian',27,82,'balanced',true),
  ('venus-volcanic','Sulfur Vogt','DF','Venusian',30,81,'workhorse',true),
  ('venus-volcanic','Cloud Ortega','MF','Venusian',29,80,'balanced',true),
  ('venus-volcanic','Lava Osei','DF','Venusian',23,79,'balanced',true),
  ('venus-volcanic','Plume Desjardins','MF','Venusian',26,78,'team_player',true),
  ('venus-volcanic','Basalt Ferreira','DF','Venusian',28,77,'team_player',true),
  ('venus-volcanic','Cinder Liu','MF','Venusian',19,74,'creative',false),
  ('venus-volcanic','Venom Shah','FW','Venusian',17,73,'selfish',false),
  ('venus-volcanic','Haze Kimura','GK','Venusian',33,72,'cautious',false),
  ('venus-volcanic','Soot Petrova','DF','Venusian',20,70,'balanced',false),
  ('venus-volcanic','Geyser Mbeki','DF','Venusian',35,67,'lazy',false),
-- ── Gas/Ice Giants League ────────────────────────────────────────────────────
-- callisto-wolves
  ('callisto-wolves','Fang Petrov','FW','Callistian',24,85,'selfish',true),
  ('callisto-wolves','Claw Nakamura','FW','Callistian',22,84,'aggressive',true),
  ('callisto-wolves','Frost Vega','GK','Callistian',27,82,'balanced',true),
  ('callisto-wolves','Hunt Rivera','FW','Callistian',28,82,'balanced',true),
  ('callisto-wolves','Tundra Cross','DF','Callistian',28,81,'team_player',true),
  ('callisto-wolves','Glacier Kane','DF','Callistian',25,80,'aggressive',true),
  ('callisto-wolves','Howl Okafor','MF','Callistian',23,79,'creative',true),
  ('callisto-wolves','Shadow Mori','MF','Callistian',25,78,'team_player',true),
  ('callisto-wolves','Ice Brennan','DF','Callistian',24,78,'workhorse',true),
  ('callisto-wolves','Blizzard Sato','DF','Callistian',26,77,'cautious',true),
  ('callisto-wolves','Pack Reyes','MF','Callistian',27,76,'balanced',true),
  ('callisto-wolves','Stalker Beck','FW','Callistian',30,77,'selfish',false),
  ('callisto-wolves','Permafrost Kim','DF','Callistian',29,75,'team_player',false),
  ('callisto-wolves','Chill Vargas','GK','Callistian',32,74,'cautious',false),
  ('callisto-wolves','Arctic Tran','DF','Callistian',20,73,'balanced',false),
  ('callisto-wolves','Winter Chen','MF','Callistian',21,72,'creative',false),
-- enceladus-geysers
  ('enceladus-geysers','Gush Li','FW','Enceladean',22,87,'selfish',true),
  ('enceladus-geysers','Surge Patel','FW','Enceladean',25,85,'aggressive',true),
  ('enceladus-geysers','Plume Torres','GK','Enceladean',28,83,'balanced',true),
  ('enceladus-geysers','Flood Novak','FW','Enceladean',28,83,'selfish',true),
  ('enceladus-geysers','Vapor Cruz','DF','Enceladean',23,82,'aggressive',true),
  ('enceladus-geysers','Geyser Walsh','DF','Enceladean',26,81,'team_player',true),
  ('enceladus-geysers','Spray Morales','MF','Enceladean',27,80,'creative',true),
  ('enceladus-geysers','Steam Hayashi','DF','Enceladean',29,79,'workhorse',true),
  ('enceladus-geysers','Jet Fischer','DF','Enceladean',25,78,'balanced',true),
  ('enceladus-geysers','Brine Nakamura','MF','Enceladean',24,77,'team_player',true),
  ('enceladus-geysers','Saline Park','MF','Enceladean',26,76,'balanced',true),
  ('enceladus-geysers','Wave Koval','FW','Enceladean',31,78,'selfish',false),
  ('enceladus-geysers','Tide Brennan','GK','Enceladean',31,75,'cautious',false),
  ('enceladus-geysers','Ripple Tanaka','DF','Enceladean',28,74,'team_player',false),
  ('enceladus-geysers','Drizzle Osei','DF','Enceladean',20,72,'balanced',false),
  ('enceladus-geysers','Current Webb','MF','Enceladean',22,71,'creative',false),
-- europa-oceanic
  ('europa-oceanic','Surge Yamamoto','FW','Europan',22,88,'selfish',true),
  ('europa-oceanic','Deep Nkosi','FW','Europan',25,86,'aggressive',true),
  ('europa-oceanic','Rift Larsson','FW','Europan',27,84,'selfish',true),
  ('europa-oceanic','Depth Vasquez','GK','Europan',29,84,'balanced',true),
  ('europa-oceanic','Marine Okafor','DF','Europan',26,83,'aggressive',true),
  ('europa-oceanic','Abyss Storm','DF','Europan',27,82,'team_player',true),
  ('europa-oceanic','Tide Walker','MF','Europan',23,81,'creative',true),
  ('europa-oceanic','Coral Sato','DF','Europan',25,80,'workhorse',true),
  ('europa-oceanic','Trench Reyes','DF','Europan',24,79,'balanced',true),
  ('europa-oceanic','Current Rivers','MF','Europan',28,78,'team_player',true),
  ('europa-oceanic','Wave Santiago','MF','Europan',26,76,'balanced',true),
  ('europa-oceanic','Plunge Ito','FW','Europan',32,79,'selfish',false),
  ('europa-oceanic','Shell Novak','GK','Europan',33,76,'cautious',false),
  ('europa-oceanic','Kelp Anderson','DF','Europan',30,75,'team_player',false),
  ('europa-oceanic','Shoal Martinez','DF','Europan',21,73,'balanced',false),
  ('europa-oceanic','Brine Chandra','MF','Europan',22,72,'creative',false),
-- ganymede-united
  ('ganymede-united','Giant Rivera','FW','Ganymedean',22,89,'selfish',true),
  ('ganymede-united','Vast Chen','FW','Ganymedean',25,87,'aggressive',true),
  ('ganymede-united','Magnet Petrov','GK','Ganymedean',30,85,'balanced',true),
  ('ganymede-united','Immense Patel','FW','Ganymedean',28,85,'selfish',true),
  ('ganymede-united','Massive Cruz','DF','Ganymedean',25,84,'workhorse',true),
  ('ganymede-united','Titan Kane','DF','Ganymedean',28,83,'team_player',true),
  ('ganymede-united','Pole Kim','MF','Ganymedean',24,82,'creative',true),
  ('ganymede-united','Colossal Wren','DF','Ganymedean',26,81,'aggressive',true),
  ('ganymede-united','Enormous Lee','DF','Ganymedean',27,80,'balanced',true),
  ('ganymede-united','Flux Mori','MF','Ganymedean',26,79,'team_player',true),
  ('ganymede-united','Field Osei','MF','Ganymedean',23,77,'balanced',true),
  ('ganymede-united','Goliath Brennan','FW','Ganymedean',31,80,'selfish',false),
  ('ganymede-united','Shield Beck','GK','Ganymedean',32,77,'cautious',false),
  ('ganymede-united','Bastion Park','DF','Ganymedean',29,76,'team_player',false),
  ('ganymede-united','Bulwark Torres','DF','Ganymedean',20,74,'balanced',false),
  ('ganymede-united','Aegis Tanaka','MF','Ganymedean',21,73,'creative',false),
-- jupiter-titans
  ('jupiter-titans','Tempest Rivera','FW','Jovian',22,90,'selfish',true),
  ('jupiter-titans','Typhoon Lee','FW','Jovian',24,88,'aggressive',true),
  ('jupiter-titans','Storm Reyes','GK','Jovian',28,86,'balanced',true),
  ('jupiter-titans','Maelstrom Park','FW','Jovian',28,86,'selfish',true),
  ('jupiter-titans','Cyclone Walsh','DF','Jovian',27,85,'workhorse',true),
  ('jupiter-titans','Thunder Okafor','DF','Jovian',26,84,'team_player',true),
  ('jupiter-titans','Vortex Chen','MF','Jovian',23,83,'creative',true),
  ('jupiter-titans','Lightning Petrov','DF','Jovian',25,82,'aggressive',true),
  ('jupiter-titans','Squall Morales','MF','Jovian',27,80,'team_player',true),
  ('jupiter-titans','Gale Fischer','DF','Jovian',24,80,'balanced',true),
  ('jupiter-titans','Gust Nakamura','MF','Jovian',25,78,'balanced',true),
  ('jupiter-titans','Rush Sato','FW','Jovian',31,82,'selfish',false),
  ('jupiter-titans','Zephyr Torres','GK','Jovian',32,78,'cautious',false),
  ('jupiter-titans','Mist Tanaka','DF','Jovian',30,77,'team_player',false),
  ('jupiter-titans','Nimbus Kim','DF','Jovian',20,75,'balanced',false),
  ('jupiter-titans','Breeze Brennan','MF','Jovian',21,74,'creative',false),
-- saturn-rings
  ('saturn-rings','Halo Creed','FW','Saturnian',25,89,'selfish',true),
  ('saturn-rings','Nora Blaze','DF','Saturnian',27,86,'team_player',true),
  ('saturn-rings','Sera Nox','FW','Saturnian',22,86,'selfish',true),
  ('saturn-rings','Axel Frost','DF','Saturnian',25,84,'workhorse',true),
  ('saturn-rings','Eon Vasquez','GK','Saturnian',29,84,'balanced',true),
  ('saturn-rings','Yuki Storm','FW','Saturnian',28,84,'selfish',true),
  ('saturn-rings','Livy Thane','DF','Saturnian',26,81,'team_player',true),
  ('saturn-rings','Demi Volta','MF','Saturnian',26,81,'team_player',true),
  ('saturn-rings','Rook Steele','DF','Saturnian',28,79,'aggressive',true),
  ('saturn-rings','Cass Wren','MF','Saturnian',24,77,'team_player',true),
  ('saturn-rings','Pierce Lux','MF','Saturnian',23,75,'balanced',true),
  ('saturn-rings','Mav Solaris','FW','Saturnian',31,81,'selfish',false),
  ('saturn-rings','Finn Ardent','GK','Saturnian',32,79,'cautious',false),
  ('saturn-rings','Reese Dawn','DF','Saturnian',23,77,'balanced',false),
  ('saturn-rings','Tara Veil','DF','Saturnian',30,76,'balanced',false),
  ('saturn-rings','Corin Ash','MF','Saturnian',21,71,'balanced',false),
-- titan-methane
  ('titan-methane','Halo Nkosi','FW','Titanian',22,87,'selfish',true),
  ('titan-methane','Shroud Martinez','FW','Titanian',25,85,'aggressive',true),
  ('titan-methane','Fume Chandra','FW','Titanian',28,83,'selfish',true),
  ('titan-methane','Haze Yamamoto','GK','Titanian',29,83,'balanced',true),
  ('titan-methane','Murk Anderson','DF','Titanian',26,82,'workhorse',true),
  ('titan-methane','Fog Larsson','DF','Titanian',27,81,'team_player',true),
  ('titan-methane','Drift Cruz','MF','Titanian',23,80,'creative',true),
  ('titan-methane','Smog Walker','DF','Titanian',25,79,'aggressive',true),
  ('titan-methane','Miasma Santos','DF','Titanian',24,78,'balanced',true),
  ('titan-methane','Murky Rivers','MF','Titanian',27,77,'team_player',true),
  ('titan-methane','Dusk Ito','MF','Titanian',25,76,'balanced',true),
  ('titan-methane','Pall Kim','FW','Titanian',31,78,'selfish',false),
  ('titan-methane','Veil Torres','DF','Titanian',29,75,'team_player',false),
  ('titan-methane','Gloom Beck','GK','Titanian',33,75,'cautious',false),
  ('titan-methane','Dim Park','DF','Titanian',21,73,'balanced',false),
  ('titan-methane','Fade Tanaka','MF','Titanian',22,72,'creative',false),
-- uranus-sidewinders
  ('uranus-sidewinders','Lateral Park','FW','Uranian',22,86,'selfish',true),
  ('uranus-sidewinders','Sideways Kim','FW','Uranian',24,84,'aggressive',true),
  ('uranus-sidewinders','Tilt Vasquez','GK','Uranian',28,82,'balanced',true),
  ('uranus-sidewinders','Tangent Okafor','FW','Uranian',28,82,'selfish',true),
  ('uranus-sidewinders','Axis Torres','DF','Uranian',27,81,'workhorse',true),
  ('uranus-sidewinders','Roll Kane','DF','Uranian',26,80,'team_player',true),
  ('uranus-sidewinders','Slant Chen','MF','Uranian',23,79,'creative',true),
  ('uranus-sidewinders','Spin Walker','DF','Uranian',24,78,'aggressive',true),
  ('uranus-sidewinders','Orbit Rivera','DF','Uranian',25,77,'balanced',true),
  ('uranus-sidewinders','Lean Petrov','MF','Uranian',27,76,'team_player',true),
  ('uranus-sidewinders','Skew Morales','MF','Uranian',25,75,'balanced',true),
  ('uranus-sidewinders','Deflect Sato','FW','Uranian',31,77,'selfish',false),
  ('uranus-sidewinders','Veer Nakamura','DF','Uranian',29,74,'team_player',false),
  ('uranus-sidewinders','Rotate Tanaka','GK','Uranian',32,74,'cautious',false),
  ('uranus-sidewinders','Wobble Fischer','DF','Uranian',20,72,'balanced',false),
  ('uranus-sidewinders','Drift Hayashi','MF','Uranian',21,71,'creative',false),
-- ── Outer Reaches League ─────────────────────────────────────────────────────
-- beltway
  ('beltway','Exit Park','FW','Belter',22,86,'selfish',true),
  ('beltway','Merge Kim','FW','Belter',24,84,'aggressive',true),
  ('beltway','Corridor Vasquez','GK','Belter',28,82,'balanced',true),
  ('beltway','Overpass Okafor','FW','Belter',28,82,'selfish',true),
  ('beltway','Bypass Torres','DF','Belter',27,81,'workhorse',true),
  ('beltway','Highway Kane','DF','Belter',26,80,'team_player',true),
  ('beltway','Freeway Chen','MF','Belter',23,79,'creative',true),
  ('beltway','Transit Walker','DF','Belter',24,78,'aggressive',true),
  ('beltway','Toll Rivera','DF','Belter',25,77,'balanced',true),
  ('beltway','Ramp Petrov','MF','Belter',27,76,'team_player',true),
  ('beltway','Junction Morales','MF','Belter',25,75,'balanced',true),
  ('beltway','Detour Sato','FW','Belter',31,77,'selfish',false),
  ('beltway','Underpass Tanaka','GK','Belter',32,74,'cautious',false),
  ('beltway','Offramp Nakamura','DF','Belter',29,74,'team_player',false),
  ('beltway','Onramp Fischer','DF','Belter',20,72,'balanced',false),
  ('beltway','Interchange Hayashi','MF','Belter',21,71,'creative',false),
-- ceres-miners
  ('ceres-miners','Strike Yamamoto','FW','Cerean',22,87,'selfish',true),
  ('ceres-miners','Quarry Nakamura','FW','Cerean',25,85,'aggressive',true),
  ('ceres-miners','Drill Vasquez','GK','Cerean',28,83,'balanced',true),
  ('ceres-miners','Blast Fischer','FW','Cerean',28,83,'selfish',true),
  ('ceres-miners','Vein Torres','DF','Cerean',27,82,'workhorse',true),
  ('ceres-miners','Ore Kane','DF','Cerean',26,81,'team_player',true),
  ('ceres-miners','Dig Chen','MF','Cerean',23,80,'creative',true),
  ('ceres-miners','Shaft Walker','DF','Cerean',24,79,'aggressive',true),
  ('ceres-miners','Seam Rivera','DF','Cerean',25,78,'balanced',true),
  ('ceres-miners','Pick Petrov','MF','Cerean',27,77,'team_player',true),
  ('ceres-miners','Tunnel Morales','MF','Cerean',25,76,'balanced',true),
  ('ceres-miners','Splint Beck','FW','Cerean',31,78,'selfish',false),
  ('ceres-miners','Crusher Tanaka','GK','Cerean',32,75,'cautious',false),
  ('ceres-miners','Cobalt Kim','DF','Cerean',29,74,'team_player',false),
  ('ceres-miners','Flint Osei','DF','Cerean',20,72,'balanced',false),
  ('ceres-miners','Nugget Park','MF','Cerean',22,71,'creative',false),
-- hygiea-united
  ('hygiea-united','Vigor Park','FW','Hygieian',22,86,'selfish',true),
  ('hygiea-united','Robust Kim','FW','Hygieian',24,84,'aggressive',true),
  ('hygiea-united','Vitality Okafor','FW','Hygieian',28,82,'selfish',true),
  ('hygiea-united','Clean Vasquez','GK','Hygieian',28,82,'balanced',true),
  ('hygiea-united','Cleanse Torres','DF','Hygieian',27,81,'workhorse',true),
  ('hygiea-united','Pure Kane','DF','Hygieian',26,80,'team_player',true),
  ('hygiea-united','Vital Chen','MF','Hygieian',23,79,'creative',true),
  ('hygiea-united','Pristine Walker','DF','Hygieian',24,78,'aggressive',true),
  ('hygiea-united','Sterile Rivera','DF','Hygieian',25,77,'balanced',true),
  ('hygiea-united','Heal Petrov','MF','Hygieian',27,76,'team_player',true),
  ('hygiea-united','Cure Morales','MF','Hygieian',25,75,'balanced',true),
  ('hygiea-united','Elixir Sato','FW','Hygieian',31,77,'selfish',false),
  ('hygiea-united','Tonic Nakamura','DF','Hygieian',29,74,'team_player',false),
  ('hygiea-united','Remedy Tanaka','GK','Hygieian',32,74,'cautious',false),
  ('hygiea-united','Salve Fischer','DF','Hygieian',20,72,'balanced',false),
  ('hygiea-united','Balm Hayashi','MF','Hygieian',21,71,'creative',false),
-- juno-city
  ('juno-city','Skyline Yamamoto','FW','Junonian',22,87,'selfish',true),
  ('juno-city','Spire Nakamura','FW','Junonian',25,85,'aggressive',true),
  ('juno-city','Civic Reyes','GK','Junonian',28,83,'balanced',true),
  ('juno-city','Apex Fischer','FW','Junonian',28,83,'selfish',true),
  ('juno-city','District Torres','DF','Junonian',27,82,'workhorse',true),
  ('juno-city','Metro Okafor','DF','Junonian',26,81,'team_player',true),
  ('juno-city','Boulevard Chen','MF','Junonian',23,80,'creative',true),
  ('juno-city','Urban Kane','DF','Junonian',24,79,'aggressive',true),
  ('juno-city','Precinct Rivera','DF','Junonian',25,78,'balanced',true),
  ('juno-city','Avenue Petrov','MF','Junonian',27,77,'team_player',true),
  ('juno-city','Plaza Morales','MF','Junonian',25,76,'balanced',true),
  ('juno-city','Neon Beck','FW','Junonian',31,78,'selfish',false),
  ('juno-city','Dome Tanaka','GK','Junonian',32,75,'cautious',false),
  ('juno-city','Sector Kim','DF','Junonian',29,74,'team_player',false),
  ('juno-city','Level Osei','DF','Junonian',20,72,'balanced',false),
  ('juno-city','Grid Park','MF','Junonian',22,71,'creative',false),
-- pallas-wanderers
  ('pallas-wanderers','Ramble Rivera','FW','Palladian',22,89,'selfish',true),
  ('pallas-wanderers','Traverse Chen','FW','Palladian',25,87,'aggressive',true),
  ('pallas-wanderers','Nomad Petrov','GK','Palladian',30,85,'balanced',true),
  ('pallas-wanderers','Pilgrim Patel','FW','Palladian',28,85,'selfish',true),
  ('pallas-wanderers','Stray Torres','DF','Palladian',25,84,'workhorse',true),
  ('pallas-wanderers','Roam Okafor','DF','Palladian',28,83,'team_player',true),
  ('pallas-wanderers','Trek Kim','MF','Palladian',24,82,'creative',true),
  ('pallas-wanderers','Wander Kane','DF','Palladian',26,81,'aggressive',true),
  ('pallas-wanderers','Vagrant Lee','DF','Palladian',27,80,'balanced',true),
  ('pallas-wanderers','Journey Mori','MF','Palladian',26,79,'team_player',true),
  ('pallas-wanderers','Range Osei','MF','Palladian',23,77,'balanced',true),
  ('pallas-wanderers','Sojourn Brennan','FW','Palladian',31,80,'selfish',false),
  ('pallas-wanderers','Exile Beck','GK','Palladian',32,77,'cautious',false),
  ('pallas-wanderers','Quest Park','DF','Palladian',29,76,'team_player',false),
  ('pallas-wanderers','Odyssey Torres','DF','Palladian',20,74,'balanced',false),
  ('pallas-wanderers','Venture Tanaka','MF','Palladian',21,73,'creative',false),
-- psyche-metallics
  ('psyche-metallics','Alloy Rivera','FW','Psychean',22,88,'selfish',true),
  ('psyche-metallics','Ferrous Patel','FW','Psychean',25,86,'aggressive',true),
  ('psyche-metallics','Magnesium Reyes','GK','Psychean',29,84,'balanced',true),
  ('psyche-metallics','Steel Novak','FW','Psychean',28,84,'selfish',true),
  ('psyche-metallics','Chrome Cruz','DF','Psychean',26,83,'workhorse',true),
  ('psyche-metallics','Iron Okafor','DF','Psychean',27,82,'team_player',true),
  ('psyche-metallics','Coil Kim','MF','Psychean',23,81,'creative',true),
  ('psyche-metallics','Nickel Sato','DF','Psychean',25,80,'aggressive',true),
  ('psyche-metallics','Cobalt Lee','DF','Psychean',24,79,'balanced',true),
  ('psyche-metallics','Static Mori','MF','Psychean',27,78,'team_player',true),
  ('psyche-metallics','Spark Nakamura','MF','Psychean',25,77,'balanced',true),
  ('psyche-metallics','Forge Ito','FW','Psychean',32,79,'selfish',false),
  ('psyche-metallics','Weld Torres','GK','Psychean',33,76,'cautious',false),
  ('psyche-metallics','Solder Anderson','DF','Psychean',30,75,'team_player',false),
  ('psyche-metallics','Flux Martinez','DF','Psychean',21,73,'balanced',false),
  ('psyche-metallics','Arc Chandra','MF','Psychean',22,72,'creative',false),
-- solar-miners
  ('solar-miners','Flare Rivera','FW','Miner',22,88,'selfish',true),
  ('solar-miners','Blaze Patel','FW','Miner',25,86,'aggressive',true),
  ('solar-miners','Shine Novak','FW','Miner',28,84,'selfish',true),
  ('solar-miners','Photon Vasquez','GK','Miner',29,84,'balanced',true),
  ('solar-miners','Beam Cruz','DF','Miner',26,83,'workhorse',true),
  ('solar-miners','Solar Okafor','DF','Miner',27,82,'team_player',true),
  ('solar-miners','Radiant Kim','MF','Miner',23,81,'creative',true),
  ('solar-miners','Ray Sato','DF','Miner',25,80,'aggressive',true),
  ('solar-miners','Flux Lee','DF','Miner',24,79,'balanced',true),
  ('solar-miners','Lumens Mori','MF','Miner',27,78,'team_player',true),
  ('solar-miners','Watt Nakamura','MF','Miner',25,77,'balanced',true),
  ('solar-miners','Ampere Ito','FW','Miner',32,79,'selfish',false),
  ('solar-miners','Array Torres','GK','Miner',33,76,'cautious',false),
  ('solar-miners','Volt Anderson','DF','Miner',30,75,'team_player',false),
  ('solar-miners','Panel Martinez','DF','Miner',21,73,'balanced',false),
  ('solar-miners','Current Chandra','MF','Miner',22,72,'creative',false),
-- vesta
  ('vesta','Eruption Rivera','FW','Vestan',22,88,'selfish',true),
  ('vesta','Scorch Patel','FW','Vestan',25,86,'aggressive',true),
  ('vesta','Lava Reyes','GK','Vestan',29,84,'balanced',true),
  ('vesta','Cinder Novak','FW','Vestan',28,84,'selfish',true),
  ('vesta','Igneous Cruz','DF','Vestan',26,83,'workhorse',true),
  ('vesta','Magma Okafor','DF','Vestan',27,82,'team_player',true),
  ('vesta','Pyro Kim','MF','Vestan',23,81,'creative',true),
  ('vesta','Basalt Sato','DF','Vestan',25,80,'aggressive',true),
  ('vesta','Crater Lee','DF','Vestan',24,79,'balanced',true),
  ('vesta','Ember Mori','MF','Vestan',27,78,'team_player',true),
  ('vesta','Flare Nakamura','MF','Vestan',25,77,'balanced',true),
  ('vesta','Blaze Ito','FW','Vestan',32,79,'selfish',false),
  ('vesta','Ash Torres','GK','Vestan',33,76,'cautious',false),
  ('vesta','Slag Anderson','DF','Vestan',30,75,'team_player',false),
  ('vesta','Coke Martinez','DF','Vestan',21,73,'balanced',false),
  ('vesta','Char Chandra','MF','Vestan',22,72,'creative',false),
-- ── Kuiper Belt League ───────────────────────────────────────────────────────
-- charon-united
  ('charon-united','Bond Yamamoto','FW','Charonian',22,87,'selfish',true),
  ('charon-united','Link Nakamura','FW','Charonian',25,85,'aggressive',true),
  ('charon-united','Lock Reyes','GK','Charonian',28,83,'balanced',true),
  ('charon-united','Couple Fischer','FW','Charonian',28,83,'selfish',true),
  ('charon-united','Fixed Torres','DF','Charonian',27,82,'workhorse',true),
  ('charon-united','Sync Okafor','DF','Charonian',26,81,'team_player',true),
  ('charon-united','Anchor Chen','MF','Charonian',23,80,'creative',true),
  ('charon-united','Tidal Kane','DF','Charonian',24,79,'aggressive',true),
  ('charon-united','Orbit Rivera','DF','Charonian',25,78,'balanced',true),
  ('charon-united','Bind Petrov','MF','Charonian',27,77,'team_player',true),
  ('charon-united','Chain Morales','MF','Charonian',25,76,'balanced',true),
  ('charon-united','Lash Beck','FW','Charonian',31,78,'selfish',false),
  ('charon-united','Tether Tanaka','GK','Charonian',32,75,'cautious',false),
  ('charon-united','Shackle Kim','DF','Charonian',29,74,'team_player',false),
  ('charon-united','Yoke Osei','DF','Charonian',20,72,'balanced',false),
  ('charon-united','Fetter Park','MF','Charonian',22,71,'creative',false),
-- eris-wanderers
  ('eris-wanderers','Mayhem Rivera','FW','Eridian',22,88,'selfish',true),
  ('eris-wanderers','Bedlam Patel','FW','Eridian',25,86,'aggressive',true),
  ('eris-wanderers','Chaos Vasquez','GK','Eridian',29,84,'balanced',true),
  ('eris-wanderers','Turmoil Novak','FW','Eridian',28,84,'selfish',true),
  ('eris-wanderers','Anarchy Cruz','DF','Eridian',26,83,'workhorse',true),
  ('eris-wanderers','Discord Okafor','DF','Eridian',27,82,'team_player',true),
  ('eris-wanderers','Havoc Kim','MF','Eridian',23,81,'creative',true),
  ('eris-wanderers','Strife Sato','DF','Eridian',25,80,'aggressive',true),
  ('eris-wanderers','Unrest Lee','DF','Eridian',24,79,'balanced',true),
  ('eris-wanderers','Tumult Mori','MF','Eridian',27,78,'team_player',true),
  ('eris-wanderers','Mayhem Nakamura','MF','Eridian',25,77,'balanced',true),
  ('eris-wanderers','Upheaval Ito','FW','Eridian',32,79,'selfish',false),
  ('eris-wanderers','Frenzy Torres','GK','Eridian',33,76,'cautious',false),
  ('eris-wanderers','Unruly Anderson','DF','Eridian',30,75,'team_player',false),
  ('eris-wanderers','Riot Martinez','DF','Eridian',21,73,'balanced',false),
  ('eris-wanderers','Ferment Chandra','MF','Eridian',22,72,'creative',false),
-- haumea-spinners
  ('haumea-spinners','Blur Yamamoto','FW','Haumeian',22,87,'selfish',true),
  ('haumea-spinners','Cyclone Nakamura','FW','Haumeian',25,85,'aggressive',true),
  ('haumea-spinners','Storm Fischer','FW','Haumeian',28,83,'selfish',true),
  ('haumea-spinners','Gyro Reyes','GK','Haumeian',28,83,'balanced',true),
  ('haumea-spinners','Spiral Torres','DF','Haumeian',27,82,'workhorse',true),
  ('haumea-spinners','Rotate Okafor','DF','Haumeian',26,81,'team_player',true),
  ('haumea-spinners','Spin Chen','MF','Haumeian',23,80,'creative',true),
  ('haumea-spinners','Whirl Kane','DF','Haumeian',24,79,'aggressive',true),
  ('haumea-spinners','Twist Rivera','DF','Haumeian',25,78,'balanced',true),
  ('haumea-spinners','Orbit Petrov','MF','Haumeian',27,77,'team_player',true),
  ('haumea-spinners','Pirouette Morales','MF','Haumeian',25,76,'balanced',true),
  ('haumea-spinners','Pivot Beck','FW','Haumeian',31,78,'selfish',false),
  ('haumea-spinners','Twirl Tanaka','GK','Haumeian',32,75,'cautious',false),
  ('haumea-spinners','Reel Kim','DF','Haumeian',29,74,'team_player',false),
  ('haumea-spinners','Swivel Osei','DF','Haumeian',20,72,'balanced',false),
  ('haumea-spinners','Cartwheel Park','MF','Haumeian',22,71,'creative',false),
-- makemake
  ('makemake','Deity Rivera','FW','Makean',22,89,'selfish',true),
  ('makemake','Idol Chen','FW','Makean',25,87,'aggressive',true),
  ('makemake','Ancient Vasquez','GK','Makean',30,85,'balanced',true),
  ('makemake','Shrine Patel','FW','Makean',28,85,'selfish',true),
  ('makemake','Rune Cruz','DF','Makean',25,84,'workhorse',true),
  ('makemake','Mystic Okafor','DF','Makean',28,83,'team_player',true),
  ('makemake','Totem Kim','MF','Makean',24,82,'creative',true),
  ('makemake','Oracle Sato','DF','Makean',26,81,'aggressive',true),
  ('makemake','Enigma Lee','DF','Makean',27,80,'balanced',true),
  ('makemake','Ritual Mori','MF','Makean',26,79,'team_player',true),
  ('makemake','Omen Osei','MF','Makean',23,77,'balanced',true),
  ('makemake','Effigy Brennan','FW','Makean',31,80,'selfish',false),
  ('makemake','Altar Beck','GK','Makean',32,77,'cautious',false),
  ('makemake','Votive Park','DF','Makean',29,76,'team_player',false),
  ('makemake','Icon Torres','DF','Makean',20,74,'balanced',false),
  ('makemake','Rite Tanaka','MF','Makean',21,73,'creative',false),
-- orcus-athletic
  ('orcus-athletic','Ghost Yamamoto','FW','Orcian',22,88,'selfish',true),
  ('orcus-athletic','Nether Patel','FW','Orcian',25,86,'aggressive',true),
  ('orcus-athletic','Shade Reyes','GK','Orcian',29,84,'balanced',true),
  ('orcus-athletic','Dusk Novak','FW','Orcian',28,84,'selfish',true),
  ('orcus-athletic','Specter Torres','DF','Orcian',26,83,'workhorse',true),
  ('orcus-athletic','Shadow Okafor','DF','Orcian',27,82,'team_player',true),
  ('orcus-athletic','Void Kim','MF','Orcian',23,81,'creative',true),
  ('orcus-athletic','Wraith Kane','DF','Orcian',25,80,'aggressive',true),
  ('orcus-athletic','Phantom Rivera','DF','Orcian',24,79,'balanced',true),
  ('orcus-athletic','Abyss Mori','MF','Orcian',27,78,'team_player',true),
  ('orcus-athletic','Dark Nakamura','MF','Orcian',25,77,'balanced',true),
  ('orcus-athletic','Obscure Ito','FW','Orcian',32,79,'selfish',false),
  ('orcus-athletic','Umbra Torres','GK','Orcian',33,76,'cautious',false),
  ('orcus-athletic','Eclipse Anderson','DF','Orcian',30,75,'team_player',false),
  ('orcus-athletic','Penumbra Martinez','DF','Orcian',21,73,'balanced',false),
  ('orcus-athletic','Occult Chandra','MF','Orcian',22,72,'creative',false),
-- pluto-frost
  ('pluto-frost','Nyx Rivera','FW','Plutonian',22,88,'selfish',true),
  ('pluto-frost','Hydra Patel','FW','Plutonian',25,86,'aggressive',true),
  ('pluto-frost','Cryo Vasquez','GK','Plutonian',29,84,'balanced',true),
  ('pluto-frost','Kerberos Novak','FW','Plutonian',28,84,'selfish',true),
  ('pluto-frost','Permafrost Cruz','DF','Plutonian',26,83,'workhorse',true),
  ('pluto-frost','Frost Kane','DF','Plutonian',27,82,'team_player',true),
  ('pluto-frost','Charon Kim','MF','Plutonian',23,81,'creative',true),
  ('pluto-frost','Glacial Sato','DF','Plutonian',25,80,'aggressive',true),
  ('pluto-frost','Arctic Lee','DF','Plutonian',24,79,'balanced',true),
  ('pluto-frost','Styx Mori','MF','Plutonian',27,78,'team_player',true),
  ('pluto-frost','Nix Nakamura','MF','Plutonian',25,77,'balanced',true),
  ('pluto-frost','Zero Ito','FW','Plutonian',32,79,'selfish',false),
  ('pluto-frost','Cerberus Torres','GK','Plutonian',33,76,'cautious',false),
  ('pluto-frost','Polar Anderson','DF','Plutonian',30,75,'team_player',false),
  ('pluto-frost','Boreas Martinez','DF','Plutonian',21,73,'balanced',false),
  ('pluto-frost','Kelvin Chandra','MF','Plutonian',22,72,'creative',false),
-- scattered-disc
  ('scattered-disc','Flung Park','FW','Scattered',22,86,'selfish',true),
  ('scattered-disc','Strewn Kim','FW','Scattered',24,84,'aggressive',true),
  ('scattered-disc','Cast Okafor','FW','Scattered',28,82,'selfish',true),
  ('scattered-disc','Scatter Vasquez','GK','Scattered',28,82,'balanced',true),
  ('scattered-disc','Irregular Torres','DF','Scattered',27,81,'workhorse',true),
  ('scattered-disc','Disc Kane','DF','Scattered',26,80,'team_player',true),
  ('scattered-disc','Random Chen','MF','Scattered',23,79,'creative',true),
  ('scattered-disc','Erratic Walker','DF','Scattered',24,78,'aggressive',true),
  ('scattered-disc','Eccentric Rivera','DF','Scattered',25,77,'balanced',true),
  ('scattered-disc','Chaotic Petrov','MF','Scattered',27,76,'team_player',true),
  ('scattered-disc','Dispersed Morales','MF','Scattered',25,75,'balanced',true),
  ('scattered-disc','Launched Sato','FW','Scattered',31,77,'selfish',false),
  ('scattered-disc','Ejected Nakamura','DF','Scattered',29,74,'team_player',false),
  ('scattered-disc','Hurled Tanaka','GK','Scattered',32,74,'cautious',false),
  ('scattered-disc','Thrown Fischer','DF','Scattered',20,72,'balanced',false),
  ('scattered-disc','Expelled Hayashi','MF','Scattered',21,71,'creative',false),
-- sedna-mariners
  ('sedna-mariners','Vast Rivera','FW','Sednan',22,88,'selfish',true),
  ('sedna-mariners','Lonely Patel','FW','Sednan',25,86,'aggressive',true),
  ('sedna-mariners','Deep Vasquez','GK','Sednan',29,84,'balanced',true),
  ('sedna-mariners','Desolate Novak','FW','Sednan',28,84,'selfish',true),
  ('sedna-mariners','Abyssal Cruz','DF','Sednan',26,83,'workhorse',true),
  ('sedna-mariners','Glacier Okafor','DF','Sednan',27,82,'team_player',true),
  ('sedna-mariners','Distant Kim','MF','Sednan',23,81,'creative',true),
  ('sedna-mariners','Permafrost Sato','DF','Sednan',25,80,'aggressive',true),
  ('sedna-mariners','Remote Lee','DF','Sednan',24,79,'balanced',true),
  ('sedna-mariners','Isolated Mori','MF','Sednan',27,78,'team_player',true),
  ('sedna-mariners','Solitary Nakamura','MF','Sednan',25,77,'balanced',true),
  ('sedna-mariners','Outcast Ito','FW','Sednan',32,79,'selfish',false),
  ('sedna-mariners','Forsaken Torres','GK','Sednan',33,76,'cautious',false),
  ('sedna-mariners','Exile Anderson','DF','Sednan',30,75,'team_player',false),
  ('sedna-mariners','Abandoned Martinez','DF','Sednan',21,73,'balanced',false),
  ('sedna-mariners','Solitude Chandra','MF','Sednan',22,72,'creative',false);

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
