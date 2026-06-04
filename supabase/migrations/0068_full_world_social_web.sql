-- ── 0068_full_world_social_web.sql ───────────────────────────────────────────
-- WHY: 0067 layered a personal web onto the *world-building* entities
-- (politicians, journalists, pundits, referees, writers, club staff) — but the
-- 512 players and 32 managers, the largest cast in the universe, stayed islands:
-- every player carried exactly ONE edge (plays_for → their club) and every
-- manager exactly one (manages → their club).  They knew nobody.  A handful of
-- other entities were fully isolated too (the three commentators, the three
-- cosmic voices, the lone bookie, seven colonies, eleven planets, five
-- governance bodies).
--
-- This migration finishes the job the user asked for: EVERY entity now sits in
-- a living social web.  Players gain teammates, mentors, positional peers,
-- marquee rivals and the occasional dressing-room feud; managers gain a
-- fraternity, touchline rivalries and bonds with their squad; cross-kind
-- surname "bloodlines" fuse players + managers into the dynasties 0067 began
-- (every Nakamura — player, pundit, referee, writer, staffer, manager — becomes
-- one cosmic family); and the last island nodes are tied into the cosmology.
--
-- DETERMINISTIC, NOT RANDOM.  704 hand-written edges is infeasible and a
-- re-run would double them, so every pairing is generated set-based from a
-- stable hash of each entity's UUID (`_social_hash`).  The same database always
-- produces the same web, and ON CONFLICT (from_id, to_id, kind) DO NOTHING makes
-- the whole file idempotent.  The helper function is dropped at the end so the
-- public schema is left exactly as it was found.
--
-- RELATIONSHIP KINDS used here (taxonomy shared with 0064/0067; no DB CHECK on
-- `kind`, but we stay within the established vocabulary plus two natural
-- additions, `neighbours` and `trusts` were considered and rejected in favour
-- of reusing existing kinds):
--   friend_of, colleague_of, mentors, admires, family_of  — positive bonds
--   rival, feuds_with, scorns                              — negative bonds
--   based_in, member_of, affiliated_with, employed_by, neighbours — structural
-- Strength stays within the DB CHECK (-100..+100); sign drives the graph
-- legend (teal = allied, red = rival).
--
-- `meta.bond` tags each edge with the lore reason (teammate, mentor,
-- position-guild, marquee, feud, gaffer, bloodline, orbital, region, …) so the
-- UI / Architect can read *why* two entities are linked, not just that they are.
-- ──────────────────────────────────────────────────────────────────────────────


