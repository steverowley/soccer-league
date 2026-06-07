-- ── 0073_entity_writes_service_role_only.sql ─────────────────────────────────
-- Closes a P0 from the 2026-06-05 review (#525): the entire entity graph was
-- writable by ANY authenticated user.
--
-- THE HOLE
--   0002_entities.sql granted `FOR ALL USING (auth.role() = 'authenticated')`
--   write access on entities / entity_traits / entity_relationships, re-affirmed
--   verbatim (init-plan-wrapped) as entities_auth_write / entity_traits_auth_write
--   / entity_relationships_auth_write in 0058. The match worker and the LLM /
--   Architect layers READ this graph (referee strictness drives card behaviour,
--   relationships seed narrative), so any signed-in browser user could POST to
--   /rest/v1/entities (and the trait/relationship tables) and rewrite referee
--   strictness, fabricate relationships, or alter traits the simulation and
--   narrative layers consume — a shared-world integrity hole. This was never
--   caught by 0030's security pass, which dropped authenticated-write on the
--   sibling pipeline tables (narratives, focus_enacted, team_finances, …) but
--   not these three.
--
-- THE FIX
--   Drop the three `*_auth_write` policies. Writes are now service-role only:
--   the match worker and edge functions use the service-role key, which
--   BYPASSES RLS entirely, so seed scripts and worker writes keep functioning.
--   The only browser write that depended on these policies — the season-focus
--   enactment's `db.from('entities').insert(...)` (enactment.ts) — was moved
--   to a service-role Node job in #529, so locking these tables breaks no live
--   client path.
--
--   The public-read policies (entities_public_read / entity_traits_public_read /
--   entity_relationships_public_read from 0002) are left intact, so the entity
--   browser, Architect context, and referee selection keep reading. With RLS
--   enabled and no permissive write policy remaining, browser INSERT/UPDATE/
--   DELETE default-deny.
--
--   We also add explicit `*_service_write` policies. They are functionally
--   redundant (service role bypasses RLS), but they make the intended
--   write-access model greppable and mirror the existing
--   entity_persona_service_write / entity_snippets_service_write policies (0058)
--   rather than leaving these three tables relying on an implicit default-deny.

-- ── entities ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS entities_auth_write ON public.entities;

CREATE POLICY entities_service_write ON public.entities
  FOR ALL
  USING      ((SELECT auth.role()) = 'service_role'::text)
  WITH CHECK ((SELECT auth.role()) = 'service_role'::text);

-- ── entity_traits ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS entity_traits_auth_write ON public.entity_traits;

CREATE POLICY entity_traits_service_write ON public.entity_traits
  FOR ALL
  USING      ((SELECT auth.role()) = 'service_role'::text)
  WITH CHECK ((SELECT auth.role()) = 'service_role'::text);

-- ── entity_relationships ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS entity_relationships_auth_write ON public.entity_relationships;

CREATE POLICY entity_relationships_service_write ON public.entity_relationships
  FOR ALL
  USING      ((SELECT auth.role()) = 'service_role'::text)
  WITH CHECK ((SELECT auth.role()) = 'service_role'::text);

-- Verification (run after apply):
--   SELECT tablename, policyname, cmd, qual, with_check
--     FROM pg_policies
--    WHERE schemaname = 'public'
--      AND tablename IN ('entities', 'entity_traits', 'entity_relationships');
--   -- Expect exactly one SELECT policy (qual = 'true') and one ALL policy
--   -- (service_role) per table, and ZERO policy whose qual/with_check
--   -- references 'authenticated'.
