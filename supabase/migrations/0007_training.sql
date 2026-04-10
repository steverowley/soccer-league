-- ── 0007_training.sql ────────────────────────────────────────────────────────
-- WHY: Phase 6 — Training minigame.
--
-- The training facility is a clicker minigame played between matches. Each
-- click adds XP to a chosen player; once enough XP accumulates on a given
-- player, a small stat bump is awarded. It creates a direct mechanical link
-- between fan engagement and player development while feeding into the
-- "fan-driven collective agency" pillar — no single fan can unilaterally
-- boost a player, but the community effect compounds.
--
-- TABLES:
--   player_training_log — append-only log of every click: who clicked, on
--                         which player, how much XP was added, and (if this
--                         click crossed a threshold) which stat was bumped.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS player_training_log (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The player receiving XP. FK to players so deleting a player cascades
  -- their training history.
  player_id   UUID        NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  -- The fan who clicked. FK to auth.users so training is tied to accounts.
  -- We intentionally do NOT restrict clicks to "fans of the player's team" —
  -- any logged-in user can train any player. That makes the community effect
  -- global and lets rival fans troll (or sabotage).
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- XP added by this single click. Always positive; currently a constant
  -- (XP_PER_CLICK in logic/xpCurve.ts) but kept flexible for future combo
  -- bonuses, crit multipliers, or Architect interventions.
  xp_added    INTEGER     NOT NULL CHECK (xp_added > 0),
  -- If this click crossed a stat threshold, which stat was bumped.
  -- NULL when the click only accumulated XP without triggering a bump.
  -- Values: 'attacking' | 'defending' | 'mental' | 'athletic' | 'technical'.
  stat_bumped TEXT        CHECK (
    stat_bumped IS NULL OR
    stat_bumped IN ('attacking', 'defending', 'mental', 'athletic', 'technical')
  ),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fetching a player's cumulative training history (used to compute
-- current total XP and stat bump count on the PlayerDetail page).
CREATE INDEX IF NOT EXISTS idx_player_training_log_player
  ON player_training_log (player_id);

-- Index for fetching a user's click history (profile page / rate limiting
-- queries that read the most recent click to enforce the cooldown).
CREATE INDEX IF NOT EXISTS idx_player_training_log_user_created
  ON player_training_log (user_id, created_at DESC);

-- ── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE player_training_log ENABLE ROW LEVEL SECURITY;

-- Anyone can read training logs (used to show total XP on player pages and
-- leaderboards of "most supported" players). Individual clicks are not
-- sensitive; the social aggregate is part of the experiment's visibility.
CREATE POLICY player_training_log_select ON player_training_log
  FOR SELECT USING (true);

-- Users can only insert clicks as themselves. Cooldown enforcement happens
-- in application logic; the DB only guarantees identity.
CREATE POLICY player_training_log_insert_own ON player_training_log
  FOR INSERT WITH CHECK (auth.uid() = user_id);
