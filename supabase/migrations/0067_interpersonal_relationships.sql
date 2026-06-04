-- ── 0067_interpersonal_relationships.sql ─────────────────────────────────────
-- WHY: Migrations 0062–0066 built an entity graph with 0 island nodes and 793
-- edges, but nearly all edges are structural (employed_by, affiliated_with,
-- member_of, political_ally).  The world reads like an org chart.  This
-- migration layers in 8 personal relationship kinds and ~170 directed edges:
-- friendships forged at coaching academies, family ties that cross club lines,
-- feuds simmering inside the referee corps, journalists with inside sources,
-- and pundits who mentored the writers who now quote them.  The Architect
-- gains a dense social web to pull narrative threads from.
--
-- NEW RELATIONSHIP KINDS (first use in this migration):
--   friend_of      — personal bond (mutual where seeded both ways)
--   colleague_of   — working relationship in the same field or institution
--   mentors        — directed: senior actively guiding a junior
--   family_of      — blood or household relation
--   feuds_with     — ongoing personal animosity (can be one-sided or mutual)
--   admires        — one-way respect / hero-worship
--   scorns         — one-way contempt
--   trusted_source — this entity is a reliable private information source
--
-- Fixed-UUID entities (71 = politicians, 74 = sports_writers, 75 = managing_staff)
-- are referenced directly.  Journalist / pundit / referee UUIDs were generated
-- by gen_random_uuid in 0002 and are resolved here by name JOIN.
--
-- All edges: ON CONFLICT (from_id, to_id, kind) DO NOTHING (idempotent).
-- Strength: -100..+100 (DB CHECK constraint).
-- ──────────────────────────────────────────────────────────────────────────────


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 1: Politician ↔ Politician — personal ties
-- ═══════════════════════════════════════════════════════════════════════════
-- Supplements 0064's structural political_ally / political_opponent edges with
-- lived personal connections.  The Architect can use these when a GLC vote or
-- cup controversy coincides with a private friendship or feud.

INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta) VALUES

  -- ── Solaris Compact inner circle ───────────────────────────────────────
  -- Vance and Zheng are party colleagues; she sponsored his rise
  ('71000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000002','colleague_of',  60, '{}'::jsonb),
  ('71000000-0000-0000-0000-000000000002','71000000-0000-0000-0000-000000000001','colleague_of',  55, '{}'::jsonb),
  ('71000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000002','mentors',        50, '{}'::jsonb),
  -- Vance pulled Velloris into the Cloudborn sphere early in her career
  ('71000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000005','mentors',        45, '{}'::jsonb),
  -- Vance and Castellane: polite Earth colleagues across party lines
  ('71000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000010','colleague_of',  30, '{}'::jsonb),
  ('71000000-0000-0000-0000-000000000010','71000000-0000-0000-0000-000000000001','colleague_of',  25, '{}'::jsonb),

  -- ── The solar system's most visible feud ───────────────────────────────
  ('71000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000003','feuds_with',   -60, '{}'::jsonb),
  ('71000000-0000-0000-0000-000000000003','71000000-0000-0000-0000-000000000001','feuds_with',   -65, '{}'::jsonb),
  -- Zheng vs Obuobi: the most hostile dynamic on the GLC floor
  ('71000000-0000-0000-0000-000000000002','71000000-0000-0000-0000-000000000003','feuds_with',   -70, '{}'::jsonb),
  ('71000000-0000-0000-0000-000000000003','71000000-0000-0000-0000-000000000002','feuds_with',   -75, '{}'::jsonb),

  -- ── Outer-system solidarity ─────────────────────────────────────────────
  -- Obuobi and Vask were friends before either entered politics
  ('71000000-0000-0000-0000-000000000003','71000000-0000-0000-0000-000000000008','friend_of',     75, '{}'::jsonb),
  ('71000000-0000-0000-0000-000000000008','71000000-0000-0000-0000-000000000003','friend_of',     75, '{}'::jsonb),
  -- Obuobi and Ren: different worlds, same outer-system cause
  ('71000000-0000-0000-0000-000000000003','71000000-0000-0000-0000-000000000006','colleague_of',  55, '{}'::jsonb),
  ('71000000-0000-0000-0000-000000000006','71000000-0000-0000-0000-000000000003','colleague_of',  50, '{}'::jsonb),
  -- Ren's personal feud with Zheng: six seasons of being ignored by the GLC director
  ('71000000-0000-0000-0000-000000000006','71000000-0000-0000-0000-000000000002','feuds_with',   -60, '{}'::jsonb),

  -- ── Establishment cohesion and contempt ─────────────────────────────────
  -- Obuobi scorns Senn (Jovian old money is everything she fights against)
  ('71000000-0000-0000-0000-000000000003','71000000-0000-0000-0000-000000000007','scorns',       -50, '{}'::jsonb),
  -- Vask vs Senn: Belt Workers vs Jovian privilege is long and public
  ('71000000-0000-0000-0000-000000000008','71000000-0000-0000-0000-000000000007','feuds_with',   -55, '{}'::jsonb),
  -- Senn and Castellane: comfortable establishment colleagues
  ('71000000-0000-0000-0000-000000000007','71000000-0000-0000-0000-000000000010','colleague_of',  35, '{}'::jsonb),
  ('71000000-0000-0000-0000-000000000010','71000000-0000-0000-0000-000000000007','colleague_of',  35, '{}'::jsonb),
  -- Castellane scorns Zheng (Heritage League sees Solaris Compact as upstarts)
  ('71000000-0000-0000-0000-000000000010','71000000-0000-0000-0000-000000000002','scorns',       -35, '{}'::jsonb),

  -- ── One-way personal sentiments ─────────────────────────────────────────
  -- Doru admires Vance's media mastery from a professional distance
  ('71000000-0000-0000-0000-000000000004','71000000-0000-0000-0000-000000000001','admires',       40, '{}'::jsonb),
  -- Doru scorns Obuobi (Technocrat finds passion without data irrational)
  ('71000000-0000-0000-0000-000000000004','71000000-0000-0000-0000-000000000003','scorns',       -30, '{}'::jsonb),
  -- Noor quietly admires Obuobi from Pluto's outer rim
  ('71000000-0000-0000-0000-000000000009','71000000-0000-0000-0000-000000000003','admires',       55, '{}'::jsonb)

