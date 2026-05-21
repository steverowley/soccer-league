-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: 0039_match_start_push_notifications
-- ───────────────────────────────────────────────────────────────────────────
-- WHY: Players want to be notified ~1 minute before their team's match
-- starts so they can open the app and watch the live commentary.  Browser
-- push notifications (OS-level — fire even when the tab is closed) are
-- the only way to deliver this for users who aren't already in the app.
--
-- ARCHITECTURE
--   - `push_subscriptions` stores the (endpoint, p256dh, auth) triplet a
--     browser hands back from PushManager.subscribe().  One row per
--     (user, endpoint) — a user can have multiple devices/browsers.
--   - `profiles.notify_favourite_team` and `profiles.notify_all_matches`
--     are the two opt-in toggles.  Both default false; users explicitly
--     enable them from /profile after granting Notification permission.
--   - `match_notification_sends` is the idempotency ledger.  The
--     edge-function cron runs every 30 seconds; without a ledger it
--     would re-fire pushes on every tick while a match is in the
--     "about to start" window.
--
-- DELIVERY
--   The match-notify-worker edge function (supabase/functions/
--   match-notify-worker) polls every 30s for matches with
--   `scheduled_at` in the next 60–90 seconds and `status='scheduled'`,
--   joins to interested users, web-pushes them, and records the
--   ledger row to prevent duplicates.
--
-- RLS
--   - push_subscriptions: owner can SELECT/INSERT/DELETE their own
--     rows.  Service role (edge function) reads all rows.
--   - match_notification_sends: service role only.  Users have no
--     business reading this.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. Profile opt-in columns ────────────────────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS notify_favourite_team BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notify_all_matches    BOOLEAN NOT NULL DEFAULT false;


-- ── 2. push_subscriptions table ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- The push service URL the browser handed us.  Different per browser
  -- vendor (fcm.googleapis.com, push.services.mozilla.com, …) and per
  -- device.  Unique-per-user so re-subscribing on the same device
  -- updates rather than duplicates.
  endpoint     TEXT        NOT NULL,

  -- The two encryption keys we need to send an encrypted payload to
  -- this endpoint.  Both are base64url-encoded as the browser returns
  -- them.  We never decrypt — they're forwarded straight into the
  -- web-push library on the server.
  p256dh_key   TEXT        NOT NULL,
  auth_key     TEXT        NOT NULL,

  -- Useful when debugging "why didn't I get a push on Safari?".
  user_agent   TEXT,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (user_id, endpoint)
);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx
  ON push_subscriptions (user_id);


-- ── 3. match_notification_sends ledger ───────────────────────────────────────
-- Idempotency guard so the every-30s cron doesn't double-fire pushes
-- while a match is sitting in the 60-90s pre-kickoff window.
CREATE TABLE IF NOT EXISTS match_notification_sends (
  match_id  UUID        NOT NULL REFERENCES matches(id)  ON DELETE CASCADE,
  user_id   UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  sent_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, user_id)
);


-- ── 4. RLS — push_subscriptions ──────────────────────────────────────────────
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY push_subscriptions_select_own ON push_subscriptions
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY push_subscriptions_insert_own ON push_subscriptions
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY push_subscriptions_delete_own ON push_subscriptions
  FOR DELETE
  USING (auth.uid() = user_id);


-- ── 5. RLS — match_notification_sends ───────────────────────────────────────
-- Service-role only.  No anon or authenticated access.  Users learn about
-- their own pushes via the OS notification, not by querying this table.
ALTER TABLE match_notification_sends ENABLE ROW LEVEL SECURITY;


-- ── 6. Cron — match-notify-worker every 30 seconds ───────────────────────────
-- pg_cron's minimum cadence is 1 minute, but pg_cron supports the
-- non-standard '30 seconds' syntax via the "*/N seconds" form on
-- recent versions.  Two cron rows (offset 0s + 30s) emulate 30s
-- cadence on older deployments — both safe because the worker is
-- idempotent via match_notification_sends.
SELECT cron.schedule(
  'trigger-match-notify-worker',
  '* * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://ddtpbipkqamuxnvupddc.supabase.co/functions/v1/match-notify-worker',
    body    := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json')
  ) AS request_id;
  $$
);

SELECT cron.schedule(
  'trigger-match-notify-worker-30s',
  '* * * * *',
  $$
  SELECT pg_sleep(30);
  SELECT net.http_post(
    url     := 'https://ddtpbipkqamuxnvupddc.supabase.co/functions/v1/match-notify-worker',
    body    := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json')
  ) AS request_id;
  $$
);
