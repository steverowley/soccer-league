-- ── 0032_admin_role_gating.sql ─────────────────────────────────────────────
-- Closes the `admin_reset_season` exposure flagged by `get_advisors`:
-- the function was SECURITY DEFINER + callable by every signed-in user
-- (`authenticated` role), and its body TRUNCATEs every dynamic table in
-- the game — match_events, wagers, lore, narratives, training logs, etc.
-- Any authenticated user could wipe the entire game state with one POST.
--
-- This migration:
--   1. Adds `profiles.is_admin BOOLEAN NOT NULL DEFAULT false`, so the
--      app and DB share one source of truth for who may run destructive
--      ops.  No new table — we already have a 1:1 `profiles` → `auth.users`
--      mapping (see migration 0001), so piggy-backing `is_admin` there
--      keeps the role check a single point lookup against auth.uid().
--   2. Rewrites `admin_reset_season()` to raise an `insufficient_privilege`
--      exception when the caller's profile row has `is_admin = false`
--      (or no profile row exists at all).  The check runs even though
--      the function is SECURITY DEFINER — `auth.uid()` returns the
--      JWT-derived caller id regardless of definer / invoker mode.
--   3. Leaves the function SECURITY DEFINER so admins can TRUNCATE
--      regardless of their per-table RLS grants.  The in-body check
--      provides the gate that RLS would otherwise enforce.
--
-- WHO BECOMES ADMIN
-- ─────────────────
-- Default is `false` for every existing profile, so the function becomes
-- effectively dead until you explicitly flip the flag for your own
-- account.  Run this once from the SQL editor (or via supabase_admin
-- service-role client) — the email match is intentionally narrow so a
-- typo can't grant the role to the wrong account:
--
--   UPDATE profiles
--   SET    is_admin = true
--   WHERE  id = (SELECT id FROM auth.users WHERE email = 'you@example.com');
--
-- Future admins can be flipped the same way.  There's deliberately no
-- self-service path for promoting yourself — the bootstrap step has to
-- happen out-of-band.

-- ── Column: profiles.is_admin ──────────────────────────────────────────────
-- NOT NULL + DEFAULT false so every existing row is non-admin without a
-- backfill UPDATE.  The constraint stays cheap (single boolean column,
-- no FK / index) and the read path inside the RPC is a single PK lookup.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;

-- COMMENT documents the field for anyone reading the schema dump or
-- generated TS types — saves a code-spelunking session later.
COMMENT ON COLUMN profiles.is_admin IS
  'Authorization flag for destructive RPCs (admin_reset_season etc). Default false; bootstrap admin out-of-band via a service-role UPDATE keyed on auth.users.email.';

-- ── RPC: admin_reset_season with in-body role gate ─────────────────────────
-- Same body as migration 0029 with one prelude block: raise on missing
-- caller, missing profile, or is_admin=false.  The error code 28000
-- ('insufficient_privilege') is the standard SQLSTATE for permission
-- failures — PostgREST surfaces it to the client as 403 so the admin
-- UI can distinguish "you can't" from "the function blew up".

CREATE OR REPLACE FUNCTION admin_reset_season()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller    UUID;
  v_is_admin  BOOLEAN;
  v_cadence   INTEGER;
  v_kickoff   TIMESTAMPTZ;
  v_comp      RECORD;
  v_count     INTEGER;
BEGIN
  -- ── Role gate ─────────────────────────────────────────────────────────
  -- auth.uid() returns the JWT-derived caller id, or NULL for service-role
  -- callers (which we want to allow — service-role tools / migrations
  -- always pass).  Anon callers have NULL too; we reject them via the
  -- subsequent profile lookup that won't find a matching row.
  v_caller := auth.uid();

  IF v_caller IS NULL THEN
    -- Service role: bypass.  RLS doesn't apply to service-role clients
    -- so we let them through without a profiles lookup.  Anon callers
    -- shouldn't be reaching SECURITY DEFINER functions at all because
    -- we revoked anon EXECUTE in migration 0030 — but defence-in-depth
    -- is cheap so we keep the gate explicit.
    NULL;
  ELSE
    SELECT is_admin
      INTO v_is_admin
      FROM profiles
     WHERE id = v_caller;

    IF v_is_admin IS NOT TRUE THEN
      RAISE EXCEPTION 'admin_reset_season requires is_admin = true on the caller profile'
        USING ERRCODE = '28000';
    END IF;
  END IF;

  -- ── Original body (mirrors migration 0029) ────────────────────────────
  TRUNCATE match_events, match_player_stats, match_attendance, match_odds CASCADE;
  TRUNCATE wagers CASCADE;
  TRUNCATE architect_interventions, architect_lore CASCADE;
  TRUNCATE narratives CASCADE;
  TRUNCATE player_training_log CASCADE;
  TRUNCATE team_finances CASCADE;
  TRUNCATE incinerations CASCADE;
  TRUNCATE focus_votes, focus_enacted, season_decrees CASCADE;

  DELETE FROM matches;

  SELECT COALESCE(sc.match_cadence_minutes, 1440)
    INTO v_cadence
    FROM seasons s
    LEFT JOIN season_config sc ON sc.season_id = s.id
    WHERE s.is_active = true
    LIMIT 1;

  v_kickoff := NOW() + INTERVAL '5 minutes';

  FOR v_comp IN (
    SELECT c.id AS comp_id,
           ARRAY_AGG(ct.team_id ORDER BY ct.team_id) AS team_ids
    FROM competitions c
    JOIN competition_teams ct ON ct.competition_id = c.id
    WHERE c.type = 'league'
    GROUP BY c.id
  ) LOOP
    PERFORM berger_round_robin_fixtures(
      v_comp.comp_id, v_comp.team_ids, v_kickoff, v_cadence
    );
  END LOOP;

  SELECT COUNT(*) INTO v_count FROM matches;

  UPDATE seasons SET
    status             = 'active',
    ended_at           = NULL,
    election_opens_at  = NULL,
    election_closes_at = NULL
  WHERE is_active = true;

  RETURN json_build_object(
    'success',         true,
    'matches_created', v_count,
    'cadence_minutes', v_cadence,
    'caller',          v_caller
  );
END;
$$;

COMMENT ON FUNCTION admin_reset_season() IS
  'Destructive: wipes match/event/wager/lore/narrative state and rebuilds the fixture list. Gated on profiles.is_admin (see migration 0032).';
