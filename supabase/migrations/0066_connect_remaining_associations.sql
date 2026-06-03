-- ── 0066_connect_remaining_associations.sql ──────────────────────────────────
-- WHY: After 0065 connected the officials boards, referees, and social media,
-- two association entities from 0002 remained island nodes: MWSA (Mars-Wide
-- Soccer Association) and ISSU (Intergalactic Sports Standards Union).  Both
-- surface in the Galaxy Atlas (/world) "Officials" filter, where a lone,
-- edgeless node looks broken.  They sit unambiguously under the ISL in the
-- governance hierarchy, so we close the last gap here.
--
-- ISL (30000000-…0010), MWSA (…0011), and ISSU (…0012) all use fixed UUIDs
-- from 0002, safe to reference directly.
--
-- IDEMPOTENT — ON CONFLICT (from_id, to_id, kind) DO NOTHING.
-- ──────────────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════
-- Regional / standards bodies → ISL (affiliated_with)
-- ═══════════════════════════════════════════════════════════════════════════
-- MWSA is a regional body (Mars + orbital colonies) operating under the ISL
-- umbrella; ISSU is the standards body that sets equipment/pitch/atmospheric
-- rules on the ISL's behalf.  Strength reflects how tightly each sits under
-- the league: ISSU is an arm of the league (+70); MWSA is a semi-autonomous
-- regional affiliate (+55).

INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta) VALUES

  -- MWSA → ISL (regional affiliate)
  ('30000000-0000-0000-0000-000000000011','30000000-0000-0000-0000-000000000010','affiliated_with', 55, '{}'::jsonb),
  -- ISSU → ISL (standards arm of the league)
  ('30000000-0000-0000-0000-000000000012','30000000-0000-0000-0000-000000000010','affiliated_with', 70, '{}'::jsonb)

ON CONFLICT (from_id, to_id, kind) DO NOTHING;
