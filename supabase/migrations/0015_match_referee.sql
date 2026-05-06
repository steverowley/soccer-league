-- ── 0015_match_referee.sql ────────────────────────────────────────────────────
-- Phase 5a: Wake referees — link IEOB officials to specific matches and expose
-- their identity in the public schema.
--
-- WHY THIS EXISTS
-- ────────────────
-- 0002_entities seeded 31 referees with strictness traits.  They have existed
-- as data ever since but the rest of the system is unaware of them — the
-- match engine fabricates a random referee per fixture (gameEngine.js:178)
-- and no fan-visible surface ever shows who officiated a given match.  The
-- entity graph is asleep on this axis.
--
-- This migration:
--   1. Adds a nullable `referee_id` FK on `matches` so any fixture can carry
--      a deterministic IEOB official assignment.
--   2. Backfills `referee_id` for every existing match using a hash of the
--      match UUID against the referee corps — deterministic, idempotent, and
--      requires no application code.
--   3. Provides a SECURITY DEFINER `assign_match_referee` RPC so the Election
--      Night orchestrator and any future scheduler can write the FK without
--      needing direct table-level INSERT privileges.
--
-- DESIGN NOTES
-- ────────────
-- - referee_id is NULLABLE so fixtures can exist before assignment runs and
--   so we never break the FK if a referee row is ever soft-deleted.
-- - ON DELETE SET NULL prevents an entity row deletion from cascading into
--   the matches table — the historical record stays even if the referee
--   somehow vanishes from the entity graph.
-- - We do NOT add a CHECK ensuring `entities.kind = 'referee'` because
--   Postgres CHECK constraints can only reference the row being inserted,
--   not joined tables.  RLS on the assignment RPC handles validation.
-- ──────────────────────────────────────────────────────────────────────────────

-- ── 1. Schema column ─────────────────────────────────────────────────────────
ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS referee_id UUID REFERENCES entities(id) ON DELETE SET NULL;

-- Index on referee_id supports the "matches officiated by X" query used by the
-- referee profile page (Phase 5a-2) and Architect arc loaders.  Partial index
-- (WHERE NOT NULL) keeps it small while every fixture awaits assignment.
CREATE INDEX IF NOT EXISTS idx_matches_referee_id
  ON matches (referee_id)
  WHERE referee_id IS NOT NULL;

-- ── 2. Backfill — deterministic hash-based assignment ────────────────────────
--
-- Every existing match without a referee gets one assigned by mapping the
-- match UUID's lower 32 bits into the ordered set of referee entities.  This
-- gives:
--   - Even-ish distribution across the corps (random UUID input + modulo).
--   - Deterministic output (same match → same referee on every backfill).
--   - Independence from row insertion order in the entities table.
--
-- We use a CTE to materialise the ordered referee list once, then UPDATE
-- joins matches to a row index computed from the hash.

DO $$
DECLARE
  ref_count INT;
BEGIN
  -- Bail if no referee entities exist yet (ordering of migrations matters):
  -- 0002_entities seeds them, but a fresh DB might run 0015 before seeds.
  SELECT COUNT(*) INTO ref_count FROM entities WHERE kind = 'referee';
  IF ref_count = 0 THEN
    RAISE NOTICE '[0015] No referees seeded yet — skipping backfill.';
    RETURN;
  END IF;

  WITH ordered_refs AS (
    -- Stable ordering: id ASC ensures the same row index always maps to the
    -- same referee even if new referees are added later (they get appended
    -- at higher indices and existing assignments don't shift).
    SELECT id, ROW_NUMBER() OVER (ORDER BY id) - 1 AS idx
    FROM entities
    WHERE kind = 'referee'
  )
  UPDATE matches m
  SET referee_id = orf.id
  FROM ordered_refs orf
  WHERE m.referee_id IS NULL
    -- Cast the leading hex chars of the match UUID to integer and modulo
    -- against the corps size.  Substring is safe — UUIDs always have the
    -- same canonical layout post-cast.
    AND orf.idx = (('x' || substring(m.id::text, 1, 8))::bit(32)::int & 2147483647) % ref_count;
END $$;

-- ── 3. Atomic assignment RPC ─────────────────────────────────────────────────
--
-- WHY AN RPC: the assignment should be performable by trusted server roles
-- (the Election Night orchestrator, the season scheduler, future Edge
-- Functions) without granting them blanket UPDATE on `matches`.  The RPC
-- runs as the migration owner (SECURITY DEFINER) so it bypasses table-level
-- RLS while still validating that the target entity is actually a referee.
--
-- Returns nothing — write-only.  Errors propagate so the caller can decide
-- whether to retry.

CREATE OR REPLACE FUNCTION public.assign_match_referee(
  p_match_id   UUID,
  p_referee_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Validate that the target entity is a referee.  Without this check, a
  -- caller could accidentally write a player or pundit ID and silently
  -- corrupt the match record.  The kind=referee CHECK lives in code, not
  -- schema, because cross-table CHECK constraints aren't possible in PG.
  IF NOT EXISTS (
    SELECT 1 FROM entities WHERE id = p_referee_id AND kind = 'referee'
  ) THEN
    RAISE EXCEPTION 'assign_match_referee: % is not a referee entity', p_referee_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE matches SET referee_id = p_referee_id WHERE id = p_match_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'assign_match_referee: match % not found', p_match_id
      USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_match_referee(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_match_referee(UUID, UUID)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.assign_match_referee IS
  'Assign an IEOB referee entity to a match, validating that the target entity is of kind=referee. Idempotent.';

-- ── 4. Public match-with-referee view ────────────────────────────────────────
--
-- Convenience view for the MatchDetail page and the post-match narrative
-- writer.  Joins the referee's display_name and strictness trait so callers
-- don't need three queries to render a single match's officiating context.
--
-- LEFT JOIN preserves matches that have no referee assigned (transitional
-- state during seeding); the columns just come back NULL.

CREATE OR REPLACE VIEW match_referee_v AS
SELECT
  m.id                  AS match_id,
  m.referee_id,
  e.name                AS referee_name,
  e.display_name        AS referee_display_name,
  -- Strictness lives in entity_traits keyed on (entity_id, 'strictness');
  -- the value is JSONB so we cast through ::int for safe arithmetic.
  COALESCE((t.trait_value)::int, 5) AS referee_strictness
FROM matches m
LEFT JOIN entities      e ON e.id        = m.referee_id AND e.kind = 'referee'
LEFT JOIN entity_traits t ON t.entity_id = m.referee_id AND t.trait_key = 'strictness';

-- PostgREST exposure — the view must be explicitly granted; CREATE VIEW
-- alone leaves PostgREST returning permission errors.
GRANT SELECT ON match_referee_v TO anon, authenticated;