-- ═══════════════════════════════════════════════════════════════════════════
-- Deterministic hash helper (temporary — dropped at the end of this migration)
-- ═══════════════════════════════════════════════════════════════════════════
-- Returns a stable, non-negative 28-bit integer (0 .. 268,435,455) from an
-- entity UUID plus a salt.  28 bits guarantees the value is always positive
-- (no sign-bit surprises when cast to int), and the salt lets each relationship
-- layer shuffle the same set of entities independently (so teammates, the
-- positional guild and the bloodline chain don't all pick the same ordering).
-- IMMUTABLE so the planner can use it in window ORDER BY clauses.
CREATE OR REPLACE FUNCTION _social_hash(p_id uuid, p_salt text)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT ('x' || substr(md5(p_id::text || ':' || p_salt), 1, 7))::bit(28)::int;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART A: Teammate friendships (intra-team social ring)
-- ═══════════════════════════════════════════════════════════════════════════
-- The core fabric.  Within each club, players are shuffled into a ring and each
-- befriends their ±1 and ±2 ring-neighbours — four close teammate friendships
-- apiece, mutual.  A ring (not a full 16-way clique) keeps the graph readable
-- and the edge count sane while guaranteeing nobody on a squad is a stranger.
-- The ±1 bond is tighter (42) than the ±2 bond (33).
WITH ring AS (
  SELECT e.id,
         e.meta->>'team_id' AS team,
         row_number() OVER (PARTITION BY e.meta->>'team_id'
                            ORDER BY _social_hash(e.id, 'teammate')) - 1 AS rn,
         count(*)     OVER (PARTITION BY e.meta->>'team_id')             AS m
  FROM entities e
  WHERE e.kind = 'player' AND e.meta->>'team_id' IS NOT NULL
),
pairs AS (
  SELECT a.id AS from_id,
         b.id AS to_id,
         CASE WHEN off.k = 1 THEN 42 ELSE 33 END AS strength
  FROM ring a
  CROSS JOIN (VALUES (1), (2)) AS off(k)
  JOIN ring b ON b.team = a.team
             AND b.rn   = (a.rn + off.k) % a.m
  WHERE a.m > off.k          -- ring must be larger than the offset to be valid
)
INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta)
SELECT from_id, to_id, 'friend_of', strength, '{"bond":"teammate"}'::jsonb
FROM pairs WHERE from_id <> to_id
UNION ALL
SELECT to_id, from_id, 'friend_of', strength, '{"bond":"teammate"}'::jsonb
FROM pairs WHERE from_id <> to_id
ON CONFLICT (from_id, to_id, kind) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART B: Squad mentorship (intra-team, age-driven)
-- ═══════════════════════════════════════════════════════════════════════════
-- The oldest head in each dressing room takes the two youngest under their
-- wing: veteran → youth `mentors` (+45), and the kids look up in return with
-- `admires` (+35).  Gives the Architect a ready-made "the old guard vs the
-- next generation" lever on every club.
WITH ranked AS (
  SELECT p.entity_id AS id,
         p.team_id,
         row_number() OVER (PARTITION BY p.team_id
                            ORDER BY p.age DESC, _social_hash(p.entity_id, 'veteran')) AS old_rank,
         row_number() OVER (PARTITION BY p.team_id
                            ORDER BY p.age ASC,  _social_hash(p.entity_id, 'youth'))   AS young_rank
  FROM players p
  WHERE p.is_active AND p.entity_id IS NOT NULL
),
vet   AS (SELECT id, team_id FROM ranked WHERE old_rank   = 1),
youth AS (SELECT id, team_id FROM ranked WHERE young_rank <= 2)
INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta)
SELECT v.id, y.id, 'mentors', 45, '{"bond":"mentor"}'::jsonb
FROM vet v JOIN youth y ON y.team_id = v.team_id AND y.id <> v.id
UNION ALL
SELECT y.id, v.id, 'admires', 35, '{"bond":"mentor"}'::jsonb
FROM vet v JOIN youth y ON y.team_id = v.team_id AND y.id <> v.id
ON CONFLICT (from_id, to_id, kind) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART C: Positional guild (cross-team colleagues)
-- ═══════════════════════════════════════════════════════════════════════════
-- Goalkeepers know goalkeepers; strikers know strikers.  Within each position
-- (GK/DF/MF/FW) players are shuffled into an open chain and linked to their
-- chain-neighbour as `colleague_of` (+22, "came up through the same position
-- academy").  This is the layer that reaches ACROSS clubs, so a player's web is
-- never trapped inside their own squad — you can walk the graph from a Mercury
-- keeper to a Pluto keeper.
WITH guild AS (
  SELECT e.id,
         e.meta->>'position' AS pos,
         row_number() OVER (PARTITION BY e.meta->>'position'
                            ORDER BY _social_hash(e.id, 'guild')) AS rn
  FROM entities e
  WHERE e.kind = 'player' AND e.meta->>'position' IS NOT NULL
),
pairs AS (
  SELECT a.id AS from_id, b.id AS to_id
  FROM guild a JOIN guild b ON b.pos = a.pos AND b.rn = a.rn + 1
)
INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta)
SELECT from_id, to_id, 'colleague_of', 22, '{"bond":"position-guild"}'::jsonb FROM pairs
UNION ALL
SELECT to_id, from_id, 'colleague_of', 22, '{"bond":"position-guild"}'::jsonb FROM pairs
ON CONFLICT (from_id, to_id, kind) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART D: Marquee rivalries (each club's star vs the league)
-- ═══════════════════════════════════════════════════════════════════════════
-- The highest-rated player at every club is its talisman.  Within each league
-- the eight talismans are ringed and set as `rival` (-35) — the headline
-- one-on-one duels the betting market and commentary live for.
WITH team_league AS (
  SELECT te.meta->>'team_id' AS team_slug, te.meta->>'league_id' AS league
  FROM entities te WHERE te.kind = 'team'
),
stars AS (
  SELECT DISTINCT ON (p.team_id)
         p.entity_id AS id, tl.league
  FROM players p
  JOIN team_league tl ON tl.team_slug = p.team_id
  WHERE p.is_active AND p.entity_id IS NOT NULL
  ORDER BY p.team_id, p.overall_rating DESC, _social_hash(p.entity_id, 'star')
),
ring AS (
  SELECT id, league,
         row_number() OVER (PARTITION BY league ORDER BY _social_hash(id, 'marquee')) - 1 AS rn,
         count(*)     OVER (PARTITION BY league) AS m
  FROM stars
),
pairs AS (
  SELECT a.id AS from_id, b.id AS to_id
  FROM ring a JOIN ring b ON b.league = a.league AND b.rn = (a.rn + 1) % a.m
  WHERE a.m > 1
)
INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta)
SELECT from_id, to_id, 'rival', -35, '{"bond":"marquee"}'::jsonb FROM pairs WHERE from_id <> to_id
UNION ALL
SELECT to_id, from_id, 'rival', -35, '{"bond":"marquee"}'::jsonb FROM pairs WHERE from_id <> to_id
ON CONFLICT (from_id, to_id, kind) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART E: Dressing-room feuds (sparse, intra-team tension)
-- ═══════════════════════════════════════════════════════════════════════════
-- Not every squad is harmonious.  On roughly half the clubs (those whose slug
-- hashes even) the player at ring position 0 `feuds_with` the player on the
-- opposite side of the ring (-45) — a single simmering rift per affected club.
-- Sprinkled, not blanketed: dressing-room poison should feel like news.
WITH ring AS (
  SELECT e.id,
         e.meta->>'team_id' AS team,
         row_number() OVER (PARTITION BY e.meta->>'team_id'
                            ORDER BY _social_hash(e.id, 'teammate')) - 1 AS rn,
         count(*)     OVER (PARTITION BY e.meta->>'team_id')             AS m
  FROM entities e
  WHERE e.kind = 'player' AND e.meta->>'team_id' IS NOT NULL
),
pairs AS (
  SELECT a.id AS from_id, b.id AS to_id
  FROM ring a
  JOIN ring b ON b.team = a.team AND b.rn = (a.rn + (a.m / 2)) % a.m
  WHERE a.rn = 0
    AND a.m > 2
    AND ('x' || substr(md5(a.team || ':feud'), 1, 7))::bit(28)::int % 2 = 0
)
INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta)
SELECT from_id, to_id, 'feuds_with', -45, '{"bond":"feud"}'::jsonb FROM pairs WHERE from_id <> to_id
UNION ALL
SELECT to_id, from_id, 'feuds_with', -45, '{"bond":"feud"}'::jsonb FROM pairs WHERE from_id <> to_id
ON CONFLICT (from_id, to_id, kind) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART F: The managers' guild + touchline rivalries
-- ═══════════════════════════════════════════════════════════════════════════
-- Managers are a fraternity: ringed across the whole league as `colleague_of`
-- (+25, the coaching-circuit acquaintances).  Within each league they are ALSO
-- ringed as `rival` (-30) — the eight gaffers who meet twice a season and want
-- each other's jobs.
WITH mgr AS (
  SELECT e.id,
         row_number() OVER (ORDER BY _social_hash(e.id, 'fraternity')) - 1 AS rn,
         count(*)     OVER () AS m
  FROM entities e WHERE e.kind = 'manager'
),
pairs AS (
  SELECT a.id AS from_id, b.id AS to_id
  FROM mgr a JOIN mgr b ON b.rn = (a.rn + 1) % a.m
  WHERE a.m > 1
)
INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta)
SELECT from_id, to_id, 'colleague_of', 25, '{"bond":"managers-guild"}'::jsonb FROM pairs WHERE from_id <> to_id
UNION ALL
SELECT to_id, from_id, 'colleague_of', 25, '{"bond":"managers-guild"}'::jsonb FROM pairs WHERE from_id <> to_id
ON CONFLICT (from_id, to_id, kind) DO NOTHING;

