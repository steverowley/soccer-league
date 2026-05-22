-- ── 0041_profiles_column_lockdown.sql ─────────────────────────────────────
-- Closes a critical pre-existing exposure on `profiles_update_own` (added in
-- migration 0001).  The original policy permitted any authenticated user to
-- UPDATE any column on their own row, including:
--   * `is_admin` — self-promote to admin and run `admin_reset_season()`
--                  (TRUNCATEs the entire game), invoke `bd-sync-now`,
--                  access the new admin panel surface.
--   * `credits` — self-grant unlimited Intergalactic Credits and bet
--                  arbitrarily large stakes.
--
-- ATTACK BEFORE THIS MIGRATION
-- ────────────────────────────
--   await supabase.from('profiles')
--     .update({ is_admin: true, credits: 999999999 })
--     .eq('id', currentUserId);
-- Two columns, one POST, complete privilege escalation.
--
-- FIX
-- ───
-- Rewrite `profiles_update_own` with a `WITH CHECK` that compares the new
-- row against the existing row for the two sensitive columns:
--   * is_admin  — must equal the current value (no client-side toggling
--                 in either direction).  Admin bootstrap remains the
--                 out-of-band service-role UPDATE documented in 0032.
--   * credits   — may only DECREASE.  This keeps the current debit-side
--                 client flows working (bet placement at
--                 wagers.ts:90; focus voting at focuses.ts:143) while
--                 blocking self-credit injection.  Credit INCREASES happen
--                 exclusively via service-role contexts (settlement in the
--                 match-worker bypasses RLS), which are unaffected.
--
-- WHY A REWRITE INSTEAD OF COLUMN GRANT REVOKE
-- ────────────────────────────────────────────
-- Postgres column-level UPDATE GRANTs interact poorly with PostgREST: a
-- partial column GRANT means a `.update({a, b})` where the user lacks
-- write on `b` returns a permission error even when `b` is unchanged.
-- A `WITH CHECK` enforcing same-value (or monotonic decrease) avoids the
-- footgun — the row passes whenever the user did not actually try to
-- escalate, regardless of which columns appear in the payload.
--
-- FOLLOW-UP
-- ─────────
-- A future migration should move credits writes off the client entirely
-- (a `place_wager_rpc` SECURITY DEFINER function plus a paired focus-vote
-- RPC) so credits become append-only from the user's perspective.  That
-- would let us tighten the credits check to `credits = previous` and
-- eliminate the "only-decreasing" carve-out.  See bd issue isl-... .

-- ── Replace profiles_update_own ────────────────────────────────────────────

DROP POLICY IF EXISTS profiles_update_own ON public.profiles;

CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    -- is_admin: must equal current value.  Blocks both self-promotion
    -- (false→true) and the more theoretical self-demotion case.  NULL
    -- safety via IS NOT DISTINCT FROM even though the column is NOT NULL;
    -- harmless defence-in-depth.
    AND is_admin IS NOT DISTINCT FROM (
      SELECT p.is_admin FROM public.profiles p WHERE p.id = auth.uid()
    )
    -- credits: cannot increase from the client.  Bet placement and focus
    -- voting are debits and continue to work.  Settlement and payout
    -- happen in the match-worker under the service role and bypass RLS.
    AND credits <= (
      SELECT p.credits FROM public.profiles p WHERE p.id = auth.uid()
    )
  );

-- ── Confirmation comment for schema dumps ──────────────────────────────────

COMMENT ON POLICY profiles_update_own ON public.profiles IS
  'Owner-row UPDATE with is_admin same-value lock and credits-monotonic-decrease guard. See migration 0041 for the threat model.';
