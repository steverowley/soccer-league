-- ── 0006_voting.sql ─────────────────────────────────────────────────────────
-- WHY: Phase 4 — End-of-season focus voting.
--
-- At the end of each season, fans of each team spend their Intergalactic
-- Credits to collectively vote on what their club focuses on next season.
-- The focus with the most credits pooled wins. Two focuses are enacted per
-- team: 1 major + 1 minor. This is the core "social experiment" mechanic —
-- individual credits become collective agency.
--
-- TABLES:
--   focus_options — the menu of choices available per team per season
--   focus_votes  — individual fan credit allocations to specific options
--
-- VIEWS:
--   focus_tally  — aggregated credit totals per option for live display
-- ──────────────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════════
-- Part 1: focus_options table
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS focus_options (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Which team this focus option belongs to.
  team_id     TEXT        NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  -- Which season this option is for. Options are generated per-season.
  season_id   UUID        NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  -- Machine-readable key for the option (e.g. 'sign_striker', 'youth_academy').
  -- Used by the enactment logic to apply stat changes.
  option_key  TEXT        NOT NULL,
  -- Human-readable label displayed on the voting UI.
  label       TEXT        NOT NULL,
  -- Longer description of what this focus entails. Initially static; later
  -- LLM-generated based on team lore via the Architect.
  description TEXT,
  -- Focus tier: 'major' options have bigger impact, 'minor' are smaller tweaks.
  -- One of each is enacted per team per season.
  tier        TEXT        NOT NULL CHECK (tier IN ('major', 'minor')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One option_key per team per season to prevent duplicate entries.
  UNIQUE (team_id, season_id, option_key)
);

-- Index for fetching all options for a team in a season (the voting page).
CREATE INDEX IF NOT EXISTS idx_focus_options_team_season
  ON focus_options (team_id, season_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- Part 2: focus_votes table
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS focus_votes (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The fan casting the vote.
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Which focus option they're voting for.
  focus_option_id UUID        NOT NULL REFERENCES focus_options(id) ON DELETE CASCADE,
  -- How many credits they're spending on this option. Must be positive.
  -- Credits are consumed — once spent, they're gone from the user's balance.
  credits_spent   INTEGER     NOT NULL CHECK (credits_spent > 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fetching a user's votes (profile page / voting page).
CREATE INDEX IF NOT EXISTS idx_focus_votes_user
  ON focus_votes (user_id);

-- Index for tallying votes per option (leaderboard / tally view).
CREATE INDEX IF NOT EXISTS idx_focus_votes_option
  ON focus_votes (focus_option_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- Part 3: focus_tally view
-- ═══════════════════════════════════════════════════════════════════════════════

-- Aggregated credit totals per option. Displayed on the voting page so fans
-- can see the running tally and coordinate (or counter-vote).
CREATE OR REPLACE VIEW focus_tally AS
SELECT
  fo.id               AS option_id,
  fo.team_id,
  fo.season_id,
  fo.option_key,
  fo.label,
  fo.description,
  fo.tier,
  COUNT(fv.id)                     AS vote_count,
  COALESCE(SUM(fv.credits_spent), 0) AS total_credits
FROM focus_options fo
LEFT JOIN focus_votes fv ON fv.focus_option_id = fo.id
GROUP BY fo.id, fo.team_id, fo.season_id, fo.option_key, fo.label, fo.description, fo.tier;

GRANT SELECT ON focus_tally TO anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Part 4: RLS policies
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── focus_options RLS ───────────────────────────────────────────────────────

ALTER TABLE focus_options ENABLE ROW LEVEL SECURITY;

-- Anyone can read focus options (displayed on voting page).
CREATE POLICY focus_options_select ON focus_options
  FOR SELECT USING (true);

-- Only authenticated users can create options (admin/generation logic).
CREATE POLICY focus_options_insert ON focus_options
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- ── focus_votes RLS ─────────────────────────────────────────────────────────

ALTER TABLE focus_votes ENABLE ROW LEVEL SECURITY;

-- Users can read their own votes.
CREATE POLICY focus_votes_select_own ON focus_votes
  FOR SELECT USING (auth.uid() = user_id);

-- Users can insert votes for themselves only.
CREATE POLICY focus_votes_insert_own ON focus_votes
  FOR INSERT WITH CHECK (auth.uid() = user_id);
