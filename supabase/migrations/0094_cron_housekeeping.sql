-- 0094_cron_housekeeping.sql
-- Daily in-database housekeeping: trim pg_cron's run history and pg_net's
-- response buffer to the last 3 days (docs/mvp-free-tier.md, decision 5).
--
-- WHY: neither table holds game state, and neither trims itself.
--   cron.job_run_details gains a row per job run (the match worker alone ran
--     1 440 times a day) and once reached 279 MB.
--   net._http_response keeps every pg_net response (each cron tick that calls
--     an edge function leaves one) and once reached 76 MB.
-- On the free plan's 500 MB quota that is real money. The weekly
-- db-maintenance workflow also trims them, but from outside the database and
-- only once a week; this job keeps them small every day with no workflow
-- secrets involved.
--
-- The job runs as the migration's role (postgres), which owns both tables'
-- maintenance. One DO block, so it is a single statement for pg_cron. Plain
-- DELETEs (no VACUUM FULL): autovacuum reuses the freed space, and a daily
-- trim keeps the tables at a steady size.
--
-- Idempotent and guarded by job name: re-running replaces the job with the
-- same definition.

SELECT cron.unschedule('trim-cron-and-net-history') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'trim-cron-and-net-history'
);

SELECT cron.schedule(
  'trim-cron-and-net-history',
  '17 3 * * *',
  $cron$
  DO $trim$
  BEGIN
    DELETE FROM cron.job_run_details WHERE start_time < now() - interval '3 days';
    DELETE FROM net._http_response   WHERE created    < now() - interval '3 days';
  END
  $trim$;
  $cron$
);
