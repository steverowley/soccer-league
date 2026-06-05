-- ── 0071_place_wager_server_odds.sql ─────────────────────────────────────────
-- Closes a P0 credit-minting hole (#523).
--
-- THE HOLE
--   place_wager (0053) trusted the client-supplied `p_odds` and stored it
--   verbatim as `wagers.odds_snapshot`. settle_wager later pays
--   floor(stake × odds_snapshot), so a crafted request with p_odds = 1000000
--   minted credits on a win. The only check was `p_odds > 1.0`.
--
-- THE FIX
--   The stored snapshot now comes from `match_odds` (the worker-computed,
--   public-read odds row), never from the client. match_odds is already
--   worker-write-only — migration 0030 dropped the authenticated INSERT/UPDATE
--   policies precisely to stop "rewriting odds before placing a bet" — so a
--   user cannot poison their own price either. p_odds is kept ONLY as an
--   advisory odds-lock: if the price the client displayed has drifted from the
--   live price by more than 3%, the bet is rejected so the user is never
--   silently settled at a materially different price than they saw.
--
-- No client change: the signature is unchanged, so wagers.ts / WagerWidget keep
-- passing the displayed odds as p_odds (now advisory). Stake stays uncapped per
-- the design ("minimum 10, no maximum") — balance remains the only ceiling.
--
-- Everything else (auth, FOR UPDATE profile lock, credits check, atomic
-- insert + debit) is preserved exactly from 0053.

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
  v_caller   UUID;
  v_role     TEXT;
  v_credits  INTEGER;
  v_match    RECORD;
  v_odds     NUMERIC;
  v_inserted public.wagers;
BEGIN
  -- ── Auth ─────────────────────────────────────────────────────────────
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

  -- ── Authoritative odds (server-side) ─────────────────────────────────
  -- The odds stored on the wager MUST come from match_odds, never the client.
  -- match_odds is worker-write-only (RLS locked in 0030), so the user cannot
  -- pre-poison this row. This is the line that closes the credit-minting hole.
  SELECT CASE p_team_choice
           WHEN 'home' THEN home_odds
           WHEN 'draw' THEN draw_odds
           WHEN 'away' THEN away_odds
         END
    INTO v_odds
    FROM match_odds
   WHERE match_id = p_match_id;

  IF v_odds IS NULL THEN
    RAISE EXCEPTION 'place_wager: no odds posted for this match yet'
      USING ERRCODE = '22023';
  END IF;

  -- ── Advisory odds-lock ───────────────────────────────────────────────
  -- p_odds is the price the client displayed. If it has drifted from the live
  -- price by more than 3%, reject so the user isn't settled at a surprise
  -- price. The stored snapshot is ALWAYS v_odds regardless. NULL p_odds (a
  -- service-role caller, say) skips the advisory check.
  IF p_odds IS NOT NULL
     AND (p_odds < v_odds * 0.97 OR p_odds > v_odds * 1.03) THEN
    RAISE EXCEPTION 'place_wager: odds have moved (you saw %, live odds are %) — refresh and retry', p_odds, v_odds
      USING ERRCODE = '22023';
  END IF;

  -- ── Lock + debit ─────────────────────────────────────────────────────
  -- FOR UPDATE serialises concurrent place_wager calls for the same user.
  SELECT credits INTO v_credits
    FROM profiles
   WHERE id = COALESCE(v_caller, (SELECT id FROM profiles LIMIT 0))
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'place_wager: no profile row for caller' USING ERRCODE = 'P0002';
  END IF;

  IF v_credits < p_stake THEN
    RAISE EXCEPTION 'place_wager: insufficient credits (have %, need %)', v_credits, p_stake
      USING ERRCODE = '22023';
  END IF;

  -- ── Insert wager + decrement credits atomically ──────────────────────
  -- odds_snapshot = v_odds (server price), NOT p_odds.
  INSERT INTO wagers (user_id, match_id, team_choice, stake, odds_snapshot)
  VALUES (v_caller, p_match_id, p_team_choice, p_stake, v_odds)
  RETURNING * INTO v_inserted;

  UPDATE profiles
     SET credits = credits - p_stake
   WHERE id = v_caller;

  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION public.place_wager(UUID, TEXT, INTEGER, NUMERIC) IS
  'Atomic wager placement. odds_snapshot is read server-side from match_odds (worker-write-only); p_odds is an advisory odds-lock only (rejects on >3% drift). Locks profile FOR UPDATE, validates credits + match status, inserts wager + decrements credits in one transaction. See migrations 0053 + 0071 (#523).';

-- Grants unchanged (same signature) but re-asserted for idempotency.
REVOKE EXECUTE ON FUNCTION public.place_wager(UUID, TEXT, INTEGER, NUMERIC) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.place_wager(UUID, TEXT, INTEGER, NUMERIC) FROM anon;
GRANT  EXECUTE ON FUNCTION public.place_wager(UUID, TEXT, INTEGER, NUMERIC) TO authenticated;
