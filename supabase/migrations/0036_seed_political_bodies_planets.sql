-- ── 0036_seed_political_bodies_planets.sql ─────────────────────────────────
-- WHY: Phase 4 of the Universal Agent System (bd epic isl-bqx, child
-- isl-bqx.5).  Seeds the long-tail entities that Phase 6 (reflection
-- decisions) and Phase 9 (drama tier) need to be able to address by
-- name — political bodies that issue decrees, planets whose gravity
-- and weather shape matches, colonies with their own civic stakes.
--
-- The entries below are intentionally numerous and *neutral* — Phase 5's
-- corpus-enricher and Phase 9's drama-tick will progressively give each
-- one a voice and a stake.  Right now they exist so:
--
--   - The decision layer (Phase 6+) can route "Earth President" to a
--     specific entity_id when it wants to fire a political decree.
--   - The Architect council (Phase 5+) can reference planets by entity_id
--     rather than as opaque strings in narratives.
--   - Players who share a homeworld (already encoded in entities.meta)
--     can be related back to a planet entity row via Phase 1's relationship
--     graph in future migrations.
--
-- IDEMPOTENT — every INSERT uses ON CONFLICT (id) DO NOTHING so re-running
-- this migration on a partially-seeded database is a no-op.  IDs use a
-- stable namespace prefix per kind (40000000-…/political_body,
-- 50000000-…/planet, 60000000-…/colony) so future migrations can target
-- specific rows without ambiguity.
--
-- PERSONA SEEDING — after this migration runs, re-run
-- `scripts/seed-personas.ts` to give every new row an entity_persona via
-- the Phase 3 deterministic factory.  The factory's archetype palette
-- already covers `association` (covers political bodies' tone) and
-- `planet` (covers planets + colonies — same archetype).
-- ──────────────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 1: Political bodies
-- ═══════════════════════════════════════════════════════════════════════════
-- League-spanning governance entities.  Each carries a `role` and a short
-- `description` in meta so the decision-layer prompts can ground prose
-- without re-querying.  Sphere of influence in `scope` (system /
-- regional / planetary).

INSERT INTO entities (id, kind, name, display_name, meta) VALUES
  -- ── System-wide governance ───────────────────────────────────────────────
  ('40000000-0000-0000-0000-000000000001', 'political_body',
   'Solar Federation', 'Solar Federation',
   '{"role": "federation", "scope": "system", "description": "The interplanetary governing union; arbitrates disputes between planets, ratifies cross-planet trade pacts, and signs off on league fixture calendars."}'::jsonb),

  ('40000000-0000-0000-0000-000000000002', 'political_body',
   'Galactic League Council', 'GLC',
   '{"role": "league_oversight", "scope": "system", "description": "The supreme oversight body of the ISL; ratifies rule changes, hears appeals, and audits Architect interventions when challenged in formal hearings."}'::jsonb),

  ('40000000-0000-0000-0000-000000000003', 'political_body',
   'Office of the Earth President', 'Earth President',
   '{"role": "head_of_state", "scope": "regional", "description": "The most visible single human seat of power in the league; speaks for Earth-aligned clubs in interplanetary disputes and rarely passes a season without a public footballing intervention."}'::jsonb),

  -- ── Planetary governments ───────────────────────────────────────────────
  -- One per major league location.  Each issues planet-scoped decrees that
  -- affect their resident clubs (training subsidies, atmospheric levies,
  -- player transfer windows shaped by orbital alignment).
  ('40000000-0000-0000-0000-000000000010', 'political_body',
   'Mercury Solar Authority', 'Mercury Authority',
   '{"role": "planetary_government", "scope": "planetary", "homeworld": "Mercury", "description": "Compact technocratic council that schedules everything around the planet's solar exposure cycles."}'::jsonb),

  ('40000000-0000-0000-0000-000000000011', 'political_body',
   'Venus Cloud Senate', 'Venus Senate',
   '{"role": "planetary_government", "scope": "planetary", "homeworld": "Venus", "description": "Floats above the surface in atmospheric chambers; values deliberation and rhetoric over speed."}'::jsonb),

  ('40000000-0000-0000-0000-000000000012', 'political_body',
   'Earth Sport Ministry', 'Earth Sport Ministry',
   '{"role": "planetary_government", "scope": "planetary", "homeworld": "Earth", "description": "Earth's footballing arm of state; oversees development pathways, broadcast rights, and the heritage of the game on its mother world."}'::jsonb),

  ('40000000-0000-0000-0000-000000000013', 'political_body',
   'Mars Republic Assembly', 'Mars Assembly',
   '{"role": "planetary_government", "scope": "planetary", "homeworld": "Mars", "description": "Federated assembly of Mars's four major settlements; rivalries between members occasionally leak into footballing politics."}'::jsonb),

  ('40000000-0000-0000-0000-000000000014', 'political_body',
   'Jovian League Conclave', 'Jovian Conclave',
   '{"role": "planetary_government", "scope": "planetary", "homeworld": "Jupiter", "description": "Rotating chairmanship between Jupiter's habitat-clouds; outwardly genteel, internally fractious."}'::jsonb),

  ('40000000-0000-0000-0000-000000000015', 'political_body',
   'Saturnian Ring Council', 'Saturn Council',
   '{"role": "planetary_government", "scope": "planetary", "homeworld": "Saturn", "description": "Orbital ring-based legislature; insists on procedural perfection in every footballing matter."}'::jsonb),

  ('40000000-0000-0000-0000-000000000016', 'political_body',
   'Uranus Tilt Bureau', 'Uranus Bureau',
   '{"role": "planetary_government", "scope": "planetary", "homeworld": "Uranus", "description": "Quiet bureaucracy famous for its long memory and even longer fixture-list negotiations."}'::jsonb),

  ('40000000-0000-0000-0000-000000000017', 'political_body',
   'Neptune Tide Bureau', 'Neptune Bureau',
   '{"role": "planetary_government", "scope": "planetary", "homeworld": "Neptune", "description": "Deep-blue institutional culture; rarely speaks first, never speaks twice on the same matter."}'::jsonb),

  ('40000000-0000-0000-0000-000000000018', 'political_body',
   'Belt Confederation', 'Belt Confederation',
   '{"role": "regional_government", "scope": "regional", "homeworld": "Asteroid Belt", "description": "Loose alliance of Asteroid-Belt mining colonies that bargains collectively for football rights."}'::jsonb),

  ('40000000-0000-0000-0000-000000000019', 'political_body',
   'Kuiper Frontier Assembly', 'Kuiper Assembly',
   '{"role": "regional_government", "scope": "regional", "homeworld": "Kuiper Belt", "description": "Slow-comms confederation of the outer dwarf worlds; values self-sufficiency and quiet independence."}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 2: Planets
-- ═══════════════════════════════════════════════════════════════════════════
-- Every primary league location gets a planet entity.  Planets aren't
-- mortal — their voice (per personaFactory's `planet` archetype) is
-- slow and geological.  meta carries gravity / atmosphere / weather
-- hints so future decision resolvers can derive match-time perturbations.

INSERT INTO entities (id, kind, name, display_name, meta) VALUES
  -- ── Rocky Inner League ───────────────────────────────────────────────────
  ('50000000-0000-0000-0000-000000000001', 'planet', 'Mercury', 'Mercury',
   '{"league": "rocky-inner", "gravity_g": 0.38, "atmosphere": "tenuous", "weather": "solar_flares", "description": "Closest to the sun. Days bake; nights chill. Football here is fast, brittle, and short."}'::jsonb),
  ('50000000-0000-0000-0000-000000000002', 'planet', 'Venus', 'Venus',
   '{"league": "rocky-inner", "gravity_g": 0.91, "atmosphere": "thick", "weather": "acid_rain", "description": "Pressure-domed pitches under a sulfuric sky. Movement is heavy; lungs are precious."}'::jsonb),
  ('50000000-0000-0000-0000-000000000003', 'planet', 'Earth', 'Earth',
   '{"league": "rocky-inner", "gravity_g": 1.00, "atmosphere": "standard", "weather": "varied", "description": "The mother of the game. Every other planet measures itself against the templates born here."}'::jsonb),
  ('50000000-0000-0000-0000-000000000004', 'planet', 'Mars', 'Mars',
   '{"league": "rocky-inner", "gravity_g": 0.38, "atmosphere": "thin", "weather": "dust_storms", "description": "Red, low-gravity, frontier. Jumps go higher; tackles slide further; dust gets everywhere."}'::jsonb),

  -- ── Gas / Ice Giant League ───────────────────────────────────────────────
  ('50000000-0000-0000-0000-000000000005', 'planet', 'Jupiter', 'Jupiter',
   '{"league": "gas-giant", "gravity_g": 2.53, "atmosphere": "crushing", "weather": "storm_belts", "description": "No surface — football is played in floating arena-cities under the storm bands. Heavy gravity tests every leg."}'::jsonb),
  ('50000000-0000-0000-0000-000000000006', 'planet', 'Saturn', 'Saturn',
   '{"league": "gas-giant", "gravity_g": 1.07, "atmosphere": "thick_hydrogen", "weather": "ring_shadows", "description": "Played in ring-tethered orbital habitats. Shadows from the rings ripple across pitches on cycle."}'::jsonb),
  ('50000000-0000-0000-0000-000000000007', 'planet', 'Uranus', 'Uranus',
   '{"league": "gas-giant", "gravity_g": 0.89, "atmosphere": "cold_methane", "weather": "axial_disruption", "description": "Tilted ninety degrees. Seasons last decades. Tactical patience compounds across years."}'::jsonb),
  ('50000000-0000-0000-0000-000000000008', 'planet', 'Neptune', 'Neptune',
   '{"league": "gas-giant", "gravity_g": 1.14, "atmosphere": "supersonic_winds", "weather": "fastest_in_system", "description": "The fastest winds in the solar system. Stadium domes do most of the work."}'::jsonb),

  -- ── Asteroid Belt League ─────────────────────────────────────────────────
  ('50000000-0000-0000-0000-000000000009', 'planet', 'Ceres', 'Ceres',
   '{"league": "asteroid-belt", "gravity_g": 0.029, "atmosphere": "none", "weather": "vacuum_dust", "description": "The largest body in the Belt; venue for the biggest free-fall arenas."}'::jsonb),
  ('50000000-0000-0000-0000-00000000000a', 'planet', 'Vesta', 'Vesta',
   '{"league": "asteroid-belt", "gravity_g": 0.025, "atmosphere": "none", "weather": "vacuum_dust", "description": "Bright, basaltic, ancient. Stadium foundations are anchored to a billion-year-old crust."}'::jsonb),
  ('50000000-0000-0000-0000-00000000000b', 'planet', 'Pallas', 'Pallas',
   '{"league": "asteroid-belt", "gravity_g": 0.020, "atmosphere": "none", "weather": "vacuum_dust", "description": "Heavily inclined orbit; the league's most awkward away trip."}'::jsonb),
  ('50000000-0000-0000-0000-00000000000c', 'planet', 'Hygiea', 'Hygiea',
   '{"league": "asteroid-belt", "gravity_g": 0.014, "atmosphere": "none", "weather": "vacuum_dust", "description": "Dim, dark, the most distant of the major belt worlds; small but obstinate."}'::jsonb),
  ('50000000-0000-0000-0000-00000000000d', 'planet', 'Juno', 'Juno',
   '{"league": "asteroid-belt", "gravity_g": 0.012, "atmosphere": "none", "weather": "vacuum_dust", "description": "Among the brightest minor bodies; its football academy ships players the league over."}'::jsonb),

  -- ── Kuiper Belt League ───────────────────────────────────────────────────
  ('50000000-0000-0000-0000-00000000000e', 'planet', 'Pluto', 'Pluto',
   '{"league": "kuiper", "gravity_g": 0.063, "atmosphere": "trace_nitrogen", "weather": "frost", "description": "Heart-shaped plains; the most romantic away day on the calendar."}'::jsonb),
  ('50000000-0000-0000-0000-00000000000f', 'planet', 'Eris', 'Eris',
   '{"league": "kuiper", "gravity_g": 0.083, "atmosphere": "frozen", "weather": "icefall", "description": "Wide elliptical orbit. Visiting clubs travel for months between fixtures."}'::jsonb),
  ('50000000-0000-0000-0000-000000000010', 'planet', 'Haumea', 'Haumea',
   '{"league": "kuiper", "gravity_g": 0.045, "atmosphere": "none", "weather": "vacuum_chill", "description": "Egg-shaped and rapidly spinning. Pitches are gyroscopically stabilised."}'::jsonb),
  ('50000000-0000-0000-0000-000000000011', 'planet', 'Makemake', 'Makemake',
   '{"league": "kuiper", "gravity_g": 0.050, "atmosphere": "none", "weather": "vacuum_chill", "description": "Cratered, methane-frozen, dignified in its quiet."}'::jsonb),
  ('50000000-0000-0000-0000-000000000012', 'planet', 'Sedna', 'Sedna',
   '{"league": "kuiper", "gravity_g": 0.040, "atmosphere": "none", "weather": "vacuum_chill", "description": "The most isolated venue; some clubs make the trip once a decade."}'::jsonb),
  ('50000000-0000-0000-0000-000000000013', 'planet', 'Orcus', 'Orcus',
   '{"league": "kuiper", "gravity_g": 0.035, "atmosphere": "none", "weather": "vacuum_chill", "description": "Walks the line between Plutino and dwarf world; legalistic about both."}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 3: Colonies
-- ═══════════════════════════════════════════════════════════════════════════
-- Orbital habitats and pocket settlements that show up in the league as
-- venue locations (e.g. 'Solar City FC — Earth Orbital Colony').  Same
-- archetype family as planets, but separate entity_kind so future logic
-- can distinguish "this entity has gravity" from "this entity is a
-- habitat".

INSERT INTO entities (id, kind, name, display_name, meta) VALUES
  ('60000000-0000-0000-0000-000000000001', 'colony', 'Earth Orbital Colony', 'Earth Orbital',
   '{"league": "rocky-inner", "parent": "Earth", "habitat": "ring_station", "description": "First-generation orbital around Earth; the original off-world venue."}'::jsonb),
  ('60000000-0000-0000-0000-000000000002', 'colony', 'Saturn Orbital Colony', 'Saturn Orbital',
   '{"league": "gas-giant", "parent": "Saturn", "habitat": "ring_anchor", "description": "Anchored to the inner rings; matches play to the slow drift of ring-shadow overhead."}'::jsonb),
  ('60000000-0000-0000-0000-000000000003', 'colony', 'Beltway Habitat', 'Beltway',
   '{"league": "asteroid-belt", "parent": "Asteroid Belt", "habitat": "linked_asteroids", "description": "Loose archipelago of habitats strung between mid-Belt asteroids; venue for FC Beltway."}'::jsonb),
  ('60000000-0000-0000-0000-000000000004', 'colony', 'Solar Miners Habitat', 'Solar Miners',
   '{"league": "asteroid-belt", "parent": "Asteroid Belt", "habitat": "mining_complex", "description": "Working colony retrofitted with a stadium; pitch is small, the crowd is loud."}'::jsonb),
  ('60000000-0000-0000-0000-000000000005', 'colony', 'Plutino Region', 'Plutino Region',
   '{"league": "kuiper", "parent": "Plutino", "habitat": "scattered_outposts", "description": "Loose belt of habitats sharing Pluto's orbital resonance; FC Plutino plays nominally home games across half a dozen of them."}'::jsonb),
  ('60000000-0000-0000-0000-000000000006', 'colony', 'Outer Kuiper Belt', 'Outer Kuiper',
   '{"league": "kuiper", "parent": "Scattered Disc", "habitat": "frontier_stations", "description": "Last outposts before deep space; remote, self-reliant, fond of underdog mythologies."}'::jsonb),
  ('60000000-0000-0000-0000-000000000007', 'colony', 'Jupiter Region', 'Jupiter Region',
   '{"league": "gas-giant", "parent": "Jupiter", "habitat": "moons_and_clouds", "description": "Catch-all label for habitats around Jupiter's moons that don't anchor to one specific body."}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- NOTES
-- ═══════════════════════════════════════════════════════════════════════════
-- After this migration applies, run `npx tsx scripts/seed-personas.ts` to
-- give every new row an entity_persona via the Phase 3 deterministic
-- factory.  The factory's `political_body` kind falls through to the
-- generic archetype today — the `association` archetype is a closer
-- match.  A small follow-up to personaFactory.ts can add a dedicated
-- `political_body` archetype if/when the generic voice feels too thin.
