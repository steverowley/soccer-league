-- ── 0043_match_notify_worker_auth.sql ──────────────────────────────────────
-- Closes the H2 finding from the security review of branch
-- claude/great-allen-wOGHA: the match-notify-worker edge function was
-- callable by anyone on the internet (no Authorization header check on
-- the function side, pg_cron invoking it without credentials).  Drive-by
-- traffic could trigger a full DB scan + push fan-out at any time, and
-- on push-service 4xx responses the function deletes rows from
-- push_subscriptions — making the open endpoint a subscription-eviction
-- vector for free.
--
-- The migration also fixes the secondary issue: migration 0039 created
-- two cron rows in an attempt to emulate 30-second cadence by gluing
-- `pg_sleep(30); SELECT net.http_post(...)` onto the second row.  pg_cron
-- runs the block as a single transaction, so pg_sleep holds an idle
-- worker connection for half of every minute without achieving sub-
-- minute cadence in practice.
--
-- MITIGATION
-- ──────────
-- 1. Generate a 64-hex-character shared secret and store it in the
--    Supabase vault under the name `notify_worker_shared_secret`.  The
--    matching env var must be deployed alongside the function — see the
--    runbook block at the bottom of this file.
-- 2. Drop both legacy cron entries (`trigger-match-notify-worker` and
--    `trigger-match-notify-worker-30s`).
-- 3. Schedule a single new cron entry (`trigger-match-notify-worker`)
--    that fires every minute, pulls the secret from
--    `vault.decrypted_secrets`, and passes it in the `Authorization`
--    header as `Bearer <secret>`.
-- 4. The function (supabase/functions/match-notify-worker/index.ts)
--    rejects every inbound request whose Authorization header does not
--    match the same shared secret in constant time.
--
-- WHY MINUTE CADENCE INSTEAD OF 30 SECONDS
-- ────────────────────────────────────────
-- The 60–120s LEAD_TIME window in the worker absorbs the cron drift,
-- so a single minute-cadence cron meets the "1 minute before kickoff"
-- product requirement without needing fake 30-second cadence.  Pushes
-- arrive at most ~60s before kickoff and at worst ~60s before (the
-- window is computed at request-receive time).  pg_sleep is gone.

-- ── 1. Vault secret ────────────────────────────────────────────────────────
-- Generates a random 64-character hex value (256 bits) and stores it
-- under the well-known name `notify_worker_shared_secret`.  The vault
-- encrypts the value at rest; `vault.decrypted_secrets` is the read view
-- only the postgres role + service-role context can SELECT from.
--
-- WHY a fixed name and not a UUID:
-- The cron migration below has to reference the secret by some stable
-- identifier.  A fixed name keeps the join readable; the encryption
-- nonce inside the vault still varies per row, so the at-rest secrecy is
-- not weakened by a predictable lookup name.
--
-- IDEMPOTENT: the migration only inserts a new vault row if one doesn't
-- already exist with this name.  Re-running this migration after the
-- vault row has been rotated out-of-band leaves the live secret alone.

DO $$
DECLARE
  v_existing UUID;
BEGIN
  SELECT id INTO v_existing
    FROM vault.secrets
   WHERE name = 'notify_worker_shared_secret';
  IF v_existing IS NULL THEN
    PERFORM vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),                -- 64-hex-char value
      'notify_worker_shared_secret',                      -- well-known name
      'Shared secret bridging pg_cron and the match-notify-worker edge function (see migration 0043).'
    );
  END IF;
END
$$;


-- ── 2. Tear down the legacy cron entries ───────────────────────────────────
-- Both jobs scheduled by migration 0039.  cron.unschedule no-ops when the
-- job doesn't exist, so this is safe to re-run.

SELECT cron.unschedule('trigger-match-notify-worker')      WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'trigger-match-notify-worker'
);
SELECT cron.unschedule('trigger-match-notify-worker-30s')  WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'trigger-match-notify-worker-30s'
);


-- ── 3. Schedule the new, gated cron ────────────────────────────────────────
-- One job, every minute.  The command block:
--   a. SELECT the decrypted secret from the vault view.
--   b. Build the Authorization header value `Bearer <secret>`.
--   c. POST to the function with that header.
-- The decryption + header construction happen inside the cron job's
-- session, so the cleartext secret never leaves the postgres backend
-- until it's already in the outbound HTTP request.

SELECT cron.schedule(
  'trigger-match-notify-worker',
  '* * * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://ddtpbipkqamuxnvupddc.supabase.co/functions/v1/match-notify-worker',
    body    := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret
          FROM vault.decrypted_secrets
         WHERE name = 'notify_worker_shared_secret'
         LIMIT 1
      )
    )
  ) AS request_id;
  $cron$
);

-- ── 4. Operator runbook ───────────────────────────────────────────────────
-- The vault secret above is one half of the auth pair.  The OTHER half
-- must be set on the deployed edge function so it can verify the header.
--
--   1. Read the new secret out of the vault:
--        SELECT decrypted_secret
--          FROM vault.decrypted_secrets
--         WHERE name = 'notify_worker_shared_secret';
--   2. Set the same value as the function's env var:
--        supabase secrets set NOTIFY_WORKER_SHARED_SECRET=<value>
--        # or via Supabase dashboard → Edge Functions → match-notify-worker → secrets
--   3. Redeploy the function so it picks up the new env var:
--        supabase functions deploy match-notify-worker --no-verify-jwt
--      The --no-verify-jwt flag is intentional — the function performs
--      its own shared-secret check.  Removing it would also accept any
--      Supabase JWT, defeating the per-cron-secret gating.
--
-- Until step 2 completes, the worker will respond 401 to every cron
-- tick and pushes will be paused.  This is the deliberate fail-closed
-- behaviour; the operator-visible 401s in the function logs surface the
-- misconfiguration immediately.
