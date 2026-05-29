-- ── 0063_stadium_training_entities.sql ───────────────────────────────────────
-- WHY: Promotes stadiums and training facilities from plain text columns on
-- the `teams` table into first-class entity rows.  This gives the Cosmic
-- Architect new levers to pull — it can now "curse the pitch at Limeil
-- Stadium", journalists can file stadium renovation stories, political bodies
-- can threaten to revoke operating licences, and the voting system's
-- "training investment" focus directly upgrades a facility's quality trait.
--
-- SCHEMA CHANGES:
--   teams.stadium_entity_id         — nullable FK → entities(id)
--   teams.training_facility_entity_id — nullable FK → entities(id)
--
-- Both columns are nullable because:
--   1. The backfill below sets them in the same transaction — they are null
--      only during the brief window between ALTER TABLE and UPDATE.
--   2. Future new teams inserted before their entity rows are created must
--      not fail.  The application treats null as "no entity yet; fall back
--      to home_ground text column".
--
-- UUID namespaces (stable — future migrations reference these by ID):
--   80000000-…  stadiums       (001–032 matching teams 1–32 in league order)
--   81000000-…  training facilities (same ordering)
--
-- Stadium quality tiers (quoted in meta.quality):
--   legendary    — heritage venue; capacity 65k+; Architect uses reverential tone
--   professional — standard top-flight; adequate for any narrative
--   functional   — adequate but limiting; Architect notes the constraints
--   frontier     — remote or improvised; Architect plays up the hardship angle
--
-- Training facility quality tiers (quoted in meta.quality; also used by the
-- voting system's "training_investment" focus to set the upgrade target):
--   elite        — cutting-edge; confers a small match-day conditioning bonus
--   professional — solid; no narrative penalty
--   standard     — adequate; occasional Architect commentary on under-investment
--   basic        — resource-poor; regular Architect narrative hook
--
-- IDEMPOTENT — every INSERT uses ON CONFLICT (id) DO NOTHING; every ALTER
-- TABLE uses IF NOT EXISTS; every UPDATE is safe to re-run.
-- ──────────────────────────────────────────────────────────────────────────────


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 1: Add FK columns to teams
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS stadium_entity_id          UUID REFERENCES entities(id),
  ADD COLUMN IF NOT EXISTS training_facility_entity_id UUID REFERENCES entities(id);


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 2: Stadium entities
-- ═══════════════════════════════════════════════════════════════════════════
-- One row per club.  `nickname` is stored separately from `name` so the
-- Architect can vary register: formal match reports use the full name;
-- atmosphere-heavy prose uses the nickname.  Capacity mirrors the teams
-- table so the Architect can cite crowd sizes without a join.

INSERT INTO entities (id, kind, name, display_name, meta) VALUES

  -- ── Rocky Inner League ────────────────────────────────────────────────────

  ('80000000-0000-0000-0000-000000000001', 'stadium',
   'Solar Sprint Stadium', 'Solar Sprint Stadium',
   '{"team_id": "mercury-runners", "location": "Mercury", "capacity": "35,000", "nickname": "The Heat Box", "quality": "professional"}'::jsonb),

  ('80000000-0000-0000-0000-000000000002', 'stadium',
   'Blue Marble Arena', 'Blue Marble Arena',
   '{"team_id": "earth-united", "location": "Earth", "capacity": "95,000", "nickname": "The Blue Marble", "quality": "legendary"}'::jsonb),

  ('80000000-0000-0000-0000-000000000003', 'stadium',
   'Pressure Cooker Stadium', 'Pressure Cooker Stadium',
   '{"team_id": "venus-volcanic", "location": "Venus", "capacity": "52,000", "nickname": null, "quality": "professional"}'::jsonb),

  ('80000000-0000-0000-0000-000000000004', 'stadium',
   'The World Park', 'The World Park',
   '{"team_id": "terra-nova", "location": "Earth", "capacity": "58,000", "nickname": "The Greenhouse", "quality": "professional"}'::jsonb),

  ('80000000-0000-0000-0000-000000000005', 'stadium',
   'Red Planet Arena', 'Red Planet Arena',
   '{"team_id": "mars-athletic", "location": "Mars", "capacity": "48,000", "nickname": "The Dust Bowl", "quality": "professional"}'::jsonb),

  ('80000000-0000-0000-0000-000000000006', 'stadium',
   'Limeil Stadium', 'Limeil Stadium',
   '{"team_id": "olympus-mons", "location": "Mars", "capacity": "89,000", "nickname": "The Mountain", "quality": "legendary"}'::jsonb),

  ('80000000-0000-0000-0000-000000000007', 'stadium',
   'Canyon Complex', 'Canyon Complex',
   '{"team_id": "valles-mariners", "location": "Mars", "capacity": "61,000", "nickname": "The Trench", "quality": "professional"}'::jsonb),

  ('80000000-0000-0000-0000-000000000008', 'stadium',
   'Orbital Stadium', 'Orbital Stadium',
   '{"team_id": "solar-city", "location": "Largest Orbital Colony", "capacity": "72,000", "nickname": "The Ring", "quality": "legendary"}'::jsonb),

  -- ── Gas / Ice Giant League ────────────────────────────────────────────────

  ('80000000-0000-0000-0000-000000000009', 'stadium',
   'Storm Arena', 'Storm Arena',
   '{"team_id": "jupiter-titans", "location": "Jupiter", "capacity": "110,000", "nickname": "The Red Spot", "quality": "legendary"}'::jsonb),

  ('80000000-0000-0000-0000-000000000010', 'stadium',
   'Subsurface Stadium', 'Subsurface Stadium',
   '{"team_id": "europa-oceanic", "location": "Europa", "capacity": "53,000", "nickname": "The Ice Bowl", "quality": "professional"}'::jsonb),

  ('80000000-0000-0000-0000-000000000011', 'stadium',
   'Crater Fields', 'Crater Fields',
   '{"team_id": "ganymede-united", "location": "Ganymede", "capacity": "67,000", "nickname": "The Cradle", "quality": "professional"}'::jsonb),

  ('80000000-0000-0000-0000-000000000012', 'stadium',
   'Frozen Plains Stadium', 'Frozen Plains Stadium',
   '{"team_id": "callisto-wolves", "location": "Callisto", "capacity": "45,000", "nickname": "The Howling Den", "quality": "professional"}'::jsonb),

  ('80000000-0000-0000-0000-000000000013', 'stadium',
   'Cassini Colosseum', 'Cassini Colosseum',
   '{"team_id": "saturn-rings", "location": "Saturn Rings", "capacity": "65,000", "nickname": "The Halo", "quality": "professional"}'::jsonb),

  ('80000000-0000-0000-0000-000000000014', 'stadium',
   'Hydrocarbon Park', 'Hydrocarbon Park',
   '{"team_id": "titan-methane", "location": "Titan", "capacity": "58,000", "nickname": "The Orange Haze", "quality": "professional"}'::jsonb),

  ('80000000-0000-0000-0000-000000000015', 'stadium',
   'Geyser Stadium', 'Geyser Stadium',
   '{"team_id": "enceladus-geysers", "location": "Enceladus", "capacity": "41,000", "nickname": "The Spray", "quality": "functional"}'::jsonb),

  ('80000000-0000-0000-0000-000000000016', 'stadium',
   'Polar Tilt Arena', 'Polar Tilt Arena',
   '{"team_id": "uranus-sidewinders", "location": "Uranus", "capacity": "55,000", "nickname": "The Tilted Field", "quality": "professional"}'::jsonb),

  -- ── Outer Reaches League ──────────────────────────────────────────────────

  ('80000000-0000-0000-0000-000000000017', 'stadium',
   'Dwarf Planet Field', 'Dwarf Planet Field',
   '{"team_id": "ceres-miners", "location": "Ceres", "capacity": "29,000", "nickname": "The Rock", "quality": "functional"}'::jsonb),

  ('80000000-0000-0000-0000-000000000018', 'stadium',
   'Protoplanet Arena', 'Protoplanet Arena',
   '{"team_id": "vesta", "location": "Vesta", "capacity": "24,000", "nickname": "The Crater", "quality": "functional"}'::jsonb),

  ('80000000-0000-0000-0000-000000000019', 'stadium',
   'Nomad Stadium', 'Nomad Stadium',
   '{"team_id": "pallas-wanderers", "location": "Pallas", "capacity": "21,000", "nickname": "The Drifter", "quality": "functional"}'::jsonb),

  ('80000000-0000-0000-0000-000000000020', 'stadium',
   'Subterranean Field', 'Subterranean Field',
   '{"team_id": "hygiea-united", "location": "Hygiea", "capacity": "18,000", "nickname": "The Dark Pitch", "quality": "functional"}'::jsonb),

  ('80000000-0000-0000-0000-000000000021', 'stadium',
   'Core Ore Stadium', 'Core Ore Stadium',
   '{"team_id": "psyche-metallics", "location": "Psyche", "capacity": "22,000", "nickname": "The Forge", "quality": "functional"}'::jsonb),

  ('80000000-0000-0000-0000-000000000022', 'stadium',
   'Juno Memorial Stadium', 'Juno Memorial Stadium',
   '{"team_id": "juno-city", "location": "Juno", "capacity": "26,000", "nickname": "The Temple", "quality": "professional"}'::jsonb),

  ('80000000-0000-0000-0000-000000000023', 'stadium',
   'Transit Hub Arena', 'Transit Hub Arena',
   '{"team_id": "beltway", "location": "Beltway Habitat", "capacity": "31,000", "nickname": "The Junction", "quality": "functional"}'::jsonb),

  ('80000000-0000-0000-0000-000000000024', 'stadium',
   'Extraction Field', 'Extraction Field',
   '{"team_id": "solar-miners", "location": "Solar Miners Habitat", "capacity": "19,000", "nickname": "The Dig", "quality": "frontier"}'::jsonb),

  -- ── Kuiper Belt League ────────────────────────────────────────────────────

  ('80000000-0000-0000-0000-000000000025', 'stadium',
   'Nitrogen Icebox', 'Nitrogen Icebox',
   '{"team_id": "pluto-frost", "location": "Pluto", "capacity": "25,000", "nickname": "The Deep Freeze", "quality": "functional"}'::jsonb),

  ('80000000-0000-0000-0000-000000000026', 'stadium',
   'Binary Lagrange Arena', 'Binary Lagrange Arena',
   '{"team_id": "charon-united", "location": "Charon", "capacity": "20,000", "nickname": "The Moon", "quality": "functional"}'::jsonb),

  ('80000000-0000-0000-0000-000000000027', 'stadium',
   'Distant Objects Stadium', 'Distant Objects Stadium',
   '{"team_id": "eris-wanderers", "location": "Eris", "capacity": "16,000", "nickname": "The Outpost", "quality": "frontier"}'::jsonb),

  ('80000000-0000-0000-0000-000000000028', 'stadium',
   'Centrifuge Field', 'Centrifuge Field',
   '{"team_id": "haumea-spinners", "location": "Haumea", "capacity": "14,000", "nickname": "The Oval", "quality": "frontier"}'::jsonb),

  ('80000000-0000-0000-0000-000000000029', 'stadium',
   'Creation Stadium', 'Creation Stadium',
   '{"team_id": "makemake", "location": "Makemake", "capacity": "12,000", "nickname": "The Cradle", "quality": "frontier"}'::jsonb),

  ('80000000-0000-0000-0000-000000000030', 'stadium',
   'Underworld Arena', 'Underworld Arena',
   '{"team_id": "orcus-athletic", "location": "Orcus", "capacity": "11,000", "nickname": "The Pit", "quality": "frontier"}'::jsonb),

  ('80000000-0000-0000-0000-000000000031', 'stadium',
   'Perihelion Park', 'Perihelion Park',
   '{"team_id": "sedna-mariners", "location": "Sedna", "capacity": "9,000", "nickname": "The Long Way Round", "quality": "frontier"}'::jsonb),

  ('80000000-0000-0000-0000-000000000032', 'stadium',
   'Void Stadium', 'Void Stadium',
   '{"team_id": "scattered-disc", "location": "Outer Kuiper Belt", "capacity": "8,000", "nickname": "The Scatter", "quality": "frontier"}'::jsonb)

ON CONFLICT (id) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 3: Training facility entities
-- ═══════════════════════════════════════════════════════════════════════════
-- Quality tiers descend with distance from the sun — inner-system clubs have
-- better-funded facilities; Kuiper Belt clubs operate on minimal budgets.
-- This creates a natural Architect narrative hook: the voting system's
-- "training_investment" focus is most meaningful for the outer-system clubs.

INSERT INTO entities (id, kind, name, display_name, meta) VALUES

  -- ── Rocky Inner League ────────────────────────────────────────────────────

  ('81000000-0000-0000-0000-000000000001', 'training_facility',
   'Sunrunner Training Complex', 'Sunrunner Complex',
   '{"team_id": "mercury-runners", "location": "Mercury", "quality": "elite"}'::jsonb),

  ('81000000-0000-0000-0000-000000000002', 'training_facility',
   'The Academy at Kingswood', 'Kingswood Academy',
   '{"team_id": "earth-united", "location": "Earth", "quality": "elite"}'::jsonb),

  ('81000000-0000-0000-0000-000000000003', 'training_facility',
   'Volcanic Edge Training Ground', 'Volcanic Edge',
   '{"team_id": "venus-volcanic", "location": "Venus", "quality": "professional"}'::jsonb),

  ('81000000-0000-0000-0000-000000000004', 'training_facility',
   'Greenhouse Performance Centre', 'Greenhouse Centre',
   '{"team_id": "terra-nova", "location": "Earth", "quality": "professional"}'::jsonb),

  ('81000000-0000-0000-0000-000000000005', 'training_facility',
   'Red Dust Training Grounds', 'Red Dust Grounds',
   '{"team_id": "mars-athletic", "location": "Mars", "quality": "professional"}'::jsonb),

  ('81000000-0000-0000-0000-000000000006', 'training_facility',
   'High Peak Performance Centre', 'High Peak Centre',
   '{"team_id": "olympus-mons", "location": "Mars", "quality": "elite"}'::jsonb),

  ('81000000-0000-0000-0000-000000000007', 'training_facility',
   'Canyon Drills Complex', 'Canyon Drills',
   '{"team_id": "valles-mariners", "location": "Mars", "quality": "professional"}'::jsonb),

  ('81000000-0000-0000-0000-000000000008', 'training_facility',
   'Zero-G Performance Dome', 'Zero-G Dome',
   '{"team_id": "solar-city", "location": "Largest Orbital Colony", "quality": "elite"}'::jsonb),

  -- ── Gas / Ice Giant League ────────────────────────────────────────────────

  ('81000000-0000-0000-0000-000000000009', 'training_facility',
   'Storm Belt Athletic Campus', 'Storm Belt Campus',
   '{"team_id": "jupiter-titans", "location": "Jupiter", "quality": "elite"}'::jsonb),

  ('81000000-0000-0000-0000-000000000010', 'training_facility',
   'Subsurface Athletic Institute', 'Subsurface Institute',
   '{"team_id": "europa-oceanic", "location": "Europa", "quality": "professional"}'::jsonb),

  ('81000000-0000-0000-0000-000000000011', 'training_facility',
   'Cradle Academy', 'Cradle Academy',
   '{"team_id": "ganymede-united", "location": "Ganymede", "quality": "professional"}'::jsonb),

  ('81000000-0000-0000-0000-000000000012', 'training_facility',
   'Tundra Performance Centre', 'Tundra Centre',
   '{"team_id": "callisto-wolves", "location": "Callisto", "quality": "standard"}'::jsonb),

  ('81000000-0000-0000-0000-000000000013', 'training_facility',
   'Ring-Side Training Complex', 'Ring-Side Complex',
   '{"team_id": "saturn-rings", "location": "Saturn Rings", "quality": "professional"}'::jsonb),

  ('81000000-0000-0000-0000-000000000014', 'training_facility',
   'Hydrocarbon Athletic Campus', 'Hydrocarbon Campus',
   '{"team_id": "titan-methane", "location": "Titan", "quality": "professional"}'::jsonb),

  ('81000000-0000-0000-0000-000000000015', 'training_facility',
   'Geyser Training Grounds', 'Geyser Grounds',
   '{"team_id": "enceladus-geysers", "location": "Enceladus", "quality": "standard"}'::jsonb),

  ('81000000-0000-0000-0000-000000000016', 'training_facility',
   'Sideways Athletic Institute', 'Sideways Institute',
   '{"team_id": "uranus-sidewinders", "location": "Uranus", "quality": "professional"}'::jsonb),

  -- ── Outer Reaches League ──────────────────────────────────────────────────

  ('81000000-0000-0000-0000-000000000017', 'training_facility',
   'Ceres Deep Training Complex', 'Ceres Deep Complex',
   '{"team_id": "ceres-miners", "location": "Ceres", "quality": "standard"}'::jsonb),

  ('81000000-0000-0000-0000-000000000018', 'training_facility',
   'Vesta Athletic Centre', 'Vesta Centre',
   '{"team_id": "vesta", "location": "Vesta", "quality": "standard"}'::jsonb),

  ('81000000-0000-0000-0000-000000000019', 'training_facility',
   'Nomad Training Grounds', 'Nomad Grounds',
   '{"team_id": "pallas-wanderers", "location": "Pallas", "quality": "basic"}'::jsonb),

  ('81000000-0000-0000-0000-000000000020', 'training_facility',
   'The Dark Pitch Academy', 'Dark Pitch Academy',
   '{"team_id": "hygiea-united", "location": "Hygiea", "quality": "basic"}'::jsonb),

  ('81000000-0000-0000-0000-000000000021', 'training_facility',
   'Core Training Campus', 'Core Campus',
   '{"team_id": "psyche-metallics", "location": "Psyche", "quality": "standard"}'::jsonb),

  ('81000000-0000-0000-0000-000000000022', 'training_facility',
   'Juno Temple Training Ground', 'Juno Temple Grounds',
   '{"team_id": "juno-city", "location": "Juno", "quality": "standard"}'::jsonb),

  ('81000000-0000-0000-0000-000000000023', 'training_facility',
   'The Junction Academy', 'Junction Academy',
   '{"team_id": "beltway", "location": "Beltway Habitat", "quality": "standard"}'::jsonb),

  ('81000000-0000-0000-0000-000000000024', 'training_facility',
   'Extraction Athletic Campus', 'Extraction Campus',
   '{"team_id": "solar-miners", "location": "Solar Miners Habitat", "quality": "basic"}'::jsonb),

  -- ── Kuiper Belt League ────────────────────────────────────────────────────

  ('81000000-0000-0000-0000-000000000025', 'training_facility',
   'Frost Academy', 'Frost Academy',
   '{"team_id": "pluto-frost", "location": "Pluto", "quality": "standard"}'::jsonb),

  ('81000000-0000-0000-0000-000000000026', 'training_facility',
   'Binary Training Complex', 'Binary Complex',
   '{"team_id": "charon-united", "location": "Charon", "quality": "basic"}'::jsonb),

  ('81000000-0000-0000-0000-000000000027', 'training_facility',
   'The Long Road Training Ground', 'Long Road Grounds',
   '{"team_id": "eris-wanderers", "location": "Eris", "quality": "basic"}'::jsonb),

  ('81000000-0000-0000-0000-000000000028', 'training_facility',
   'Oval Athletic Centre', 'Oval Centre',
   '{"team_id": "haumea-spinners", "location": "Haumea", "quality": "basic"}'::jsonb),

  ('81000000-0000-0000-0000-000000000029', 'training_facility',
   'Creation Academy', 'Creation Academy',
   '{"team_id": "makemake", "location": "Makemake", "quality": "basic"}'::jsonb),

  ('81000000-0000-0000-0000-000000000030', 'training_facility',
   'The Pit Training Complex', 'The Pit Complex',
   '{"team_id": "orcus-athletic", "location": "Orcus", "quality": "basic"}'::jsonb),

  ('81000000-0000-0000-0000-000000000031', 'training_facility',
   'Perihelion Training Ground', 'Perihelion Grounds',
   '{"team_id": "sedna-mariners", "location": "Sedna", "quality": "basic"}'::jsonb),

  ('81000000-0000-0000-0000-000000000032', 'training_facility',
   'The Scatter Academy', 'Scatter Academy',
   '{"team_id": "scattered-disc", "location": "Outer Kuiper Belt", "quality": "basic"}'::jsonb)

ON CONFLICT (id) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 4: Backfill FK columns on teams
-- ═══════════════════════════════════════════════════════════════════════════
-- Map each team slug to the entity IDs created above.  Written as individual
-- UPDATEs rather than a single JOIN so the intent is auditable and re-running
-- is a no-op (UPDATE on matching WHERE clause is idempotent).

-- Rocky Inner League
UPDATE teams SET stadium_entity_id = '80000000-0000-0000-0000-000000000001', training_facility_entity_id = '81000000-0000-0000-0000-000000000001' WHERE id = 'mercury-runners';
UPDATE teams SET stadium_entity_id = '80000000-0000-0000-0000-000000000002', training_facility_entity_id = '81000000-0000-0000-0000-000000000002' WHERE id = 'earth-united';
UPDATE teams SET stadium_entity_id = '80000000-0000-0000-0000-000000000003', training_facility_entity_id = '81000000-0000-0000-0000-000000000003' WHERE id = 'venus-volcanic';
UPDATE teams SET stadium_entity_id = '80000000-0000-0000-0000-000000000004', training_facility_entity_id = '81000000-0000-0000-0000-000000000004' WHERE id = 'terra-nova';
UPDATE teams SET stadium_entity_id = '80000000-0000-0000-0000-000000000005', training_facility_entity_id = '81000000-0000-0000-0000-000000000005' WHERE id = 'mars-athletic';
UPDATE teams SET stadium_entity_id = '80000000-0000-0000-0000-000000000006', training_facility_entity_id = '81000000-0000-0000-0000-000000000006' WHERE id = 'olympus-mons';
UPDATE teams SET stadium_entity_id = '80000000-0000-0000-0000-000000000007', training_facility_entity_id = '81000000-0000-0000-0000-000000000007' WHERE id = 'valles-mariners';
UPDATE teams SET stadium_entity_id = '80000000-0000-0000-0000-000000000008', training_facility_entity_id = '81000000-0000-0000-0000-000000000008' WHERE id = 'solar-city';

-- Gas / Ice Giant League
UPDATE teams SET stadium_entity_id = '80000000-0000-0000-0000-000000000009', training_facility_entity_id = '81000000-0000-0000-0000-000000000009' WHERE id = 'jupiter-titans';
UPDATE teams SET stadium_entity_id = '80000000-0000-0000-0000-000000000010', training_facility_entity_id = '81000000-0000-0000-0000-000000000010' WHERE id = 'europa-oceanic';
UPDATE teams SET stadium_entity_id = '80000000-0000-0000-0000-000000000011', training_facility_entity_id = '81000000-0000-0000-0000-000000000011' WHERE id = 'ganymede-united';
UPDATE teams SET stadium_entity_id = '80000000-0000-0000-0000-000000000012', training_facility_entity_id = '81000000-0000-0000-0000-000000000012' WHERE id = 'callisto-wolves';
UPDATE teams SET stadium_entity_id = '80000000-0000-0000-0000-000000000013', training_facility_entity_id = '81000000-0000-0000-0000-000000000013' WHERE id = 'saturn-rings';
UPDATE teams SET stadium_entity_id = '80000000-0000-0000-0000-000000000014', training_facility_entity_id = '81000000-0000-0000-0000-000000000014' WHERE id = 'titan-methane';
UPDATE teams SET stadium_entity_id = '80000000-0000-0000-0000-000000000015', training_facility_entity_id = '81000000-0000-0000-0000-000000000015' WHERE id = 'enceladus-geysers';
UPDATE teams SET stadium_entity_id = '80000000-0000-0000-0000-000000000016', training_facility_entity_id = '81000000-0000-0000-0000-000000000016' WHERE id = 'uranus-sidewinders';

-- Outer Reaches League
UPDATE teams SET stadium_entity_id = '80000000-0000-0000-0000-000000000017', training_facility_entity_id = '81000000-0000-0000-0000-000000000017' WHERE id = 'ceres-miners';
UPDATE teams SET stadium_entity_id = '80000000-0000-0000-0000-000000000018', training_facility_entity_id = '81000000-0000-0000-0000-000000000018' WHERE id = 'vesta';
UPDATE teams SET stadium_entity_id = '80000000-0000-0000-0000-000000000019', training_facility_entity_id = '81000000-0000-0000-0000-000000000019' WHERE id = 'pallas-wanderers';
UPDATE teams SET stadium_entity_id = '80000000-0000-0000-0000-000000000020', training_facility_entity_id = '81000000-0000-0000-0000-000000000020' WHERE id = 'hygiea-united';
UPDATE teams SET stadium_entity_id = '80000000-0000-0000-0000-000000000021', training_facility_entity_id = '81000000-0000-0000-0000-000000000021' WHERE id = 'psyche-metallics';
UPDATE teams SET stadium_entity_id = '80000000-0000-0000-0000-000000000022', training_facility_entity_id = '81000000-0000-0000-0000-000000000022' WHERE id = 'juno-city';
UPDATE teams SET stadium_entity_id = '80000000-0000-0000-0000-000000000023', training_facility_entity_id = '81000000-0000-0000-0000-000000000023' WHERE id = 'beltway';
UPDATE teams SET stadium_entity_id = '80000000-0000-0000-0000-000000000024', training_facility_entity_id = '81000000-0000-0000-0000-000000000024' WHERE id = 'solar-miners';

-- Kuiper Belt League
UPDATE teams SET stadium_entity_id = '80000000-0000-0000-0000-000000000025', training_facility_entity_id = '81000000-0000-0000-0000-000000000025' WHERE id = 'pluto-frost';
UPDATE teams SET stadium_entity_id = '80000000-0000-0000-0000-000000000026', training_facility_entity_id = '81000000-0000-0000-0000-000000000026' WHERE id = 'charon-united';
UPDATE teams SET stadium_entity_id = '80000000-0000-0000-0000-000000000027', training_facility_entity_id = '81000000-0000-0000-0000-000000000027' WHERE id = 'eris-wanderers';
UPDATE teams SET stadium_entity_id = '80000000-0000-0000-0000-000000000028', training_facility_entity_id = '81000000-0000-0000-0000-000000000028' WHERE id = 'haumea-spinners';
UPDATE teams SET stadium_entity_id = '80000000-0000-0000-0000-000000000029', training_facility_entity_id = '81000000-0000-0000-0000-000000000029' WHERE id = 'makemake';
UPDATE teams SET stadium_entity_id = '80000000-0000-0000-0000-000000000030', training_facility_entity_id = '81000000-0000-0000-0000-000000000030' WHERE id = 'orcus-athletic';
UPDATE teams SET stadium_entity_id = '80000000-0000-0000-0000-000000000031', training_facility_entity_id = '81000000-0000-0000-0000-000000000031' WHERE id = 'sedna-mariners';
UPDATE teams SET stadium_entity_id = '80000000-0000-0000-0000-000000000032', training_facility_entity_id = '81000000-0000-0000-0000-000000000032' WHERE id = 'scattered-disc';
