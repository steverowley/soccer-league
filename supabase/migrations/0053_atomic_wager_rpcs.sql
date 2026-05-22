-- ── 0053_atomic_wager_rpcs.sql ────────────────────────────────────────────
-- Closes a P0 from the May-2026 code-architecture audit: `placeWager` and
-- `settleMatchWagers` in src/features/betting/api/wagers.ts both did
-- non-atomic read-modify-write on `profiles.credits`. Two concurrent bets
-- could debit a stale balance (TOCTOU). The DB `credits >= 0` check
-- constraint was the only thing preventing negative balances; with concurrent
-- writes hitting the wrong baseline, that constraint would either fail loud
-- (rejecting the second insert + leaving the wager row orphaned) or, worse,
-- both writes overwriting each other with the same "balance - stake" value
-- so the user effectively only paid for one bet but had two open.
--
-- This migration ships two SECURITY DEFINER RPCs that wrap the whole
-- transaction in a single statement with row-level locking:
--
--   place_wager(p_user_id, p_match_id, p_team_choice, p_stake, p_odds)
--     1. SELECT … FOR UPDATE on the profile row to serialise concurrent bets
--     2. Validate credits >= stake AND match is upcoming/scheduled
--     3. INSERT into wagers
--     4. UPDATE profiles SET credits = credits - stake
--     5. RETURN wager row
--
--   settle_wager(p_wager_id, p_status, p_payout)
--     1. SELECT … FOR UPDATE on the wager row to serialise concurrent
--        settlement attempts (idempotent: returns false if already settled)
--     2. UPDATE wagers status + payout (only if status='open')
--     3. UPDATE profiles credits += payout when status='won'
--     4. RETURN true on first-time settlement, false on duplicate
--
-- BACKWARDS COMPATIBILITY: the wagers.ts TS API is rewritten in the same PR
-- to call these RPCs. The shape of the returned Wager type is identical, so
-- WagerWidget and Wagers.tsx need no changes.
--
-- DEFENCE-IN-DEPTH: migration 0041 still permits authenticated users to
-- UPDATE profiles.credits as long as new ≤ previous (which the TOCTOU
-- exploit relied on). The follow-up to this PR — tracked in #364's body —
-- is to drop the 0041 policy entirely now that the RPC owns the only
-- legitimate write path. Deferred so we can land the RPC and switch the TS
-- callers in one rev, then drop the policy in a separate rev once we've
-- verified no client code still touches credits directly.

-- ── 1. place_wager ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.place_wager(
  p_match_id    UUID,
  p_team_choice TEXT,
  p_stake       INTEGER,
  p_odds        NUMERIC
)
RETURNS public.wagers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller      UUID;
  v_role        TEXT;
  v_credits     INTEGER;
  v_match       RECORD;
  v_inserted    public.wagers;
BEGIN
  -- ── Auth ─────────────────────────────────────────────────────────────
  -- Anon-lockdown variant per migration 0051 — caller must be authenticated.
  -- No service-role bypass here; place_wager is a user action only.
  v_caller := auth.uid();
  v_role   := (current_setting('request.jwt.claims', true)::jsonb ->> 'role');
  IF v_caller IS NULL THEN
    IF v_role IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION 'place_wager requires authentication' USING ERRCODE = '28000';
    END IF;
  END IF;

  -- ── Validation (pre-lock) ────────────────────────────────────────────
  IF p_team_choice NOT IN ('home', 'draw', 'away') THEN
    RAISE EXCEPTION 'place_wager: team_choice must be home/draw/away (got %)', p_team_choice
      USING ERRCODE = '22023';
  END IF;
  IF p_stake IS NULL OR p_stake < 10 THEN
    RAISE EXCEPTION 'place_wager: stake must be >= 10 (minimum bet)'
      USING ERRCODE = '22023';
  END IF;
  IF p_odds IS NULL OR p_odds <= 1.0 THEN
    RAISE EXCEPTION 'place_wager: odds_snapshot must be > 1.0'
      USING ERRCODE = '22023';
  END IF;

  -- ── Match guard ──────────────────────────────────────────────────────
  -- Reject bets on completed / in-progress matches — accepting them would
  -- let a user bet on a known outcome.
  SELECT id, status INTO v_match
    FROM matches
   WHERE id = p_match_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'place_wager: match % not found', p_match_id USING ERRCODE = 'P0002';
  END IF;
  IF v_match.status <> 'scheduled' THEN
    RAISE EXCEPTION 'place_wager: match is no longer open for bets (status=%)', v_match.status
      USING ERRCODE = '22023';
  END IF;

  -- ── Lock + debit ─────────────────────────────────────────────────────
  -- FOR UPDATE serialises concurrent place_wager calls for the same user.
  -- The lock is released at function end (or txn commit/rollback).
  SELECT credits INTO v_credits
    FROM profiles
   WHERE id = COALESCE(v_caller, (SELECT id FROM profiles LIMIT 0))
   FOR UPDATE;

  IF NOT FOUND THEN
    -- Service-role callers without an explicit user can't place wagers.
    RAISE EXCEPTION 'place_wager: no profile row for caller' USING ERRCODE = 'P0002';
  END IF;

  IF v_credits < p_stake THEN
    RAISE EXCEPTION 'place_wager: insufficient credits (have %, need %)', v_credits, p_stake
      USING ERRCODE = '22023';
  END IF;

  -- ── Insert wager + decrement credits atomically ──────────────────────
  INSERT INTO wagers (user_id, match_id, team_choice, stake, odds_snapshot)
  VALUES (v_caller, p_match_id, p_team_choice, p_stake, p_odds)
  RETURNING * INTO v_inserted;

  UPDATE profiles
     SET credits = credits - p_stake
   WHERE id = v_caller;

  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION public.place_wager(UUID, TEXT, INTEGER, NUMERIC) IS
  'Atomic wager placement. Locks profile row FOR UPDATE, validates credits + match status, inserts wager and decrements credits in one transaction. See migration 0053.';