ON CONFLICT (from_id, to_id, kind) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 2: Politicians → journalists / sports writers — source cultivation
-- ═══════════════════════════════════════════════════════════════════════════
-- Politicians who cultivate specific journalists/writers as outlets for leaks.
-- Reverse direction (journalist → politician) means the journalist actively
-- maintains that politician as a source.  The Architect can use these to
-- model who planted which story.

-- Politicians → journalists / sports writers (fixed → random UUID)
INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta)
SELECT v.fixed_id, e.id, v.kind, v.strength, '{}'::jsonb
FROM (VALUES
  ('71000000-0000-0000-0000-000000000001'::uuid, 'Sol Petrov',       'trusted_source', 55),
  ('71000000-0000-0000-0000-000000000002'::uuid, 'Sol Petrov',       'trusted_source', 40),
  ('71000000-0000-0000-0000-000000000003'::uuid, 'Echo Rashidi',     'trusted_source', 60),
  ('71000000-0000-0000-0000-000000000006'::uuid, 'Vex Diallo',       'trusted_source', 50),
  ('71000000-0000-0000-0000-000000000008'::uuid, 'Quinn Rivera',     'trusted_source', 45),
  ('71000000-0000-0000-0000-000000000005'::uuid, 'Marco Stellos',    'trusted_source', 50),
  ('71000000-0000-0000-0000-000000000006'::uuid, 'Dai Korrin',       'trusted_source', 55),
  ('71000000-0000-0000-0000-000000000009'::uuid, 'Void Christensen', 'trusted_source', 35)
) AS v(fixed_id, to_name, kind, strength)
JOIN entities e ON e.name = v.to_name
ON CONFLICT (from_id, to_id, kind) DO NOTHING;

-- Politicians politicians admire specific writers (fixed → random UUID)
INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta)
SELECT v.fixed_id, e.id, v.kind, v.strength, '{}'::jsonb
FROM (VALUES
  ('71000000-0000-0000-0000-000000000007'::uuid, 'Nyx Farlowe',   'admires', 40),
  ('71000000-0000-0000-0000-000000000008'::uuid, 'Cage Moretti',  'admires', 65),
  ('71000000-0000-0000-0000-000000000003'::uuid, 'Dust Nakamura', 'admires', 60),
  ('71000000-0000-0000-0000-000000000003'::uuid, 'Cage Moretti',  'admires', 55)
) AS v(fixed_id, to_name, kind, strength)
JOIN entities e ON e.name = v.to_name
ON CONFLICT (from_id, to_id, kind) DO NOTHING;

