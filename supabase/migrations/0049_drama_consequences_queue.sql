-- ── 0049_drama_consequences_queue.sql ──────────────────────────────────────
-- Queue table for delayed drama-tier consequences (isl-hr0).
--
-- WHY THIS EXISTS
--   v1 applied the structural consequence immediately after the
--   narrative landed — the news and the world-shift hit fans on the
--   same tick.  The user's original spec called for a "cooloff": fans
--   should see the news a day before the world changes, so the rumour
--   has time to ripple through commentary, betting markets, and
--   editorial reactions before reality bends.
--
-- HOW IT WORKS
--   • Drama-tick INSERTs a row here with mature_at = now() + 24h
--     whenever a structural-drama narrative emits.
--   • The next drama-tick invocation runs an applier loop at the TOP
--     before generating new narratives:
--       SELECT ... FROM drama_consequences
--       WHERE applied_at IS NULL AND mature_at <= now()
--       FOR UPDATE SKIP LOCKED;
--     For each row it calls applyDramaConsequence and stamps
--     applied_at + applied_reason + applied_meta.
--
-- COOLOFF WINDOW
--   24 hours by default.  Lives in the worker source as
--   DRAMA_COOLOFF_HOURS so future playtesting can tune without a
--   schema change.

CREATE TABLE IF NOT EXISTS drama_consequences (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  narrative_id    UUID        NOT NULL REFERENCES narratives(id) ON DELETE CASCADE,
  kind            TEXT        NOT NULL,
  entity_id       UUID        NOT NULL,
  narrative_text  TEXT        NOT NULL,
  mature_at       TIMESTAMPTZ NOT NULL,
  applied_at      TIMESTAMPTZ,
  applied_reason  TEXT,
  applied_meta    JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_drama_consequences_pending
  ON drama_consequences (mature_at)
  WHERE applied_at IS NULL;

ALTER TABLE drama_consequences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS drama_consequences_select ON drama_consequences;
CREATE POLICY drama_consequences_select ON drama_consequences FOR SELECT USING (true);

COMMENT ON TABLE drama_consequences IS
  'Delayed drama-tier consequence queue (isl-hr0).  Each drama narrative '
  'inserts a row with mature_at = now() + 24h; the next drama-tick run '
  'applies matured rows so the announcement lands a day before the world '
  'shifts.';
