-- 0088_match_sim_seed.sql
-- Engine v2 draws a fresh random simulation seed per match instead of deriving
-- it from the match id. The worker must reuse the same seed when it retries a
-- match after a crash, or a retry would simulate a different match and could
-- persist it on top of the first attempt's partial rows.
--
-- The worker reads sim_seed at claim time; when it is null it generates a seed
-- and stores it (UPDATE ... WHERE sim_seed IS NULL) before simulating, and a
-- retry reads the stored value back. Nullable: fixtures played before engine
-- v2, and scheduled fixtures not yet claimed, have no seed. Values are
-- unsigned 32-bit integers, hence bigint. Idempotent.

ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS sim_seed bigint;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matches_sim_seed_u32') THEN
    ALTER TABLE public.matches
      ADD CONSTRAINT matches_sim_seed_u32 CHECK (sim_seed IS NULL OR (sim_seed >= 0 AND sim_seed <= 4294967295));
  END IF;
END $$;

COMMENT ON COLUMN public.matches.sim_seed IS
  'Engine v2 simulation seed, stored before the match is simulated and reused on worker retries so a retry replays the same match.';
