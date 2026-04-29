-- ── 0013_match_events_lifecycle.sql ───────────────────────────────────────────
-- WHY: Package 9 — DB foundation for the playable-state roadmap.  Adds the
-- per-minute event log (`match_events`), extends `matches` with the simulation
-- lifecycle fields, and introduces a `season_config` knobs table that the
-- match-simulation worker (Package 10) and the live viewer (Package 11) read.
--
-- THE ARCHITECTURE THIS UNLOCKS
-- ──────────────────────────────
-- Server pre-simulates each match at its kickoff_at instant, writing every
-- generated event into `match_events` with a `minute` (0-120) and a
-- `subminute` (0-1) so events fired in the same simulated minute keep their
-- original ordering.  Clients subscribe to `match_events` via Supabase
-- Realtime and reveal each event when wall-clock elapsed-from-kickoff crosses
-- its `minute` boundary.  No streaming, no leader election, no clock-sync.
--
-- DESIGN NOTES
-- ────────────
--   • match_events has RLS with public read + service-role write.  Anyone can
--     watch any match, but only the worker (running with the service role
--     key) can insert events.  This matches the public-spectator model.
--   • `payload jsonb` instead of typed columns per event variant.  We have
--     ~13 event types today and that number grows; a wide table with NULL
--     columns for every non-applicable field would balloon the schema.
--     The TS layer (gameEngine.types.ts:MatchEvent) is the type source of
--     truth — Supabase only stores it as opaque JSON.
--   • matches.status gains `'cancelled'` so the worker / admin tooling can
--     mark a match dead without simulating it (e.g. team forfeits).
--   • matches.simulated_at distinguishes the *real-world* timestamp at which
--     simulation actually started from `scheduled_at` (the planned kickoff,
--     added in 0009).  Worker writes simulated_at when it picks a match up.
--   • season_config is keyed by `season_id text` (not a UUID FK) because the
--     `seasons` table is introduced later in Package 13; we want this knobs
--     table available before then.  A future migration will add the FK.
-- ──────────────────────────────────────────────────────────────────────────────


-- ── 1. match_events table ────────────────────────────────────────────────────
-- Row per simulated event (shot, goal, card, commentary, …).  Pre-populated
-- by the worker at kickoff and revealed client-side by elapsed-time logic.
--
-- minute     0–120 (90 regulation + up to 30 extra time / stoppage); the
--            engine itself caps at 120 in the gameEngine.smoke.test.ts
--            invariants, so the CHECK constraint mirrors the engine's contract.
-- subminute  Three decimal places of resolution within a single minute; lets
--            multiple events fired in the same simulated minute stay ordered
--            without timestamp collisions.  0.000 ≤ subminute < 1.000.
-- type       The event-type discriminant (e.g. 'shot', 'goal', 'card',
--            'kickoff', 'fulltime_whistle').  Free-form text rather than an
--            enum because new types are added regularly and an enum would
--            require a migration per type.
-- payload    All other event fields (player, defender, commentary, …) as
--            jsonb.  Shape is documented by gameEngine.types.ts:MatchEvent.

CREATE TABLE IF NOT EXISTS match_events (
  id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id    uuid          NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  minute      smallint      NOT NULL CHECK (minute >= 0 AND minute <= 120),
  subminute   numeric(4, 3) NOT NULL DEFAULT 0
                            CHECK (subminute >= 0 AND subminute < 1),
  type        text          NOT NULL,
  payload     jsonb         NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz   NOT NULL DEFAULT now()
);

COMMENT ON TABLE match_events IS
  'Per-minute simulated event log written by the match worker (Package 10) and consumed by the live viewer (Package 11).';

-- ── Index: ordered fetch by match ─────────────────────────────────────────────
-- The viewer fetches every event for a single match ordered by minute then
-- subminute.  Composite index lets PostgreSQL serve that read directly from
-- the index without a sort step.
CREATE INDEX IF NOT EXISTS idx_match_events_match_minute
  ON match_events (match_id, minute, subminute);


-- ── 2. matches lifecycle extensions ──────────────────────────────────────────
-- Two changes:
--   a) Add 'cancelled' to the existing status CHECK so admin tooling can
--      retire a match without simulating it.
--   b) Add simulated_at as the real-world timestamp the worker started
--      simulation (distinct from `played_at` which is finished-at).