WITH team_league AS (
  SELECT te.meta->>'team_id' AS team_slug, te.meta->>'league_id' AS league
  FROM entities te WHERE te.kind = 'team'
),
mgr AS (
  SELECT e.id, tl.league,
         row_number() OVER (PARTITION BY tl.league ORDER BY _social_hash(e.id, 'touchline')) - 1 AS rn,
         count(*)     OVER (PARTITION BY tl.league) AS m
  FROM entities e
  JOIN team_league tl ON tl.team_slug = e.meta->>'team_id'
  WHERE e.kind = 'manager'
),
pairs AS (
  SELECT a.id AS from_id, b.id AS to_id
  FROM mgr a JOIN mgr b ON b.league = a.league AND b.rn = (a.rn + 1) % a.m
  WHERE a.m > 1
)
INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta)
SELECT from_id, to_id, 'rival', -30, '{"bond":"touchline"}'::jsonb FROM pairs WHERE from_id <> to_id
UNION ALL
SELECT to_id, from_id, 'rival', -30, '{"bond":"touchline"}'::jsonb FROM pairs WHERE from_id <> to_id
ON CONFLICT (from_id, to_id, kind) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART G: Manager ↔ squad bonds
-- ═══════════════════════════════════════════════════════════════════════════
-- Wires each manager directly into their squad (not just via the club node):
-- the gaffer `mentors` the two youngest players (+42) and shares mutual
-- `admires` with the club's talisman (manager 40, player 38).  Now a player's
-- web shows the human who picks them, and a manager's web shows who they are
-- building around.
WITH mgr AS (
  SELECT e.id AS mgr_id, e.meta->>'team_id' AS team
  FROM entities e WHERE e.kind = 'manager'
),
youth AS (
  SELECT p.entity_id AS id, p.team_id,
         row_number() OVER (PARTITION BY p.team_id
                            ORDER BY p.age ASC, _social_hash(p.entity_id, 'gaffer')) AS yr
  FROM players p WHERE p.is_active AND p.entity_id IS NOT NULL
),
star AS (
  SELECT DISTINCT ON (p.team_id) p.entity_id AS id, p.team_id
  FROM players p WHERE p.is_active AND p.entity_id IS NOT NULL
  ORDER BY p.team_id, p.overall_rating DESC, _social_hash(p.entity_id, 'star')
)
INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta)
SELECT m.mgr_id, y.id, 'mentors', 42, '{"bond":"gaffer"}'::jsonb
FROM mgr m JOIN youth y ON y.team_id = m.team AND y.yr <= 2
UNION ALL
SELECT m.mgr_id, s.id, 'admires', 40, '{"bond":"talisman"}'::jsonb
FROM mgr m JOIN star s ON s.team_id = m.team
UNION ALL
SELECT s.id, m.mgr_id, 'admires', 38, '{"bond":"talisman"}'::jsonb
FROM mgr m JOIN star s ON s.team_id = m.team
ON CONFLICT (from_id, to_id, kind) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART H: Cosmic bloodlines (cross-kind surname dynasties)
-- ═══════════════════════════════════════════════════════════════════════════
-- The crown jewel.  Every shared surname across people-kind entities becomes a
-- bloodline: all 27 Nakamuras (players, a manager, a pundit, a referee, a
-- writer, a club staffer), all 25 Okafors, every Fontaine and Mensah and
-- Diallo, chained into one `family_of` line (+55).  ON CONFLICT merges
-- seamlessly with the explicit family clusters 0067 already seeded, so the
-- world reads as a handful of vast clans scattered across the solar system —
-- exactly the "real, breathing world" texture requested.  A chain (not a
-- clique) keeps even a 27-member surname from becoming a hairball.
WITH fam AS (
  SELECT e.id,
         lower(split_part(e.name, ' ', array_length(string_to_array(e.name, ' '), 1))) AS surname
  FROM entities e
  WHERE e.kind IN ('player','manager','referee','journalist','pundit',
                   'sports_writer','managing_staff','commentator')
    AND array_length(string_to_array(e.name, ' '), 1) >= 2   -- needs a surname token
),
chain AS (
  SELECT id, surname,
         row_number() OVER (PARTITION BY surname ORDER BY _social_hash(id, 'bloodline')) AS rn,
         count(*)     OVER (PARTITION BY surname) AS m
  FROM fam
),
pairs AS (
  SELECT a.id AS from_id, b.id AS to_id
  FROM chain a JOIN chain b ON b.surname = a.surname AND b.rn = a.rn + 1
  WHERE a.m >= 2
)
INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta)
SELECT from_id, to_id, 'family_of', 55, '{"bond":"bloodline"}'::jsonb FROM pairs
UNION ALL
SELECT to_id, from_id, 'family_of', 55, '{"bond":"bloodline"}'::jsonb FROM pairs
ON CONFLICT (from_id, to_id, kind) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART I: The commentary booth (de-island the three commentators)
-- ═══════════════════════════════════════════════════════════════════════════
-- Captain Vox, Nexus-7 and Zara Bloom share a booth every match — mutual
-- `colleague_of` (+50) — and all three draw a salary from the dominant
-- broadcaster, Galactic Sports Network (`employed_by`, +40).  GSN UUID is
-- random (seeded 0002), so resolved by name.
INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta) VALUES
  ('40000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002','colleague_of', 50, '{"bond":"broadcast-booth"}'::jsonb),
  ('40000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001','colleague_of', 50, '{"bond":"broadcast-booth"}'::jsonb),
  ('40000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000003','colleague_of', 50, '{"bond":"broadcast-booth"}'::jsonb),
  ('40000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000001','colleague_of', 50, '{"bond":"broadcast-booth"}'::jsonb),
  ('40000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000003','colleague_of', 50, '{"bond":"broadcast-booth"}'::jsonb),
  ('40000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000002','colleague_of', 50, '{"bond":"broadcast-booth"}'::jsonb)
