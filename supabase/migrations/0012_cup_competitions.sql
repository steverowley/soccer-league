-- ── 0012_cup_competitions.sql ─────────────────────────────────────────────────
-- WHY: Package 3 — Celestial Cup + Solar Shield single-elimination brackets.
-- The league structure (4 × round-robin) was seeded in migration 0009 but the
-- cup competitions described in CLAUDE.md were never created:
--   • Celestial Cup  — top 3 per league (12 teams) — ISL's Champions League
--   • Solar Shield   — 4th–6th per league (12 teams) — ISL's Europa League
--
-- DESIGN NOTES:
--   • Both cups use format='knockout' (pure single-elimination).
--     The existing ISL Champions Cup uses 'group_knockout'; we keep that intact.
--   • A new nullable `bracket` JSONB column is added to `competitions` to store
--     the full bracket draw once `seedCupCompetitions()` runs at season-end.
--     Null while the draw hasn't happened; populated by the TS cupSeeder.
--   • Well-known UUIDs in the 2000…-series (cup tier) for easy scripting:
--       20000000-0000-0000-0000-000000000002 = Celestial Cup S1
--       20000000-0000-0000-0000-000000000003 = Solar Shield S1
--   • Status starts 'upcoming' — the seeder sets it to 'active' when fixtures
--     are inserted.
-- ──────────────────────────────────────────────────────────────────────────────

-- ── 1. Add bracket storage column ────────────────────────────────────────────
-- Stores the full bracket JSON produced by drawSingleElim() so advanceCupRound()
-- can look up which match feeds which slot without recomputing the draw.
-- Nullable: NULL while the cup draw hasn't been seeded yet.
ALTER TABLE competitions
  ADD COLUMN IF NOT EXISTS bracket JSONB;

-- ── 1.5. Defensive seasons-row seed ──────────────────────────────────────────
-- Section 2 below inserts cup competitions whose season_id FK targets
-- `00000000-…001`.  Prior to this fix, that row was created out-of-band
-- (manual insert / seed.sql / admin_reset RPC) on the production DB, so
-- a fresh Supabase Preview branch — which replays migrations against an
-- empty schema — would fail at this point with:
--
--   ERROR: insert or update on table "competitions" violates foreign key
--   constraint "competitions_season_id_fkey" (SQLSTATE 23503)
--   Key (season_id)=(00000000-0000-0000-0000-000000000001) is not present
--   in table "seasons".
--
-- IDEMPOTENT — `ON CONFLICT (id) DO NOTHING` keeps production unchanged
-- (the row already exists with this id and `is_active=true`) while
-- creating it on any fresh database.  is_active=true respects the
-- `seasons_one_active` partial unique index because no other migration
-- inserts a seasons row.
INSERT INTO seasons (id, name, year, is_active, start_date, end_date) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Season 1 — 2600', 2600, true,
   DATE '2600-01-01', DATE '2600-12-31')
ON CONFLICT (id) DO NOTHING;

-- ── 2. Celestial Cup & Solar Shield competition rows ──────────────────────────
INSERT INTO competitions (id, season_id, league_id, name, type, format, status) VALUES

  -- Celestial Cup S1: top 3 per league = 12 qualifiers, single elimination
  -- 12 teams → bracket size 16 → 4 byes → 4+4+2+1 = 11 fixtures
  ('20000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000001', NULL,
   'Celestial Cup — Season 1',
   'cup', 'knockout', 'upcoming'),

  -- Solar Shield S1: 4th–6th per league = 12 qualifiers, single elimination
  -- Same bracket structure as Celestial Cup
  ('20000000-0000-0000-0000-000000000003',
   '00000000-0000-0000-0000-000000000001', NULL,
   'Solar Shield — Season 1',
   'cup', 'knockout', 'upcoming')

ON CONFLICT (id) DO NOTHING;

-- ── Indexes ───────────────────────────────────────────────────────────────────
-- Cup pages query competitions by season; this index covers both
-- "all cups in a season" and "single competition by id" lookups.
CREATE INDEX IF NOT EXISTS idx_competitions_season_type
  ON competitions (season_id, type);

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- competitions table already has RLS enabled (public SELECT from schema.sql).
-- No new policies needed — existing policies cover the new rows.
