-- ── 0003_architect_lore.sql ──────────────────────────────────────────────────
-- WHY: Phase 5.1 — Architect lore DB hydration lifecycle.
--
-- The Cosmic Architect's cross-match lore was previously stored in
-- localStorage, which means every browser gets its own private universe —
-- unacceptable for a social experiment where all fans share one reality.
--
-- This table centralises lore so all users observe the same emergent
-- narrative. The data model uses a flexible (scope, key) → payload JSONB
-- pattern so the Architect can store arbitrary lore without schema churn.
--
-- SCOPE CONVENTIONS:
--   'global'            — ledger-wide state (match_ledger, current_season)
--   'player:{name}'     — per-player narrative arcs
--   'manager:{name}'    — per-manager fate threads
--   'rivalry:{key}'     — head-to-head team rivalry lore
--   'season:{id}'       — per-season story arcs
--   'relationship:{key}'— player-pair relationship details
--
-- LIFECYCLE (enforced by application code, not DB):
--   1. Pre-match: load all rows → reconstruct in-memory lore object.
--   2. During match: getContext() reads from memory only (synchronous).
--   3. Post-match: upsert changed rows fire-and-forget.
--   4. Match end: flush() awaits all pending writes.
--
-- See src/features/architect/logic/loreStore.ts for the TypeScript lifecycle.
-- ──────────────────────────────────────────────────────────────────────────────

-- ── Table ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS architect_lore (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Scope partitions lore into categories. The prefix before ':' identifies
  -- the category (global, player, manager, rivalry, season, relationship).
  -- The suffix after ':' identifies the specific entity/key within that
  -- category. 'global' has no suffix.
  scope       TEXT        NOT NULL,
  -- Key distinguishes multiple lore entries within the same scope.
  -- e.g. scope='player:Kael Vorn', key='arc' holds the player's narrative.
  key         TEXT        NOT NULL,
  -- Payload is arbitrary JSONB — shape varies by scope/key combination.
  -- The application layer (loreStore.ts) handles serialisation.
  payload     JSONB       NOT NULL DEFAULT '{}',
  -- Tracks when this lore entry was last modified, for debugging and
  -- conflict resolution.
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Each (scope, key) pair is unique — upserts replace existing entries.
  UNIQUE (scope, key)
);

-- ── Indexes ─────────────────────────────────────────────────────────────────

-- Pre-hydration queries filter by scope prefix (e.g. all 'player:%' rows).
-- A btree index on scope supports both exact match and prefix LIKE queries.
CREATE INDEX IF NOT EXISTS idx_architect_lore_scope
  ON architect_lore (scope);

-- ── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE architect_lore ENABLE ROW LEVEL SECURITY;

-- All users can read lore — the shared narrative is public.
CREATE POLICY architect_lore_select
  ON architect_lore FOR SELECT
  USING (true);

-- Authenticated users can write lore. Currently the match engine runs
-- client-side with the user's session, so any logged-in user's browser
-- can persist Architect state. When the engine moves server-side, tighten
-- this to service_role only.
CREATE POLICY architect_lore_insert
  ON architect_lore FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY architect_lore_update
  ON architect_lore FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
