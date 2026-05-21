-- ── 0038_bd_issues.sql ─────────────────────────────────────────────────────
-- Adds `public.bd_issues` — a live mirror of the bd (beads) issue tracker
-- that powers the /roadmap board's "mirrored · bd" lane.
--
-- WHY this exists:
--   Until this migration, the kanban board read bd state from a static
--   `public/bd-snapshot.json` regenerated only at build time.  That meant
--   closing an issue or filing a new one didn't show up on the public
--   roadmap until the next deploy.  This table is the missing link — a
--   GitHub Action (`.github/workflows/bd-sync.yml`) reads `.beads/issues.jsonl`
--   on every push and upserts every row into this table, while the
--   roadmap UI subscribes to Realtime so cards re-render in place.
--
-- ACCESS MODEL
-- ────────────
-- * Public read   — anyone hitting /roadmap can SELECT.  On-brand for the
--                   "watch the experiment happen" framing.
-- * Service-role  — only the bd-sync GitHub Action (with the service-role
--   write           key from repo secrets) can write.  No anon or
--                   authenticated write path — the roadmap board is a
--                   read-only consumer of bd state.
--
-- COLUMN NOTES
-- ────────────
-- * id            — text PK matching bd's own issue id (e.g. 'isl-bqx').
-- * priority      — bd validates 0..4 (lower = more urgent).  We store
--                   the raw bd value; the kanban's 0..100 scale is
--                   computed in TS via `bdMapping.ts`.
-- * issue_type    — bd issue_type ('task' / 'feature' / 'bug' / 'epic' / ...);
--                   defaults to 'task' to mirror the snapshot trimmer.
-- * synced_at     — wall-clock when the row was last touched by the sync
--                   job.  Powers the legend strip's "synced · <ts>" chip
--                   (replaces the old build-time `generated_at`).
--
-- The other columns (status, assignee, started_at, closed_at, close_reason,
-- description, notes) are verbatim from bd's JSONL shape.

-- ── Table ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.bd_issues (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  description   TEXT,
  notes         TEXT,
  status        TEXT NOT NULL,
  priority      SMALLINT NOT NULL,
  issue_type    TEXT NOT NULL DEFAULT 'task',
  assignee      TEXT,
  created_at    TIMESTAMPTZ NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL,
  started_at    TIMESTAMPTZ,
  closed_at     TIMESTAMPTZ,
  close_reason  TEXT,
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.bd_issues IS
  'Live mirror of .beads/issues.jsonl powering the /roadmap kanban. Synced by the bd-sync GitHub Action. Service-role write, public read.';

-- Column-grouping query (board groups by status column).  Partial-free
-- because every column is interesting at some point.
CREATE INDEX IF NOT EXISTS bd_issues_status_idx
  ON public.bd_issues (status);

-- Tiebreak on the board is "most recently updated first" — index keeps
-- the order-by a single index scan once the table grows past a few
-- hundred issues.
CREATE INDEX IF NOT EXISTS bd_issues_updated_at_idx
  ON public.bd_issues (updated_at DESC);

-- ── Row Level Security ────────────────────────────────────────────────────

ALTER TABLE public.bd_issues ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bd_issues public read" ON public.bd_issues;

CREATE POLICY "bd_issues public read"
  ON public.bd_issues
  FOR SELECT
  USING (true);

-- Note: no INSERT/UPDATE/DELETE policy.  RLS denies-by-default, so only
-- the service-role key (which bypasses RLS) can write.  The bd-sync
-- workflow supplies that key from repository secrets.

-- ── Realtime ──────────────────────────────────────────────────────────────
-- Add the table to the `supabase_realtime` publication so the roadmap
-- board's subscription receives INSERT / UPDATE / DELETE events without
-- an extra migration.  Wrapped in DO so re-running is idempotent
-- (ALTER PUBLICATION ADD TABLE errors if the table is already a member).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'bd_issues'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.bd_issues;
  END IF;
END
$$;
