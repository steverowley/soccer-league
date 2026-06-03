-- ── 0065_connect_officials_and_social.sql ────────────────────────────────────
-- WHY: Two kinds seeded for the world-building graph came out as ISLAND NODES
-- with zero relationships, plus the referee corps was never connected at all.
-- This migration finishes the entity graph so every world entity is reachable
-- and the Galaxy Atlas (/world) never shows a lone, edgeless node.
--
-- ROOT CAUSE OF THE GAPS (discovered 2026-06-03):
--   1. officials_association (RMAS / ISOB / OROG): migration 0064 PART 7 tried
--      to link them via `affiliated_with` to an association entity named
--      'Interplanetary Enforcement of the Beautiful Game' (IEOB).  That entity
--      does NOT exist — IEOB is only a `meta.corps` label on referee rows in
--      0002, never seeded as kind='association'.  The JOIN matched zero rows,
--      so 0064 PART 7 silently inserted nothing.  We supersede it here by
--      affiliating the three boards with the ISL (the supreme governing body
--      that actually exists, 30000000-…0010).
--   2. social_media (Stellarverse / CometFeed / OrbNet): 0064 never wrote a
--      relationship section for them at all — a pure omission.
--   3. referee corps (32 referees from 0002): never given any edges, so every
--      referee was an island too.  They are the natural membership of RMAS
--      (the referees' union), so we connect them here.
--
-- 0064 PART 7 is left untouched (applied migrations are immutable history);
-- it is a harmless no-op on every database, fresh or existing.
--
-- IDEMPOTENT — every INSERT uses ON CONFLICT (from_id, to_id, kind) DO NOTHING.
-- Strength values all lie within the entity_relationships CHECK (-100..+100).
-- Relationship `kind` labels reuse the taxonomy documented in 0064.
-- ──────────────────────────────────────────────────────────────────────────────


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 1: Officials associations → ISL (affiliated_with)  [supersedes 0064 P7]
-- ═══════════════════════════════════════════════════════════════════════════
-- All three officials bodies answer, to varying degrees, to the ISL — the
-- supreme governing body of interplanetary soccer.  Strength encodes the
-- political tension the Architect can exploit:
--   RMAS (the union) is in perpetual negotiation with the league (+40).
--   ISOB (inner-system board) is the most institutionally loyal (+60).
--   OROG (outer guild) runs an independent pipeline, so it is only loosely
--   bound (+50).
-- ISL fixed UUID 30000000-…0010 is safe to reference directly (seeded 0002).

INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta) VALUES

  -- Referee Mutual Aid Society (RMAS) → ISL
  ('72000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000010','affiliated_with', 40, '{}'::jsonb),
  -- Inner System Officials Board (ISOB) → ISL
  ('72000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000010','affiliated_with', 60, '{}'::jsonb),
  -- Outer Reaches Officials Guild (OROG) → ISL
  ('72000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000010','affiliated_with', 50, '{}'::jsonb)

ON CONFLICT (from_id, to_id, kind) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 2: Inner vs Outer officials rivalry (rival — mutual)
-- ═══════════════════════════════════════════════════════════════════════════
-- ISOB is "accused of bias toward inner-system clubs"; OROG is the outer-
-- reaches guild that runs its own independent pipeline.  Their structural
-- antagonism is a ready-made officiating-controversy lever for the Architect
-- whenever an inner club plays an outer club.  Both directions are seeded.

INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta) VALUES

  ('72000000-0000-0000-0000-000000000002','72000000-0000-0000-0000-000000000003','rival', -45, '{}'::jsonb),
  ('72000000-0000-0000-0000-000000000003','72000000-0000-0000-0000-000000000002','rival', -45, '{}'::jsonb)

