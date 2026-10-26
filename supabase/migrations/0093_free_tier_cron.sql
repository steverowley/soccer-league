-- 0093_free_tier_cron.sql
-- Cron changes for running the MVP inside Supabase's free tier
-- (docs/mvp-free-tier.md, decisions 3 and 6).
--
-- 1. trigger-match-worker: every 2 minutes instead of every minute.
--    Together with at most 2 simulations in flight and at most 2 claims per
--    tick (match-worker/simAttempts.ts), a backlog drains steadily instead of
--    bursting the Nano instance's CPU. Only the schedule changes: the command
--    (URL, body, vault-held Authorization header from migration 0052) is kept
--    as it is. Publishing at full time compares the wall clock with the
--    kickoff plus the reveal window, so it does not assume a 1-minute tick; a
--    match is published at most one tick (2 minutes) after full time.
--
-- 2. trigger-corpus-enricher: unscheduled. Its only work is a model call
--    (Anthropic) to grow persona snippet libraries, and production logged
--    "[callEnricher] anthropic call failed" every hour. The function itself
--    now also returns early unless ISL_NARRATIVE_MODE=llm. To bring it back,
--    re-run the corpus-enricher block of migration 0052 after opting in.
--
-- Kept as they are (they have deterministic paths, and make no model call
-- unless ISL_NARRATIVE_MODE=llm):
--   trigger-architect-galaxy-tick (0 */2 * * *): the Galaxy Dispatch voices
--     run on the local corpus by default.
--   trigger-drama-tick (0 7 * * *): drains the matured drama-consequence
--     queue; new drama is only written in llm mode.
--   trigger-match-notify-worker (* * * * *): no model call at all.
--
-- Idempotent and guarded by job name: safe to re-run, and a no-op for any
-- job that does not exist.

DO $$
DECLARE
  v_job bigint;
BEGIN
  SELECT jobid INTO v_job FROM cron.job WHERE jobname = 'trigger-match-worker';
  IF v_job IS NOT NULL THEN
    PERFORM cron.alter_job(job_id := v_job, schedule := '*/2 * * * *');
  END IF;
END
$$;

SELECT cron.unschedule('trigger-corpus-enricher') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'trigger-corpus-enricher'
);