REVOKE EXECUTE ON FUNCTION public.place_wager(UUID, TEXT, INTEGER, NUMERIC) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.place_wager(UUID, TEXT, INTEGER, NUMERIC) FROM anon;
GRANT  EXECUTE ON FUNCTION public.place_wager(UUID, TEXT, INTEGER, NUMERIC) TO authenticated;


-- ── 2. settle_wager ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.settle_wager(
  p_wager_id UUID,
  p_status   TEXT,
  p_payout   INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller   UUID;
  v_role     TEXT;
  v_wager    RECORD;
  v_updated  INTEGER;
BEGIN
  -- ── Auth ─────────────────────────────────────────────────────────────
  -- Settlement runs from the match-worker (service role) AND from the
  -- browser-side WagerSettlementListener (authenticated admin). Either
  -- path is acceptable; anon is not.
  v_caller := auth.uid();
  v_role   := (current_setting('request.jwt.claims', true)::jsonb ->> 'role');
  IF v_caller IS NULL THEN
    IF v_role IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION 'settle_wager requires authentication' USING ERRCODE = '28000';
    END IF;
  END IF;

  -- ── Validation ───────────────────────────────────────────────────────
  IF p_status NOT IN ('won', 'lost', 'void') THEN
    RAISE EXCEPTION 'settle_wager: status must be won/lost/void (got %)', p_status
      USING ERRCODE = '22023';
  END IF;
  IF p_payout IS NULL OR p_payout < 0 THEN
    RAISE EXCEPTION 'settle_wager: payout must be >= 0' USING ERRCODE = '22023';
  END IF;

  -- ── Lock wager + idempotency check ───────────────────────────────────
  SELECT id, user_id, status INTO v_wager
    FROM wagers
   WHERE id = p_wager_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'settle_wager: wager % not found', p_wager_id USING ERRCODE = 'P0002';
  END IF;
  IF v_wager.status <> 'open' THEN
    -- Already settled by an earlier concurrent run. Idempotent no-op.
    RETURN false;
  END IF;

  -- ── Apply settlement ─────────────────────────────────────────────────
  UPDATE wagers
     SET status = p_status,
         payout = CASE WHEN p_payout > 0 THEN p_payout ELSE NULL END
   WHERE id = p_wager_id
     AND status = 'open';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    -- Race lost between FOR UPDATE release and UPDATE — another
    -- transaction beat us. Treat as idempotent no-op.
    RETURN false;
  END IF;

  -- Credit the winner (only fires for status='won' AND non-zero payout).
  IF p_status = 'won' AND p_payout > 0 THEN
    UPDATE profiles
       SET credits = credits + p_payout
     WHERE id = v_wager.user_id;
  END IF;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.settle_wager(UUID, TEXT, INTEGER) IS
  'Atomic wager settlement. Locks wager row FOR UPDATE, updates status + payout, credits winner if won. Idempotent: returns false on already-settled wagers. See migration 0053.';

REVOKE EXECUTE ON FUNCTION public.settle_wager(UUID, TEXT, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.settle_wager(UUID, TEXT, INTEGER) FROM anon;
GRANT  EXECUTE ON FUNCTION public.settle_wager(UUID, TEXT, INTEGER) TO authenticated;
