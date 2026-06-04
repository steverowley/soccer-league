-- ── 0064_seed_entity_relationships.sql ───────────────────────────────────────
-- WHY: Wires the entity graph introduced in migrations 0062–0063 into the
-- `entity_relationships` table.  Without edges, the new nodes are islands —
-- the Architect can name them but cannot reason about their stakes in any
-- given match or narrative.  With edges, it can generate stories like:
--   "Prefect Senn (Jovian Conclave Party, strength +85 toward Jupiter Titans)
--    publicly denounced the Belt Workers' Congress after Ceres Miners' upset
--    victory at Storm Arena."
--
-- RELATIONSHIP TAXONOMY (kind labels used below):
--   member_of          — politician belongs to political party
--   leads              — politician heads a political body
--   based_in           — political party's home planet/region
--   sympathises_with   — party leans toward a club (positive) or is hostile
--                        (negative); strength encodes the degree
--   staff_of           — managing staff works for a team
--   home_of            — stadium belongs to a team
--   trains_at          — training facility belongs to a team
--   affiliated_with    — officials association is affiliated with another body
--   employed_by        — sports writer works for a media company
--   covers             — media entity covers a league or club
--   rival              — mutual hostility between two parties or politicians
--
-- STRENGTH SEMANTICS (range -100 to +100):
--   +100  — inseparable allies; the Architect treats as a single bloc
--    +80  — strong allegiance; publicly declared support
--    +50  — moderate sympathy; general alignment
--    +20  — mild preference; no active support
--      0  — neutral
--    -20  — mild friction; public disagreements
--    -50  — open rivalry; competing interests
--    -80  — active hostility; formal opposition
--   -100  — sworn enemies; the Architect generates conflict arcs automatically
--
-- IDEMPOTENT — uses INSERT … ON CONFLICT (from_id, to_id, kind) DO NOTHING
-- so re-running this file is safe.  The `entity_relationships` table has a
-- composite PK on (from_id, to_id, kind) which enforces uniqueness.
-- ──────────────────────────────────────────────────────────────────────────────


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 1: Politicians → political parties (member_of)
-- ═══════════════════════════════════════════════════════════════════════════
-- Every politician belongs to exactly one party.  Strength reflects how
-- orthodox their alignment is — lower values hint at internal friction the
-- Architect can exploit.

INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta) VALUES

  -- Lyra Vance → Solaris Compact (public figurehead; strength max)
  ('71000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001','member_of', 90, '{}'::jsonb),
  -- Korrax Zheng → Solaris Compact (nominally neutral but functionally aligned)
  ('71000000-0000-0000-0000-000000000002','70000000-0000-0000-0000-000000000001','member_of', 60, '{}'::jsonb),
  -- Senna Obuobi → Frontier Coalition (true believer)
  ('71000000-0000-0000-0000-000000000003','70000000-0000-0000-0000-000000000002','member_of', 95, '{}'::jsonb),
  -- Mika Doru → Mercury Technocratic Alliance
  ('71000000-0000-0000-0000-000000000004','70000000-0000-0000-0000-000000000003','member_of', 85, '{}'::jsonb),
  -- Aria Velloris → Cloudborn Collective
  ('71000000-0000-0000-0000-000000000005','70000000-0000-0000-0000-000000000005','member_of', 80, '{}'::jsonb),
  -- Harko Ren → Red Frontier Party
  ('71000000-0000-0000-0000-000000000006','70000000-0000-0000-0000-000000000009','member_of', 90, '{}'::jsonb),
  -- Boros Senn → Jovian Conclave Party
  ('71000000-0000-0000-0000-000000000007','70000000-0000-0000-0000-000000000011','member_of', 85, '{}'::jsonb),
  -- Petra Vask → Belt Workers' Congress
  ('71000000-0000-0000-0000-000000000008','70000000-0000-0000-0000-000000000017','member_of', 95, '{}'::jsonb),
  -- Thane Noor → Kuiper Sovereignty Assembly
  ('71000000-0000-0000-0000-000000000009','70000000-0000-0000-0000-000000000019','member_of', 70, '{}'::jsonb),
  -- Orin Castellane → The Heritage League
  ('71000000-0000-0000-0000-000000000010','70000000-0000-0000-0000-000000000007','member_of', 80, '{}'::jsonb)

