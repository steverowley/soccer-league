-- ── 0062_seed_relationships.sql ─────────────────────────────────────────────
-- Seeds initial player-to-player and player-to-manager relationship graph data.
--
-- WHY THIS EXISTS
-- ───────────────
-- The entity_relationships table was created in migration 0002 and the
-- relationship graph utilities (matchRelationships.ts, decisionBlender.ts)
-- were wired into the simulation pipeline in Phases 1–2B.  However, only
-- structural edges exist so far (plays_for, manages — from migration 0048).
-- Without narrative edges, resolveContest's relationship modifier branch is
-- always a no-op regardless of who is on the pitch.
--
-- This migration seeds four kinds of player-to-player / player-to-manager
-- edges that resolveContest interprets mechanically:
--
--   rivalry (-75)         Cross-team, same-position pairs.  Raises card-bias
--                         multiplier (rnd 1.3–1.9 × intensity) and flags
--                         flavour for commentary.
--
--   partnership (+80)     Same-team MF/FW and DF/MF complementary pairs.
--                         Adds atkMod = rnd(8,16) × intensity in contests.
--
--   mentor_pupil (+65)    Same-team veteran (age ≥ 29) + young (age ≤ 21).
--                         Adds atkMod = rnd(5,11) × intensity — the pupil
--                         performs better with their mentor present.
--
--   manager_favourite (+85) Manager → player edge.  Consumed by Phase 3
--                           manager-confidence modifiers (not yet wired, but
--                           the data is present so those hooks can read it
--                           without a schema change).
--
-- DETERMINISM
-- ───────────
-- All pair selection uses row_number() OVER (ORDER BY entity_id) so the
-- output is stable across DB restores: same entity IDs → same relationships.
-- The `% N = 0` filter thins the full cross-join to a manageable count
-- (~100 rivalries, ~80 partnerships, ~30 mentor/pupils, 1 fave per team).
--
-- SAFETY
-- ──────
-- ON CONFLICT DO NOTHING throughout — safe to re-run on idempotent migrations.
-- All inserts are filtered to rows where entity_id IS NOT NULL; old player rows
-- without entity_ids (pre-migration-0002 inserts) are silently skipped.

-- ── 1. Cross-team rivalries ───────────────────────────────────────────────────
-- Pairs starters at the same position on different teams.  Both players must
-- have overall_rating ≥ 65 (keeps rivalries to genuinely prominent players).
-- row_number() within each position tier, % 4 = 0 → ~25% of pairs → ~100 rows.
WITH cross_rivals AS (
  SELECT
    a.entity_id AS from_id,
    b.entity_id AS to_id,
    row_number() OVER (ORDER BY a.entity_id, b.entity_id) AS rn
  FROM players a
  JOIN players b
    ON  a.position    = b.position   -- same position (GK / DF / MF / FW)
    AND a.team_id    != b.team_id    -- different clubs
    AND a.entity_id   < b.entity_id  -- canonical direction, avoids A↔B dupes
  WHERE a.entity_id IS NOT NULL
    AND b.entity_id IS NOT NULL
    AND a.starter = true
    AND b.starter = true
    AND COALESCE(a.overall_rating, 0) >= 65
    AND COALESCE(b.overall_rating, 0) >= 65
)
INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta)
SELECT
  from_id,
  to_id,
  'rivalry',
  -- -75: strong hostile edge.  resolveContest scales by intensity = 0.75,
  -- so effective cardBiasMod ≈ rnd(0.98,1.43) — meaningful but not dominant.
  -75,
  '{"seeded": true}'::jsonb
FROM cross_rivals
WHERE rn % 4 = 0  -- ~25% of candidate pairs; yields ≈100 rivalries
LIMIT 100
ON CONFLICT (from_id, to_id, kind) DO NOTHING;

