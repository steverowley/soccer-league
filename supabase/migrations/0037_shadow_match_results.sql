-- ── 0037_shadow_match_results.sql ─────────────────────────────────────────
-- WHY: Phase 11 of the Universal Agent System (bd isl-bqx.12).  Stores
-- ensemble outcomes for upcoming matches so the Architect council can
-- read the distribution of "what could happen" before a fixture kicks
-- off and decide whether to intervene (e.g. nudge an underdog when
-- 4-of-5 shadow timelines say they'd otherwise be hammered).
--
-- DESIGN PHILOSOPHY (MiroFish parallel)
--   Inspired by MiroFish's parallel-simulation ensembles.  The
--   canonical (live) timeline runs as it always has; the shadow worker
--   runs 3-5 perturbed copies of each upcoming match in the background.
--   Their outcomes are stored here.  v1 surfaces them only to the
--   Architect council (Phase 11 finishes when the council reads them);
--   Phase 12 will expose a fan-facing "What If" page that lets users
--   perturb world state and read the resulting shadow distribution.
--
-- INVARIANT — never user-facing in v1
--   Shadow results are an internal observability surface.  RLS denies
--   anon and authenticated reads.  Only service-role workers and the
--   Architect council reach in.  This keeps the canonical timeline as
--   the single user-visible story — fans don't see "your team lost in
--   3 of 5 alternate realities" because that's not the league they're
--   experiencing.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS shadow_match_results (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),

  -- match_id — the canonical fixture these shadows are alternates of.
  -- ON DELETE CASCADE so an admin reset of matches cleans up shadows
  -- without leaving orphan rows.
  match_id        UUID         NOT NULL REFERENCES matches(id) ON DELETE CASCADE,

  -- timeline_index — which of the N shadow runs this row represents.
  -- 0..N-1 by convention; lets the council enumerate distinct timelines
  -- without depending on insert order.
  timeline_index  SMALLINT     NOT NULL,

  -- home_goals / away_goals — the simulated final score for THIS timeline.
  -- Stored as integers (no clamp here; the engine bounds them).
  home_goals      SMALLINT     NOT NULL,
  away_goals      SMALLINT     NOT NULL,

  -- outcome — the categorical result.  Persisted so consumers don't
  -- need to derive it from the score every time and so a future change
  -- to extra-time semantics doesn't require recomputing historical rows.
  -- Values: 'home' | 'draw' | 'away'.
  outcome         TEXT         NOT NULL CHECK (outcome IN ('home','draw','away')),

  -- perturbation — short identifier for the seed / mutation applied to
  -- this shadow timeline (e.g. 'rng_42', 'home_keeper_fatigued').  Free-
  -- text in v1; future migrations may tighten it to an enum.
  perturbation    TEXT         NOT NULL DEFAULT 'rng_only',

  -- created_at — wall-clock of the shadow simulation run.  Used by the
  -- Architect council to ignore stale shadows (e.g. when a roster
  -- change occurred between simulation and kickoff).
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),

  -- Each (match, timeline_index) pair is unique so a partial worker
  -- re-run can upsert by composite key without producing duplicates.
  UNIQUE (match_id, timeline_index)
);

-- ── Indexes ─────────────────────────────────────────────────────────────────

-- Council-side query: "give me every shadow for THIS match".
CREATE INDEX IF NOT EXISTS shadow_match_results_match_idx
  ON shadow_match_results (match_id);

-- Cleanup query: "remove shadows older than N days" + analytics that
-- want a running window.
CREATE INDEX IF NOT EXISTS shadow_match_results_created_idx
  ON shadow_match_results (created_at DESC);

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Service-role only.  Anon + authenticated readers are blocked outright
-- so this can't leak the "what could happen" view back to fans.

ALTER TABLE shadow_match_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY shadow_match_results_service_read
  ON shadow_match_results FOR SELECT
  USING (auth.role() = 'service_role');

CREATE POLICY shadow_match_results_service_write
  ON shadow_match_results FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