-- Journalists / sports writers → politicians as sources (random → fixed UUID)
INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta)
SELECT e.id, v.fixed_id, v.kind, v.strength, '{}'::jsonb
FROM (VALUES
  ('Sol Petrov',   '71000000-0000-0000-0000-000000000001'::uuid, 'trusted_source', 50),
  ('Echo Rashidi', '71000000-0000-0000-0000-000000000003'::uuid, 'trusted_source', 65),
  ('Vex Diallo',   '71000000-0000-0000-0000-000000000006'::uuid, 'trusted_source', 45),
  ('Tara Mensah',  '71000000-0000-0000-0000-000000000008'::uuid, 'trusted_source', 50)
) AS v(from_name, fixed_id, kind, strength)
JOIN entities e ON e.name = v.from_name
ON CONFLICT (from_id, to_id, kind) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 3: Journalist ↔ Journalist — same-outlet colleagues + cross rivalries
-- ═══════════════════════════════════════════════════════════════════════════
-- Daily working bonds within each outlet; cross-outlet friendships around
-- shared beats; rivalries around competing for the same story.

INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta)
SELECT f.id, t.id, v.kind, v.strength, '{}'::jsonb
FROM (VALUES
  -- GSN: Iris Volkov, Kael Nkosi, Ren Kowalski, Tara Mensah, Atlas Kim
  ('Iris Volkov',    'Ren Kowalski',    'colleague_of',  55),
  ('Ren Kowalski',   'Iris Volkov',     'colleague_of',  55),
  ('Iris Volkov',    'Tara Mensah',     'colleague_of',  50),
  ('Tara Mensah',    'Iris Volkov',     'colleague_of',  50),
  ('Kael Nkosi',     'Atlas Kim',       'colleague_of',  45),
  ('Atlas Kim',      'Kael Nkosi',      'colleague_of',  45),
  ('Ren Kowalski',   'Tara Mensah',     'colleague_of',  50),
  ('Tara Mensah',    'Ren Kowalski',    'colleague_of',  50),

  -- TOV: Lux Tanaka, Wren Ivanova, Celeste Obi
  ('Lux Tanaka',     'Wren Ivanova',    'colleague_of',  60),
  ('Wren Ivanova',   'Lux Tanaka',      'colleague_of',  60),
  ('Lux Tanaka',     'Celeste Obi',     'colleague_of',  50),
  ('Celeste Obi',    'Lux Tanaka',      'colleague_of',  50),
  ('Wren Ivanova',   'Celeste Obi',     'colleague_of',  55),
  ('Celeste Obi',    'Wren Ivanova',    'colleague_of',  55),

  -- BBM: Quinn Rivera, Drift Hartmann, Xia Chen
  ('Quinn Rivera',   'Drift Hartmann',  'colleague_of',  65),
  ('Drift Hartmann', 'Quinn Rivera',    'colleague_of',  65),
  ('Quinn Rivera',   'Xia Chen',        'colleague_of',  50),
  ('Xia Chen',       'Quinn Rivera',    'colleague_of',  50),
  ('Drift Hartmann', 'Xia Chen',        'colleague_of',  45),
  ('Xia Chen',       'Drift Hartmann',  'colleague_of',  45),

  -- KCN: Mira Fontaine, Yuri Santos
  ('Mira Fontaine',  'Yuri Santos',     'colleague_of',  70),
  ('Yuri Santos',    'Mira Fontaine',   'colleague_of',  70),

  -- SSSD: Orion Sharma, Sol Petrov, Zara Brennan, Echo Rashidi
  ('Sol Petrov',     'Zara Brennan',    'colleague_of',  60),
  ('Zara Brennan',   'Sol Petrov',      'colleague_of',  55),
  ('Sol Petrov',     'Echo Rashidi',    'colleague_of',  45),
  ('Echo Rashidi',   'Sol Petrov',      'colleague_of',  40),
  ('Orion Sharma',   'Zara Brennan',    'colleague_of',  50),
  ('Zara Brennan',   'Orion Sharma',    'colleague_of',  55),
  ('Orion Sharma',   'Sol Petrov',      'colleague_of',  45),
  ('Sol Petrov',     'Orion Sharma',    'colleague_of',  40),

  -- ISS: Pax Okafor, Ursa Park, Vex Diallo
  ('Pax Okafor',     'Ursa Park',       'colleague_of',  50),
  ('Ursa Park',      'Pax Okafor',      'colleague_of',  50),
  ('Pax Okafor',     'Vex Diallo',      'colleague_of',  45),
  ('Vex Diallo',     'Pax Okafor',      'colleague_of',  45),
  ('Ursa Park',      'Vex Diallo',      'colleague_of',  40),
  ('Vex Diallo',     'Ursa Park',       'colleague_of',  40),

  -- Cross-outlet friendships (shared outer-reaches beat)
  ('Lux Tanaka',     'Mira Fontaine',   'friend_of',     55),
  ('Mira Fontaine',  'Lux Tanaka',      'friend_of',     55),
  ('Xia Chen',       'Lux Tanaka',      'friend_of',     45),
  ('Lux Tanaka',     'Xia Chen',        'friend_of',     45),

  -- Cross-outlet rivalries (competing for the same story)
  ('Iris Volkov',    'Vex Diallo',      'feuds_with',   -40),
  ('Vex Diallo',     'Iris Volkov',     'feuds_with',   -45),
  ('Echo Rashidi',   'Tara Mensah',     'feuds_with',   -35),
  ('Tara Mensah',    'Echo Rashidi',    'feuds_with',   -30)
) AS v(from_name, to_name, kind, strength)
JOIN entities f ON f.name = v.from_name AND f.kind = 'journalist'
JOIN entities t ON t.name = v.to_name AND t.kind = 'journalist'
ON CONFLICT (from_id, to_id, kind) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 4: Journalist ↔ Pundit — media ecosystem
-- ═══════════════════════════════════════════════════════════════════════════
-- Journalists who regularly quote specific pundits; pundits who mentored
-- the journalists who now cite them; and the occasional feud.

INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta)
SELECT f.id, t.id, v.kind, v.strength, '{}'::jsonb
FROM (VALUES
  -- GSN journalist + tactics pundit (Rex Valorum on GSN panels)
  ('Iris Volkov',    'Rex Valorum',     'colleague_of',  50),
  ('Rex Valorum',    'Iris Volkov',     'colleague_of',  50),
  ('Ren Kowalski',   'Rex Valorum',     'colleague_of',  45),
  ('Rex Valorum',    'Ren Kowalski',    'colleague_of',  45),
  -- Statistics journalist + statistics pundit (Atlas Kim + Axis Delgado are proper friends)
  ('Atlas Kim',      'Axis Delgado',    'colleague_of',  60),
  ('Axis Delgado',   'Atlas Kim',       'colleague_of',  60),
  ('Atlas Kim',      'Axis Delgado',    'friend_of',     55),
  ('Axis Delgado',   'Atlas Kim',       'friend_of',     55),
  -- Tactics journalist admires the tactics pundit who got there first
  ('Pax Okafor',     'Rex Valorum',     'admires',       55),
  -- Managers-beat journalist + retired coach pundit (Celeste Obi quotes Zephyr Kwan constantly)
  ('Celeste Obi',    'Zephyr Kwan',     'colleague_of',  50),
  ('Zephyr Kwan',    'Celeste Obi',     'colleague_of',  45),
  -- KCN journalist admires the isolation-focused psychology pundit
  ('Mira Fontaine',  'Void Nakamura',   'admires',       50),
  ('Yuri Santos',    'Void Nakamura',   'colleague_of',  40),
  ('Void Nakamura',  'Yuri Santos',     'colleague_of',  40),
  -- Echo Rashidi (referee controversy) feuds with transfers agent-pundit Frost Lindqvist
  -- (they represent opposing views on whether corruption is structural or individual)
  ('Echo Rashidi',   'Frost Lindqvist', 'feuds_with',   -40),
  ('Frost Lindqvist','Echo Rashidi',    'feuds_with',   -45),
  -- Outer-system connections
  ('Drift Hartmann', 'Crag Montoya',    'colleague_of',  40),
  ('Crag Montoya',   'Drift Hartmann',  'colleague_of',  40)
) AS v(from_name, to_name, kind, strength)
JOIN entities f ON f.name = v.from_name
JOIN entities t ON t.name = v.to_name
ON CONFLICT (from_id, to_id, kind) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 5: Pundit ↔ Pundit — media circles
-- ═══════════════════════════════════════════════════════════════════════════
-- Old teammates, classic media feuds, and the quieter bonds of people who
-- have sat in the same studio for twenty years.

INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta)
SELECT f.id, t.id, v.kind, v.strength, '{}'::jsonb
FROM (VALUES
  -- Rex Valorum and Stellar Cruz: Earth retired players, old teammates
  ('Rex Valorum',    'Stellar Cruz',    'friend_of',     70),
  ('Stellar Cruz',   'Rex Valorum',     'friend_of',     70),
  -- Rex Valorum and Crag Montoya: two ex-players who still argue about defending
  ('Rex Valorum',    'Crag Montoya',    'colleague_of',  45),
  ('Crag Montoya',   'Rex Valorum',     'colleague_of',  45),
  -- Rex vs Bolt: the classic attacker/defender argument, never settled
  ('Rex Valorum',    'Bolt Adesanya',   'feuds_with',   -50),
  ('Bolt Adesanya',  'Rex Valorum',     'feuds_with',   -45),
  -- Bolt and Tide: both ex-players from the outer-system run, long friendship
  ('Bolt Adesanya',  'Tide Okonkwo',    'friend_of',     65),
  ('Tide Okonkwo',   'Bolt Adesanya',   'friend_of',     65),
  -- Crag and Tide: outer-system solidarity, both Belt/fringe-origin players
  ('Crag Montoya',   'Tide Okonkwo',    'friend_of',     55),
  ('Tide Okonkwo',   'Crag Montoya',    'friend_of',     55),
  -- Axis Delgado scorns Rex Valorum (analyst thinks gut-feel punditry is noise)
  ('Axis Delgado',   'Rex Valorum',     'feuds_with',   -35),
  ('Rex Valorum',    'Axis Delgado',    'scorns',       -30),
  -- Flare Asante and Nova Petrossian: both retired coaches, inner-system era
  ('Flare Asante',   'Nova Petrossian', 'colleague_of',  50),
  ('Nova Petrossian','Flare Asante',    'colleague_of',  50),
  -- Zephyr Kwan and Void Nakamura: both outer/fringe-system, philosophy and youth
  ('Zephyr Kwan',    'Void Nakamura',   'friend_of',     55),
  ('Void Nakamura',  'Zephyr Kwan',     'friend_of',     55),
  -- Echo Ferrara and Nova Petrossian: both Venus/inner-system, form meets goalkeeping
  ('Echo Ferrara',   'Nova Petrossian', 'friend_of',     50),
  ('Nova Petrossian','Echo Ferrara',    'friend_of',     50),
  -- Frost Lindqvist admires Axis Delgado (agent respects the stats)
  ('Frost Lindqvist','Axis Delgado',    'admires',       35)
) AS v(from_name, to_name, kind, strength)
JOIN entities f ON f.name = v.from_name AND f.kind = 'pundit'
JOIN entities t ON t.name = v.to_name AND t.kind = 'pundit'
ON CONFLICT (from_id, to_id, kind) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 6: Sports writer cross-connections
-- ═══════════════════════════════════════════════════════════════════════════
-- Sports writers operate in the same media ecosystem as journalists and
-- pundits but are column-first rather than broadcast.  These edges connect
-- the two fixed-UUID writers to the random-UUID media figures they interact
-- with professionally.

INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta)
SELECT f.id, t.id, v.kind, v.strength, '{}'::jsonb
FROM (VALUES
  -- Nyx Farlowe (tactician) ↔ Axis Delgado (statistics pundit): fellow analysts
  ('Nyx Farlowe',     'Axis Delgado',   'colleague_of',  55),
  ('Axis Delgado',    'Nyx Farlowe',    'colleague_of',  55),
  -- Nyx Farlowe vs Rex Valorum: data-driven v narrative-driven punditry, public feud
  ('Nyx Farlowe',     'Rex Valorum',    'feuds_with',   -40),
  ('Rex Valorum',     'Nyx Farlowe',    'scorns',       -30),
  -- Rinne Ovaska ↔ Nova Petrossian: both Saturn-system, emotional approach to the game
  ('Rinne Ovaska',    'Nova Petrossian','friend_of',     60),
  ('Nova Petrossian', 'Rinne Ovaska',   'friend_of',     60),
  -- Cage Moretti admires Crag Montoya (grew up watching Belt-born Crag play)
  ('Cage Moretti',    'Crag Montoya',   'admires',       60),
  -- Void Christensen and Void Nakamura: philosophical resonance across disciplines
  ('Void Christensen','Void Nakamura',  'admires',       50),
  ('Void Nakamura',   'Void Christensen','admires',      45),
  -- Sable Osei → Void Christensen: outer-system solidarity (Sedna and Pluto)
  ('Sable Osei',      'Void Christensen','admires',      40),
  -- Dust Nakamura ↔ Drift Hartmann (journalist): Belt-profile writers, same beat
  ('Dust Nakamura',   'Drift Hartmann', 'colleague_of',  50),
  ('Drift Hartmann',  'Dust Nakamura',  'colleague_of',  50),
  ('Dust Nakamura',   'Drift Hartmann', 'friend_of',     55),
  ('Drift Hartmann',  'Dust Nakamura',  'friend_of',     55),
  -- Marco Stellos vs Rex Valorum: polemicist attacks Earth-establishment punditry constantly
  ('Marco Stellos',   'Rex Valorum',    'feuds_with',   -45)
) AS v(from_name, to_name, kind, strength)
JOIN entities f ON f.name = v.from_name
JOIN entities t ON t.name = v.to_name
ON CONFLICT (from_id, to_id, kind) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 7: Managing staff ↔ Managing staff — coaching fraternity
-- ═══════════════════════════════════════════════════════════════════════════
-- Coaching staff who came through the same academies, share a specialty, or
-- have built relationships through years of living on the same regional circuit.

INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta) VALUES

  -- Martian coaching circle (Redd, Ira, Lore all grew up in the same system)
  ('75000000-0000-0000-0000-000000000005','75000000-0000-0000-0000-000000000006','friend_of',     65, '{}'::jsonb),
  ('75000000-0000-0000-0000-000000000006','75000000-0000-0000-0000-000000000005','friend_of',     65, '{}'::jsonb),
  ('75000000-0000-0000-0000-000000000005','75000000-0000-0000-0000-000000000007','colleague_of',  55, '{}'::jsonb),
  ('75000000-0000-0000-0000-000000000007','75000000-0000-0000-0000-000000000005','colleague_of',  55, '{}'::jsonb),

  -- Youth specialists across the system: Spra Iversen (Enceladus) and Seren Bright (Terra Nova)
  ('75000000-0000-0000-0000-000000000015','75000000-0000-0000-0000-000000000004','friend_of',     60, '{}'::jsonb),
  ('75000000-0000-0000-0000-000000000004','75000000-0000-0000-0000-000000000015','friend_of',     60, '{}'::jsonb),
  -- Spra mentors Origin Okonjo (both youth pathway specialists, different ends of the system)
  ('75000000-0000-0000-0000-000000000015','75000000-0000-0000-0000-000000000029','mentors',       50, '{}'::jsonb),

  -- Data and video analysts know each other from the same conferences
  ('75000000-0000-0000-0000-000000000008','75000000-0000-0000-0000-000000000022','colleague_of',  55, '{}'::jsonb),
  ('75000000-0000-0000-0000-000000000022','75000000-0000-0000-0000-000000000008','colleague_of',  55, '{}'::jsonb),
  ('75000000-0000-0000-0000-000000000008','75000000-0000-0000-0000-000000000022','friend_of',     50, '{}'::jsonb),
  ('75000000-0000-0000-0000-000000000022','75000000-0000-0000-0000-000000000008','friend_of',     50, '{}'::jsonb),

  -- Set-piece specialists: Aero Caldas (Venus) and Dax Morison (Ganymede) collaborated
  ('75000000-0000-0000-0000-000000000003','75000000-0000-0000-0000-000000000011','colleague_of',  45, '{}'::jsonb),
  ('75000000-0000-0000-0000-000000000011','75000000-0000-0000-0000-000000000003','colleague_of',  45, '{}'::jsonb),

  -- Extreme-cold/cryo fitness coaches: Grip Svenson (Callisto) and Frost Bergman (Pluto)
  ('75000000-0000-0000-0000-000000000012','75000000-0000-0000-0000-000000000025','colleague_of',  60, '{}'::jsonb),
  ('75000000-0000-0000-0000-000000000025','75000000-0000-0000-0000-000000000012','colleague_of',  60, '{}'::jsonb),
  ('75000000-0000-0000-0000-000000000012','75000000-0000-0000-0000-000000000025','friend_of',     55, '{}'::jsonb),
  ('75000000-0000-0000-0000-000000000025','75000000-0000-0000-0000-000000000012','friend_of',     55, '{}'::jsonb),

  -- Outer Kuiper fringe: Frost Bergman (Pluto), Far Christodoulou (Eris), Shade Petrova (Orcus)
  -- — three staff from the most isolated clubs, they know each other well
  ('75000000-0000-0000-0000-000000000025','75000000-0000-0000-0000-000000000027','friend_of',     65, '{}'::jsonb),
  ('75000000-0000-0000-0000-000000000027','75000000-0000-0000-0000-000000000025','friend_of',     65, '{}'::jsonb),
  ('75000000-0000-0000-0000-000000000025','75000000-0000-0000-0000-000000000030','colleague_of',  45, '{}'::jsonb),
  ('75000000-0000-0000-0000-000000000030','75000000-0000-0000-0000-000000000025','colleague_of',  45, '{}'::jsonb)

ON CONFLICT (from_id, to_id, kind) DO NOTHING;

-- Managing staff → pundit admiration (random UUIDs resolved by name)
INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta)
SELECT v.from_id, t.id, v.kind, v.strength, '{}'::jsonb
FROM (VALUES
  -- Dim Osei (Hygiea goalkeeper coach) admires Nova Petrossian (goalkeeping pundit)
  ('75000000-0000-0000-0000-000000000020'::uuid, 'Nova Petrossian', 'admires', 55),
  -- Ori Watanabe (Solar City data analyst) admires Axis Delgado (statistics pundit)
  ('75000000-0000-0000-0000-000000000008'::uuid, 'Axis Delgado',   'admires', 50)
) AS v(from_id, to_name, kind, strength)
JOIN entities t ON t.name = v.to_name
ON CONFLICT (from_id, to_id, kind) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 8: Referee ↔ Referee — corps bonds
-- ═══════════════════════════════════════════════════════════════════════════
-- Referees who came through the same regional academies stay bonded for life.
-- Corps rivals compete for the best fixture assignments.  Mentor relationships
-- keep the corps standard high.

INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta)
SELECT f.id, t.id, v.kind, v.strength, '{}'::jsonb
FROM (VALUES
  -- Earth academy cohort: Orion Blackwood, Sirius Fontaine, Fomalhaut Chen, Dubhe Santos
  ('Orion Blackwood',  'Sirius Fontaine',  'friend_of',     70),
  ('Sirius Fontaine',  'Orion Blackwood',  'friend_of',     70),
  ('Orion Blackwood',  'Fomalhaut Chen',   'colleague_of',  60),
  ('Fomalhaut Chen',   'Orion Blackwood',  'colleague_of',  60),
  ('Sirius Fontaine',  'Dubhe Santos',     'colleague_of',  55),
  ('Dubhe Santos',     'Sirius Fontaine',  'colleague_of',  55),
  ('Fomalhaut Chen',   'Dubhe Santos',     'friend_of',     60),
  ('Dubhe Santos',     'Fomalhaut Chen',   'friend_of',     60),

  -- Mars academy cohort: Vega Castellano, Aldebaran Singh, Merak Ivanova
  ('Vega Castellano',  'Aldebaran Singh',  'friend_of',     65),
  ('Aldebaran Singh',  'Vega Castellano',  'friend_of',     65),
  ('Vega Castellano',  'Merak Ivanova',    'colleague_of',  55),
  ('Merak Ivanova',    'Vega Castellano',  'colleague_of',  55),

  -- Corps rival (fixture-assignment competition at the top)
  ('Arcturus Volkov',  'Betelgeuse Park',  'feuds_with',   -50),
  ('Betelgeuse Park',  'Arcturus Volkov',  'feuds_with',   -50),
  ('Dubhe Santos',     'Pollux Kowalski',  'feuds_with',   -40),
  ('Pollux Kowalski',  'Dubhe Santos',     'feuds_with',   -40),

  -- Mentor relationships: experienced refs developing newer colleagues
  ('Orion Blackwood',  'Mizar Cruz',       'mentors',       55),
  ('Altair Nakamura',  'Achernar Sharma',  'mentors',       50)
) AS v(from_name, to_name, kind, strength)
JOIN entities f ON f.name = v.from_name AND f.kind = 'referee'
JOIN entities t ON t.name = v.to_name AND t.kind = 'referee'
ON CONFLICT (from_id, to_id, kind) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 9: Family ties — surname clusters across entity kinds
-- ═══════════════════════════════════════════════════════════════════════════
-- Several surnames repeat across different entity kinds (journalist, referee,
-- sports_writer, managing_staff, pundit), indicating extended families
-- scattered across the solar system.  This is the Blaseball "lore texture"
-- layer: players and staff notice these connections; the Architect can use
-- them for nepotism controversies, conflict-of-interest stories, and personal-
-- stakes moments.
--
-- NOTE: family_of is treated as mutual; both directions are seeded.
--
-- Fontaine family: Sirius Fontaine (referee, Earth) + Electra Fontaine
-- (referee, Saturn) + Mira Fontaine (journalist, KCN/Kuiper Belt).
-- Siblings separated by career; Electra and Sirius came up through different
-- corps academies after the family scattered.

INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta)
SELECT f.id, t.id, 'family_of', v.strength, '{}'::jsonb
FROM (VALUES
  -- Fontaine siblings (referee × referee × journalist)
  ('Sirius Fontaine',   'Electra Fontaine',  75),
  ('Electra Fontaine',  'Sirius Fontaine',   75),
  ('Mira Fontaine',     'Sirius Fontaine',   70),
  ('Sirius Fontaine',   'Mira Fontaine',     70),
  ('Mira Fontaine',     'Electra Fontaine',  65),
  ('Electra Fontaine',  'Mira Fontaine',     65),

  -- Nakamura extended family (referee × sports_writer × managing_staff × pundit):
  -- Altair (ref, Saturn) + Void (pundit, Sedna) + Forge (staff, Psyche) + Dust (writer, Ceres)
  -- — four cousins who grew up on different rocks in the outer half of the system
  ('Altair Nakamura',   'Void Nakamura',     55),
  ('Void Nakamura',     'Altair Nakamura',   55),
  ('Altair Nakamura',   'Forge Nakamura',    60),
  ('Forge Nakamura',    'Altair Nakamura',   60),
  ('Dust Nakamura',     'Forge Nakamura',    65),
  ('Forge Nakamura',    'Dust Nakamura',     65),
  ('Dust Nakamura',     'Void Nakamura',     50),
  ('Void Nakamura',     'Dust Nakamura',     50),

  -- Mensah family: Polaris Mensah (referee, Ceres) + Tara Mensah (journalist, GSN)
  -- — cousins; Polaris on the Belt, Tara reporting from the inner system
  ('Polaris Mensah',    'Tara Mensah',       60),
  ('Tara Mensah',       'Polaris Mensah',    60),

  -- Diallo family: Procyon Diallo (referee, Eris) + Vex Diallo (journalist, ISS)
  -- — the most stretched family in the solar system (Eris to rocky-inner ISS)
  ('Procyon Diallo',    'Vex Diallo',        55),
  ('Vex Diallo',        'Procyon Diallo',    55),

  -- Asante family: Flare Asante (pundit, Mercury) + Deneb Asante (referee, Venus)
  -- — siblings from Mercury who took very different career paths
  ('Flare Asante',      'Deneb Asante',      70),
  ('Deneb Asante',      'Flare Asante',      70),

  -- Moretti family: Junction Moretti (managing staff, Beltway) + Cage Moretti (sports writer, BBM)
  -- — brothers; Junction works inside a Belt club, Cage writes about the same world from outside
  ('Cage Moretti',      'Junction Moretti',  80),
  ('Junction Moretti',  'Cage Moretti',      75),

  -- Osei family: Sable Osei (sports_writer, KCN/Sedna) + Dim Osei (managing staff, Hygiea)
  -- — cousins from different asteroid-adjacent worlds
  ('Sable Osei',        'Dim Osei',          60),
  ('Dim Osei',          'Sable Osei',        60)
) AS v(from_name, to_name, strength)
JOIN entities f ON f.name = v.from_name
JOIN entities t ON t.name = v.to_name
ON CONFLICT (from_id, to_id, kind) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 10: Cross-network connections
-- ═══════════════════════════════════════════════════════════════════════════
-- The most interesting edges: journalists who cover (and feud with) specific
-- referees, managing staff with political connections, and referees who have
-- become part of the public conversation.

INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta)
SELECT f.id, t.id, v.kind, v.strength, '{}'::jsonb
FROM (VALUES
  -- Echo Rashidi (referee-controversy journalist) has specific referees in her sights
  ('Echo Rashidi',    'Fomalhaut Chen',    'feuds_with',  -55),
  ('Fomalhaut Chen',  'Echo Rashidi',      'feuds_with',  -50),
  ('Echo Rashidi',    'Dubhe Santos',      'feuds_with',  -45),
  ('Dubhe Santos',    'Echo Rashidi',      'feuds_with',  -40),

  -- Sol Petrov (cosmic_architect journalist) admires Mizar Cruz
  -- (Mizar is the most intellectually curious referee; Sol finds him quotable)
  ('Sol Petrov',      'Mizar Cruz',        'admires',      45),

  -- Redd Okafor (Mars Athletic staff) has personal history with Vega Castellano
  -- (Mars ref assigned to too many Mars Athletic home matches — Redd believes it is unfair)
  ('Redd Okafor',     'Vega Castellano',   'feuds_with',  -35),

  -- Lore Castillo (Valles Mariners, possession systems) respects Merak Ivanova
  -- (Ivanova's consistent Martian-derby standards are a model for fair play)
  ('Lore Castillo',   'Merak Ivanova',     'admires',      40)
) AS v(from_name, to_name, kind, strength)
JOIN entities f ON f.name = v.from_name
JOIN entities t ON t.name = v.to_name
ON CONFLICT (from_id, to_id, kind) DO NOTHING;

-- Politician ↔ non-politician cross-network edges (politicians have formal titles in
-- their `name` field, so fixed UUIDs are used directly rather than name JOINs).

-- Petra Vask (Congress Chair, fixed UUID 71000000-…0008) ↔ Polaris Mensah (referee, Ceres)
INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta)
SELECT '71000000-0000-0000-0000-000000000008'::uuid, e.id, 'friend_of', 60, '{}'::jsonb
FROM entities e WHERE e.name = 'Polaris Mensah'
ON CONFLICT (from_id, to_id, kind) DO NOTHING;

INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta)
SELECT e.id, '71000000-0000-0000-0000-000000000008'::uuid, 'friend_of', 60, '{}'::jsonb
FROM entities e WHERE e.name = 'Polaris Mensah'
ON CONFLICT (from_id, to_id, kind) DO NOTHING;

-- Harko Ren (Assembly Speaker, fixed UUID 71000000-…0006) → Redd Okafor (Mars staff)
INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta)
SELECT '71000000-0000-0000-0000-000000000006'::uuid, e.id, 'admires', 45, '{}'::jsonb
FROM entities e WHERE e.name = 'Redd Okafor'
ON CONFLICT (from_id, to_id, kind) DO NOTHING;