ON CONFLICT (from_id, to_id, kind) DO NOTHING;

INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta)
SELECT c.id, gsn.id, 'employed_by', 40, '{"bond":"broadcast-booth"}'::jsonb
FROM (VALUES
  ('40000000-0000-0000-0000-000000000001'::uuid),
  ('40000000-0000-0000-0000-000000000002'::uuid),
  ('40000000-0000-0000-0000-000000000003'::uuid)
) AS c(id)
JOIN entities gsn ON gsn.kind = 'media_company' AND gsn.name = 'Galactic Sports Network'
ON CONFLICT (from_id, to_id, kind) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART J: The three cosmic voices (Fate / Balance / Chaos)
-- ═══════════════════════════════════════════════════════════════════════════
-- The Architect speaks in three voices locked in eternal tension.  Balance
-- (Second) and Chaos (Third) are direct antagonists — `feuds_with` (-65).
-- Fate (First) is inscrutable and at odds with both — `rival` (-25 vs Balance,
-- -30 vs Chaos).  This de-islands them AND renders the Architect's internal
-- conflict as visible graph structure the narrative layer can lean on.
INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta) VALUES
  -- Balance ↔ Chaos: the central antagonism
  ('50000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000003','feuds_with', -65, '{"bond":"cosmic-facet"}'::jsonb),
  ('50000000-0000-0000-0000-000000000003','50000000-0000-0000-0000-000000000002','feuds_with', -65, '{"bond":"cosmic-facet"}'::jsonb),
  -- Fate ↔ Balance
  ('50000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000002','rival', -25, '{"bond":"cosmic-facet"}'::jsonb),
  ('50000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000001','rival', -25, '{"bond":"cosmic-facet"}'::jsonb),
  -- Fate ↔ Chaos
  ('50000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000003','rival', -30, '{"bond":"cosmic-facet"}'::jsonb),
  ('50000000-0000-0000-0000-000000000003','50000000-0000-0000-0000-000000000001','rival', -30, '{"bond":"cosmic-facet"}'::jsonb)