ON CONFLICT (from_id, to_id, kind) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 2: Politicians → political bodies (leads)
-- ═══════════════════════════════════════════════════════════════════════════
-- Links the named politicians to the existing political body entities from
-- migration 0036.  The Architect uses this to understand who speaks for
-- which institution in a decree or controversy arc.

INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta) VALUES

  -- Lyra Vance leads Office of the Earth President
  ('71000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000003','leads', 100, '{}'::jsonb),
  -- Korrax Zheng leads Galactic League Council
  ('71000000-0000-0000-0000-000000000002','41000000-0000-0000-0000-000000000002','leads', 100, '{}'::jsonb),
  -- Mika Doru leads Mercury Solar Authority
  ('71000000-0000-0000-0000-000000000004','40000000-0000-0000-0000-000000000010','leads', 100, '{}'::jsonb),
  -- Aria Velloris senior figure in Venus Cloud Senate
  ('71000000-0000-0000-0000-000000000005','40000000-0000-0000-0000-000000000011','leads',  70, '{}'::jsonb),
  -- Harko Ren leads Mars Republic Assembly
  ('71000000-0000-0000-0000-000000000006','40000000-0000-0000-0000-000000000013','leads', 100, '{}'::jsonb),
  -- Boros Senn speaks for Jovian League Conclave
  ('71000000-0000-0000-0000-000000000007','40000000-0000-0000-0000-000000000014','leads',  75, '{}'::jsonb),
  -- Petra Vask represents Belt Confederation
  ('71000000-0000-0000-0000-000000000008','40000000-0000-0000-0000-000000000018','leads',  80, '{}'::jsonb),
  -- Thane Noor speaks for Kuiper Frontier Assembly
  ('71000000-0000-0000-0000-000000000009','40000000-0000-0000-0000-000000000019','leads',  65, '{}'::jsonb)

ON CONFLICT (from_id, to_id, kind) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 3: Political parties → planets (based_in)
-- ═══════════════════════════════════════════════════════════════════════════
-- Anchors each party to its home planet entity from migration 0036.
-- System-wide parties are NOT linked here (no single homeworld).

INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta) VALUES

  -- Mercury parties
  ('70000000-0000-0000-0000-000000000003','51000000-0000-0000-0000-000000000001','based_in', 80, '{}'::jsonb),
  ('70000000-0000-0000-0000-000000000004','51000000-0000-0000-0000-000000000001','based_in', 50, '{}'::jsonb),
  -- Venus parties
  ('70000000-0000-0000-0000-000000000005','51000000-0000-0000-0000-000000000002','based_in', 80, '{}'::jsonb),
  ('70000000-0000-0000-0000-000000000006','51000000-0000-0000-0000-000000000002','based_in', 60, '{}'::jsonb),
  -- Earth parties
  ('70000000-0000-0000-0000-000000000007','51000000-0000-0000-0000-000000000003','based_in', 80, '{}'::jsonb),
  ('70000000-0000-0000-0000-000000000008','51000000-0000-0000-0000-000000000003','based_in', 70, '{}'::jsonb),
  -- Mars parties
  ('70000000-0000-0000-0000-000000000009','50000000-0000-0000-0000-000000000004','based_in', 90, '{}'::jsonb),
  ('70000000-0000-0000-0000-000000000010','50000000-0000-0000-0000-000000000004','based_in', 75, '{}'::jsonb),
  -- Jupiter parties
  ('70000000-0000-0000-0000-000000000011','50000000-0000-0000-0000-000000000005','based_in', 80, '{}'::jsonb),
  ('70000000-0000-0000-0000-000000000012','50000000-0000-0000-0000-000000000005','based_in', 65, '{}'::jsonb),
  -- Saturn parties
  ('70000000-0000-0000-0000-000000000013','50000000-0000-0000-0000-000000000006','based_in', 80, '{}'::jsonb),
  ('70000000-0000-0000-0000-000000000014','50000000-0000-0000-0000-000000000006','based_in', 65, '{}'::jsonb),
  -- Uranus
  ('70000000-0000-0000-0000-000000000015','50000000-0000-0000-0000-000000000007','based_in', 80, '{}'::jsonb),
  -- Neptune
  ('70000000-0000-0000-0000-000000000016','50000000-0000-0000-0000-000000000008','based_in', 80, '{}'::jsonb)

