-- ── 0046_political_decree_payload.sql ──────────────────────────────────────
-- Extends season_decrees to support drama-tier political_decree
-- consequences with structured mechanical effects (isl-azz).
--
-- WHY
--   Before this migration, the only outlet for a `political_decree`
--   drama consequence was a `proclamation` row — a lore-only entry
--   the simulator never reads.  This commit teaches the table to
--   carry a `political_decree` type AND a structured payload the
--   match-worker can consult pre-match to nudge match cadence,
--   referee strictness, and ticket multipliers.
--
-- PAYLOAD CONTRACT (always optional; missing keys = no effect)
--   cadence_mult         number  default 1.0   multiplier on match_duration_seconds
--   ref_strictness_delta integer default 0     added to base referee strictness (clamped 0..100)
--   ticket_multiplier    number  default 1.0   multiplier on team_finances ticket revenue
--
-- BACKWARDS COMPAT
--   The CHECK constraint now admits 6 values; existing rows fall
--   under the original 5.  `payload DEFAULT '{}'` keeps every
--   pre-existing row legal without a backfill — only new rows
--   bothering with the payload bear effects.

ALTER TABLE season_decrees
  DROP CONSTRAINT IF EXISTS season_decrees_decree_type_check;
ALTER TABLE season_decrees
  ADD CONSTRAINT season_decrees_decree_type_check
  CHECK (decree_type IN (
    'incineration', 'transformation', 'focus_enacted',
    'blessing', 'proclamation', 'political_decree'
  ));

ALTER TABLE season_decrees
  ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN season_decrees.payload IS
  'Structured payload for mechanically-active decrees (political_decree). '
  'Keys: cadence_mult (number), ref_strictness_delta (int), ticket_multiplier (number). '
  'Defaults to {} for lore-only decree types (isl-azz).';
