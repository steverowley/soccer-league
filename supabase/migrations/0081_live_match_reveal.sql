-- ── 0081_live_match_reveal.sql ────────────────────────────────────────────────
-- WHY: a match was only ever "live" by accident.  The worker simulated all 90
-- minutes in ~10 s and immediately wrote status='completed' plus the final
-- score, so by the time a spectator opened the page the match was history —
-- while the commentary feed was still pacing minute 3 against the wall clock.
-- Worse, the scoreboard reads matches.home_score directly, so the *final score
-- was on screen from kickoff*, and wagers settled before anyone watched.
--
-- THE MODEL THIS INTRODUCES
-- ─────────────────────────
-- Simulation and publication become two separate moments:
--
--   scheduled  → worker hasn't claimed it yet
--   in_progress→ a worker isolate is simulating RIGHT NOW (unchanged meaning:
--                this is the claim lock, the MAX_IN_FLIGHT semaphore, and the
--                stale-reaper's target — it stays short-lived, seconds only)
--   live       → fully simulated and persisted (events + frames + stats), but
--                the RESULT IS WITHHELD.  The viewer reveals it against the
--                wall clock over season_config.match_duration_seconds.
--   completed  → real full time has passed; the score is published and the
--                post-match effects (wagers, cup bracket, standings) fire.
--
-- `live` is deliberately a DIFFERENT status from `in_progress` so that a match
-- sitting in its 10-minute reveal window is NOT counted by MAX_IN_FLIGHT and is
-- NOT requeued by the stale-in-progress reaper.  Conflating them would jam the
-- queue at 4 concurrent matches and re-simulate every match on a 10-min loop.
--
-- WITHHOLDING THE SCORE
-- ─────────────────────
-- The simulated result parks in sim_home_score / sim_away_score while the match
-- is `live`; the finalizer copies it into home_score / away_score at full time.
-- Deriving the score by recounting goal events was rejected: match_events has no
-- team_id and the goal payload carries only a team SHORT NAME which is sometimes
-- absent entirely (observed: `{"isGoal":true,"commentary":"A player scores for
-- Away!"}`), so a recount would silently mis-score matches.
--
-- Keeping home_score NULL until full time also fixes standings for free —
-- src/features/match/api/standings.ts already skips rows whose scores are NULL,
-- so a league table can no longer show a result the spectator hasn't seen.

-- ── 1. matches.status gains 'live' ────────────────────────────────────────────
ALTER TABLE matches DROP CONSTRAINT IF EXISTS matches_status_check;
ALTER TABLE matches ADD CONSTRAINT matches_status_check
  CHECK (status IN ('scheduled', 'in_progress', 'live', 'completed', 'cancelled'));

-- ── 2. The withheld result ────────────────────────────────────────────────────
-- Nullable: only populated between simulation and full time.  Left in place
-- after publication as an audit trail of what the engine actually produced
-- (the Architect's rewrites mutate events, so a divergence here is meaningful).
ALTER TABLE matches ADD COLUMN IF NOT EXISTS sim_home_score smallint;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS sim_away_score smallint;

COMMENT ON COLUMN matches.sim_home_score IS
  'Simulated home score, withheld from home_score until real full time. Set when status→live.';
COMMENT ON COLUMN matches.sim_away_score IS
  'Simulated away score, withheld from away_score until real full time. Set when status→live.';

-- ── 3. Finalizer index ────────────────────────────────────────────────────────
-- The finalizer pass runs every minute and asks "which live matches have
-- reached full time?".  A partial index keeps that a cheap lookup over the
-- handful of concurrently-live rows rather than a scan of the whole season.
CREATE INDEX IF NOT EXISTS idx_matches_live_scheduled
  ON matches (scheduled_at)
  WHERE status = 'live';
