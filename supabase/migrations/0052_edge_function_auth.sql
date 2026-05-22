-- ── 0052_edge_function_auth.sql ───────────────────────────────────────────
-- Closes the H0 finding from the May-2026 audit: four LLM-spending edge
-- functions (match-worker, architect-galaxy-tick, drama-tick,
-- corpus-enricher) accepted unauthenticated POST requests and silently
-- burned Anthropic tokens on every invocation. A drive-by `curl` loop
-- could drain the per-day spend in minutes.
--
-- This migration extends the 0043 vault+bearer pattern (originally added
-- for match-notify-worker) to all four:
--   1. A single new vault secret `worker_shared_secret` (64 hex chars)
--      is shared across the four functions — keeps operator burden low
--      (one secret to rotate; one env var name to set on each function).
--   2. Each of the four cron jobs is unscheduled and re-created with
--      `Authorization: Bearer <secret>` in its `net.http_post` headers.
--   3. The function bodies (this PR) check the header in constant time
--      via the WORKER_SHARED_SECRET env var.
--
-- ATTACK (before this migration)
-- ──────────────────────────────
--   curl -X POST https://<project>.supabase.co/functions/v1/architect-galaxy-tick
-- And the function spends Anthropic tokens. Same shape for match-worker,
-- drama-tick, corpus-enricher.
--
-- OPERATOR HANDOFF (must complete before functions stop accepting cron):
--   1. Read the secret out of the vault:
--        SELECT decrypted_secret
--          FROM vault.decrypted_secrets
--         WHERE name = 'worker_shared_secret';
--   2. Set it as an env var on each of the four functions:
--        supabase secrets set WORKER_SHARED_SECRET=<value> \
--          --project-ref <project>
--      (the env var is shared across all four functions in the same
--       project; one set command applies to all of them)
--   3. Redeploy each function so it picks up the new env var:
--        for fn in match-worker architect-galaxy-tick drama-tick corpus-enricher; do
--          supabase functions deploy "$fn" --no-verify-jwt
--        done
--
-- Until step 2 completes, the functions will respond 401 to every cron
-- tick (matching the fail-closed behaviour of match-notify-worker per
-- 0043). The 401s appear in the function logs, surfacing the
-- misconfiguration immediately.

-- ── 1. Vault secret ────────────────────────────────────────────────────────
-- Generates a random 64-character hex value (256 bits) and stores it
-- under the well-known name `worker_shared_secret`. Idempotent — only
-- inserts a new row when no row with this name exists, so re-running
-- after rotation does not destroy the live secret.

DO $$
DECLARE
  v_existing UUID;
BEGIN
  SELECT id INTO v_existing
    FROM vault.secrets
   WHERE name = 'worker_shared_secret';
  IF v_existing IS NULL THEN
    PERFORM vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      'worker_shared_secret',
      'Shared secret bridging pg_cron and the four LLM-spending edge functions (see migration 0052).'
    );
  END IF;
END
$$;

-- ── 2. Re-schedule the four cron jobs with Auth header ─────────────────────
-- For each job: unschedule (no-op if missing), then create with the same
-- cadence + same URL but with the Bearer header attached. The decryption
-- happens inside the cron session — the cleartext secret never leaves
-- the postgres backend until it's already in the outbound HTTP request.

-- match-worker — every minute
SELECT cron.unschedule('trigger-match-worker') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'trigger-match-worker'
);
SELECT cron.schedule(
  'trigger-match-worker',
  '* * * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://ddtpbipkqamuxnvupddc.supabase.co/functions/v1/match-worker',
    body    := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets
         WHERE name = 'worker_shared_secret' LIMIT 1
      )
    )
  ) AS request_id;
  $cron$
);

-- architect-galaxy-tick — every 2 hours on the hour
SELECT cron.unschedule('trigger-architect-galaxy-tick') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'trigger-architect-galaxy-tick'
);
SELECT cron.schedule(
  'trigger-architect-galaxy-tick',
  '0 */2 * * *',
  $cron$
  SELECT net.http_post(
    url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
                 || '/functions/v1/architect-galaxy-tick',
    body    := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets
         WHERE name = 'worker_shared_secret' LIMIT 1
      )
    )
  );
  $cron$
);

-- drama-tick — daily at 07:00 UTC
SELECT cron.unschedule('trigger-drama-tick') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'trigger-drama-tick'
);
SELECT cron.schedule(
  'trigger-drama-tick',
  '0 7 * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://ddtpbipkqamuxnvupddc.supabase.co/functions/v1/drama-tick',
    body    := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets
         WHERE name = 'worker_shared_secret' LIMIT 1
      )
    )
  );
  $cron$
);

-- corpus-enricher — hourly on the hour
SELECT cron.unschedule('trigger-corpus-enricher') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'trigger-corpus-enricher'
);
SELECT cron.schedule(
  'trigger-corpus-enricher',
  '0 * * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://ddtpbipkqamuxnvupddc.supabase.co/functions/v1/corpus-enricher',
    body    := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets
         WHERE name = 'worker_shared_secret' LIMIT 1
      )
    )
  );
  $cron$
);
