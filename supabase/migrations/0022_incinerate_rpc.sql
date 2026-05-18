-- ── 0014_incinerate_rpc.sql ───────────────────────────────────────────────────
-- Phase 3 follow-up: atomic incineration via a single RPC.
--
-- WHY THIS EXISTS
-- ────────────────
-- 0013 introduced the permadeath pipeline as two sequential client-side writes:
--
--   1. UPDATE players  SET is_active=false, incineration_date=now() WHERE id=…
--   2. INSERT INTO incinerations (…)  -- audit log + memorial source
--
-- Run independently from the browser, those two writes are NOT atomic.  If the
-- second call fails (network hiccup, FK violation, RLS error, transient
-- PostgREST error) the player is left flagged inactive with NO audit row and
-- NO decree text.  That breaks two contracts:
--
--   - The /lost memorial reads from `incinerations` — a missing row means the
--     player vanishes silently, which is exactly the opposite of the design.
--   - The Architect's decree is the cosmos's permanent record of why the
--     mortal was taken.  Losing it means the season's lore loses an entry.
--
-- Wrapping both writes in a SECURITY DEFINER function gives us a single
-- transaction boundary: if the audit insert fails, the player UPDATE is rolled
-- back and the caller receives a single coherent error.  Either both succeed,
-- or neither does.
--
-- DESIGN NOTES
-- ────────────
-- - SECURITY DEFINER runs the function with the migration owner's privileges,
--   not the caller's.  That lets the RPC bypass per-row INSERT policies on the
--   incinerations table while keeping the table itself locked down.
-- - The function returns the new incinerations.id so callers can correlate
--   the audit row with downstream Decree writes.
-- - SET search_path = public is required by Supabase advisors to prevent
--   search_path injection attacks against SECURITY DEFINER functions.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.incinerate_player(
  p_player_id   UUID,
  p_season_id   UUID,
  p_team_id     TEXT,
  p_idol_rank   INTEGER,
  p_decree_text TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_audit_id UUID;
BEGIN
  -- ── Step 1: soft-delete the player ─────────────────────────────────────────
  -- We mark inactive FIRST so any concurrent match-roster load racing this
  -- transaction sees the dead player drop out of the engine the moment we
  -- commit.  is_active=true → false transition is the atomic flag.
  UPDATE players
  SET is_active         = false,
      incineration_date = now()
  WHERE id = p_player_id;

  -- Defensive guard: refuse to write an audit row for a player that doesn't
  -- exist.  Otherwise the memorial would show ghost entries with NULL names.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'incinerate_player: player % not found', p_player_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- ── Step 2: write the audit row ────────────────────────────────────────────
  -- Same transaction as Step 1.  If this insert fails (FK violation, check
  -- constraint, anything) the UPDATE above is rolled back and the player
  -- remains active.  The caller sees one error, not a half-applied state.
  INSERT INTO incinerations (
    player_id,
    season_id,
    team_id,
    idol_rank_at_time,
    decree_text
  )
  VALUES (
    p_player_id,
    p_season_id,
    p_team_id,
    p_idol_rank,
    p_decree_text
  )
  RETURNING id INTO v_audit_id;

  RETURN v_audit_id;
END;
$$;

-- ── PostgREST RPC exposure ────────────────────────────────────────────────────
-- The RPC must be callable by `authenticated` users so the Election Night
-- orchestrator (running as the logged-in admin in dev, or as a service role in
-- production) can invoke it via supabase.rpc().  Anon callers are NOT granted
-- execute — incinerations must always be an authenticated, audited action.
REVOKE ALL ON FUNCTION public.incinerate_player(UUID, UUID, TEXT, INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.incinerate_player(UUID, UUID, TEXT, INTEGER, TEXT)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.incinerate_player IS
  'Atomically marks a player as incinerated and writes the audit row in one transaction. Returns incinerations.id.';
