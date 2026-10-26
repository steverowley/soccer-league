-- 0092_match_sim_attempts.sql
-- Poison-pill handling for the match worker: count failed simulation
-- attempts, back off between them, and park a match that keeps failing.
--
-- WHY (docs/mvp-free-tier.md, decision 4; incident #712): a retry reuses the
-- match's stored sim_seed, so a deterministic failure (a constraint violation,
-- a bad payload) fails identically on every attempt. The worker used to put a
-- failed match straight back to 'scheduled', so one bad match was re-simulated
-- every tick, held worker slots and starved the free Nano instance.
--
-- HOW THE WORKER USES THESE (supabase/functions/match-worker/simAttempts.ts)
--   sim_attempts         failed attempts so far (a stale in_progress reap
--                        counts too).
--   sim_last_error       the last failure, one line, at most 500 characters.
--   sim_next_attempt_at  earliest time the match may be claimed again:
--                        +5 min after the 1st failure, +15 after the 2nd,
--                        +45 after the 3rd.
--   sim_parked_at        set on the 3rd failure. A parked match is never
--                        claimed automatically. To retry one by hand, clear
--                        sim_parked_at and sim_next_attempt_at (and reset
--                        sim_attempts to 0 for a fresh set of attempts).
--   The worker claims only rows with status = 'scheduled', scheduled_at <= now,
--   sim_parked_at IS NULL and (sim_next_attempt_at IS NULL OR <= now).
--
-- ORDERING: the worker selects and writes these columns, so this migration
-- must be applied BEFORE the worker change that uses them is deployed, or
-- every claim fails.
--
-- Additive only: every column has a default or is nullable, and no read-side
-- schema has to change. Adding a column with a constant default is a catalog
-- change on Postgres 11+, so this does not rewrite the matches table.
--
-- Idempotent: safe to re-run.

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS sim_attempts        integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sim_last_error      text,
  ADD COLUMN IF NOT EXISTS sim_next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS sim_parked_at       timestamptz;

COMMENT ON COLUMN public.matches.sim_attempts IS
  'Failed simulation attempts so far (match-worker; a stale in_progress reap counts). See migration 0092.';
COMMENT ON COLUMN public.matches.sim_last_error IS
  'Last simulation failure, one line, truncated to 500 characters. See migration 0092.';
COMMENT ON COLUMN public.matches.sim_next_attempt_at IS
  'Earliest time the match-worker may claim this match again after a failure (backoff 5, 15, 45 min). See migration 0092.';
COMMENT ON COLUMN public.matches.sim_parked_at IS
  'Set after the 3rd failed attempt: the match-worker never claims a parked match. Clear it (and sim_next_attempt_at) to retry by hand. See migration 0092.';

-- Lets an admin list parked matches cheaply; tiny, because almost no row is parked.
CREATE INDEX IF NOT EXISTS matches_sim_parked_at_idx
  ON public.matches (sim_parked_at)
  WHERE sim_parked_at IS NOT NULL;
