-- ── 0072_cast_focus_vote_rpc.sql ─────────────────────────────────────────────
-- Closes a P0 vote-stuffing / free-vote hole (#524).
--
-- THE HOLE
--   castVote() (voting/api/focuses.ts) inserted a focus_votes row FIRST, then
--   separately attempted a `decrement_credits` RPC that was never deployed
--   (it always errors), falling back to a skippable client-side debit. RLS on
--   focus_votes only checked user_id. So a client could POST a focus_votes row
--   with any `credits_spent`, for any team, and never pay — one attacker could
--   decide every club's season focus.
--
-- THE FIX
--   A single atomic SECURITY DEFINER RPC that, in one transaction:
--     1. validates the caller is authenticated and the vote is >= 10 credits;
--     2. resolves the option -> its team + season;
--     3. enforces eligibility — you may only vote on YOUR OWN club's focuses
--        (profiles.favourite_team_id must equal the option's team_id);
--     4. locks the profile row FOR UPDATE, checks the balance, and inserts the
--        vote + debits the credits together — the debit can no longer be skipped.
--
--   The mechanic is preserved exactly: voting is variable credit POOLING
--   (amount >= 10, no maximum, repeatable — "most credits wins"), matching the
--   OptionCard form (MIN_VOTE = 10). credits_spent is now always the amount the
--   user actually paid, never a free-form client claim.
--
--   focus_votes direct INSERT is revoked from clients; the SECURITY DEFINER RPC
--   is the only write path (it bypasses RLS as the owner). Public read of own
--   votes (focus_votes_select_own) is unchanged.
--
-- NOT in scope here (separate follow-ups): enforcing the season voting WINDOW,
-- and reconciling the design-doc's "10 IC major / 5 IC minor" line with the
-- implemented min-10 pooling mechanic.

-- ── 1. The atomic vote RPC ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cast_focus_vote(
  p_focus_option_id UUID,
  p_credits         INTEGER
)
RETURNS public.focus_votes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller   UUID;
  v_option   RECORD;
  v_fav_team TEXT;
  v_credits  INTEGER;
  v_inserted public.focus_votes;
BEGIN
  -- ── Auth ─────────────────────────────────────────────────────────────
  -- Voting is a user action only — no service-role path.
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'cast_focus_vote requires authentication' USING ERRCODE = '28000';
  END IF;

  -- ── Minimum vote (server-enforced) ───────────────────────────────────
  -- Matches MIN_VOTE = 10 in the UI. No maximum: voting is a credit pool,
  -- the balance is the only ceiling.
  IF p_credits IS NULL OR p_credits < 10 THEN
    RAISE EXCEPTION 'cast_focus_vote: a vote must spend at least 10 credits'
      USING ERRCODE = '22023';
  END IF;

  -- ── Resolve the option ───────────────────────────────────────────────
  SELECT id, team_id, season_id, tier INTO v_option
    FROM focus_options
   WHERE id = p_focus_option_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cast_focus_vote: focus option % not found', p_focus_option_id
      USING ERRCODE = 'P0002';
  END IF;

  -- ── Lock caller + eligibility + balance ──────────────────────────────
  -- FOR UPDATE serialises this user's concurrent votes so the balance check
  -- and debit can't race.
  SELECT favourite_team_id, credits INTO v_fav_team, v_credits
    FROM profiles
   WHERE id = v_caller
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cast_focus_vote: no profile row for caller' USING ERRCODE = 'P0002';
  END IF;

  -- Eligibility: only fans of the club may vote on its focuses.
  IF v_fav_team IS NULL OR v_fav_team IS DISTINCT FROM v_option.team_id THEN
    RAISE EXCEPTION 'cast_focus_vote: you can only vote on your own club''s focuses'
      USING ERRCODE = '42501';
  END IF;

  IF v_credits < p_credits THEN
    RAISE EXCEPTION 'cast_focus_vote: insufficient credits (have %, need %)', v_credits, p_credits
      USING ERRCODE = '22023';
  END IF;

  -- ── Insert vote + debit atomically ───────────────────────────────────
  INSERT INTO focus_votes (user_id, focus_option_id, credits_spent)
  VALUES (v_caller, p_focus_option_id, p_credits)
  RETURNING * INTO v_inserted;

  UPDATE profiles
     SET credits = credits - p_credits
   WHERE id = v_caller;

  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION public.cast_focus_vote(UUID, INTEGER) IS
  'Atomic focus vote. Validates auth + min-10 + own-club eligibility, locks profile FOR UPDATE, inserts the vote and debits credits in one transaction. Variable pooling preserved (no max, repeatable). See migration 0072 (#524).';

REVOKE EXECUTE ON FUNCTION public.cast_focus_vote(UUID, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cast_focus_vote(UUID, INTEGER) FROM anon;
GRANT  EXECUTE ON FUNCTION public.cast_focus_vote(UUID, INTEGER) TO authenticated;

-- ── 2. Revoke direct INSERT on focus_votes ────────────────────────────────
-- The RPC (SECURITY DEFINER) is now the only write path; it bypasses RLS as
-- the owner. Dropping the client INSERT policy means a direct
-- `insert into focus_votes` from anon/authenticated is denied by RLS — closing
-- the free-vote path. Own-row SELECT (focus_votes_select_own) stays.
DROP POLICY IF EXISTS focus_votes_insert_own ON public.focus_votes;
