-- ── 0084_compact_match_positions.sql ────────────────────────────────────────
-- Shrinks the stored replay-frame format by ~86% and gives the roster its own
-- table so the 22 player UUIDs stop being repeated in every frame.
--
-- WHY THIS CHANGE EXISTS
-- ─────────────────────
-- Migration 0061 created `match_positions` with one JSONB frame every 2 seconds
-- of match time and the note that the data "can be pruned after the season
-- ends".  No pruning existed, so Season 1's 233 played fixtures grew the table
-- to 2.1 GB, blew the 500 MB Free-plan disk quota, and Supabase restricted the
-- project: every API call (auth included) started returning HTTP 402 and the
-- game went dark.  `scripts/db-maintenance.ts` now prunes, and the table has
-- been truncated, but pruning alone only buys time: the format itself is the
-- problem, so the format is what this migration fixes.
--
-- WHERE THE BYTES WENT (measured, not estimated)
-- ──────────────────────────────────────────────
-- The v1 shape was:
--   { players: [{ id: uuid, x, y, hasBall }], ball: { x, y, ownerId } }
-- Per frame that is 22 x 36-char UUIDs plus the JSON keys wrapping them, and
-- the same 22 UUIDs appear again in the next frame 2 seconds later, 2 731 times
-- per match.  `hasBall` is pure redundancy: it is already derivable from
-- `ball.ownerId`.  Running the real engine locally and serialising both shapes
-- measured 4.81 MB/match for v1 against 0.67 MB/match for the compact shape,
-- an 86% reduction.  At 500 matches/season that is 2.4 GB against 335 MB.
--
-- THE COMPACT SHAPE (version 2)
-- ─────────────────────────────
--   { "v": 2, "p": [x0,y0,x1,y1,...], "b": [bx,by,ownerIdx] }
-- `p` is a flat array of 2N coordinates in roster order, so a player's identity
-- is its index, resolved once per match through `match_position_rosters`.
-- `b` carries the ball's x/y plus the roster index of its carrier, or -1 when
-- the ball is loose.  `hasBall` is derived on read as (index === ownerIdx).
--
-- WHY ROUNDING TO 0.1 m IS FREE
-- ─────────────────────────────
-- The pitch is 105 x 68 m and renders a few hundred CSS pixels wide, so 0.1 m
-- is well under a single rendered pixel, and the viewer interpolates between
-- 2-second frames with CSS transitions anyway.  Dropping the long decimal tails
-- that a float physics step produces is most of the remaining win.
--
-- NO BACKFILL NEEDED
-- ──────────────────
-- `match_positions` is empty right now (the disk-recovery truncate), so there
-- is nothing to migrate: the next simulated match writes v2 directly.  The
-- reader still understands v1 rows, which keeps a restored-from-backup row or a
-- stale deploy from breaking the viewer, and the `v` field makes the two shapes
-- unambiguous.
--
-- ACCESS PATTERN
-- ─────────────
-- Write: match-worker upserts one roster row per match, then batch-inserts the
-- frames (same batch size as events).
-- Read: browser fetches the roster once, then pages the frames and decodes them
-- back into the exact in-memory shape it consumed before.

-- ── Roster table ─────────────────────────────────────────────────────────────
-- One row per match holding the ordered player ids the frames index into.
-- The order is the engine's frame order (home XI GK-first, then away XI), which
-- is stable for the whole match: the spatial engine has no substitutions, and a
-- frame's player array is built from the same slot list every tick.

CREATE TABLE IF NOT EXISTS match_position_rosters (
  match_id   uuid  PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,
  -- Ordered JSON array of player-id strings, e.g. ["uuid-a", "uuid-b", ...].
  -- Index i in this array addresses coordinates (p[2i], p[2i+1]) in every
  -- frame of this match, and ownerIdx in `b` is an index into it as well.
  player_ids jsonb NOT NULL
);

COMMENT ON TABLE match_position_rosters IS
  'Ordered player-id roster for a match''s replay frames, stored once per match '
  'so match_positions.snapshots can address players by index instead of '
  'repeating 22 UUIDs in every 2-second frame (migration 0084).';

COMMENT ON COLUMN match_position_rosters.player_ids IS
  'JSON array of player-id strings in frame order. Index i maps to the '
  'coordinate pair (p[2i], p[2i+1]) in match_positions.snapshots.';

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Same policy as match_positions: the roster is useless on its own and the
-- frames it decodes are already public, so anyone watching a match can read it.
-- Writes stay with the service-role worker; no INSERT grant to authenticated.

ALTER TABLE match_position_rosters ENABLE ROW LEVEL SECURITY;

-- Public read: any user (including unauthenticated) can fetch the roster.
CREATE POLICY "match_position_rosters_public_read"
  ON match_position_rosters
  FOR SELECT
  USING (true);

-- Service-role write: only the match-worker (running as service_role) writes
-- roster rows, exactly as for match_positions.  We do NOT grant INSERT to the
-- authenticated role.
-- (Service role bypasses RLS by default; this comment documents intent.)

-- ── Document the new frame shape ─────────────────────────────────────────────
-- The 0061 comment still described the v1 shape, which would mislead anyone
-- reading the schema from the database rather than from this file.

COMMENT ON COLUMN match_positions.snapshots IS
  'Compact replay frame, version 2: { v: 2, p: [x0, y0, x1, y1, ...], '
  'b: [ballX, ballY, ownerIdx] }. `p` holds 2N coordinates in the order given '
  'by match_position_rosters.player_ids; `b` holds the ball position plus the '
  'roster index of its carrier, or -1 when the ball is loose. Coordinates are '
  'metres rounded to 0.1: x in [0, 105], y in [0, 68] (FIFA pitch dimensions). '
  'hasBall is NOT stored: it is derived on read as (roster index = ownerIdx). '
  'Legacy v1 rows (no `v` field) use { players: [{ id, x, y, hasBall }], '
  'ball: { x, y, ownerId } } and are still decodable by the reader.';
