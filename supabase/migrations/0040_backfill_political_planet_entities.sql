-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: 0040_backfill_political_planet_entities
-- ───────────────────────────────────────────────────────────────────────────
-- WHY: An earlier revision of `0036_seed_political_bodies_planets.sql` placed
-- the three system-wide political_body entities (Solar Federation, GLC,
-- Earth President) at UUIDs `40000000-0000-0000-0000-000000000001..003`,
-- and the three inner-rocky planet entities (Mercury / Venus / Earth) at
-- `50000000-0000-0000-0000-000000000001..003`.  Both of those UUIDs were
-- already claimed by `0011_voices.sql` for the three commentator entities
-- (Vox / Nexus-7 / Zara) and the three cosmic_voice entities respectively.
-- 0036's `ON CONFLICT (id) DO NOTHING` therefore silently skipped those
-- six inserts in any environment where 0011 ran first.
--
-- 0036 was subsequently amended in-place to use the `41000000-…` and
-- `51000000-…` namespaces (commit fb037d4).  Supabase tracks applied
-- migrations by filename, so any environment that already recorded 0036
-- as applied does NOT re-execute it with the corrected UUIDs — those
-- environments therefore are missing the six rows entirely.  Code that
-- references political_body / planet entities by name (referee selection,
-- council deliberation, narrative templates, `scripts/seed-personas.ts`)
-- silently degrades on those environments while passing on every fresh
-- dev DB.
--
-- THIS MIGRATION re-inserts the six rows under the corrected namespaces
-- with `ON CONFLICT (id) DO NOTHING`, so:
--   • Fresh DBs (which already got the rows via the amended 0036) skip
--     the inserts cleanly — no duplicates, no errors.
--   • Stale environments (where the original 0036 ran) get the missing
--     rows inserted for the first time, finally matching what fresh DBs
--     have had all along.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── System-wide governance ──────────────────────────────────────────────────
INSERT INTO entities (id, kind, name, display_name, meta) VALUES
  ('41000000-0000-0000-0000-000000000001', 'political_body',
   'Solar Federation', 'Solar Federation',
   '{"role": "federation", "scope": "system", "description": "The interplanetary governing union; arbitrates disputes between planets, ratifies cross-planet trade pacts, and signs off on league fixture calendars."}'::jsonb),

  ('41000000-0000-0000-0000-000000000002', 'political_body',
   'Galactic League Council', 'GLC',
   '{"role": "league_oversight", "scope": "system", "description": "The supreme oversight body of the ISL; ratifies rule changes, hears appeals, and audits Architect interventions when challenged in formal hearings."}'::jsonb),

  ('41000000-0000-0000-0000-000000000003', 'political_body',
   'Office of the Earth President', 'Earth President',
   '{"role": "head_of_state", "scope": "regional", "description": "The most visible single human seat of power in the league; speaks for Earth-aligned clubs in interplanetary disputes and rarely passes a season without a public footballing intervention."}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- ── Rocky Inner League — Mercury / Venus / Earth ────────────────────────────
INSERT INTO entities (id, kind, name, display_name, meta) VALUES
  ('51000000-0000-0000-0000-000000000001', 'planet', 'Mercury', 'Mercury',
   '{"league": "rocky-inner", "gravity_g": 0.38, "atmosphere": "tenuous", "weather": "solar_flares", "description": "Closest to the sun. Days bake; nights chill. Football here is fast, brittle, and short."}'::jsonb),
  ('51000000-0000-0000-0000-000000000002', 'planet', 'Venus', 'Venus',
   '{"league": "rocky-inner", "gravity_g": 0.91, "atmosphere": "thick", "weather": "acid_rain", "description": "Pressure-domed pitches under a sulfuric sky. Movement is heavy; lungs are precious."}'::jsonb),
  ('51000000-0000-0000-0000-000000000003', 'planet', 'Earth', 'Earth',
   '{"league": "rocky-inner", "gravity_g": 1.00, "atmosphere": "standard", "weather": "varied", "description": "The mother of the game. Every other planet measures itself against the templates born here."}'::jsonb)
ON CONFLICT (id) DO NOTHING;
