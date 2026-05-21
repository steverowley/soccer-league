// ── roadmap/api/bdIssues.ts ─────────────────────────────────────────────────
// Supabase queries + Realtime subscription for the `bd_issues` table —
// the live mirror of bd (beads) issues that powers the /roadmap board's
// "mirrored · bd" cards.
//
// WHY this layer exists:
//   1. Replaces the old static `public/bd-snapshot.json` fetch with a
//      live Supabase read so closing / creating bd issues shows up on
//      the board within seconds of the bd-sync GitHub Action finishing
//      (no GitHub Pages rebuild required).
//   2. The roadmap board is READ-ONLY against bd state — there is no
//      write path here.  All writes happen via the `bd` CLI locally,
//      get committed into `.beads/issues.jsonl`, and flow into Supabase
//      via `scripts/sync-bd-to-supabase.mjs`.
//   3. Centralises the Zod boundary so a schema drift between Postgres
//      and the UI fails loud in one place (the `parseRows` helper)
//      rather than crashing the kanban render.

import { z } from 'zod';
import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload,
} from '@supabase/supabase-js';
import type { IslSupabaseClient } from '@shared/supabase/client';

// ── Zod schema ─────────────────────────────────────────────────────────────
// Mirrors the `bd_issues` row shape in `src/types/database.ts` and the
// trimmer in `scripts/sync-bd-to-supabase.mjs`.  Optional bd columns are
// modelled as explicit `null` rather than `undefined` because the sync
// job collapses missing values to NULL before insert.

/**
 * A single `bd_issues` row.  All timestamps come back as ISO-8601
 * strings; the UI converts with `Date` as needed.
 */
const BdIssueSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  notes: z.string().nullable(),
  status: z.string(),
  priority: z.number(),
  issue_type: z.string(),
  assignee: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  started_at: z.string().nullable(),
  closed_at: z.string().nullable(),
  close_reason: z.string().nullable(),
  synced_at: z.string(),
});

/** Validated row consumed by the roadmap board. */
export type BdIssue = z.infer<typeof BdIssueSchema>;

// ── Parsing helper ─────────────────────────────────────────────────────────

/**
 * Validate an array of raw rows.  Rows that fail Zod are dropped with a
 * `console.warn` so a single bad row never blanks the lane.  Same
 * pattern as `claudeSessions.ts`.
 *
 * @param rows - Raw `data` from a Supabase select / subscription.
 * @returns    The subset that parsed cleanly.
 */
function parseRows(rows: unknown[]): BdIssue[] {
  const out: BdIssue[] = [];
  for (const row of rows) {
    const parsed = BdIssueSchema.safeParse(row);
    if (parsed.success) {
      out.push(parsed.data);
    } else {
      console.warn('[bd-issues] row failed validation:', parsed.error.message);
    }
  }
  return out;
}

// ── List query ─────────────────────────────────────────────────────────────

/**
 * Fetch every bd issue currently mirrored into Supabase, ordered most-
 * recently-updated first so the board's column-internal tiebreak is
 * predictable.
 *
 * @param db - Injected Supabase client (real or test fake).
 * @returns  Validated rows.  Empty array on query error so the board
 *           never throws.
 */
export async function listBdIssues(db: IslSupabaseClient): Promise<BdIssue[]> {
  const { data, error } = await db
    .from('bd_issues')
    .select('*')
    .order('updated_at', { ascending: false });

  if (error) {
    console.warn('[bd-issues] list query failed:', error.message);
    return [];
  }
  return parseRows(data ?? []);
}

// ── Most-recent sync timestamp ─────────────────────────────────────────────

/**
 * Return the most-recent `synced_at` across all rows — drives the
 * legend strip's "synced · <ts>" chip so the user can see at a glance
 * how stale the mirror is.  Returns the empty string when the table is
 * empty or the query fails.
 *
 * @param db - Injected Supabase client.
 * @returns  ISO-8601 timestamp string, or '' on miss.
 */
export async function getBdSyncedAt(db: IslSupabaseClient): Promise<string> {
  const { data, error } = await db
    .from('bd_issues')
    .select('synced_at')
    .order('synced_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn('[bd-issues] synced_at lookup failed:', error.message);
    return '';
  }
  return data?.synced_at ?? '';
}

// ── Realtime subscription ──────────────────────────────────────────────────

/**
 * Subscribe to INSERT / UPDATE / DELETE events on `bd_issues`.  Invokes
 * the supplied callback on every change so the board can refetch (cheap
 * — the table tops out at a few hundred rows) and re-render.
 *
 * We deliberately do NOT maintain a local diff — re-running the SELECT
 * is simpler and the table is small enough that a full refetch per
 * change is negligible.
 *
 * @param db       - Injected Supabase client.
 * @param onChange - Called with the raw payload on every event.  The UI
 *                   ignores the payload and refetches via `listBdIssues`.
 * @returns        The Realtime channel handle.  Caller MUST invoke
 *                 `.unsubscribe()` on unmount to avoid leaked sockets.
 */
export function subscribeToBdIssues(
  db: IslSupabaseClient,
  onChange: (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => void,
): RealtimeChannel {
  return db
    .channel('bd_issues:board')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'bd_issues' },
      onChange,
    )
    .subscribe();
}
