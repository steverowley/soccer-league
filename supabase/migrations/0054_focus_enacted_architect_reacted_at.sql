-- ── 0054_focus_enacted_architect_reacted_at.sql ──────────────────────────
-- Closes #377 — the Architect previously wrote nothing in reaction to fans'
-- end-of-season focus choices. focus_enacted rows landed silently and the
-- only post-enactment narrative was the static "What the Cosmos Decided"
-- panel on /voting.
--
-- This migration adds a nullable timestamp column so the architect-galaxy-tick
-- cron can poll for unreacted enactments and emit one architect_whisper per
-- focus_enacted row exactly once.
--
-- NEW COLUMN
-- ──────────
--   architect_reacted_at TIMESTAMPTZ NULL
--     - NULL  → reaction not yet emitted
--     - non-NULL → tick already wrote the architect_whisper at this time
--
-- The tick stamps the column inside the same DB call as the narrative insert,
-- so a crash between insert and stamp results in a re-attempt next tick
-- (idempotent: a duplicate architect_whisper for the same focus is acceptable
-- noise, far better than a silent drop).
--
-- INDEX
-- ─────
-- Partial index on `architect_reacted_at IS NULL` so the poll query
-- `SELECT … WHERE architect_reacted_at IS NULL ORDER BY enacted_at`
-- scans only unreacted rows once steady-state is reached.

ALTER TABLE focus_enacted
  ADD COLUMN IF NOT EXISTS architect_reacted_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_focus_enacted_unreacted
  ON focus_enacted (enacted_at)
  WHERE architect_reacted_at IS NULL;

COMMENT ON COLUMN focus_enacted.architect_reacted_at IS
  'Set by architect-galaxy-tick after emitting an architect_whisper for this enactment. NULL = not yet reacted to. Single-shot; partial index supports the poll.';
