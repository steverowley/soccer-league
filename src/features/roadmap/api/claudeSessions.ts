// ── roadmap/api/claudeSessions.ts ───────────────────────────────────────────
// Supabase queries + Realtime subscription for the `claude_sessions` table.
//
// WHY this layer exists:
//   The /roadmap board surfaces live Claude Code sessions in its "In
//   Progress" lane.  Sessions are written by the cloud SessionStart hook
//   (see `.claude/hooks/log-session-start.sh`); the dashboard is a
//   READ-ONLY consumer, so this module only fetches + subscribes — it
//   never inserts or patches.
//
// SHAPE PARSING:
//   Every row passes through the Zod schema below.  Rows that fail
//   validation are dropped with a console warning so a single bad row
//   never blanks the lane.  Same pattern as `items.ts`.
//
// "ACTIVE" SEMANTICS:
//   A session is considered active when `ended_at IS NULL` AND its
//   `started_at` is within the recent past (defaults to 4 hours).  The
//   floor is enforced client-side via a query filter so abandoned
//   sessions (container reclaimed before the Stop hook fired) don't
//   linger as ghost cards on the board.

import { z } from 'zod';
import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload,
} from '@supabase/supabase-js';
import type { IslSupabaseClient } from '@shared/supabase/client';

// ── Zod schema ─────────────────────────────────────────────────────────────
// Mirrors the `claude_sessions` row shape in `src/types/database.ts`.
// Nullables are explicit so a row missing an optional column doesn't
// fail validation.

/**
 * A single `claude_sessions` row.  `started_at` / `ended_at` come back
 * as ISO-8601 timestamp strings; the UI converts them with `Date` as
 * needed.
 */
const ClaudeSessionSchema = z.object({
  id: z.string().uuid(),
  session_id: z.string(),
  branch_name: z.string().nullable(),
  title: z.string().nullable(),
  pr_url: z.string().nullable(),
  container_id: z.string().nullable(),
  account_uuid: z.string().nullable(),
  started_at: z.string(),
  ended_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

/** Validated session row consumed by the roadmap board. */
export type ClaudeSession = z.infer<typeof ClaudeSessionSchema>;

// ── Tunables ───────────────────────────────────────────────────────────────

/**
 * Sessions older than this without an `ended_at` are treated as
 * abandoned (container was reclaimed before the Stop hook fired) and
 * filtered out of the active-sessions query.
 *
 * 4h is a conservative ceiling — Claude Code on the web tops out a
 * single conversation well below that, and bumping the floor here
 * doesn't affect server-side data, only UI display.
 */
export const ACTIVE_SESSION_MAX_AGE_HOURS = 4;

// ── Parsing helper ─────────────────────────────────────────────────────────

/**
 * Validate an array of raw rows.  Rows that fail Zod are dropped with a
 * `console.warn` so the rest of the lane still renders cleanly.
 *
 * @param rows - Raw `data` from a Supabase select / subscription.
 * @returns    The subset that parsed cleanly.
 */
function parseRows(rows: unknown[]): ClaudeSession[] {
  const out: ClaudeSession[] = [];
  for (const row of rows) {
    const parsed = ClaudeSessionSchema.safeParse(row);
    if (parsed.success) {
      out.push(parsed.data);
    } else {
      console.warn('[claude-sessions] row failed validation:', parsed.error.message);
    }
  }
  return out;
}

// ── Active-session query ───────────────────────────────────────────────────

/**
 * Fetch all currently-active Claude sessions, newest first.
 *
 * "Active" = `ended_at IS NULL` AND `started_at >= now() - 4h`.  The
 * 4-hour floor filters out ghost rows whose container was reclaimed
 * before the Stop hook could fire.
 *
 * @param db - Injected Supabase client (real or test fake).
 * @returns  Validated session rows.  Empty array on query error so the
 *           board never throws.
 */
export async function listActiveClaudeSessions(
  db: IslSupabaseClient,
): Promise<ClaudeSession[]> {
  const floorIso = new Date(
    Date.now() - ACTIVE_SESSION_MAX_AGE_HOURS * 60 * 60 * 1000,
  ).toISOString();

  const { data, error } = await db
    .from('claude_sessions')
    .select('*')
    .is('ended_at', null)
    .gte('started_at', floorIso)
    .order('started_at', { ascending: false });

  if (error) {
    console.warn('[claude-sessions] list query failed:', error.message);
    return [];
  }
  return parseRows(data ?? []);
}

// ── Realtime subscription ──────────────────────────────────────────────────

/**
 * Subscribe to INSERT / UPDATE / DELETE events on `claude_sessions`.
 * Invokes the supplied callback on every change so the board can refetch
 * (cheap — at most a handful of active rows) and re-render.
 *
 * We deliberately do NOT try to maintain a local diff:
 *   * "active" requires both an `ended_at IS NULL` check and the 4-hour
 *     floor — easier to re-run the SELECT than reimplement that filter
 *     in JS.
 *   * The table is small; a full refetch per change is negligible.
 *
 * @param db       - Injected Supabase client.
 * @param onChange - Called with the raw payload on every event.  The UI
 *                   ignores the payload and refetches via
 *                   `listActiveClaudeSessions`.
 * @returns        The Realtime channel handle.  Caller MUST invoke
 *                 `.unsubscribe()` on unmount to avoid leaked sockets.
 */
export function subscribeToClaudeSessions(
  db: IslSupabaseClient,
  onChange: (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => void,
): RealtimeChannel {
  return db
    .channel('claude_sessions:board')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'claude_sessions' },
      onChange,
    )
    .subscribe();
}
