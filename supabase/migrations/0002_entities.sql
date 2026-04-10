-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: 0002_entities
-- ───────────────────────────────────────────────────────────────────────────
-- WHY: Phase 5 introduces the unified entity model — a single table of
-- "things that exist in the ISL universe" (players, managers, referees,
-- pundits, journalists, the bookie, associations, planets) plus typed
-- traits and relationships between them. This is the foundation that lets
-- the Cosmic Architect weave cross-entity narratives: "journalist X quotes
-- pundit Y reacting to referee Z's decision in the match between A and B".
--
-- DESIGN DECISIONS:
--   1. ADDITIVE ONLY — existing `players` and `managers` tables keep every
--      column intact. `src/gameEngine.js` hardcodes camelCase stat columns
--      (attacking/defending/mental/athletic/technical/jersey_number/starter)
--      via normalizeTeamForEngine(). Dropping any of those columns would
--      break match simulation. The entities model is a SUPERSET, not a
--      replacement.
--   2. Players and managers get an `entity_id` FK column (nullable) that
--      links to their row in `entities`. A DO $$ block backfills this for
--      every existing row.
--   3. Entity "kind" is free-form text rather than a Postgres enum because
--      the list of entity kinds will grow as new phases land (Phase 8 adds
--      more). Adding a value to a text column is a zero-downtime operation;
--      adding one to an enum requires ALTER TYPE ... ADD VALUE which can't
--      run inside a transaction on older PG versions.
--   4. `entity_traits` uses (entity_id, trait_key) as PK — no separate id
--      column. Traits are key-value pairs, not standalone rows.
--   5. `entity_relationships` uses (from_id, to_id, kind) as PK so two
--      entities can have multiple relationship types (e.g. "rival" AND
--      "former_teammate") but only one of each kind.
--   6. `narratives` stores LLM-generated story fragments that reference
--      entities. The Architect, match engine, and scheduled Edge Functions
--      all write to this table. The `source` column tracks provenance.
--
-- DEPENDS ON: 0000_init.sql (players, managers), 0001_profiles.sql.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 1: CORE ENTITY TABLES
-- ═══════════════════════════════════════════════════════════════════════════

-- ── entities ────────────────────────────────────────────────────────────────
-- The unified table of "things that exist". Every player, manager, referee,
-- pundit, journalist, bookie, association, planet, etc. gets a row here.
-- The `kind` column categorises them; `meta` holds kind-specific data that
-- doesn't warrant its own column (e.g. a journalist's "beat" or a planet's
-- "atmosphere type").
CREATE TABLE IF NOT EXISTS entities (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         TEXT NOT NULL,
  name         TEXT NOT NULL,
  display_name TEXT,
  meta         JSONB DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index on kind for filtered queries ("give me all referees", "all pundits").
CREATE INDEX IF NOT EXISTS idx_entities_kind ON entities (kind);

-- ── entity_traits ───────────────────────────────────────────────────────────
-- Key-value personality/attribute store. For players this starts with their
-- `personality` archetype from the seed; for other kinds it holds role-
-- specific traits (e.g. referee strictness, pundit bias, journalist beat).
--
-- trait_value is JSONB so it can store strings, numbers, booleans, or nested
-- objects without requiring a column-per-trait. The trade-off is that
-- queries on specific trait values need JSONB operators, but that's
-- acceptable — trait queries are infrequent (Architect context loading,
-- not match-tick-rate).
CREATE TABLE IF NOT EXISTS entity_traits (
  entity_id   UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  trait_key   TEXT NOT NULL,
  trait_value JSONB NOT NULL DEFAULT '""',
  PRIMARY KEY (entity_id, trait_key)
);

-- ── entity_relationships ────────────────────────────────────────────────────
-- Directed edges between entities. "from → to" with a kind label and a
-- strength score [-100, +100] where negative is hostile and positive is
-- friendly. The Architect uses these to generate storylines: "Manager X
-- has a bitter rivalry (strength: -80) with Referee Y since the Season 1
-- final".
--
-- Examples of relationship kinds:
--   'rival', 'mentor', 'protege', 'former_teammate', 'friend', 'enemy',
--   'employed_by', 'covers' (journalist → team), 'officiates' (ref → match)
CREATE TABLE IF NOT EXISTS entity_relationships (
  from_id   UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  to_id     UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  kind      TEXT NOT NULL,
  strength  INTEGER NOT NULL DEFAULT 0
            CONSTRAINT strength_range CHECK (strength BETWEEN -100 AND 100),
  meta      JSONB DEFAULT '{}',
  PRIMARY KEY (from_id, to_id, kind)
);

-- ── narratives ──────────────────────────────────────────────────────────────
-- LLM-generated story fragments. Each narrative references one or more
-- entities and is tagged with its source (who/what generated it). The
-- Architect reads recent narratives when building its context window so
-- it can reference them in commentary and make decisions that feel
-- continuity-aware.
--
-- `entities_involved` is a JSONB array of entity UUIDs rather than a
-- junction table because:
--   a) Narratives are write-heavy, read-infrequent (only at Architect
--      context load time, not per-match-tick).
--   b) A junction table would double the write cost for every narrative.
--   c) We never need to JOIN from narrative→entity in a hot path.
CREATE TABLE IF NOT EXISTS narratives (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind              TEXT NOT NULL,
  summary           TEXT NOT NULL,
  entities_involved JSONB DEFAULT '[]',
  source            TEXT NOT NULL DEFAULT 'manual',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_by   JSONB DEFAULT '[]'
);