-- ── 2a. status CHECK constraint widening ──────────────────────────────────────
-- Drop the old CHECK then re-add with the expanded set.  IF EXISTS guards
-- against re-runs.  PostgreSQL doesn't support ALTER CONSTRAINT directly, so
-- DROP + ADD is the canonical workaround for CHECK constraints.
ALTER TABLE matches
  DROP CONSTRAINT IF EXISTS matches_status_check;

ALTER TABLE matches
  ADD CONSTRAINT matches_status_check
    CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled'));

-- ── 2b. simulated_at column ───────────────────────────────────────────────────
-- NULL while a match has not yet been picked up by the worker.  Set when
-- worker transitions matches.status from 'scheduled' to 'in_progress'.
ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS simulated_at timestamptz;

COMMENT ON COLUMN matches.simulated_at IS
  'Real-world timestamp the worker started simulating this match. NULL until pick-up. Distinct from played_at (finished-at) and scheduled_at (planned kickoff).';

-- ── Index: worker pick-up query ───────────────────────────────────────────────
-- The worker polls "scheduled matches whose kickoff is now or in the past"
-- every 30s.  Partial index on status='scheduled' keeps it tiny — once a
-- match transitions out of 'scheduled' the row leaves this index entirely.
CREATE INDEX IF NOT EXISTS idx_matches_status_scheduled
  ON matches (status, scheduled_at)
  WHERE status = 'scheduled';


-- ── 3. season_config table ───────────────────────────────────────────────────
-- One row per season.  Holds the cadence/duration/min-bet knobs the worker
-- and the live viewer need.  Not FK'd to a `seasons` table (that arrives in
-- Package 13); season_id is a free-form text identifier matching the IDs
-- already in use in the competitions/fixtures schema.
--
--   match_cadence_minutes    Real-world minutes between consecutive kickoffs
--                            within the season.  1440 = one match per day.
--                            Test seasons may use 5 (one match every 5 min)
--                            for fast end-to-end testing.
--   match_duration_seconds   How long a single match takes to PLAY in real
--                            time (i.e. how fast the viewer reveals the
--                            90 simulated minutes).  600 = 10 minutes real
--                            for 90 game minutes; ~6.7 real seconds per
--                            game minute.
--   min_bet                  Minimum credits per wager.  Currently mirrored
--                            by the MIN_BET constant in features/auth; this
--                            row makes it season-configurable without a
--                            code deploy.

CREATE TABLE IF NOT EXISTS season_config (
  season_id              text        PRIMARY KEY,
  match_cadence_minutes  integer     NOT NULL DEFAULT 1440
                                     CHECK (match_cadence_minutes > 0),
  match_duration_seconds integer     NOT NULL DEFAULT 600
                                     CHECK (match_duration_seconds > 0),
  min_bet                integer     NOT NULL DEFAULT 10
                                     CHECK (min_bet > 0),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE season_config IS
  'Per-season cadence/duration/min-bet knobs read by the match worker and live viewer. Not FK''d to seasons; that comes in Package 13.';

-- Seed a row for season 1 with sensible production-leaning defaults.
-- Tests will INSERT/UPDATE their own row to override (e.g. cadence=5).
INSERT INTO season_config (season_id, match_cadence_minutes, match_duration_seconds, min_bet)
  VALUES ('00000000-0000-0000-0000-000000000001', 1440, 600, 10)
  ON CONFLICT (season_id) DO NOTHING;


-- ── 4. Row-Level Security ────────────────────────────────────────────────────
-- match_events: public can SELECT (everyone can watch any match in progress
-- or completed), only service role can INSERT/UPDATE/DELETE (the worker is
-- the sole writer).  Same model as competitions / fixtures.
ALTER TABLE match_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read match_events"
  ON match_events FOR SELECT
  USING (true);

-- (No INSERT/UPDATE/DELETE policies → only service-role writes succeed)

-- season_config: public read so the betting UI can show min_bet without a
-- separate auth flow.  Service role only for writes.
ALTER TABLE season_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read season_config"
  ON season_config FOR SELECT
  USING (true);


-- ── 5. Realtime publication ──────────────────────────────────────────────────
-- The live viewer subscribes via Supabase Realtime's postgres_changes channel
-- so new event rows land on every connected client within ~100ms of the
-- worker's INSERT.  Adding the table to supabase_realtime is what enables
-- that broadcast.  Idempotent — if the table is already in the publication
-- the ALTER is a no-op.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'match_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE match_events;
  END IF;
END $$;
