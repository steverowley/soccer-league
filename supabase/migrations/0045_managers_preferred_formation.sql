-- ── 0045_managers_preferred_formation.sql ───────────────────────────────────
-- Adds a `preferred_formation` column to `managers` so the Pitch View
-- can render each team's actual tactical shape (isl-6da) instead of a
-- hardcoded 4-4-2 for everyone.
--
-- WHY HERE (and not on teams)
--   Formation is a MANAGER trait, not a team identity field — managers
--   come and go (drama-tier resignations, season rollovers) and bring
--   their own tactical preferences with them.  Storing on managers
--   lets the formation change when the dugout changes without
--   touching the team row.
--
-- CHECK CONSTRAINT
--   Mirrors the FORMATIONS union in
--   src/features/match/logic/pitch/formations.ts.  A row that lands
--   here must already match a TypeScript-supported formation so the
--   PitchView's getFormationSlots() never has to silently fall back
--   at render time.  Add new entries here AND in formations.ts when
--   the supported set grows.
--
-- BACKFILL
--   Distributes the existing managers across the four formations
--   roughly evenly so each team picks up a tactical identity at
--   migration time.  Uses a deterministic hash of the manager's id
--   so the same seed produces the same formation across reapplies.
--   Future managers (drama-tier replacements, season rollovers)
--   default to '4-4-2' which matches the existing rest state.

ALTER TABLE managers
  ADD COLUMN IF NOT EXISTS preferred_formation TEXT NOT NULL DEFAULT '4-4-2';

-- CHECK constraint — list MUST mirror FORMATIONS in formations.ts.
ALTER TABLE managers
  DROP CONSTRAINT IF EXISTS managers_preferred_formation_check;
ALTER TABLE managers
  ADD CONSTRAINT managers_preferred_formation_check
  CHECK (preferred_formation IN ('4-4-2', '3-4-3', '4-5-1', '5-4-1'));

-- Backfill: distribute existing managers across the four formations
-- using the lowest hex digit of their id.  Modulo 4 → formation
-- index 0..3.  Deterministic across re-runs (idempotent).
UPDATE managers
SET preferred_formation = (ARRAY['4-4-2', '3-4-3', '4-5-1', '5-4-1'])[
  -- ('x' || left): treat the first hex char of the uuid as a hex
  -- number; `% 4 + 1` gives a 1-based index into the SQL array
  -- (Postgres arrays are 1-indexed).
  (('x' || left(REPLACE(id::text, '-', ''), 1))::bit(4)::int % 4) + 1
]
WHERE preferred_formation = '4-4-2';

COMMENT ON COLUMN managers.preferred_formation IS
  'Manager''s tactical shape — one of 4-4-2 / 3-4-3 / 4-5-1 / 5-4-1. '
  'Drives the Pitch View dot layout via getFormationSlots() (isl-6da). '
  'Defaults to 4-4-2 for any new manager (drama-tier replacements, '
  'season rollovers).  See src/features/match/logic/pitch/formations.ts.';
