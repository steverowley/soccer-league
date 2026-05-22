-- ── 0050_drop_bd_and_roadmap_tables.sql ────────────────────────────────────
-- Removes the beads-mirror plumbing (`bd_issues`, migration 0038) and the
-- never-populated roadmap items table (`roadmap_items`, migration 0034) as
-- part of replacing the bd workflow with GitHub Issues.
--
-- WHY DROP `roadmap_items` TOO: the table existed solely to back the
-- `/roadmap` page + QuickCaptureFAB pair, which never got real use
-- (0 rows in production at drop time).  Both UIs are removed in the same
-- PR so there is no consumer left to read or write the table.
--
-- CASCADE is intentional: no foreign keys reference these tables today,
-- but if a stray cross-link slipped in we'd rather drop it than block
-- the migration on a 30-second debug session.

DROP TABLE IF EXISTS public.bd_issues       CASCADE;
DROP TABLE IF EXISTS public.roadmap_items   CASCADE;
