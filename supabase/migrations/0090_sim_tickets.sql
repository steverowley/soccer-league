-- 0090_sim_tickets.sql
-- One-time tickets that authorise a single remote match simulation.
--
-- WHY: the match simulation no longer fits the Supabase edge CPU budget (about
-- 2 s per invocation; a full match takes about 5 s of CPU on the edge), so
-- every match was killed with HTTP 546 right after simulating. The CPU-heavy
-- simulation now runs in a Vercel Node function (api/simulate.mjs). The
-- match-worker keeps claiming, orchestration and persistence and awaits the
-- Vercel call, which is I/O and costs no edge CPU.
--
-- HOW THE TICKET WORKS: no shared secret is configured between Supabase and
-- Vercel, so the database itself vouches for each call.
--   1. The worker (service role) inserts a row here with the SHA-256 of a
--      fresh random token and the match id, and sends the ticket id, the
--      plain token and the match id to the Vercel function.
--   2. The function calls consume_sim_ticket(ticket id, token) over the REST
--      RPC endpoint with the public publishable key (role anon).
--   3. The function marks an unused ticket younger than five minutes whose
--      hash matches as used, atomically, and returns its match id; anything
--      else returns null. The function only simulates when the returned
--      match id equals the one in the request.
-- A ticket is therefore single use, short lived, and useless without the
-- plain token, which never touches the database. Anon and authenticated can
-- neither read nor write the table (RLS on, no policies, grants revoked); the
-- only anon path is the function below.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS public.sim_tickets (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id    uuid        NOT NULL,
  token_hash  text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  used_at     timestamptz
);

COMMENT ON TABLE public.sim_tickets IS
  'One-time tickets authorising a single remote match simulation (api/simulate on Vercel). Written by the match-worker (service role), consumed through consume_sim_ticket(). See migration 0090.';

-- Supports the stale-ticket sweep in consume_sim_ticket().
CREATE INDEX IF NOT EXISTS sim_tickets_created_at_idx ON public.sim_tickets (created_at);

ALTER TABLE public.sim_tickets ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies: only the service role (which bypasses RLS) and the
-- SECURITY DEFINER function below touch this table.
REVOKE ALL ON TABLE public.sim_tickets FROM PUBLIC;
REVOKE ALL ON TABLE public.sim_tickets FROM anon, authenticated;
GRANT ALL ON TABLE public.sim_tickets TO service_role;

CREATE OR REPLACE FUNCTION public.consume_sim_ticket(p_id uuid, p_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_match_id uuid;
BEGIN
  -- Cheap rejections first. Real tokens are 64 hex characters.
  IF p_id IS NULL OR p_token IS NULL OR length(p_token) < 32 OR length(p_token) > 256 THEN
    RETURN NULL;
  END IF;

  -- Atomic consume: concurrent calls with the same ticket serialise on the row
  -- lock, and the loser re-checks used_at IS NULL and matches nothing.
  UPDATE public.sim_tickets
     SET used_at = now()
   WHERE id = p_id
     AND used_at IS NULL
     AND created_at > now() - interval '5 minutes'
     AND token_hash = encode(pg_catalog.sha256(convert_to(p_token, 'UTF8')), 'hex')
  RETURNING match_id INTO v_match_id;

  -- Housekeeping: tickets are worthless after five minutes, keep a day for
  -- debugging and drop the rest so the table stays tiny.
  DELETE FROM public.sim_tickets WHERE created_at < now() - interval '1 day';

  RETURN v_match_id;
END;
$$;

COMMENT ON FUNCTION public.consume_sim_ticket(uuid, text) IS
  'Marks an unused sim ticket younger than 5 minutes as used when sha256(p_token) matches, and returns its match_id; otherwise returns null. Called by api/simulate on Vercel with the publishable key. See migration 0090.';

-- Supabase's default privileges grant EXECUTE on new functions to anon,
-- authenticated and service_role directly, so revoking from PUBLIC alone is
-- not enough: revoke from authenticated too, then grant only what is needed.
REVOKE ALL ON FUNCTION public.consume_sim_ticket(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_sim_ticket(uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_sim_ticket(uuid, text) TO anon, service_role;
