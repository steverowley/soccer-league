// ── roadmap/api/bdSnapshot.ts ───────────────────────────────────────────────
// Fetches the bd (beads) issue snapshot that `scripts/build-bd-snapshot.mjs`
// generates from `.beads/issues.jsonl` at every dev/build run.
//
// WHY this layer exists:
//   1. The snapshot lives in `public/bd-snapshot.json`, served at the
//      site's BASE_URL root.  Centralising the fetch + Zod validation
//      here means the UI never deals with raw JSON or the absence of
//      the file (e.g. a fresh clone before `npm run dev` runs).
//   2. The shape is verified at runtime via Zod so a malformed snapshot
//      surfaces in one place rather than crashing the kanban render.
//   3. The dashboard is read-only against bd — there is no write path
//      from the browser back to bd.  Curated edits live in the
//      Supabase `roadmap_items` table instead.

import { z } from 'zod';

// ── Zod schema ─────────────────────────────────────────────────────────────
// Mirrors the `trim(row)` shape in `scripts/build-bd-snapshot.mjs`.
// Keep both ends synchronised — drift between the script's output and
// this schema is caught at runtime by the safeParse below.

/**
 * A single bd issue as serialised into the snapshot.  All optional fields
 * are explicitly nullable rather than absent so the JSON is stable across
 * issues that are missing one field or another.
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
});

const SnapshotSchema = z.object({
  generated_at: z.string(),
  issues: z.array(BdIssueSchema),
});

/** Validated single-issue shape consumed by the UI. */
export type BdIssue = z.infer<typeof BdIssueSchema>;

/** Validated full snapshot — issues plus the generation timestamp. */
export type BdSnapshot = z.infer<typeof SnapshotSchema>;

// ── Fetcher ────────────────────────────────────────────────────────────────

/**
 * Fetch and parse the bd snapshot.  Resolves to an empty array of issues
 * (plus a generated-at sentinel) when the file is missing or malformed,
 * so the board still renders cleanly.  All failure modes are logged via
 * `console.warn` so they are visible during development without
 * propagating as errors into the React tree.
 *
 * Cache policy: the snapshot is a build artefact that only changes on
 * deploy, so the browser's normal HTTP cache (under the BASE_URL) is the
 * right level of freshness.  We pass `cache: 'no-cache'` so the browser
 * revalidates on each load — important during local development where
 * the file may be regenerated between page reloads.
 *
 * @returns The validated snapshot or a safe empty fallback.
 */
export async function fetchBdSnapshot(): Promise<BdSnapshot> {
  // BASE_URL is `/` in dev, `/soccer-league/` on GitHub Pages.  Either
  // way, files in `public/` mount at that root.
  const url = `${import.meta.env.BASE_URL}bd-snapshot.json`;

  let response: Response;
  try {
    response = await fetch(url, { cache: 'no-cache' });
  } catch (err) {
    console.warn('[bd-snapshot] fetch failed:', (err as Error).message);
    return { generated_at: '', issues: [] };
  }

  if (!response.ok) {
    // 404 is expected on environments where the prebuild script hasn't
    // run yet (e.g. someone serving the static `dist/` from an old
    // build).  Quiet the noise to a warning, not an error.
    console.warn(`[bd-snapshot] HTTP ${response.status} for ${url}`);
    return { generated_at: '', issues: [] };
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch (err) {
    console.warn('[bd-snapshot] JSON parse failed:', (err as Error).message);
    return { generated_at: '', issues: [] };
  }

  const parsed = SnapshotSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn('[bd-snapshot] schema validation failed:', parsed.error.message);
    return { generated_at: '', issues: [] };
  }
  return parsed.data;
}