ON CONFLICT (from_id, to_id, kind) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART K: The bookie (de-island The House)
-- ═══════════════════════════════════════════════════════════════════════════
-- Galactic Sportsbook ("The House", fixed UUID …0001) is the ISL's sole
-- licensed operator → `affiliated_with` the league (+25).  Earth's footballing
-- ministry, guardian of the heritage game, publicly `scorns` the bookmaker
-- (-40) — a gambling-regulation tension the Architect can stir.  ISL fixed UUID
-- …0010; Earth Sport Ministry resolved by name.
INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta) VALUES
  ('30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000010','affiliated_with', 25, '{"bond":"licensed"}'::jsonb)
ON CONFLICT (from_id, to_id, kind) DO NOTHING;

INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta)
SELECT esm.id, '30000000-0000-0000-0000-000000000001'::uuid, 'scorns', -40, '{"bond":"regulation"}'::jsonb
FROM entities esm WHERE esm.kind = 'political_body' AND esm.name = 'Earth Sport Ministry'
ON CONFLICT (from_id, to_id, kind) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART L: Colonies → their worlds (de-island the seven colonies)
-- ═══════════════════════════════════════════════════════════════════════════
-- Each colony orbits a parent world.  Where the colony's `parent` names a real
-- planet entity (Earth / Jupiter / Saturn), link directly (`based_in`, +45).
-- Belt and Kuiper colonies name a region, not a body, so every colony ALSO
-- anchors to the first planet (alphabetical, deterministic) in its league
-- (+35) — guaranteeing each colony reaches the planetary graph even when its
-- parent isn't a discrete world.
INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta)
SELECT c.id, p.id, 'based_in', 45, '{"bond":"orbital"}'::jsonb
FROM entities c
JOIN entities p ON p.kind = 'planet' AND p.name = c.meta->>'parent'
WHERE c.kind = 'colony'
ON CONFLICT (from_id, to_id, kind) DO NOTHING;

INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta)
SELECT c.id, lp.planet_id, 'based_in', 35, '{"bond":"region"}'::jsonb
FROM entities c
JOIN (
  SELECT DISTINCT ON (meta->>'league') id AS planet_id, meta->>'league' AS league
  FROM entities WHERE kind = 'planet'
  ORDER BY meta->>'league', name
) lp ON lp.league = c.meta->>'league'
WHERE c.kind = 'colony'
ON CONFLICT (from_id, to_id, kind) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART M: Planetary neighbours (de-island the eleven team-less worlds)
-- ═══════════════════════════════════════════════════════════════════════════
-- Worlds in the same league are neighbours in the same region of space.
-- Chaining each league's planets (alphabetical) as mutual `neighbours` (+35)
-- ties the eleven team-less worlds (Ceres, Eris, Vesta, …) to the worlds that
-- DO host clubs, so the whole cosmology is one connected map.
WITH pl AS (
  SELECT id, meta->>'league' AS league,
         row_number() OVER (PARTITION BY meta->>'league' ORDER BY name) AS rn
  FROM entities WHERE kind = 'planet'
),
pairs AS (
  SELECT a.id AS from_id, b.id AS to_id
  FROM pl a JOIN pl b ON b.league = a.league AND b.rn = a.rn + 1
)
INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta)
SELECT from_id, to_id, 'neighbours', 35, '{"bond":"region"}'::jsonb FROM pairs
UNION ALL
SELECT to_id, from_id, 'neighbours', 35, '{"bond":"region"}'::jsonb FROM pairs
ON CONFLICT (from_id, to_id, kind) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART N: Governance hierarchy (de-island the five remaining bodies)
-- ═══════════════════════════════════════════════════════════════════════════
-- Planetary governments take their `seat` on their homeworld (`based_in`, +45)
-- and hold `member_of` the Solar Federation (+40); the Federation in turn is
-- `affiliated_with` the ISL (+50).  This threads the orphaned bodies (Earth
-- Sport Ministry, the Neptune/Saturn/Uranus bureaus, the Solar Federation
-- itself) into both the planetary map and the league.  Run for every planetary
-- body; ON CONFLICT leaves already-connected ones untouched.
INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta)
SELECT pb.id, p.id, 'based_in', 45, '{"bond":"seat"}'::jsonb
FROM entities pb
JOIN entities p ON p.kind = 'planet' AND p.name = pb.meta->>'homeworld'
WHERE pb.kind = 'political_body' AND pb.meta->>'homeworld' IS NOT NULL
ON CONFLICT (from_id, to_id, kind) DO NOTHING;

INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta)
SELECT pb.id, sf.id, 'member_of', 40, '{"bond":"federation"}'::jsonb
FROM entities pb
CROSS JOIN (
  SELECT id FROM entities WHERE kind = 'political_body' AND name = 'Solar Federation'
) sf
WHERE pb.kind = 'political_body' AND pb.name <> 'Solar Federation'
ON CONFLICT (from_id, to_id, kind) DO NOTHING;

INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta)
SELECT sf.id, '30000000-0000-0000-0000-000000000010'::uuid, 'affiliated_with', 50, '{"bond":"governance"}'::jsonb
FROM entities sf WHERE sf.kind = 'political_body' AND sf.name = 'Solar Federation'
ON CONFLICT (from_id, to_id, kind) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- Clean up the temporary hash helper — leave the schema as we found it.
-- ═══════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS _social_hash(uuid, text);
