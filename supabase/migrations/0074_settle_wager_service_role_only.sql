-- ── 0074_settle_wager_service_role_only.sql ───────────────────────────────────
-- Closes a P0 credit-minting hole (#557).
--
-- THE HOLE
--   settle_wager (0053) is SECURITY DEFINER, was GRANTed to `authenticated`, and
--   trusts the client-supplied `p_payout` (only checked >= 0). Its auth gate only
--   rejected anon — `IF v_caller IS NULL` passes for any signed-in user. So a
--   signed-in user could POST /rest/v1/rpc/settle_wager with
--   { p_wager_id: <own open wager>, p_status: 'won', p_payout: 999999999 },
--   skip the legitimate resolveWager computation, and mint credits at will.
--
-- THE FIX
--   Settlement is already worker-authoritative: match-worker/index.ts calls
--   settleMatchWagers inline in service-role context the moment a match is marked
--   complete. The browser-side WagerSettlementListener path (the only caller that
--   needed the `authenticated` grant) is redundant and is removed in this PR.
--   So lock settle_wager to the service role:
--     1. tighten the internal guard to require role = service_role; and
--     2. REVOKE EXECUTE from authenticated (PUBLIC/anon already revoked in 0053),
--        GRANT EXECUTE to service_role explicitly so the worker keeps settling.
--
--   Body is otherwise identical to 0053 (FOR UPDATE lock, idempotent no-op on
--   already-settled wagers, credit-the-winner on won). `v_caller`/auth.uid() is
--   dropped — settlement no longer has a per-user caller.

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
  v_role    TEXT;
  v_wager   RECORD;
  v_updated INTEGER;
BEGIN
  -- ── Auth: service role only ──────────────────────────────────────────
  -- Settlement runs exclusively in the match-worker (service-role key).
  -- No user-facing path: a client must never choose a wager's payout.
  v_role := (current_setting('request.jwt.claims', true)::jsonb ->> 'role');
  IF v_role IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'settle_wager is service-role only — settlement runs in the match-worker (#557)'
      USING ERRCODE = '42501';
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
  'Atomic wager settlement, service-role only (match-worker). Locks the wager row FOR UPDATE, updates status + payout, credits the winner if won. Idempotent: returns false on already-settled wagers. See migrations 0053 + 0074 (#557).';

-- Lock execution to the service role. PUBLIC + anon were already revoked in 0053;
-- re-assert for idempotency. Revoke the authenticated grant (the hole) and grant
-- the service role explicitly so the worker keeps settling.
REVOKE EXECUTE ON FUNCTION public.settle_wager(UUID, TEXT, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.settle_wager(UUID, TEXT, INTEGER) FROM anon;
REVOKE EXECUTE ON FUNCTION public.settle_wager(UUID, TEXT, INTEGER) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.settle_wager(UUID, TEXT, INTEGER) TO service_role;