-- Index for loading recent narratives (Architect context).
CREATE INDEX IF NOT EXISTS idx_narratives_created_at ON narratives (created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 2: LINK EXISTING TABLES TO ENTITIES (ADDITIVE ONLY)
-- ═══════════════════════════════════════════════════════════════════════════

-- Add entity_id FK to players — nullable because the backfill runs below.
-- DO NOTHING if the column already exists (idempotent re-run safety).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'players' AND column_name = 'entity_id'
  ) THEN
    ALTER TABLE players ADD COLUMN entity_id UUID REFERENCES entities(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Add entity_id FK to managers.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'managers' AND column_name = 'entity_id'
  ) THEN
    ALTER TABLE managers ADD COLUMN entity_id UUID REFERENCES entities(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 3: BACKFILL — create entity rows for existing players + managers
-- ═══════════════════════════════════════════════════════════════════════════
-- This DO $$ block runs exactly once (the migration system guarantees that).
-- For every player row, it:
--   1. INSERTs an entities row with kind='player', name from players.name.
--   2. Updates players.entity_id to point at the new entity.
--   3. INSERTs an entity_trait for the player's personality archetype.
--
-- Same for managers (kind='manager', personality → trait).

DO $$
DECLARE
  rec RECORD;
  new_entity_id UUID;
BEGIN
  -- ── Backfill players ──────────────────────────────────────────────────
  FOR rec IN
    SELECT id, name, personality, team_id, position, nationality
    FROM players
    WHERE entity_id IS NULL
  LOOP
    INSERT INTO entities (kind, name, display_name, meta)
    VALUES (
      'player',
      rec.name,
      rec.name,
      jsonb_build_object(
        'team_id', rec.team_id,
        'position', rec.position,
        'nationality', rec.nationality
      )
    )
    RETURNING id INTO new_entity_id;

    UPDATE players SET entity_id = new_entity_id WHERE id = rec.id;

    -- Copy personality into entity_traits so the Architect can query it
    -- without joining back to the players table.
    IF rec.personality IS NOT NULL THEN
      INSERT INTO entity_traits (entity_id, trait_key, trait_value)
      VALUES (new_entity_id, 'personality', to_jsonb(rec.personality))
      ON CONFLICT (entity_id, trait_key) DO NOTHING;
    END IF;
  END LOOP;

  -- ── Backfill managers ─────────────────────────────────────────────────
  FOR rec IN
    SELECT id, name, style, team_id, nationality
    FROM managers
    WHERE entity_id IS NULL
  LOOP
    INSERT INTO entities (kind, name, display_name, meta)
    VALUES (
      'manager',
      rec.name,
      rec.name,
      jsonb_build_object(
        'team_id', rec.team_id,
        'nationality', rec.nationality
      )
    )
    RETURNING id INTO new_entity_id;

    UPDATE managers SET entity_id = new_entity_id WHERE id = rec.id;

    IF rec.style IS NOT NULL THEN
      INSERT INTO entity_traits (entity_id, trait_key, trait_value)
      VALUES (new_entity_id, 'style', to_jsonb(rec.style))
      ON CONFLICT (entity_id, trait_key) DO NOTHING;
    END IF;
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 4: SEED NEW ENTITY KINDS
-- ═══════════════════════════════════════════════════════════════════════════
-- These entities exist from Season 1 onward. The Architect and commentary
-- system can reference them immediately; the Phase 5.1 context hydration
-- will load them into the LLM prompt.

-- ── Bookie entity ───────────────────────────────────────────────────────────
-- The counterparty to every wager in Phase 2. House margin accrues to this
-- entity's traits so the Architect can weave "the House is nervous"
-- storylines. There is exactly ONE bookie in the ISL.
INSERT INTO entities (id, kind, name, display_name, meta)
VALUES (
  '30000000-0000-0000-0000-000000000001',
  'bookie',
  'Galactic Sportsbook',
  'The House',
  '{"description": "The sole licensed betting operator in the ISL. Takes bets on every match. House always wins… usually.", "balance": 0}'::jsonb
) ON CONFLICT (id) DO NOTHING;

-- ── Association bodies ──────────────────────────────────────────────────────
-- Governing organisations referenced in official communications, rule
-- disputes, and Architect edicts.
INSERT INTO entities (id, kind, name, display_name, meta) VALUES
  ('30000000-0000-0000-0000-000000000010', 'association', 'Interplanetary Soccer League', 'ISL',
   '{"role": "governing_body", "description": "The supreme governing body of interplanetary soccer."}'::jsonb),
  ('30000000-0000-0000-0000-000000000011', 'association', 'Mars-Wide Soccer Association', 'MWSA',
   '{"role": "regional_body", "description": "Oversees soccer on Mars and its orbital colonies."}'::jsonb),
  ('30000000-0000-0000-0000-000000000012', 'association', 'Intergalactic Sports Standards Union', 'ISSU',
   '{"role": "standards_body", "description": "Sets equipment, pitch, and atmospheric standards for all ISL venues."}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- ── IEOB Referees ───────────────────────────────────────────────────────────
-- The Interplanetary Enforcement of the Beautiful game (IEOB) referee corps.
-- Each referee has a strictness trait that affects match events when the
-- Architect assigns them to officiate.
INSERT INTO entities (kind, name, display_name, meta) VALUES
  ('referee', 'Orion Blackwood',    'O. Blackwood',    '{"corps": "IEOB", "homeworld": "Earth"}'::jsonb),
  ('referee', 'Vega Castellano',    'V. Castellano',   '{"corps": "IEOB", "homeworld": "Mars"}'::jsonb),
  ('referee', 'Rigel Okonkwo',      'R. Okonkwo',      '{"corps": "IEOB", "homeworld": "Jupiter"}'::jsonb),
  ('referee', 'Altair Nakamura',    'A. Nakamura',     '{"corps": "IEOB", "homeworld": "Saturn"}'::jsonb),
  ('referee', 'Sirius Fontaine',    'S. Fontaine',     '{"corps": "IEOB", "homeworld": "Earth"}'::jsonb),
  ('referee', 'Polaris Mensah',     'P. Mensah',       '{"corps": "IEOB", "homeworld": "Ceres"}'::jsonb),
  ('referee', 'Antares Petrov',     'A. Petrov',       '{"corps": "IEOB", "homeworld": "Pluto"}'::jsonb),
  ('referee', 'Deneb Asante',       'D. Asante',       '{"corps": "IEOB", "homeworld": "Venus"}'::jsonb),
  ('referee', 'Capella Rivera',     'C. Rivera',       '{"corps": "IEOB", "homeworld": "Titan"}'::jsonb),
  ('referee', 'Arcturus Volkov',    'A. Volkov',       '{"corps": "IEOB", "homeworld": "Europa"}'::jsonb),
  ('referee', 'Betelgeuse Park',    'B. Park',         '{"corps": "IEOB", "homeworld": "Ganymede"}'::jsonb),
  ('referee', 'Aldebaran Singh',    'A. Singh',        '{"corps": "IEOB", "homeworld": "Mars"}'::jsonb),
  ('referee', 'Procyon Diallo',     'P. Diallo',       '{"corps": "IEOB", "homeworld": "Eris"}'::jsonb),
  ('referee', 'Fomalhaut Chen',     'F. Chen',         '{"corps": "IEOB", "homeworld": "Earth"}'::jsonb),
  ('referee', 'Spica Hernandez',    'S. Hernandez',    '{"corps": "IEOB", "homeworld": "Vesta"}'::jsonb),
  ('referee', 'Castor Yamamoto',    'C. Yamamoto',     '{"corps": "IEOB", "homeworld": "Uranus"}'::jsonb),
  ('referee', 'Pollux Kowalski',    'P. Kowalski',     '{"corps": "IEOB", "homeworld": "Callisto"}'::jsonb),
  ('referee', 'Canopus Obi',        'C. Obi',          '{"corps": "IEOB", "homeworld": "Enceladus"}'::jsonb),
  ('referee', 'Achernar Sharma',    'A. Sharma',       '{"corps": "IEOB", "homeworld": "Haumea"}'::jsonb),
  ('referee', 'Regulus Torres',     'R. Torres',       '{"corps": "IEOB", "homeworld": "Makemake"}'::jsonb),
  ('referee', 'Bellatrix Nkosi',    'B. Nkosi',        '{"corps": "IEOB", "homeworld": "Sedna"}'::jsonb),
  ('referee', 'Alnilam Ferreira',   'A. Ferreira',     '{"corps": "IEOB", "homeworld": "Mercury"}'::jsonb),
  ('referee', 'Hadar Kim',          'H. Kim',          '{"corps": "IEOB", "homeworld": "Neptune"}'::jsonb),
  ('referee', 'Mimosa Patel',       'M. Patel',        '{"corps": "IEOB", "homeworld": "Psyche"}'::jsonb),
  ('referee', 'Alioth Novak',       'A. Novak',        '{"corps": "IEOB", "homeworld": "Juno"}'::jsonb),
  ('referee', 'Mizar Cruz',         'M. Cruz',         '{"corps": "IEOB", "homeworld": "Pallas"}'::jsonb),
  ('referee', 'Alcor Brennan',      'A. Brennan',      '{"corps": "IEOB", "homeworld": "Orcus"}'::jsonb),
  ('referee', 'Dubhe Santos',       'D. Santos',       '{"corps": "IEOB", "homeworld": "Earth"}'::jsonb),
  ('referee', 'Merak Ivanova',      'M. Ivanova',      '{"corps": "IEOB", "homeworld": "Mars"}'::jsonb),
  ('referee', 'Phecda Okello',      'P. Okello',       '{"corps": "IEOB", "homeworld": "Hygiea"}'::jsonb),
  ('referee', 'Megrez Wei',         'M. Wei',          '{"corps": "IEOB", "homeworld": "Charon"}'::jsonb),
  ('referee', 'Electra Fontaine',   'E. Fontaine',     '{"corps": "IEOB", "homeworld": "Saturn"}'::jsonb);

-- Seed referee strictness traits (1-10 scale: 1=lenient, 10=strict).
-- This trait determines yellow/red card frequency when a referee is assigned.
INSERT INTO entity_traits (entity_id, trait_key, trait_value)
SELECT e.id, 'strictness', to_jsonb(
  CASE
    WHEN e.name LIKE '%Blackwood%' THEN 8
    WHEN e.name LIKE '%Okonkwo%'   THEN 9
    WHEN e.name LIKE '%Fontaine%'  THEN 3
    WHEN e.name LIKE '%Mensah%'    THEN 6
    WHEN e.name LIKE '%Petrov%'    THEN 7
    WHEN e.name LIKE '%Rivera%'    THEN 5
    WHEN e.name LIKE '%Park%'      THEN 4
    WHEN e.name LIKE '%Singh%'     THEN 7
    WHEN e.name LIKE '%Diallo%'    THEN 6
    WHEN e.name LIKE '%Chen%'      THEN 5
    ELSE 5  -- default medium strictness
  END
)
FROM entities e
WHERE e.kind = 'referee'
ON CONFLICT (entity_id, trait_key) DO NOTHING;

-- ── Media companies ─────────────────────────────────────────────────────────
INSERT INTO entities (kind, name, display_name, meta) VALUES
  ('media_company', 'Galactic Sports Network',     'GSN',         '{"type": "broadcaster", "reach": "galaxy-wide"}'::jsonb),
  ('media_company', 'Inner System Sports',         'ISS',         '{"type": "broadcaster", "reach": "inner_planets"}'::jsonb),
  ('media_company', 'The Outer Voice',             'TOV',         '{"type": "broadcaster", "reach": "outer_system"}'::jsonb),
  ('media_company', 'Belt & Beyond Media',         'BBM',         '{"type": "broadcaster", "reach": "asteroid_belt"}'::jsonb),
  ('media_company', 'Kuiper Chronicle Network',    'KCN',         '{"type": "broadcaster", "reach": "kuiper_belt"}'::jsonb),
  ('media_company', 'Solar System Sports Daily',   'SSSD',        '{"type": "newspaper", "reach": "galaxy-wide"}'::jsonb);

-- ── Pundits ─────────────────────────────────────────────────────────────────
-- Opinionated ex-players/coaches who appear in commentary and news feeds.
INSERT INTO entities (kind, name, display_name, meta) VALUES
  ('pundit', 'Rex Valorum',       'Rex Valorum',       '{"specialty": "tactics", "era": "retired_player", "homeworld": "Earth"}'::jsonb),
  ('pundit', 'Zephyr Kwan',       'Zephyr Kwan',       '{"specialty": "youth_development", "era": "retired_coach", "homeworld": "Mars"}'::jsonb),
  ('pundit', 'Bolt Adesanya',     'Bolt Adesanya',     '{"specialty": "forwards", "era": "retired_player", "homeworld": "Jupiter"}'::jsonb),
  ('pundit', 'Nova Petrossian',   'Nova Petrossian',   '{"specialty": "goalkeeping", "era": "retired_player", "homeworld": "Saturn"}'::jsonb),
  ('pundit', 'Crag Montoya',      'Crag Montoya',      '{"specialty": "defending", "era": "retired_player", "homeworld": "Ceres"}'::jsonb),
  ('pundit', 'Frost Lindqvist',   'Frost Lindqvist',   '{"specialty": "transfers", "era": "agent", "homeworld": "Pluto"}'::jsonb),
  ('pundit', 'Tide Okonkwo',      'Tide Okonkwo',      '{"specialty": "midfield", "era": "retired_player", "homeworld": "Europa"}'::jsonb),
  ('pundit', 'Axis Delgado',      'Axis Delgado',      '{"specialty": "statistics", "era": "analyst", "homeworld": "Uranus"}'::jsonb),
  ('pundit', 'Void Nakamura',     'Void Nakamura',     '{"specialty": "psychology", "era": "sports_psychologist", "homeworld": "Sedna"}'::jsonb),
  ('pundit', 'Flare Asante',      'Flare Asante',      '{"specialty": "set_pieces", "era": "retired_coach", "homeworld": "Mercury"}'::jsonb),
  ('pundit', 'Echo Ferrara',      'Echo Ferrara',      '{"specialty": "form_analysis", "era": "retired_player", "homeworld": "Venus"}'::jsonb),
  ('pundit', 'Stellar Cruz',      'Stellar Cruz',      '{"specialty": "general", "era": "retired_player", "homeworld": "Earth"}'::jsonb);

-- ── Journalists ─────────────────────────────────────────────────────────────
-- Reporters who write stories in the news feed, quote pundits, and
-- investigate Architect interference. Each has a "beat" (league or topic).
INSERT INTO entities (kind, name, display_name, meta) VALUES
  ('journalist', 'Iris Volkov',       'Iris Volkov',       '{"beat": "rocky-inner", "employer": "GSN"}'::jsonb),
  ('journalist', 'Kael Nkosi',        'Kael Nkosi',        '{"beat": "gas-giants", "employer": "GSN"}'::jsonb),
  ('journalist', 'Lux Tanaka',        'Lux Tanaka',        '{"beat": "outer-reaches", "employer": "TOV"}'::jsonb),
  ('journalist', 'Mira Fontaine',     'Mira Fontaine',     '{"beat": "kuiper-belt", "employer": "KCN"}'::jsonb),
  ('journalist', 'Orion Sharma',      'Orion Sharma',      '{"beat": "transfers", "employer": "SSSD"}'::jsonb),
  ('journalist', 'Pax Okafor',        'Pax Okafor',        '{"beat": "tactics", "employer": "ISS"}'::jsonb),
  ('journalist', 'Quinn Rivera',      'Quinn Rivera',      '{"beat": "youth", "employer": "BBM"}'::jsonb),
  ('journalist', 'Ren Kowalski',      'Ren Kowalski',      '{"beat": "champions_cup", "employer": "GSN"}'::jsonb),
  ('journalist', 'Sol Petrov',        'Sol Petrov',        '{"beat": "cosmic_architect", "employer": "SSSD"}'::jsonb),
  ('journalist', 'Tara Mensah',       'Tara Mensah',       '{"beat": "betting", "employer": "GSN"}'::jsonb),
  ('journalist', 'Ursa Park',         'Ursa Park',         '{"beat": "injuries", "employer": "ISS"}'::jsonb),
  ('journalist', 'Vex Diallo',        'Vex Diallo',        '{"beat": "rocky-inner", "employer": "ISS"}'::jsonb),
  ('journalist', 'Wren Ivanova',      'Wren Ivanova',      '{"beat": "gas-giants", "employer": "TOV"}'::jsonb),
  ('journalist', 'Xia Chen',          'Xia Chen',          '{"beat": "outer-reaches", "employer": "BBM"}'::jsonb),
  ('journalist', 'Yuri Santos',       'Yuri Santos',       '{"beat": "kuiper-belt", "employer": "KCN"}'::jsonb),
  ('journalist', 'Zara Brennan',      'Zara Brennan',      '{"beat": "general", "employer": "SSSD"}'::jsonb),
  ('journalist', 'Atlas Kim',         'Atlas Kim',         '{"beat": "statistics", "employer": "GSN"}'::jsonb),
  ('journalist', 'Celeste Obi',       'Celeste Obi',       '{"beat": "managers", "employer": "TOV"}'::jsonb),
  ('journalist', 'Drift Hartmann',    'Drift Hartmann',    '{"beat": "fans", "employer": "BBM"}'::jsonb),
  ('journalist', 'Echo Rashidi',      'Echo Rashidi',      '{"beat": "referee_controversy", "employer": "SSSD"}'::jsonb);

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 5: RLS
-- ═══════════════════════════════════════════════════════════════════════════
-- Entity tables are publicly readable (the whole point is that the Architect
-- and commentary system reference them in public-facing content). Writes
-- are restricted to authenticated users for now; Phase 8's Edge Function
-- will use the service role key to bypass RLS for scheduled mutations.

ALTER TABLE entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_traits ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE narratives ENABLE ROW LEVEL SECURITY;

-- Public read for all entity tables.
CREATE POLICY entities_public_read ON entities FOR SELECT USING (true);
CREATE POLICY entity_traits_public_read ON entity_traits FOR SELECT USING (true);
CREATE POLICY entity_relationships_public_read ON entity_relationships FOR SELECT USING (true);
CREATE POLICY narratives_public_read ON narratives FOR SELECT USING (true);

-- Authenticated write for entity tables (match engine, Architect writes).
CREATE POLICY entities_auth_write ON entities
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY entity_traits_auth_write ON entity_traits
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY entity_relationships_auth_write ON entity_relationships
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY narratives_auth_write ON narratives
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