ON CONFLICT (from_id, to_id, kind) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 3: Referees → RMAS (member_of)
-- ═══════════════════════════════════════════════════════════════════════════
-- Every referee belongs to the referees' union (RMAS).  This connects the
-- otherwise-island 32-referee corps to the graph and turns RMAS into a hub
-- the Architect can use for collective-action arcs ("the union threatens to
-- withdraw officials from the Belt derby").  Referee UUIDs are random
-- (gen_random_uuid in 0002), so they are selected by kind rather than listed.
-- Strength +70: solid membership, with headroom for the occasional
-- strike-breaker / rogue-official storyline.

INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta)
SELECT e.id, '72000000-0000-0000-0000-000000000001'::uuid, 'member_of', 70, '{}'::jsonb
FROM entities e
WHERE e.kind = 'referee'
ON CONFLICT (from_id, to_id, kind) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 4: Social media platform rivalries (rival — mutual)
-- ═══════════════════════════════════════════════════════════════════════════
-- The three platforms compete for the galaxy's attention.  Their cultures
-- clash — Stellarverse (dominant microblog) vs CometFeed (scrappy Belt-born
-- video) vs OrbNet (Earth-born long-form forum).  Mutual rivalries give the
-- Architect a "where did this rumour start / which platform owns the
-- narrative" lever.  Social media fixed UUIDs 73000000-…0001/2/3 (seeded 0062).

INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta) VALUES

  -- Stellarverse ↔ CometFeed (establishment microblog vs Belt video upstart)
  ('73000000-0000-0000-0000-000000000001','73000000-0000-0000-0000-000000000002','rival', -40, '{}'::jsonb),
  ('73000000-0000-0000-0000-000000000002','73000000-0000-0000-0000-000000000001','rival', -40, '{}'::jsonb),
  -- Stellarverse ↔ OrbNet (speed-culture microblog vs depth-culture forum)
  ('73000000-0000-0000-0000-000000000001','73000000-0000-0000-0000-000000000003','rival', -35, '{}'::jsonb),
  ('73000000-0000-0000-0000-000000000003','73000000-0000-0000-0000-000000000001','rival', -35, '{}'::jsonb),
  -- CometFeed ↔ OrbNet (Belt video vs Earth forum)
  ('73000000-0000-0000-0000-000000000002','73000000-0000-0000-0000-000000000003','rival', -30, '{}'::jsonb),
  ('73000000-0000-0000-0000-000000000003','73000000-0000-0000-0000-000000000002','rival', -30, '{}'::jsonb)

ON CONFLICT (from_id, to_id, kind) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 5: Social media → media companies (affiliated_with)
-- ═══════════════════════════════════════════════════════════════════════════
-- Each platform has a content/distribution affinity with a broadcaster whose
-- region matches its origin, tying social_media into the media cluster (which
-- already has sports_writer → employed_by → media_company edges from 0064).
-- Media company UUIDs are random (gen_random_uuid in 0002), so they are
-- resolved by name via a JOIN — mirrors 0064 PART 8's pattern exactly.
--   Stellarverse (galaxy-wide, dominant) → Galactic Sports Network (+35,
--     mainstream but "politically contested", so not a tight bond)
--   CometFeed (Belt-born video) → Belt & Beyond Media (+50, strong regional)
--   OrbNet (Earth-born forum) → Inner System Sports (+40)

INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta)
SELECT s.platform_id, e.id, 'affiliated_with', s.strength, '{}'::jsonb
FROM (VALUES
  ('73000000-0000-0000-0000-000000000001'::uuid, 'Galactic Sports Network', 35),  -- Stellarverse / GSN
  ('73000000-0000-0000-0000-000000000002'::uuid, 'Belt & Beyond Media',     50),  -- CometFeed / BBM
  ('73000000-0000-0000-0000-000000000003'::uuid, 'Inner System Sports',     40)   -- OrbNet / ISS
) AS s(platform_id, company_name, strength)
JOIN entities e ON e.kind = 'media_company' AND e.name = s.company_name
ON CONFLICT (from_id, to_id, kind) DO NOTHING;
