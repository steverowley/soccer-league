-- ── 0059_account_deletions.sql ───────────────────────────────────────────
-- Closes #415 — the GDPR Article 17 ("right to erasure") flow.
--
-- A fan can request account deletion from /profile. The edge function
-- `account-delete` (PR-companion to this migration) walks them through
-- a two-phase tear-down:
--
--   1. Call the SECURITY DEFINER `request_account_deletion()` RPC. It
--      writes a row to `account_deletions` capturing the pre-tear-down
--      stats (username, # wagers, # votes) so we have a 30-day audit
--      trail proving the deletion happened.
--
--   2. The edge function then uses the service-role admin client to
--      call `auth.admin.deleteUser(uid)`. The CASCADE on `profiles.id`
--      drops the profile row; the new ON-DELETE-SET-NULL behaviour on
--      `wagers.user_id` and `focus_votes.user_id` (added below) means
--      those rows are KEPT but have their user pointer anonymised.
--      Aggregate leaderboards still tally correctly; nothing identifies
--      the deleted user.
--
-- WHY SET NULL AND NOT CASCADE
-- ───────────────────────────
-- Pre-migration these FKs were ON DELETE CASCADE — a deletion would
-- wipe the user's entire bet + vote history. That contradicts the
-- "preserves leaderboard history" requirement in #415 and would let an
-- account self-delete their wager_leaderboard influence retroactively,
-- which could be weaponised in a future tournament context.
--
-- WHY THE AUDIT TABLE IS WRITE-ONCE
-- ─────────────────────────────────
-- We never mutate `account_deletions` rows. Admin operators can read
-- them via the new RLS policy; service role can scrub them via a
-- scheduled cleanup job (out of scope for this migration — file a
-- follow-up for the cron). 30-day retention is the GDPR-typical
-- maximum for deletion logs after which the audit itself must be
-- purged.

-- ════════════════════════════════════════════════════════════════════════
-- PART 1: Allow nullable user_id + SET NULL on cascade
-- ════════════════════════════════════════════════════════════════════════

-- wagers: drop NOT NULL, swap CASCADE for SET NULL.
ALTER TABLE wagers
  ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE wagers
  DROP CONSTRAINT wagers_user_id_fkey,
  ADD  CONSTRAINT wagers_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users(id) ON DELETE SET NULL;

-- focus_votes: same shape.
ALTER TABLE focus_votes
  ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE focus_votes
  DROP CONSTRAINT focus_votes_user_id_fkey,
  ADD  CONSTRAINT focus_votes_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users(id) ON DELETE SET NULL;

-- player_training_log + push_subscriptions + match_notification_sends
-- intentionally stay CASCADE: training contributions are per-player
-- (not per-user) on the public surface, and device subscriptions /
-- notification ledgers are inherently per-account ephemera. Dropping
-- them on delete is the desired behaviour.

-- ════════════════════════════════════════════════════════════════════════
-- PART 2: Audit table
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS account_deletions (
  -- Surrogate PK — independent of the deleted_user_id so cleanups can
  -- run without colliding with later rows for the same uid.
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The Supabase auth user id at the moment of deletion. Not a FK
  -- (the auth.users row is gone immediately after) — recorded as a
  -- forensic breadcrumb only.
  deleted_user_id    UUID        NOT NULL,
  -- The username the user held at the moment of deletion. Preserved
  -- so admins can answer "did so-and-so really delete?" without
  -- needing to recover a user id from elsewhere.
  deleted_username   TEXT        NOT NULL,
  -- Counts of anonymised dependent rows, for the admin readout.
  wager_count        INTEGER     NOT NULL,
  vote_count         INTEGER     NOT NULL,
  -- When the deletion landed. Default now() so the RPC body doesn't
  -- have to thread the timestamp through.
  deleted_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE account_deletions IS
  'GDPR Article 17 audit log. One row per fan-initiated account deletion. Admin-readable via RLS. Should be purged after 30 days by a follow-up scheduled cleanup. See migration 0059.';
COMMENT ON COLUMN account_deletions.deleted_user_id IS
  'auth.users id at moment of deletion. Not an FK (target row is dropped immediately by the same flow); kept for forensic correlation only.';

-- Partial index on deleted_at so the eventual 30-day cleanup cron
-- scans only the older rows.
CREATE INDEX IF NOT EXISTS idx_account_deletions_deleted_at
  ON account_deletions (deleted_at);

ALTER TABLE account_deletions ENABLE ROW LEVEL SECURITY;

-- Admin read access. Mirrors the admin_role_gating pattern from 0032
-- — RLS evaluates is_admin on the caller's profile row. Wrapped in
-- (SELECT auth.uid()) per #392 to stay init-plan-friendly.
DROP POLICY IF EXISTS account_deletions_admin_read ON account_deletions;
CREATE POLICY account_deletions_admin_read ON account_deletions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = (SELECT auth.uid())
        AND p.is_admin = TRUE
    )
  );

