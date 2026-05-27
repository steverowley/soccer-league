-- ── 0060_account_deletions_cleanup.sql ──────────────────────────────────
-- Closes #448 — scheduled cleanup for the GDPR Article 17 audit table.
--
-- Migration 0059 added `account_deletions` to track every right-to-erasure
-- request for the 30-day window the GDPR allows operators to retain
-- deletion logs. Beyond that window the audit itself must be purged or
-- the operator becomes the source of a new data-protection violation.
--
-- This migration ships:
--   1. A SECURITY DEFINER function `purge_old_account_deletions()` that
--      DELETEs rows older than the GDPR-typical 30-day window.
--   2. A pg_cron schedule that fires the function daily.
--   3. EXECUTE permissions locked to service_role only — anon, authenticated,
--      and PUBLIC must never trigger this function (it bypasses RLS and
--      destroys audit data; a non-admin caller is always a misuse).
--
-- HOW TO VERIFY (admin-only)
--   -- 1. Insert a row dated > 30 days ago
--   INSERT INTO account_deletions (deleted_user_id, deleted_username, wagers_anonymised, votes_anonymised, deleted_at)
--   VALUES (gen_random_uuid(), 'cron-test', 0, 0, now() - interval '31 days');
--   -- 2. Run the function manually (service-role JWT only)
--   SELECT purge_old_account_deletions();
--   -- 3. Confirm the test row is gone
--   SELECT count(*) FROM account_deletions WHERE deleted_username = 'cron-test';
--   -- expected: 0

-- ════════════════════════════════════════════════════════════════════════
-- PART 1: Purge function
-- ════════════════════════════════════════════════════════════════════════

-- SECURITY DEFINER because the cron job runs without a user context and
-- account_deletions is admin-only readable + service-role-only writable
-- (set up in migration 0059).  The function takes no parameters so the
-- 30-day retention window is hard-coded — a future migration can swap to
-- `app_config`-driven configurability if the operator ever wants a
-- different retention window.
CREATE OR REPLACE FUNCTION purge_old_account_deletions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
-- Pin search_path to defend against schema-hijack on the SECURITY DEFINER
-- function (the standard hardening pattern Supabase advisors flag).
SET search_path = public, pg_temp
AS $$
DECLARE
  deleted_count integer;
BEGIN
  -- 30 days is the GDPR-typical maximum for deletion-log retention.
  -- After this window the audit row itself becomes a privacy liability.
  DELETE FROM account_deletions
    WHERE deleted_at < now() - interval '30 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- Lock execute permissions: only service_role may call this.  Calling
-- this from a user-context session would either no-op (anon can't see
-- the table) or, worse, run with the function owner's privileges and
-- silently scrub audit history — a clear misuse vector worth shutting.
REVOKE EXECUTE ON FUNCTION purge_old_account_deletions() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION purge_old_account_deletions() FROM anon;
REVOKE EXECUTE ON FUNCTION purge_old_account_deletions() FROM authenticated;
GRANT  EXECUTE ON FUNCTION purge_old_account_deletions() TO service_role;

-- ════════════════════════════════════════════════════════════════════════
-- PART 2: pg_cron schedule
-- ════════════════════════════════════════════════════════════════════════

-- pg_cron is already enabled by migration 0027 (match-worker schedule);
-- no need to re-create the extension.  Daily at 03:15 UTC sits in the
-- quiet window between the match-worker tick (every minute) and the
-- galaxy-tick (every 2 hours) — picking a non-rounded minute reduces
-- the chance of contention with future hourly jobs.
SELECT cron.schedule(
  'purge-account-deletions',
  '15 3 * * *',
  $$ SELECT purge_old_account_deletions(); $$
);
