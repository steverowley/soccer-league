-- ── 0004_betting.sql ────────────────────────────────────────────────────────
-- WHY: Phase 2 — Betting system.
--
-- Introduces the wager lifecycle: users place bets on match outcomes before
-- kickoff, and settlement resolves them atomically after the match completes.
-- The Bookie entity (seeded in 0002_entities.sql) is the counterparty to all
-- wagers — its balance is tracked in entity_traits so the Architect can
-- weave "the House is nervous" storylines.
--
-- TABLES:
--   wagers        — individual user bets on match outcomes
--   match_odds    — computed decimal odds per match (snapshot at bet time)
--   team_finances — per-team per-season financial ledger (used here and Phase 3)
--
-- VIEWS:
--   wager_leaderboard — aggregated public totals without leaking individual bets
--
-- RLS:
--   wagers: users can only SELECT/INSERT their own rows; UPDATE restricted to
--     settlement (status + payout only). No DELETE.
--   match_odds: public read, authenticated write.
--   team_finances: public read, authenticated write.
-- ──────────────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════════
-- Part 1: wagers table
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS wagers (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The user placing the wager. Cascades on user deletion.
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The match being wagered on. Cascades on match deletion.
  match_id      UUID        NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  -- Which outcome the user is betting on.
  --   'home' = home team win, 'draw' = draw, 'away' = away team win.
  team_choice   TEXT        NOT NULL
                            CHECK (team_choice IN ('home', 'draw', 'away')),
  -- Number of Intergalactic Credits staked. Minimum 10 (MIN_BET constant).
  stake         INTEGER     NOT NULL CHECK (stake >= 10),
  -- Decimal odds at the time of bet placement. Always > 1.0.
  -- Stored as a snapshot so odds changes after placement don't affect payout.
  odds_snapshot NUMERIC(6,3) NOT NULL CHECK (odds_snapshot > 1),
  -- Wager lifecycle status:
  --   'open'  = match hasn't completed yet
  --   'won'   = user's choice matched the result; payout credited
  --   'lost'  = user's choice didn't match; stake forfeited
  --   'void'  = match cancelled or other exceptional circumstance; stake refunded
  status        TEXT        NOT NULL DEFAULT 'open'
                            CHECK (status IN ('open', 'won', 'lost', 'void')),
  -- Credits paid out to the user on a win. NULL while open or on loss.
  -- payout = floor(stake × odds_snapshot) on a win.
  payout        INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for quick lookups by user (profile page bet history).
CREATE INDEX IF NOT EXISTS idx_wagers_user_id ON wagers (user_id);

-- Index for settlement: find all open wagers for a completed match.
CREATE INDEX IF NOT EXISTS idx_wagers_match_status ON wagers (match_id, status);

-- ═══════════════════════════════════════════════════════════════════════════════
-- Part 2: match_odds table
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS match_odds (
  -- One odds row per match. PK = match_id (1:1 relationship).
  match_id    UUID        PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,
  -- Decimal odds for each outcome. All must be > 1.0 (you always get your
  -- stake back on a win, plus profit). Typical range: 1.10 – 15.00.
  home_odds   NUMERIC(6,3) NOT NULL CHECK (home_odds > 1),
  draw_odds   NUMERIC(6,3) NOT NULL CHECK (draw_odds > 1),
  away_odds   NUMERIC(6,3) NOT NULL CHECK (away_odds > 1),
  -- When the odds were last computed. Used to detect stale odds.
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- Part 3: team_finances table
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS team_finances (
  -- Team slug FK (text, matching teams.id).
  team_id        TEXT        NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  -- Season UUID FK.
  season_id      UUID        NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  -- Cumulative ticket revenue from match attendance (Phase 3 populates this).
  ticket_revenue INTEGER     NOT NULL DEFAULT 0,
  -- Total player wage bill for the season.
  wage_bill      INTEGER     NOT NULL DEFAULT 0,
  -- Running balance = ticket_revenue - wage_bill + other income.
  balance        INTEGER     NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, season_id)
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- Part 4: wager_leaderboard view
-- ═══════════════════════════════════════════════════════════════════════════════

-- Public aggregate view that shows total wagering stats per user without
-- exposing individual bets. Used on leaderboard pages.
CREATE OR REPLACE VIEW wager_leaderboard AS
SELECT
  p.id                                     AS user_id,
  p.username,
  p.favourite_team_id,
  COUNT(w.id)                              AS total_bets,
  COUNT(w.id) FILTER (WHERE w.status = 'won')  AS wins,
  COUNT(w.id) FILTER (WHERE w.status = 'lost') AS losses,
  COALESCE(SUM(w.stake), 0)                AS total_staked,
  COALESCE(SUM(w.payout) FILTER (WHERE w.status = 'won'), 0) AS total_won,
  -- Net profit = total winnings - total staked (can be negative).
  COALESCE(SUM(w.payout) FILTER (WHERE w.status = 'won'), 0)
    - COALESCE(SUM(w.stake), 0)            AS net_profit
FROM profiles p
LEFT JOIN wagers w ON w.user_id = p.id
GROUP BY p.id, p.username, p.favourite_team_id;

-- Grant read access to the leaderboard view.
GRANT SELECT ON wager_leaderboard TO anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Part 5: RLS policies
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── wagers RLS ──────────────────────────────────────────────────────────────

ALTER TABLE wagers ENABLE ROW LEVEL SECURITY;

-- Users can only read their own wagers.
CREATE POLICY wagers_select_own ON wagers
  FOR SELECT
  USING (auth.uid() = user_id);

-- Users can only insert wagers for themselves.
CREATE POLICY wagers_insert_own ON wagers
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Settlement updates (status + payout) are allowed for the owning user.
-- In practice, settlement is triggered client-side after match completion.
-- When the engine moves server-side, tighten this to service_role only.
CREATE POLICY wagers_update_own ON wagers
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── match_odds RLS ──────────────────────────────────────────────────────────

ALTER TABLE match_odds ENABLE ROW LEVEL SECURITY;

-- Anyone can read odds (displayed on match pages).
CREATE POLICY match_odds_select ON match_odds
  FOR SELECT USING (true);

-- Authenticated users can write odds (client-side odds computation for now).
CREATE POLICY match_odds_insert ON match_odds
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY match_odds_update ON match_odds
  FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ── team_finances RLS ───────────────────────────────────────────────────────

ALTER TABLE team_finances ENABLE ROW LEVEL SECURITY;

-- Anyone can read team finances (displayed on team pages).
CREATE POLICY team_finances_select ON team_finances
  FOR SELECT USING (true);

-- Authenticated users can write (settlement + ticket revenue updates).
CREATE POLICY team_finances_insert ON team_finances
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY team_finances_update ON team_finances
  FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