ON CONFLICT (from_id, to_id, kind) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 4: Political parties → team shadow entities (sympathises_with)
-- ═══════════════════════════════════════════════════════════════════════════
-- Each planetary party strongly backs the clubs on its world.  Cross-planet
-- hostilities are seeded for the most dramatically interesting pairs.
-- Strength values:
--   +70 to +90  — home-world alignment (the party openly backs the club)
--   -50 to -80  — cross-world hostility (ideological or territorial rivalry)
--
-- Team shadow entity IDs are looked up by subquery since they are
-- auto-generated by the teams_sync_entity trigger in migration 0048.

INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta)
SELECT p.party_id, e.id, 'sympathises_with', p.strength, '{}'::jsonb
FROM (VALUES
  -- Solaris Compact broadly backs the establishment inner-system clubs
  ('70000000-0000-0000-0000-000000000001'::uuid, 'earth-united',    75),
  ('70000000-0000-0000-0000-000000000001'::uuid, 'terra-nova',      65),
  ('70000000-0000-0000-0000-000000000001'::uuid, 'olympus-mons',    55),
  ('70000000-0000-0000-0000-000000000001'::uuid, 'jupiter-titans',  50),
  -- Frontier Coalition backs outer-system clubs
  ('70000000-0000-0000-0000-000000000002'::uuid, 'ceres-miners',    80),
  ('70000000-0000-0000-0000-000000000002'::uuid, 'beltway',         75),
  ('70000000-0000-0000-0000-000000000002'::uuid, 'pluto-frost',     70),
  ('70000000-0000-0000-0000-000000000002'::uuid, 'scattered-disc',  65),
  ('70000000-0000-0000-0000-000000000002'::uuid, 'jupiter-titans', -40),
  -- Mercury Technocratic Alliance backs Mercury Runners
  ('70000000-0000-0000-0000-000000000003'::uuid, 'mercury-runners', 85),
  -- Solar Exposure Party is hostile to Mercury Runners (speed over safety)
  ('70000000-0000-0000-0000-000000000004'::uuid, 'mercury-runners', -30),
  -- Cloudborn Collective backs Venus Volcanic
  ('70000000-0000-0000-0000-000000000005'::uuid, 'venus-volcanic',  85),
  -- Surface Liberation Front is ironically hostile to the dome club
  ('70000000-0000-0000-0000-000000000006'::uuid, 'venus-volcanic',  -50),
  -- Heritage League backs the old Earth clubs
  ('70000000-0000-0000-0000-000000000007'::uuid, 'earth-united',    90),
  ('70000000-0000-0000-0000-000000000007'::uuid, 'terra-nova',      70),
  ('70000000-0000-0000-0000-000000000007'::uuid, 'solar-city',     -30),  -- orbital = not "proper" Earth
  -- United Colonies Party backs off-world clubs
  ('70000000-0000-0000-0000-000000000008'::uuid, 'solar-city',      80),
  ('70000000-0000-0000-0000-000000000008'::uuid, 'mars-athletic',   60),
  ('70000000-0000-0000-0000-000000000008'::uuid, 'olympus-mons',    55),
  -- Red Frontier Party is strongly nationalist toward all three Mars clubs
  ('70000000-0000-0000-0000-000000000009'::uuid, 'mars-athletic',   90),
  ('70000000-0000-0000-0000-000000000009'::uuid, 'olympus-mons',    85),
  ('70000000-0000-0000-0000-000000000009'::uuid, 'valles-mariners', 80),
  ('70000000-0000-0000-0000-000000000009'::uuid, 'earth-united',   -60),
  -- Terra Rossa Alliance — moderate Mars support
  ('70000000-0000-0000-0000-000000000010'::uuid, 'mars-athletic',   70),
  ('70000000-0000-0000-0000-000000000010'::uuid, 'valles-mariners', 65),
  -- Jovian Conclave Party heavily backs Jupiter Titans; hostile to moon clubs
  ('70000000-0000-0000-0000-000000000011'::uuid, 'jupiter-titans',  90),
  ('70000000-0000-0000-0000-000000000011'::uuid, 'europa-oceanic',  -40),
  ('70000000-0000-0000-0000-000000000011'::uuid, 'ganymede-united', -35),
  ('70000000-0000-0000-0000-000000000011'::uuid, 'callisto-wolves', -30),
  -- Galilean Independence Movement backs the moon clubs
  ('70000000-0000-0000-0000-000000000012'::uuid, 'europa-oceanic',  85),
  ('70000000-0000-0000-0000-000000000012'::uuid, 'ganymede-united', 80),
  ('70000000-0000-0000-0000-000000000012'::uuid, 'callisto-wolves', 75),
  ('70000000-0000-0000-0000-000000000012'::uuid, 'jupiter-titans',  -55),
  -- Ring Keepers back Saturn Rings FC (the establishment ring club)
  ('70000000-0000-0000-0000-000000000013'::uuid, 'saturn-rings',    85),
  ('70000000-0000-0000-0000-000000000013'::uuid, 'titan-methane',   -20),
  -- Titan Progressive Alliance backs Titan Methane SC
  ('70000000-0000-0000-0000-000000000014'::uuid, 'titan-methane',   85),
  ('70000000-0000-0000-0000-000000000014'::uuid, 'enceladus-geysers', 60),
  -- Sideways Republic backs Uranus Sidewinders
  ('70000000-0000-0000-0000-000000000015'::uuid, 'uranus-sidewinders', 85),
  -- Deep Current Party (party 16) intentionally backs no club: Neptune has
  -- no club in the current 32-team roster, and the isolationist Deep Current
  -- faction "rarely speaks, never twice" — leaving it without a sympathises_with
  -- edge is lore-consistent. (Previously referenced a phantom 'neptune-mariners'
  -- slug that the inner JOIN silently dropped.)
  -- Belt Workers' Congress backs all Belt clubs
  ('70000000-0000-0000-0000-000000000017'::uuid, 'ceres-miners',    85),
  ('70000000-0000-0000-0000-000000000017'::uuid, 'vesta',           75),
  ('70000000-0000-0000-0000-000000000017'::uuid, 'solar-miners',    80),
  ('70000000-0000-0000-0000-000000000017'::uuid, 'beltway',         75),
  ('70000000-0000-0000-0000-000000000017'::uuid, 'jupiter-titans',  -50),
  -- Ceres Free State prefers minimal league regulation; broadly positive to all Belt clubs
  ('70000000-0000-0000-0000-000000000018'::uuid, 'ceres-miners',    70),
  ('70000000-0000-0000-0000-000000000018'::uuid, 'psyche-metallics', 65),
  -- Kuiper Sovereignty Assembly backs all Kuiper clubs
  ('70000000-0000-0000-0000-000000000019'::uuid, 'pluto-frost',     85),
  ('70000000-0000-0000-0000-000000000019'::uuid, 'eris-wanderers',  80),
  ('70000000-0000-0000-0000-000000000019'::uuid, 'scattered-disc',  75),
  ('70000000-0000-0000-0000-000000000019'::uuid, 'sedna-mariners',  70),
  -- Long Orbit Party is passively supportive of all Kuiper clubs
  ('70000000-0000-0000-0000-000000000020'::uuid, 'pluto-frost',     50),
  ('70000000-0000-0000-0000-000000000020'::uuid, 'sedna-mariners',  60)
) AS p(party_id, team_slug, strength)
JOIN entities e ON e.kind = 'team' AND e.meta->>'team_id' = p.team_slug
ON CONFLICT (from_id, to_id, kind) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 5: Managing staff → team shadow entities (staff_of)
-- ═══════════════════════════════════════════════════════════════════════════
-- Links each managing staff entity to the team they work for.  Strength is
-- +80 (employed; professional loyalty) rather than +100 — leaves room for
-- the Architect to generate "staff unrest" arcs when other factors push it
-- toward a negative direction.

INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta)
SELECT s.staff_id, e.id, 'staff_of', 80, '{}'::jsonb
FROM (VALUES
  ('75000000-0000-0000-0000-000000000001'::uuid, 'mercury-runners'),
  ('75000000-0000-0000-0000-000000000002'::uuid, 'earth-united'),
  ('75000000-0000-0000-0000-000000000003'::uuid, 'venus-volcanic'),
  ('75000000-0000-0000-0000-000000000004'::uuid, 'terra-nova'),
  ('75000000-0000-0000-0000-000000000005'::uuid, 'mars-athletic'),
  ('75000000-0000-0000-0000-000000000006'::uuid, 'olympus-mons'),
  ('75000000-0000-0000-0000-000000000007'::uuid, 'valles-mariners'),
  ('75000000-0000-0000-0000-000000000008'::uuid, 'solar-city'),
  ('75000000-0000-0000-0000-000000000009'::uuid, 'jupiter-titans'),
  ('75000000-0000-0000-0000-000000000010'::uuid, 'europa-oceanic'),
  ('75000000-0000-0000-0000-000000000011'::uuid, 'ganymede-united'),
  ('75000000-0000-0000-0000-000000000012'::uuid, 'callisto-wolves'),
  ('75000000-0000-0000-0000-000000000013'::uuid, 'saturn-rings'),
  ('75000000-0000-0000-0000-000000000014'::uuid, 'titan-methane'),
  ('75000000-0000-0000-0000-000000000015'::uuid, 'enceladus-geysers'),
  ('75000000-0000-0000-0000-000000000016'::uuid, 'uranus-sidewinders'),
  ('75000000-0000-0000-0000-000000000017'::uuid, 'ceres-miners'),
  ('75000000-0000-0000-0000-000000000018'::uuid, 'vesta'),
  ('75000000-0000-0000-0000-000000000019'::uuid, 'pallas-wanderers'),
  ('75000000-0000-0000-0000-000000000020'::uuid, 'hygiea-united'),
  ('75000000-0000-0000-0000-000000000021'::uuid, 'psyche-metallics'),
  ('75000000-0000-0000-0000-000000000022'::uuid, 'juno-city'),
  ('75000000-0000-0000-0000-000000000023'::uuid, 'beltway'),
  ('75000000-0000-0000-0000-000000000024'::uuid, 'solar-miners'),
  ('75000000-0000-0000-0000-000000000025'::uuid, 'pluto-frost'),
  ('75000000-0000-0000-0000-000000000026'::uuid, 'charon-united'),
  ('75000000-0000-0000-0000-000000000027'::uuid, 'eris-wanderers'),
  ('75000000-0000-0000-0000-000000000028'::uuid, 'haumea-spinners'),
  ('75000000-0000-0000-0000-000000000029'::uuid, 'makemake'),
  ('75000000-0000-0000-0000-000000000030'::uuid, 'orcus-athletic'),
  ('75000000-0000-0000-0000-000000000031'::uuid, 'sedna-mariners'),
  ('75000000-0000-0000-0000-000000000032'::uuid, 'scattered-disc')
) AS s(staff_id, team_slug)
JOIN entities e ON e.kind = 'team' AND e.meta->>'team_id' = s.team_slug
ON CONFLICT (from_id, to_id, kind) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 6: Stadiums and training facilities → team shadow entities
-- ═══════════════════════════════════════════════════════════════════════════
-- `home_of` and `trains_at` make the Architect's graph navigable from both
-- directions: given a team, find its venues; given a venue, find its team.

INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta)
SELECT s.venue_id, e.id, s.rel_kind, 100, '{}'::jsonb
FROM (VALUES
  -- Stadiums
  ('80000000-0000-0000-0000-000000000001'::uuid,'mercury-runners',  'home_of'),
  ('80000000-0000-0000-0000-000000000002'::uuid,'earth-united',     'home_of'),
  ('80000000-0000-0000-0000-000000000003'::uuid,'venus-volcanic',   'home_of'),
  ('80000000-0000-0000-0000-000000000004'::uuid,'terra-nova',       'home_of'),
  ('80000000-0000-0000-0000-000000000005'::uuid,'mars-athletic',    'home_of'),
  ('80000000-0000-0000-0000-000000000006'::uuid,'olympus-mons',     'home_of'),
  ('80000000-0000-0000-0000-000000000007'::uuid,'valles-mariners',  'home_of'),
  ('80000000-0000-0000-0000-000000000008'::uuid,'solar-city',       'home_of'),
  ('80000000-0000-0000-0000-000000000009'::uuid,'jupiter-titans',   'home_of'),
  ('80000000-0000-0000-0000-000000000010'::uuid,'europa-oceanic',   'home_of'),
  ('80000000-0000-0000-0000-000000000011'::uuid,'ganymede-united',  'home_of'),
  ('80000000-0000-0000-0000-000000000012'::uuid,'callisto-wolves',  'home_of'),
  ('80000000-0000-0000-0000-000000000013'::uuid,'saturn-rings',     'home_of'),
  ('80000000-0000-0000-0000-000000000014'::uuid,'titan-methane',    'home_of'),
  ('80000000-0000-0000-0000-000000000015'::uuid,'enceladus-geysers','home_of'),
  ('80000000-0000-0000-0000-000000000016'::uuid,'uranus-sidewinders','home_of'),
  ('80000000-0000-0000-0000-000000000017'::uuid,'ceres-miners',     'home_of'),
  ('80000000-0000-0000-0000-000000000018'::uuid,'vesta',            'home_of'),
  ('80000000-0000-0000-0000-000000000019'::uuid,'pallas-wanderers', 'home_of'),
  ('80000000-0000-0000-0000-000000000020'::uuid,'hygiea-united',    'home_of'),
  ('80000000-0000-0000-0000-000000000021'::uuid,'psyche-metallics', 'home_of'),
  ('80000000-0000-0000-0000-000000000022'::uuid,'juno-city',        'home_of'),
  ('80000000-0000-0000-0000-000000000023'::uuid,'beltway',          'home_of'),
  ('80000000-0000-0000-0000-000000000024'::uuid,'solar-miners',     'home_of'),
  ('80000000-0000-0000-0000-000000000025'::uuid,'pluto-frost',      'home_of'),
  ('80000000-0000-0000-0000-000000000026'::uuid,'charon-united',    'home_of'),
  ('80000000-0000-0000-0000-000000000027'::uuid,'eris-wanderers',   'home_of'),
  ('80000000-0000-0000-0000-000000000028'::uuid,'haumea-spinners',  'home_of'),
  ('80000000-0000-0000-0000-000000000029'::uuid,'makemake',         'home_of'),
  ('80000000-0000-0000-0000-000000000030'::uuid,'orcus-athletic',   'home_of'),
  ('80000000-0000-0000-0000-000000000031'::uuid,'sedna-mariners',   'home_of'),
  ('80000000-0000-0000-0000-000000000032'::uuid,'scattered-disc',   'home_of'),
  -- Training facilities
  ('81000000-0000-0000-0000-000000000001'::uuid,'mercury-runners',  'trains_at'),
  ('81000000-0000-0000-0000-000000000002'::uuid,'earth-united',     'trains_at'),
  ('81000000-0000-0000-0000-000000000003'::uuid,'venus-volcanic',   'trains_at'),
  ('81000000-0000-0000-0000-000000000004'::uuid,'terra-nova',       'trains_at'),
  ('81000000-0000-0000-0000-000000000005'::uuid,'mars-athletic',    'trains_at'),
  ('81000000-0000-0000-0000-000000000006'::uuid,'olympus-mons',     'trains_at'),
  ('81000000-0000-0000-0000-000000000007'::uuid,'valles-mariners',  'trains_at'),
  ('81000000-0000-0000-0000-000000000008'::uuid,'solar-city',       'trains_at'),
  ('81000000-0000-0000-0000-000000000009'::uuid,'jupiter-titans',   'trains_at'),
  ('81000000-0000-0000-0000-000000000010'::uuid,'europa-oceanic',   'trains_at'),
  ('81000000-0000-0000-0000-000000000011'::uuid,'ganymede-united',  'trains_at'),
  ('81000000-0000-0000-0000-000000000012'::uuid,'callisto-wolves',  'trains_at'),
  ('81000000-0000-0000-0000-000000000013'::uuid,'saturn-rings',     'trains_at'),
  ('81000000-0000-0000-0000-000000000014'::uuid,'titan-methane',    'trains_at'),
  ('81000000-0000-0000-0000-000000000015'::uuid,'enceladus-geysers','trains_at'),
  ('81000000-0000-0000-0000-000000000016'::uuid,'uranus-sidewinders','trains_at'),
  ('81000000-0000-0000-0000-000000000017'::uuid,'ceres-miners',     'trains_at'),
  ('81000000-0000-0000-0000-000000000018'::uuid,'vesta',            'trains_at'),
  ('81000000-0000-0000-0000-000000000019'::uuid,'pallas-wanderers', 'trains_at'),
  ('81000000-0000-0000-0000-000000000020'::uuid,'hygiea-united',    'trains_at'),
  ('81000000-0000-0000-0000-000000000021'::uuid,'psyche-metallics', 'trains_at'),
  ('81000000-0000-0000-0000-000000000022'::uuid,'juno-city',        'trains_at'),
  ('81000000-0000-0000-0000-000000000023'::uuid,'beltway',          'trains_at'),
  ('81000000-0000-0000-0000-000000000024'::uuid,'solar-miners',     'trains_at'),
  ('81000000-0000-0000-0000-000000000025'::uuid,'pluto-frost',      'trains_at'),
  ('81000000-0000-0000-0000-000000000026'::uuid,'charon-united',    'trains_at'),
  ('81000000-0000-0000-0000-000000000027'::uuid,'eris-wanderers',   'trains_at'),
  ('81000000-0000-0000-0000-000000000028'::uuid,'haumea-spinners',  'trains_at'),
  ('81000000-0000-0000-0000-000000000029'::uuid,'makemake',         'trains_at'),
  ('81000000-0000-0000-0000-000000000030'::uuid,'orcus-athletic',   'trains_at'),
  ('81000000-0000-0000-0000-000000000031'::uuid,'sedna-mariners',   'trains_at'),
  ('81000000-0000-0000-0000-000000000032'::uuid,'scattered-disc',   'trains_at')
) AS s(venue_id, team_slug, rel_kind)
JOIN entities e ON e.kind = 'team' AND e.meta->>'team_id' = s.team_slug
ON CONFLICT (from_id, to_id, kind) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 7: Officials associations → IEOB (affiliated_with)
-- ═══════════════════════════════════════════════════════════════════════════
-- RMAS and the two regional boards are affiliated with IEOB (the supreme
-- match-officials body, seeded in 0002_entities.sql as kind='association').
-- Strength reflects the tension: RMAS is in ongoing negotiation (+40);
-- regional boards are subordinate but independent-minded (+60).

INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta)
SELECT r.assoc_id, e.id, 'affiliated_with', r.strength, '{}'::jsonb
FROM (VALUES
  ('72000000-0000-0000-0000-000000000001'::uuid, 40),  -- RMAS / IEOB (negotiating)
  ('72000000-0000-0000-0000-000000000002'::uuid, 60),  -- ISOB / IEOB (subordinate)
  ('72000000-0000-0000-0000-000000000003'::uuid, 50)   -- OROG / IEOB (semi-independent)
) AS r(assoc_id, strength)
JOIN entities e ON e.name = 'Interplanetary Enforcement of the Beautiful Game'
ON CONFLICT (from_id, to_id, kind) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 8: Sports writers → media companies (employed_by)
-- ═══════════════════════════════════════════════════════════════════════════
-- Links writers to their employer entities.  Strength is +75 (employed;
-- genuine allegiance to the outlet's editorial line) — the Architect can
-- use this to infer which platform a given take will appear on.

INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta)
SELECT w.writer_id, e.id, 'employed_by', 75, '{}'::jsonb
FROM (VALUES
  ('74000000-0000-0000-0000-000000000001'::uuid, 'Solar System Sports Daily'),   -- Marco Stellos / SSSD
  ('74000000-0000-0000-0000-000000000002'::uuid, 'Inner System Sports'),          -- Dai Korrin / ISS
  ('74000000-0000-0000-0000-000000000003'::uuid, 'The Outer Voice'),              -- Nyx Farlowe / TOV
  ('74000000-0000-0000-0000-000000000004'::uuid, 'The Outer Voice'),              -- Rinne Ovaska / TOV
  ('74000000-0000-0000-0000-000000000005'::uuid, 'Belt & Beyond Media'),          -- Cage Moretti / BBM
  ('74000000-0000-0000-0000-000000000006'::uuid, 'Belt & Beyond Media'),          -- Dust Nakamura / BBM
  ('74000000-0000-0000-0000-000000000007'::uuid, 'Kuiper Chronicle Network'),     -- Void Christensen / KCN
  ('74000000-0000-0000-0000-000000000008'::uuid, 'Kuiper Chronicle Network')      -- Sable Osei / KCN
) AS w(writer_id, employer_name)
JOIN entities e ON e.kind = 'media_company' AND e.name = w.employer_name
ON CONFLICT (from_id, to_id, kind) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 9: Key political rivalries (rival — mutual)
-- ═══════════════════════════════════════════════════════════════════════════
-- A small set of high-drama cross-party rivalries the Architect can fire on
-- whenever a politically-charged match takes place.  Both directions of each
-- rivalry are seeded (mutual hostility).

INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta) VALUES

  -- Solaris Compact ↔ Frontier Coalition (the galaxy's defining political split)
  ('70000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000002','rival', -70, '{}'::jsonb),
  ('70000000-0000-0000-0000-000000000002','70000000-0000-0000-0000-000000000001','rival', -70, '{}'::jsonb),

  -- Heritage League ↔ United Colonies Party (Earth's internal split)
  ('70000000-0000-0000-0000-000000000007','70000000-0000-0000-0000-000000000008','rival', -60, '{}'::jsonb),
  ('70000000-0000-0000-0000-000000000008','70000000-0000-0000-0000-000000000007','rival', -60, '{}'::jsonb),

  -- Red Frontier Party ↔ Heritage League (Mars independence vs Earth tradition)
  ('70000000-0000-0000-0000-000000000009','70000000-0000-0000-0000-000000000007','rival', -80, '{}'::jsonb),
  ('70000000-0000-0000-0000-000000000007','70000000-0000-0000-0000-000000000009','rival', -65, '{}'::jsonb),

  -- Jovian Conclave ↔ Galilean Independence (Jupiter's moon sovereignty dispute)
  ('70000000-0000-0000-0000-000000000011','70000000-0000-0000-0000-000000000012','rival', -75, '{}'::jsonb),
  ('70000000-0000-0000-0000-000000000012','70000000-0000-0000-0000-000000000011','rival', -75, '{}'::jsonb),

  -- Belt Workers' Congress ↔ Ceres Free State (labour vs libertarian)
  ('70000000-0000-0000-0000-000000000017','70000000-0000-0000-0000-000000000018','rival', -55, '{}'::jsonb),
  ('70000000-0000-0000-0000-000000000018','70000000-0000-0000-0000-000000000017','rival', -55, '{}'::jsonb),

  -- Lyra Vance ↔ Senna Obuobi (the human face of the inner/outer split)
  ('71000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000003','rival', -65, '{}'::jsonb),
  ('71000000-0000-0000-0000-000000000003','71000000-0000-0000-0000-000000000001','rival', -65, '{}'::jsonb),

  -- Boros Senn ↔ Petra Vask (cloud-city oligarch vs Belt union chair)
  ('71000000-0000-0000-0000-000000000007','71000000-0000-0000-0000-000000000008','rival', -80, '{}'::jsonb),
  ('71000000-0000-0000-0000-000000000008','71000000-0000-0000-0000-000000000007','rival', -80, '{}'::jsonb)

ON CONFLICT (from_id, to_id, kind) DO NOTHING;
