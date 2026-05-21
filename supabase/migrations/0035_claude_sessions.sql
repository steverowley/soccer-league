-- ── 0035_claude_sessions.sql ───────────────────────────────────────────────
-- Adds the `claude_sessions` table that lets the in-app /roadmap board
-- surface live Claude Code work as it happens.
--
-- WHY this exists:
--   Before this migration, the kanban board only knew about static bd
--   snapshots and curated Supabase roadmap_items.  When a Claude session
--   started in the cloud and worked on a branch, the user could see the
--   session in their dashboard but the roadmap board's "In Progress"
--   column stayed empty.  This table is the missing link — SessionStart
--   / Stop hooks (under `.claude/hooks/`) write rows here, and the
--   roadmap UI subscribes to Realtime changes so cards appear and
--   disappear in lockstep with live work.
--
-- ACCESS MODEL
-- ────────────
-- * Public read   — anyone can see active sessions.  On-brand for the
--                   "watch the experiment happen" framing.
-- * Service-role  — only the cloud SessionStart / Stop hooks (which run
--   write           with SUPABASE_SERVICE_ROLE_KEY) can insert / patch
--                   rows.  No anon or authenticated write path; the anon
--                   key is baked into the browser bundle and we don't
--                   want spammers populating the board.
--
-- COLUMN NOTES
-- ────────────
-- * session_id   — the `CLAUDE_CODE_SESSION_ID` env var emitted by the
--                  cloud runtime.  UNIQUE so the SessionStart hook can
--                  upsert idempotently if it fires twice (e.g. after a
--                  PreCompact reload).
-- * branch_name  — the git branch the session is working on.  Drives the
--                  card title fallback when no `title` is provided.
-- * title        — short label; defaults to a slugified branch name on
--                  the writer side.  Keep readable; truncate on render.
-- * pr_url       — populated once the session pushes and a draft PR
--                  exists.  Click-through from the board card.
-- * started_at   — wall-clock kick-off.  Used for relative-time chips.
-- * ended_at     — NULL while the session is active.  Sessions older
--                  than a few hours are treated as abandoned by the UI
--                  (filter clause), so we don't strictly need a cron
--                  cleanup — but it's still useful for the wins log.

-- ── Table ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.claude_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    TEXT NOT NULL UNIQUE,
  branch_name   TEXT,
  title         TEXT,
  pr_url        TEXT,
  container_id  TEXT,
  account_uuid  TEXT,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at      TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.claude_sessions IS
  'Live Claude Code session ledger powering the /roadmap "In Progress" lane. Service-role write, public read.';

-- Hot path: "show me active sessions".  Partial index on the active
-- subset keeps the dashboard query a single index seek even as the table
-- grows over months of session history.
CREATE INDEX IF NOT EXISTS claude_sessions_active_idx
  ON public.claude_sessions (started_at DESC)
  WHERE ended_at IS NULL;

-- Full-history index for the eventual wins-log / archive view.
CREATE INDEX IF NOT EXISTS claude_sessions_started_at_idx
  ON public.claude_sessions (started_at DESC);

-- ── updated_at trigger ────────────────────────────────────────────────────
-- Re-uses the generic `public.set_updated_at` function defined in
-- migration 0034.  Idempotent re-creation so this migration can be
-- applied to a fresh DB or one mid-evolution.

DROP TRIGGER IF EXISTS trg_claude_sessions_updated_at ON public.claude_sessions;
CREATE TRIGGER trg_claude_sessions_updated_at
  BEFORE UPDATE ON public.claude_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Row Level Security ────────────────────────────────────────────────────

ALTER TABLE public.claude_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "claude_sessions public read" ON public.claude_sessions;

CREATE POLICY "claude_sessions public read"
  ON public.claude_sessions
  FOR SELECT
  USING (true);

-- Note: no INSERT/UPDATE/DELETE policy.  RLS denies-by-default, so only
-- the service-role key (which bypasses RLS) can write.  The cloud
-- SessionStart / Stop hooks supply that key from the environment.

-- ── Realtime ──────────────────────────────────────────────────────────────
-- Add the table to the `supabase_realtime` publication so the roadmap
-- board's subscription receives INSERT / UPDATE events without an extra
-- migration.  Wrapped in DO so re-running this migration is idempotent
-- (ALTER PUBLICATION ADD TABLE errors if already a member).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'claude_sessions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.claude_sessions;
  END IF;
END
$$;
