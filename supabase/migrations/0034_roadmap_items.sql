-- ── 0034_roadmap_items.sql ─────────────────────────────────────────────────
-- Adds the `roadmap_items` table that backs the in-app /roadmap dashboard.
--
-- The dashboard exists because product/design ideas have been getting lost
-- across Notion, chat threads, and the `bd` issue tracker.  `bd` continues
-- to own engineering issues; `roadmap_items` sits one level up — capturing
-- raw ideas, prioritising them, and tracking them through to shipped.
-- A nullable `bd_issue_id` cross-links the two tracking layers without
-- coupling them.
--
-- ACCESS MODEL
-- ────────────
-- * Public read   — anyone (including anon) can see the roadmap.  This is
--                   on-brand: the social-experiment framing benefits from
--                   players being able to see what's planned.
-- * Admin write   — only profiles with `is_admin = true` (see migration
--                   0032) can insert / update / delete.  Same gate pattern
--                   used by the destructive RPCs, just expressed via RLS
--                   policies instead of a SECURITY DEFINER body.
--
-- COLUMN NOTES
-- ────────────
-- * status      — 4-stage kanban funnel.  Constrained via CHECK so the
--                 board UI can keep the column set static.
-- * priority    — small integer where LOWER = higher priority within a
--                 column.  Picked over a "p0/p1/p2" enum because in-column
--                 reordering needs a sortable continuous value; the UI
--                 derives display buckets (P0 = 0-24, P1 = 25-49, etc.).
-- * tags        — free-form text[] so the curator can invent categories
--                 without a migration.  Indexed below for filter-by-tag.
-- * effort      — XS/S/M/L; optional so an idea can be captured before
--                 it's been sized.
-- * pillar      — explicit tie-back to the four CLAUDE.md design pillars
--                 so the roadmap stays vision-aligned.
-- * source      — free-text provenance ("notion", "session-2026-05-21",
--                 "user-feedback", "architect-roulette").  Plain text on
--                 purpose; this is documentation, not a typed enum.
-- * bd_issue_id — optional cross-link to the engineering issue tracker.
-- * shipped_at  — set automatically by trigger when status flips to
--                 'shipped'; cleared if status moves back out of shipped.
--                 Powers a future "ships per month" wins log.

-- ── set_updated_at helper ──────────────────────────────────────────────────
-- Generic trigger function used by `roadmap_items` (and any future table
-- that wants automatic `updated_at` maintenance).  `CREATE OR REPLACE` is
-- idempotent so re-running this migration in a branch is safe.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.set_updated_at() IS
  'Trigger helper: stamps NEW.updated_at = now() on every UPDATE.';

-- ── Table ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.roadmap_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title        TEXT NOT NULL CHECK (length(btrim(title)) > 0),
  notes        TEXT,
  status       TEXT NOT NULL DEFAULT 'idea'
               CHECK (status IN ('idea','planned','in_progress','shipped')),
  priority     SMALLINT NOT NULL DEFAULT 50
               CHECK (priority >= 0 AND priority <= 100),
  tags         TEXT[] NOT NULL DEFAULT '{}',
  effort       TEXT CHECK (effort IS NULL OR effort IN ('xs','s','m','l')),
  pillar       TEXT CHECK (pillar IS NULL OR pillar IN
                  ('architect','fan-driven','emergent-narrative','modular')),
  source       TEXT,
  bd_issue_id  TEXT,
  shipped_at   TIMESTAMPTZ,
  created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.roadmap_items IS
  'Project-management dashboard items powering the /roadmap kanban board. Admin-write, public-read.';

CREATE INDEX IF NOT EXISTS roadmap_items_status_priority_idx
  ON public.roadmap_items (status, priority);

CREATE INDEX IF NOT EXISTS roadmap_items_tags_gin_idx
  ON public.roadmap_items USING GIN (tags);

-- ── updated_at + shipped_at triggers ──────────────────────────────────────

DROP TRIGGER IF EXISTS trg_roadmap_items_updated_at ON public.roadmap_items;
CREATE TRIGGER trg_roadmap_items_updated_at
  BEFORE UPDATE ON public.roadmap_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- shipped_at maintenance: auto-stamp when status enters 'shipped',
-- clear when it leaves.  Keeps the wins-log query trivial.
CREATE OR REPLACE FUNCTION public.set_roadmap_shipped_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'shipped' AND (OLD.status IS DISTINCT FROM 'shipped' OR NEW.shipped_at IS NULL) THEN
    NEW.shipped_at = now();
  ELSIF NEW.status <> 'shipped' AND OLD.status = 'shipped' THEN
    NEW.shipped_at = NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_roadmap_items_shipped_at ON public.roadmap_items;
CREATE TRIGGER trg_roadmap_items_shipped_at
  BEFORE UPDATE ON public.roadmap_items
  FOR EACH ROW EXECUTE FUNCTION public.set_roadmap_shipped_at();

-- On INSERT with status = 'shipped', stamp shipped_at too.  Separate
-- trigger because BEFORE-UPDATE doesn't fire for INSERTs.
CREATE OR REPLACE FUNCTION public.set_roadmap_shipped_at_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'shipped' AND NEW.shipped_at IS NULL THEN
    NEW.shipped_at = now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_roadmap_items_shipped_at_insert ON public.roadmap_items;
CREATE TRIGGER trg_roadmap_items_shipped_at_insert
  BEFORE INSERT ON public.roadmap_items
  FOR EACH ROW EXECUTE FUNCTION public.set_roadmap_shipped_at_on_insert();

-- ── Row Level Security ────────────────────────────────────────────────────

ALTER TABLE public.roadmap_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "roadmap_items public read"  ON public.roadmap_items;
DROP POLICY IF EXISTS "roadmap_items admin write"  ON public.roadmap_items;

CREATE POLICY "roadmap_items public read"
  ON public.roadmap_items
  FOR SELECT
  USING (true);

-- One blanket admin-only policy for INSERT/UPDATE/DELETE.  The `FOR ALL`
-- form also covers SELECT but that's harmless because the public-read
-- policy is permissive.  Using EXISTS against profiles keeps the check
-- a single PK lookup per row evaluation.
CREATE POLICY "roadmap_items admin write"
  ON public.roadmap_items
  FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE  p.id = auth.uid()
      AND  p.is_admin = true
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE  p.id = auth.uid()
      AND  p.is_admin = true
  ));
