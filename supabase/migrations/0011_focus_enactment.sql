-- ── 0011_focus_enactment.sql ────────────────────────────────────────────────
-- WHY: Package 2 — Wire focus voting consequence. Voting tallies already work
-- (Phase 4), but the winning focus was never actually applied to the team.
-- This table records WHAT was enacted so:
--   1. The VotingPage can show "What the cosmos decided" post-season.
--   2. The Architect can narrate the change with specific context.
--   3. We can audit season-over-season roster / facility evolution.
--
-- DESIGN NOTES:
--   • One row per team per tier per season — the UNIQUE constraint enforces
--     that re-running enactment is idempotent (safe to retry).
--   • intervention_id is NULLABLE: enactment logs an architect_interventions
--     row with the narrative reason, but a transient failure there must
--     never block the stat mutation itself.
--   • focus_label is denormalised (copied from focus_options.label) so the
--     "What the cosmos decided" UI never needs a join.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS focus_enacted (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Which season this enactment belongs to.
  season_id       UUID        NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,

  -- The team whose focus was enacted (text slug, matches teams.id).
  team_id         TEXT        NOT NULL REFERENCES teams(id) ON DELETE CASCADE,

  -- 'major' or 'minor' — one of each is enacted per team per season.
  tier            TEXT        NOT NULL CHECK (tier IN ('major', 'minor')),

  -- Machine-readable key matching focus_options.option_key.
  -- Used downstream to understand what mutation was applied.
  focus_key       TEXT        NOT NULL,

  -- Human-readable label copied from focus_options.label.
  -- Denormalised so the VotingPage can render without extra joins.
  focus_label     TEXT        NOT NULL,

  -- When this enactment ran (server time, not in-game time).
  enacted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Optional: the architect_interventions row that narrates this change.
  -- Null when the Architect intervention write fails (best-effort).
  intervention_id UUID        REFERENCES architect_interventions(id),

  -- One enactment per tier per team per season. Idempotent on re-run.
  UNIQUE (team_id, season_id, tier)
);

-- ── Indexes ──────────────────────────────────────────────────────────────────

-- Used by the VotingPage "What the cosmos decided" query: all enactments
-- for a given season, newest first.
CREATE INDEX IF NOT EXISTS idx_focus_enacted_season
  ON focus_enacted (season_id, enacted_at DESC);

-- Used by team history / profile pages: all enactments for one team.
CREATE INDEX IF NOT EXISTS idx_focus_enacted_team
  ON focus_enacted (team_id, enacted_at DESC);

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE focus_enacted ENABLE ROW LEVEL SECURITY;

-- Anyone can read enacted focuses (displayed on voting page and team pages).
CREATE POLICY focus_enacted_select ON focus_enacted
  FOR SELECT USING (true);

-- Only authenticated users (server-side enactment logic) can insert.
CREATE POLICY focus_enacted_insert ON focus_enacted
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');