-- ── 2. Intra-team partnerships ───────────────────────────────────────────────
-- Complementary-position pairings on the same club: MF+FW and DF+MF.
-- These are the natural "build-up" relationships — a midfielder setting up a
-- forward, or a defender feeding the midfield.  GKs excluded: no partnership
-- dynamic applies across the keeper position.
-- % 3 = 0 → ~33% of pairs → ~80 rows.
WITH partnerships AS (
  SELECT
    a.entity_id AS from_id,
    b.entity_id AS to_id,
    row_number() OVER (ORDER BY a.entity_id, b.entity_id) AS rn
  FROM players a
  JOIN players b
    ON  a.team_id   = b.team_id    -- same club
    AND a.entity_id < b.entity_id  -- canonical direction
    AND (
      -- MF↔FW: creative–striker combination
      (a.position = 'MF' AND b.position = 'FW') OR
      (a.position = 'FW' AND b.position = 'MF') OR
      -- DF↔MF: defensive-build-up combination
      (a.position = 'DF' AND b.position = 'MF') OR
      (a.position = 'MF' AND b.position = 'DF')
    )
  WHERE a.entity_id IS NOT NULL
    AND b.entity_id IS NOT NULL
    AND a.starter = true
    AND b.starter = true
)
INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta)
SELECT
  from_id,
  to_id,
  'partnership',
  -- +80: strong positive edge.  intensity = 0.80 → atkMod ≈ rnd(6,13) per contest.
  80,
  '{"seeded": true}'::jsonb
FROM partnerships
WHERE rn % 3 = 0  -- ~33% of pairs → ≈80 partnerships
LIMIT 80
ON CONFLICT (from_id, to_id, kind) DO NOTHING;

-- ── 3. Mentor / pupil pairs ──────────────────────────────────────────────────
-- Same-team veteran (age ≥ 29) + young player (age ≤ 21).  The veteran
-- nurtures the youngster; the pupil performs better when playing alongside
-- their mentor.  resolveContest adds atkMod = rnd(5,11) × 0.65 ≈ +3 to +7.
-- No position restriction: mentoring is cross-position.
-- No row-number thinning needed — naturally sparse (few clubs have many
-- veteran+youth overlaps in the starting XI).
WITH mentor_pupils AS (
  SELECT
    vet.entity_id AS from_id,  -- mentor = from_id by convention
    yng.entity_id AS to_id,    -- pupil  = to_id
    row_number() OVER (ORDER BY vet.entity_id, yng.entity_id) AS rn
  FROM players vet
  JOIN players yng
    ON  vet.team_id   = yng.team_id
    AND vet.entity_id < yng.entity_id
  WHERE vet.entity_id IS NOT NULL
    AND yng.entity_id IS NOT NULL
    AND COALESCE(vet.age, 0) >= 29
    AND COALESCE(yng.age, 0) <= 21
    AND vet.starter = true
)
INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta)
SELECT
  from_id,
  to_id,
  'mentor_pupil',
  -- +65: moderate positive edge.  intensity = 0.65 → atkMod ≈ rnd(3,7) per contest.
  65,
  '{"seeded": true}'::jsonb
FROM mentor_pupils
LIMIT 40
ON CONFLICT (from_id, to_id, kind) DO NOTHING;

-- ── 4. Manager favourites ─────────────────────────────────────────────────────
-- Each manager's single highest-rated starter becomes their "favourite" —
-- a strong positive edge that future manager-confidence modifiers can read.
-- Row_number() = 1 ensures exactly one favourite per team.
-- The manager_favourite kind is NOT currently consumed by resolveContest
-- (Phase 3 manager instructions will read it) but the data is present so
-- that wiring requires no schema change.
WITH mgr_faves AS (
  SELECT
    m.entity_id AS from_id,
    p.entity_id AS to_id,
    row_number() OVER (
      PARTITION BY p.team_id
      ORDER BY COALESCE(p.overall_rating, 0) DESC, p.entity_id
    ) AS rn
  FROM managers m
  JOIN players p ON p.team_id = m.team_id
  WHERE m.entity_id IS NOT NULL
    AND p.entity_id IS NOT NULL
    AND p.starter = true
)
INSERT INTO entity_relationships (from_id, to_id, kind, strength, meta)
SELECT
  from_id,
  to_id,
  'manager_favourite',
  -- +85: strong positive bond.  intensity = 0.85 when Phase 3 wires this.
  85,
  '{"seeded": true}'::jsonb
FROM mgr_faves
WHERE rn = 1  -- one favourite per club
ON CONFLICT (from_id, to_id, kind) DO NOTHING;
