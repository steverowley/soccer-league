-- ── 0008_architect_interventions.sql ────────────────────────────────────────
-- WHY: Phase 8 — Architect historic rewrite audit trail.
--
-- The Cosmic Architect is allowed to rewrite the past: change a match
-- result, alter a player's stat line, retcon a standings row. This is one
-- of the game's most distinctive mechanics — the universe itself is
-- unreliable. But unreliable ≠ untraceable. Every rewrite MUST leave an
-- audit breadcrumb so:
--   1. Players can look back and see "ah, that result was changed".
--   2. We can debug weird state by inspecting the intervention log.
--   3. The Architect's style of meddling becomes visible lore over time
--      (which teams it favours, which matches it tampers with, etc).
--
-- The audit row MUST be written in the same DB transaction as the target
-- mutation. The Edge Function + application code enforce that invariant;
-- this table is just the storage.
--
-- TABLE:
--   architect_interventions — append-only audit of every historic rewrite
--                             the Architect performs.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS architect_interventions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The table that was mutated. Stored as text rather than a regclass so
  -- we don't lose history if the underlying table is renamed or dropped.
  -- Examples: 'matches', 'match_player_stats', 'players', 'narratives'.
  target_table TEXT        NOT NULL,
  -- The primary key of the affected row. UUID because every target table
  -- we rewrite uses uuid PKs. If a future target uses a different PK type,
  -- store it in `meta` and leave this null.
  target_id    UUID,
  -- Which column was changed. Null when the mutation is a multi-column
  -- change and we want to store the full shape in old_value/new_value.
  field        TEXT,
  -- Snapshot of the previous value. JSONB so we can store any shape —
  -- numbers, strings, arrays, nested objects. Never null: if we can't
  -- read the previous value, that's a bug in the intervention path.
  old_value    JSONB       NOT NULL,
  -- Snapshot of the new value. Same rules as old_value.
  new_value    JSONB       NOT NULL,
  -- Human/Architect-readable explanation. This is the narrative hook —
  -- e.g. "The cosmos remembered the match differently after the Siege
  -- of Europa: Titan's Eye FC now wins 2-1 instead of drawing 1-1."
  reason       TEXT        NOT NULL,
  -- Optional metadata: the triggering narrative_id, the match being
  -- rewritten, the scope this rewrite belongs to, etc.
  meta         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  -- When the rewrite happened (server time, not in-game time).
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for the dev-only /architect-log page that lists the most recent
-- interventions, newest first.
CREATE INDEX IF NOT EXISTS idx_architect_interventions_created_at
  ON architect_interventions (created_at DESC);

-- Index for "show me everything that was done to this match" queries
-- (used by the MatchDetail page to render a "this result was rewritten"
-- banner and linkable audit timeline).
CREATE INDEX IF NOT EXISTS idx_architect_interventions_target
  ON architect_interventions (target_table, target_id);

-- ── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE architect_interventions ENABLE ROW LEVEL SECURITY;

-- The audit trail is public — part of the lore. Players should be able
-- to see the Architect's meddling. We don't want to normalise secrets.
CREATE POLICY architect_interventions_select ON architect_interventions
  FOR SELECT USING (true);

-- Only authenticated clients can write interventions. In practice, the
-- Edge Function runs with the service_role key so this is a belt-and-
-- braces check — we could restrict further once the Edge Function is
-- the only writer. For now authenticated is fine.
CREATE POLICY architect_interventions_insert ON architect_interventions
  FOR INSERT WITH CHECK (auth.role() = 'authenticated' OR auth.role() = 'service_role');
