-- 0100_scheduler_idle_mode.sql
-- Idle mode for the match scheduler (issue #750).
--
-- WHY: on the free Nano instance most of the database's own work is
-- scheduler plumbing, not the game. Every pg_cron run writes its
-- bookkeeping row (an insert and three updates in cron.job_run_details),
-- and every run that calls an edge function adds a pg_net request and
-- response row that pg_net's background worker later deletes. Measured
-- over 15 days (pg_stat_statements): about 21,000 s of database time on
-- that bookkeeping against a few hundred seconds for every game query put
-- together. Two jobs cause almost all of it:
--
--   trigger-match-notify-worker  every minute  (1,440 runs a day)
--   trigger-match-worker         every 2 min   (  720 runs a day)
--
-- and both run whether or not there is anything to do: between seasons,
-- and for most of every day in a season, they wake an edge function that
-- finds no work. The database starved on 2026-11-11 under exactly that
-- idle load.
--
-- WHAT: a governor job (every 5 minutes, plain SQL, no HTTP) switches those
-- two jobs on only when they can have work, and off otherwise:
--
--   trigger-match-worker: on while any match is in progress or live, or
--     any unparked scheduled match kicks off within 73 hours. The worker
--     prices odds 72 hours ahead (oddsGenerator.ts ODDS_HORIZON_HOURS), so
--     it is awake for every fixture's whole odds window, its kickoff, its
--     reveal and its publication, and for any overdue (backlogged) match,
--     exactly as before. Parked matches (sim_parked_at) are excluded: the
--     worker skips them anyway.
--   trigger-match-notify-worker: on while any scheduled match kicks off
--     between 5 minutes ago and 20 minutes from now. It only pushes
--     "starting in 1 minute" notifications for kickoffs 60 to 120 s away,
--     so waking it 15 to 20 minutes early (the governor runs every 5
--     minutes) never misses one.
--
-- Between seasons that is 288 governor runs a day instead of 2,160 runs
-- that each call a function. In a season the notify job sleeps except
-- around kickoffs.
--
-- The decision is a pure function of the matches table and a clock
-- (scheduler_job_wanted), so it can be checked at any moment by passing a
-- time. The governor only calls cron.alter_job when a job's state must
-- change, so a quiet tick writes nothing but its own run row. Jobs it does
-- not govern are never touched. Idempotent: safe to re-run.

CREATE OR REPLACE FUNCTION public.scheduler_job_wanted(p_job text, p_now timestamptz DEFAULT now())
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT CASE p_job
    WHEN 'trigger-match-worker' THEN EXISTS (
      SELECT 1 FROM public.matches m
      WHERE m.status IN ('in_progress', 'live')
         OR (m.status = 'scheduled'
             AND m.sim_parked_at IS NULL
             AND m.scheduled_at <= p_now + interval '73 hours')
    )
    WHEN 'trigger-match-notify-worker' THEN EXISTS (
      SELECT 1 FROM public.matches m
      WHERE m.status = 'scheduled'
        AND m.scheduled_at >= p_now - interval '5 minutes'
        AND m.scheduled_at <= p_now + interval '20 minutes'
    )
    ELSE true
  END
$fn$;

COMMENT ON FUNCTION public.scheduler_job_wanted(text, timestamptz) IS
  'Idle mode (0100): whether a governed pg_cron job can have work at p_now. Ungoverned jobs: true.';

CREATE OR REPLACE FUNCTION public.scheduler_governor()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  r record;
  v_want boolean;
  v_changes jsonb := '{}'::jsonb;
BEGIN
  FOR r IN
    SELECT jobid, jobname, active FROM cron.job
    WHERE jobname IN ('trigger-match-worker', 'trigger-match-notify-worker')
  LOOP
    v_want := public.scheduler_job_wanted(r.jobname);
    IF v_want IS DISTINCT FROM r.active THEN
      PERFORM cron.alter_job(job_id := r.jobid, active := v_want);
      v_changes := v_changes || jsonb_build_object(r.jobname, v_want);
    END IF;
  END LOOP;
  RETURN v_changes;
END
$fn$;

COMMENT ON FUNCTION public.scheduler_governor() IS
  'Idle mode (0100): switches the match worker and notify jobs on only when they can have work. Run by pg_cron every 5 minutes.';

-- Only the scheduler (postgres) runs these: never callable through the API.
REVOKE ALL ON FUNCTION public.scheduler_governor() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.scheduler_job_wanted(text, timestamptz) FROM PUBLIC, anon, authenticated;

-- cron.schedule with a name updates the job if it already exists.
SELECT cron.schedule('scheduler-governor', '*/5 * * * *', 'SELECT public.scheduler_governor()');

-- Settle the jobs now rather than at the first governor tick.
SELECT public.scheduler_governor();
