-- ── 0014_seasons_lifecycle.sql ───────────────────────────────────────────────
-- WHY: Package 13 — adds the explicit season lifecycle state machine that
-- the match worker keys off when deciding whether to fire enactment.  The
-- `seasons` table already exists (created in 0000_init) with `is_active`
-- and date columns; this migration *additively* extends it with:
--
--   • status        — explicit lifecycle state ('active' → 'voting' →
--                     'enacted' → 'archived').  Lets the worker detect
--                     "all league fixtures complete" exactly once and
--                     transition without races.
--   • started_at    — UTC instant the season actually began (vs the
--                     planning-only `start_date` column).
--   • ended_at      — UTC instant the season transitioned out of 'active'.
--                     NULL while still in progress.
--
-- DESIGN NOTES
--   • Additive only — `is_active` / `start_date` / `end_date` stay so
--     existing callers (getActiveSeason, displays) keep working.  A
--     follow-up package can deprecate them once consumers migrate.
--   • The existing `season_config` table (migration 0013) is keyed by
--     `season_id text` deliberately.  The season UUIDs already in use
--     match that text shape, so no FK is added here either — the choice
--     was to keep season_config decoupled from the seasons table for
--     test-time mutation flexibility.
--   • Status CHECK matches the four states the issue describes.  Worker
--     transitions:  active → voting (all league matches done)
--                   voting → enacted (enactSeasonFocuses returned)
--                   enacted → archived (next season seeded; future PR).
--
-- IDEMPOTENCY
--   ALTER TABLE … ADD COLUMN IF NOT EXISTS lets the migration re-run
--   safely.  Constraint additions are guarded by IF EXISTS-style guards.
-- ──────────────────────────────────────────────────────────────────────────────

-- ── 1. status column ─────────────────────────────────────────────────────────
-- Default 'active' so any existing season 1 row immediately satisfies the
-- new constraint without a backfill statement.
ALTER TABLE seasons
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

-- Drop-and-add pattern is the canonical PostgreSQL workaround for "modify
-- a CHECK constraint" — there's no in-place ALTER CHECK.
ALTER TABLE seasons
  DROP CONSTRAINT IF EXISTS seasons_status_check;

ALTER TABLE seasons
  ADD CONSTRAINT seasons_status_check
    CHECK (status IN ('active', 'voting', 'enacted', 'archived'));

COMMENT ON COLUMN seasons.status IS
  'Lifecycle state: active (matches in progress) → voting (all league matches complete, focuses open) → enacted (focuses applied) → archived (next season started).';

-- ── 2. started_at / ended_at timestamps ──────────────────────────────────────
-- Distinct from `start_date` / `end_date` (DATE-typed planning columns) so
-- we capture the exact instant of state transitions.  Both nullable —
-- ended_at stays NULL for the season currently in 'active'.
ALTER TABLE seasons
  ADD COLUMN IF NOT EXISTS started_at timestamptz;

ALTER TABLE seasons
  ADD COLUMN IF NOT EXISTS ended_at   timestamptz;

COMMENT ON COLUMN seasons.started_at IS
  'UTC instant the season transitioned to ''active''.  NULL for legacy rows.';

COMMENT ON COLUMN seasons.ended_at IS
  'UTC instant the season transitioned out of ''active'' (i.e. into ''voting'').  NULL while still in progress.';

-- ── 3. Backfill started_at for the existing season 1 row ─────────────────────
-- The existing season has only `start_date` (date-typed) — promote it to
-- the new timestamp column so downstream queries that prefer started_at
-- find a value.  Cast the date to midnight UTC.
UPDATE seasons
   SET started_at = start_date::timestamptz
 WHERE started_at IS NULL
   AND start_date IS NOT NULL;

-- ── 4. Index supporting the worker's status-filter query ─────────────────────
-- The worker pulls "active seasons" once per match completion to decide
-- whether to run the season-end check.  Tiny table (one row per year), but
-- the partial index keeps the lookup index-only forever.
CREATE INDEX IF NOT EXISTS idx_seasons_status
  ON seasons (status);