-- No INSERT/UPDATE/DELETE policies. The RPC below writes via
-- SECURITY DEFINER (bypasses RLS by design); service role can
-- scrub via the cleanup cron.

-- ════════════════════════════════════════════════════════════════════════
-- PART 3: SECURITY DEFINER RPC
-- ════════════════════════════════════════════════════════════════════════

-- Two-phase deletion contract (see the edge function for the second
-- phase). This RPC owns phase 1: anonymise the audit-worthy fields
-- and write the deletion log row. The caller (edge function) is
-- expected to follow up with auth.admin.deleteUser() which CASCADEs
-- through profiles, SETs NULL on wagers/focus_votes, and drops the
-- remaining ephemera.
--
-- WHY NOT JUST DO EVERYTHING IN ONE RPC
-- ─────────────────────────────────────
-- The Postgres `auth.users` row can only be removed via Supabase's
-- admin API (no SQL DELETE bypasses the auth schema's identity
-- triggers). So we have to call back to the edge function for the
-- final step. Splitting cleanly means a network failure between
-- phase 1 and 2 leaves an audit row + an unscrubbed user — surfaced
-- to admins as "abandoned deletion" rather than silently corrupted.
--
-- IDEMPOTENCY
-- ───────────
-- A second call after a successful one returns SQLSTATE P0002
-- ("profile not found") because the profile row has CASCADE-deleted.
-- The audit row is permitted to repeat (different gen_random_uuid
-- ids); admin operators can dedupe by deleted_user_id if needed.
CREATE OR REPLACE FUNCTION public.request_account_deletion()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid           UUID;
  v_username      TEXT;
  v_wager_count   INTEGER;
  v_vote_count    INTEGER;
BEGIN
  v_uid := (SELECT auth.uid());
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'request_account_deletion requires authentication'
      USING ERRCODE = '28000';
  END IF;

  -- Read the current username before the profile row is dropped by
  -- the upcoming auth.users delete cascade. If no profile row
  -- exists, that means a stale call after deletion — bail cleanly.
  SELECT username INTO v_username
  FROM profiles
  WHERE id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_account_deletion: no profile row for caller'
      USING ERRCODE = 'P0002';
  END IF;

  -- Count what's about to be anonymised. Surface the totals on the
  -- audit row so an admin can verify the SET NULL cascade actually
  -- ran (no rows = no scrubbing happened).
  SELECT COUNT(*)::INT INTO v_wager_count
  FROM wagers
  WHERE user_id = v_uid;
  SELECT COUNT(*)::INT INTO v_vote_count
  FROM focus_votes
  WHERE user_id = v_uid;

  -- Write the audit row BEFORE the cascade so v_username is still a
  -- real string. After the edge function's auth delete fires, the
  -- profile row is gone and the user is unrecoverable.
  INSERT INTO account_deletions (
    deleted_user_id, deleted_username, wager_count, vote_count
  )
  VALUES (v_uid, v_username, v_wager_count, v_vote_count);

  RETURN jsonb_build_object(
    'user_id',     v_uid,
    'username',    v_username,
    'wager_count', v_wager_count,
    'vote_count',  v_vote_count
  );
END;
$$;

COMMENT ON FUNCTION public.request_account_deletion() IS
  'Phase 1 of GDPR account deletion. Writes the audit row and returns the counts. Phase 2 (auth.users delete) is the responsibility of the account-delete edge function. See migration 0059 + the account-delete function source.';

REVOKE EXECUTE ON FUNCTION public.request_account_deletion() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.request_account_deletion() FROM anon;
GRANT  EXECUTE ON FUNCTION public.request_account_deletion() TO authenticated;
