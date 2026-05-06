-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: 0011_voices
-- ───────────────────────────────────────────────────────────────────────────
-- Phase 1: Seed entity rows for the three on-air commentators and the three
-- cosmic voices so the entity graph knows about all six broadcast presences.
--
-- DESIGN DECISIONS:
--   1. Commentator entities (kind='commentator') link to the COMMENTATOR_PROFILES
--      array in AgentSystem.ts via the `profile_id` meta field.  The match engine
--      already hardcodes three profiles; these rows give them a presence in the
--      graph so the Architect can reference them and relationships can be built.
--
--   2. Cosmic voice entities (kind='cosmic_voice') have stable UUIDs so
--      CosmicArchitect.ts can reference the First Voice by ID without a DB query.
--      The UUIDs use the 5000... prefix to avoid collisions with other seeded
--      entities (bookie uses 3000..., associations use 3000...0010+).
--
--   3. Voice traits use the same entity_traits key-value store as all other
--      entities.  trait_key 'register' holds the voice's tonal register;
--      'cadence' holds its rhythm description; 'internal_state_schema' is a
--      JSON string describing the named fields of the JSONB internal_state
--      column — used by CosmicVoiceEngine to initialise the correct fields.
--
--   4. No schema changes are required — entities.kind is free-form TEXT
--      (see migration 0002 design note #3).
--
-- DEPENDS ON: 0002_entities.sql (entities, entity_traits tables).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── On-air commentator entities ─────────────────────────────────────────────
-- These mirror the three COMMENTATOR_PROFILES in AgentSystem.ts.
-- The `profile_id` meta field is the stable key used to look them up.

INSERT INTO entities (id, kind, name, display_name, meta) VALUES
  (
    '40000000-0000-0000-0000-000000000001',
    'commentator',
    'Captain Vox',
    'Captain Vox',
    '{"profile_id": "captain_vox", "role": "Play-by-Play", "homeworld": "Earth Orbital Colony", "tenure_years": 40}'::jsonb
  ),
  (
    '40000000-0000-0000-0000-000000000002',
    'commentator',
    'Nexus-7',
    'Nexus-7',
    '{"profile_id": "nexus7", "role": "AI Analyst", "homeworld": "Synthetic", "model_generation": 7}'::jsonb
  ),
  (
    '40000000-0000-0000-0000-000000000003',
    'commentator',
    'Zara Bloom',
    'Zara Bloom',
    '{"profile_id": "zara_bloom", "role": "Color Analyst", "homeworld": "Mars", "former_position": "Striker"}'::jsonb
  )
ON CONFLICT (id) DO NOTHING;

-- Commentator personality traits
INSERT INTO entity_traits (entity_id, trait_key, trait_value) VALUES
  ('40000000-0000-0000-0000-000000000001', 'register',  '"bombastic"'),
  ('40000000-0000-0000-0000-000000000001', 'cadence',   '"theatrical, sweeping, all-caps peaks"'),
  ('40000000-0000-0000-0000-000000000001', 'concerns',  '"goals, drama, the beautiful game"'),
  ('40000000-0000-0000-0000-000000000002', 'register',  '"clinical"'),
  ('40000000-0000-0000-0000-000000000002', 'cadence',   '"precise, data-referencing, occasional glitch"'),
  ('40000000-0000-0000-0000-000000000002', 'concerns',  '"statistics, probability, expected goals"'),
  ('40000000-0000-0000-0000-000000000003', 'register',  '"incisive"'),
  ('40000000-0000-0000-0000-000000000003', 'cadence',   '"dry, direct, witheringly honest"'),
  ('40000000-0000-0000-0000-000000000003', 'concerns',  '"tactics, player psychology, poor decisions"')
ON CONFLICT (entity_id, trait_key) DO NOTHING;

-- ── Cosmic voice entities ────────────────────────────────────────────────────
-- Three unnamed presences that manifest through match events.
-- In-fiction they have no names — only their effects and cadences are known.
-- In code they are identified by stable UUID and voiceIndex (1/2/3).
--
-- First Voice  (voiceIndex=1) = the existing Cosmic Architect / Fate.
-- Second Voice (voiceIndex=2) = Balance.
-- Third Voice  (voiceIndex=3) = Chaos.
--
-- The `name` column here is for internal/admin use only.  It is never shown
-- to players.  display_name is intentionally left null.

INSERT INTO entities (id, kind, name, display_name, meta) VALUES
  (
    '50000000-0000-0000-0000-000000000001',
    'cosmic_voice',
    'First Voice',
    NULL,
    '{"voice_index": 1, "description": "Fate — seals, decrees, pursues its own inscrutable goals"}'::jsonb
  ),
  (
    '50000000-0000-0000-0000-000000000002',
    'cosmic_voice',
    'Second Voice',
    NULL,
    '{"voice_index": 2, "description": "Balance — hates imbalance, tracks the ledger, speaks of correction"}'::jsonb
  ),
  (
    '50000000-0000-0000-0000-000000000003',
    'cosmic_voice',
    'Third Voice',
    NULL,
    '{"voice_index": 3, "description": "Chaos — hungers for disruption, bored by the expected, gleeful at reversals"}'::jsonb
  )
ON CONFLICT (id) DO NOTHING;

-- Cosmic voice traits — these drive CosmicVoiceEngine behaviour
INSERT INTO entity_traits (entity_id, trait_key, trait_value) VALUES
  -- First Voice (Fate / existing Architect)
  ('50000000-0000-0000-0000-000000000001', 'register',              '"ancient, declarative, third-person omniscient"'),
  ('50000000-0000-0000-0000-000000000001', 'cadence',               '"weighty, slow, ends thoughts hard"'),
  ('50000000-0000-0000-0000-000000000001', 'vocabulary_signature',  '"thread, inevitable, written, cosmos, fed"'),
  ('50000000-0000-0000-0000-000000000001', 'internal_state_schema', '"{ fatedArcs, rivalryThreads, matchLedger }"'),

  -- Second Voice (Balance)
  ('50000000-0000-0000-0000-000000000002', 'register',              '"measured, accounting, past-tense"'),
  ('50000000-0000-0000-0000-000000000002', 'cadence',               '"paired clauses, symmetric, ends balanced"'),
  ('50000000-0000-0000-0000-000000000002', 'vocabulary_signature',  '"owed, paid, corrected, ledger, equal, weight, due"'),
  ('50000000-0000-0000-0000-000000000002', 'internal_state_schema', '"{ equilibriumDebt }"'),

  -- Third Voice (Chaos)
  ('50000000-0000-0000-0000-000000000003', 'register',              '"jagged, gleeful, present-tense"'),
  ('50000000-0000-0000-0000-000000000003', 'cadence',               '"fragments, repetition, mid-sentence pivots"'),
  ('50000000-0000-0000-0000-000000000003', 'vocabulary_signature',  '"wrong, unexpected, turn, finally, more, good"'),
  ('50000000-0000-0000-0000-000000000003', 'internal_state_schema', '"{ noveltyHunger }"')
ON CONFLICT (entity_id, trait_key) DO NOTHING;
