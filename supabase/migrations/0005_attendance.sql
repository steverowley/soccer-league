-- ── 0005_attendance.sql ──────────────────────────────────────────────────────
-- WHY: Phase 3 — Fan support boost + ticket sales.
--
-- Records how many fans were "present" (last_seen_at within 5 minutes of
-- kickoff) for each team in each match, and the ticket revenue generated.
-- The team_finances table (created in 0004_betting.sql) is updated in the
-- same transaction with cumulative ticket revenue.
--
-- The fan support boost itself is computed in application logic
-- (src/features/finance/logic/fanBoost.ts) and passed to the match engine
-- as a stat bonus. This table just records the attendance data.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS match_attendance (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Which match this attendance record belongs to.
  match_id        UUID        NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  -- Which team's fans are being counted. One row per team per match (2 rows
  -- per match total: home and away).
  team_id         TEXT        NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  -- Number of fans with favourite_team_id = this team AND last_seen_at
  -- within 5 minutes of kickoff. 0 if no fans are online.
  fan_count       INTEGER     NOT NULL DEFAULT 0,
  -- Ticket revenue generated: fan_count × ticket_price.
  -- ticket_price is a per-stadium constant (DEFAULT_TICKET_PRICE in
  -- logic/ticketPricing.ts, overridable via teams.meta in the future).
  ticket_revenue  INTEGER     NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One attendance row per team per match.
  UNIQUE (match_id, team_id)
);

-- Index for quick lookups by match (used when loading match detail page).
CREATE INDEX IF NOT EXISTS idx_match_attendance_match
  ON match_attendance (match_id);

-- ── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE match_attendance ENABLE ROW LEVEL SECURITY;

-- Anyone can read attendance data (displayed on match detail pages).
CREATE POLICY match_attendance_select ON match_attendance
  FOR SELECT USING (true);

-- Authenticated users can write attendance (the match engine records it
-- client-side for now; tighten to service_role when engine moves server-side).
CREATE POLICY match_attendance_insert ON match_attendance
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');
