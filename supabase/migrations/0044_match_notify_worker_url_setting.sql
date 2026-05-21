-- ── 0044_match_notify_worker_url_setting.sql ──────────────────────────────
-- Closes the L2 finding from the security review: migrations 0039 / 0043
-- hardcoded the Supabase project URL in the cron command body —
--     'https://ddtpbipkqamuxnvupddc.supabase.co/functions/v1/match-notify-worker'
-- The URL is not a secret (it's the project's public REST endpoint) but
-- the hardcode makes the migration non-portable: a fork or restore-to-
-- another-project requires a hand-edit before re-applying.
--
-- WHY A SETTINGS TABLE AND NOT ALTER DATABASE / VAULT
-- ───────────────────────────────────────────────────
-- Tried first: `ALTER DATABASE postgres SET app.match_notify_worker_url
-- = '…'`.  Supabase's managed Postgres refuses with 42501 — the platform
-- reserves DB-level GUC writes for its own configuration.
-- Considered:  storing the URL in supabase_vault alongside the H2 shared
-- secret.  The vault is right for *secrets*; the function URL is public
-- (anyone can `curl` it).  Mixing the two layers would be misleading
-- about which entries are sensitive.
-- Final:       a tiny `app_config` table (id PK = a short name, value
-- text) with service-role-only writes and authenticated read.  Postgres
-- is happy to host trivial key/value tables — pg_settings is the
-- preferred place for *session* config, not deploy-time config.
--
-- FORK NOTE
-- ─────────
-- After forking the project (new project ref → new URL), an operator
-- can rotate the URL via a single statement, no migration needed:
--   UPDATE app_config
--      SET value = '<new-url>'
--    WHERE key = 'match_notify_worker_url';
-- The next cron tick consumes the new value (the cron command reads the
-- table on every invocation).

-- ── 1. app_config table ────────────────────────────────────────────────────
-- Single row per setting.  TEXT/TEXT keeps the shape generic so future
-- non-secret runtime knobs can land here without a schema change.

CREATE TABLE IF NOT EXISTS public.app_config (
  -- Stable lookup name.  Snake_case to match the migration / SQL style.
  key        TEXT PRIMARY KEY,
  -- The configured value.  Caller does its own parsing (URL, integer,
  -- boolean, JSON-encoded structure — whatever the consumer needs).
  value      TEXT NOT NULL,
  -- Wall-clock when the row was last touched; useful when investigating
  -- which deploy introduced a config drift.
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.app_config IS
  'Non-secret runtime configuration consumed by SQL helpers and cron jobs. Service-role write, no public read by default. Secrets belong in supabase_vault — never store credentials here.';

-- Service-role-only writes via RLS — even though we don't expect any
-- regular role to touch this table, defence-in-depth keeps a wayward
-- INSERT from corrupting the cron destination.

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

-- No SELECT / INSERT / UPDATE / DELETE policy — RLS denies-by-default,
-- so only the service-role bypass path can touch the rows.  The cron
-- job runs as the postgres superuser (via `cron.schedule`'s default
-- nodename), which also bypasses RLS.


-- ── 2. Seed the canonical URL ──────────────────────────────────────────────
-- Upsert so re-running the migration after a manual URL rotation does
-- NOT clobber the operator's value.  WHERE-NOT-EXISTS-style guard via
-- ON CONFLICT … DO NOTHING.

INSERT INTO public.app_config (key, value)
VALUES (
  'match_notify_worker_url',
  'https://ddtpbipkqamuxnvupddc.supabase.co/functions/v1/match-notify-worker'
)
ON CONFLICT (key) DO NOTHING;


-- ── 3. Re-schedule the cron with the URL read at execution time ────────────
-- cron.schedule replaces an existing job of the same name in place, so
-- this is idempotent — re-running just rewrites the command body.  The
-- new body looks the URL up at every tick; a typo in the key would
-- surface as a runtime NULL → net.http_post error in the cron log
-- rather than silent traffic to the wrong destination.

SELECT cron.schedule(
  'trigger-match-notify-worker',
  '* * * * *',
  $cron$
  SELECT net.http_post(
    url     := (
      SELECT value FROM public.app_config
       WHERE key = 'match_notify_worker_url'
    ),
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
