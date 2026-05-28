-- ── 0061_match_positions.sql ─────────────────────────────────────────────────
-- Stores per-second player and ball position snapshots for the 2D pitch viewer.
--
-- WHY THIS TABLE EXISTS
-- ─────────────────────
-- The match simulation engine (gameEngine.js) runs a full 90-minute match
-- in a single batch (~100ms) and writes discrete narrative events to
-- match_events.  The 2D pitch viewer needs continuous positional data to
-- animate 22 player dots and a ball smoothly between events.
--
-- Rather than run a real-time physics simulation, we take a page from
-- Football Manager's own architecture: the match-worker computes player
-- positions at regular intervals (every 2 seconds of match time) DURING
-- the batch simulation and stores them here.  The browser fetches all
-- snapshots upfront and plays them back at 1× speed, interpolating between
-- 2-second ticks with CSS transitions.  The effect is indistinguishable
-- from a live physics sim for the viewer.
--
-- VOLUME ESTIMATE
-- ───────────────
-- 90 minutes × 30 snapshots/minute = 2 700 rows per match.
-- Each row stores a JSONB blob of 22 player positions + ball (~1.2 KB).
-- 2 700 × 1.2 KB ≈ 3.2 MB per match — acceptable for a typical season
-- (~500 matches = ~1.6 GB), and can be pruned after the season ends.
--
-- SCHEMA DECISION: JSONB vs WIDE TABLE
-- ──────────────────────────────────────
-- A wide table (one row per player per snapshot) would produce 22 × 2 700 =
-- 59 400 rows per match and require 59 400 Realtime events to stream.  JSONB
-- stores the whole snapshot in one row, one write, one Realtime payload.
-- The browser already receives the full array upfront, so per-player
-- granularity at the DB level adds no benefit.
--
-- ACCESS PATTERN
-- ─────────────
-- Write: match-worker inserts all rows in a single batch after simulation.
-- Read: browser fetches all rows for a match_id once (ORDER BY minute, second).
-- No per-row updates, no deletes during normal operation.

-- ── Table ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS match_positions (
  match_id  uuid        NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  -- Minute of match time (1–90).  Stoppage time snapshots use minute 90.
  minute    smallint    NOT NULL CHECK (minute BETWEEN 1 AND 120),
  -- Second within the minute (0–59).  Combined with minute gives a unique
  -- position in match time for every snapshot.
  second    smallint    NOT NULL CHECK (second BETWEEN 0 AND 59),
  -- All 22 player positions + ball position for this 2-second snapshot.
  -- Shape: { players: [{ id, x, y, hasBall }], ball: { x, y, ownerId } }
  -- x: 0–105 (pitch width in metres), y: 0–68 (pitch height in metres).
  -- hasBall: true for at most one player per snapshot.
  -- ownerId: null when the ball is loose (in-flight after a kick).
  snapshots jsonb       NOT NULL,
  PRIMARY KEY (match_id, minute, second)
);

COMMENT ON TABLE match_positions IS
  'Per-second player and ball position snapshots for the 2D pitch viewer. '
  'Batch-written by match-worker after simulation; read once by the browser.';

COMMENT ON COLUMN match_positions.snapshots IS
  'JSON shape: { players: [{ id: string, x: number, y: number, hasBall: boolean }], '
  'ball: { x: number, y: number, ownerId: string | null } }. '
  'x in [0, 105], y in [0, 68] (FIFA pitch dimensions in metres).';

-- ── Index ─────────────────────────────────────────────────────────────────────
-- The browser fetches all snapshots for a match ordered by (minute, second).
-- The primary key covers this query exactly — no additional index needed.
-- A standalone index on match_id alone would be redundant with the PK.

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Position data is public (same access policy as match_events — anyone can
-- watch a match, authenticated or not).  The service-role worker writes;
-- anon and authenticated roles read.

ALTER TABLE match_positions ENABLE ROW LEVEL SECURITY;

-- Public read: any user (including unauthenticated) can fetch position data.
CREATE POLICY "match_positions_public_read"
  ON match_positions
  FOR SELECT
  USING (true);

-- Service-role write: only the match-worker (running as service_role) can
-- insert position rows.  We do NOT grant INSERT to the authenticated role —
-- only the engine should produce this data.
-- (Service role bypasses RLS by default; this comment documents intent.)
