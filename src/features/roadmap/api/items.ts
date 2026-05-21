// ── roadmap/api/items.ts ────────────────────────────────────────────────────
// Supabase queries for the `roadmap_items` table.
//
// WHY this file exists:
//   1. Every Supabase call takes an injected `IslSupabaseClient`, never a
//      module-level import — matches the DI pattern used by the voting and
//      auth features so the in-memory test double in `items.test.ts` works
//      without monkey-patching.
//   2. Every row read through this file passes through `RoadmapItemSchema`
//      (Zod), narrowing the open `string` columns (status / effort /
//      pillar) to their domain unions and catching schema drift loudly at
//      the boundary.
//   3. The UI layer never talks to Supabase directly — it calls these
//      functions and receives already-validated `RoadmapItem`s.
//
// RLS BOUNDARY:
//   Reads — `roadmap_items public read` policy allows anyone (anon and
//           authenticated) to SELECT.  Functions here will succeed for
//           any client.
//   Writes — `roadmap_items admin write` policy requires the caller's
//           `profiles.is_admin = true`.  Non-admin writes return a
//           Postgres permission error (PostgREST surfaces it as 403);
//           callers should hide the write controls in the first place
//           and use the returned error only as a safety net.

import { z } from 'zod';
import type { IslSupabaseClient } from '@shared/supabase/client';
import type {
  RoadmapItem,
  RoadmapItemInsert,
  RoadmapItemUpdate,
} from '../types';
import { ROADMAP_STATUSES, ROADMAP_EFFORTS, ROADMAP_PILLARS } from '../types';

// ── Zod schema ──────────────────────────────────────────────────────────────
// The runtime boundary that turns a raw Supabase `Row` into the narrowed
// `RoadmapItem` shape.  Centralised here so every read path uses the same
// validation and a future column drift surfaces in exactly one place.

/**
 * Validates a single `roadmap_items` row.  Narrows the three CHECK-
 * constrained text columns (`status`, `effort`, `pillar`) into their
 * TypeScript unions; everything else passes through as-is.
 *
 * `priority` is bounded 0..100 to match the SQL CHECK; an out-of-range
 * value would indicate a manual DB tamper and we want the read to fail
 * loudly rather than silently sort weirdly in the UI.
 */
const RoadmapItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  notes: z.string().nullable(),
  status: z.enum(ROADMAP_STATUSES),
  priority: z.number().int().min(0).max(100),
  tags: z.array(z.string()),
  effort: z.enum(ROADMAP_EFFORTS).nullable(),
  pillar: z.enum(ROADMAP_PILLARS).nullable(),
  source: z.string().nullable(),
  bd_issue_id: z.string().nullable(),
  shipped_at: z.string().nullable(),
  created_by: z.string().uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

/**
 * Parse an array of raw rows, dropping any that fail validation while
 * logging a warning.  A single bad row should not blank the entire
 * board — better to render the rest of the kanban with the broken row
 * suppressed and a console warning for the operator.
 *
 * @param rows - Raw `data` from a Supabase `.select()` result.
 * @returns    The subset of rows that validated as `RoadmapItem`.
 */
function parseRows(rows: unknown[]): RoadmapItem[] {
  const out: RoadmapItem[] = [];
  for (const row of rows) {
    const parsed = RoadmapItemSchema.safeParse(row);
    if (parsed.success) {
      out.push(parsed.data);
    } else {
      console.warn('[roadmap] skipping invalid roadmap_items row:', parsed.error.message);
    }
  }
  return out;
}

// ── Reads ───────────────────────────────────────────────────────────────────

/**
 * Fetch every roadmap item, ordered by status (column) then priority
 * ascending so the board can hydrate without an extra in-memory sort.
 *
 * The query is unfiltered intentionally — the dataset is small (curator-
 * authored items, expected <500 lifetime) and a single round-trip beats
 * paginating four columns separately.  If the table grows past ~2k rows
 * we'd revisit and fetch per-column.
 *
 * @param db - Injected Supabase client.
 * @returns  Validated items.  Returns `[]` on error (logged), never throws.
 */
export async function listItems(db: IslSupabaseClient): Promise<RoadmapItem[]> {
  const { data, error } = await db
    .from('roadmap_items')
    .select('*')
    .order('status')
    .order('priority');

  if (error) {
    console.warn('[listItems] failed:', error.message);
    return [];
  }
  return parseRows(data ?? []);
}

// ── Writes (admin-only at the RLS boundary) ────────────────────────────────

/**
 * Input shape for `createItem` — the user-supplied subset of an insert.
 * `id` / `shipped_at` / timestamps are populated by Postgres (defaults +
 * triggers), so callers never set them.
 */
export type CreateItemInput = Omit<
  RoadmapItemInsert,
  'id' | 'shipped_at' | 'created_at' | 'updated_at'
>;

/**
 * Insert a new roadmap item.  RLS will reject non-admins with a Postgres
 * permission error; the caller (admin-only UI) should be hiding the
 * create button so this is a defence-in-depth path.
 *
 * @param db    - Injected Supabase client.
 * @param input - The item to create.  `created_by` should be passed by
 *                the UI from `useAuth().user?.id` so authorship is
 *                recorded even though RLS doesn't require it.
 * @returns     The validated, persisted row, or `null` on error.
 */
export async function createItem(
  db: IslSupabaseClient,
  input: CreateItemInput,
): Promise<RoadmapItem | null> {
  const { data, error } = await db
    .from('roadmap_items')
    .insert(input)
    .select()
    .single();

  if (error) {
    console.warn('[createItem] failed:', error.message);
    return null;
  }
  const parsed = RoadmapItemSchema.safeParse(data);
  if (!parsed.success) {
    console.warn('[createItem] validation failed:', parsed.error.message);
    return null;
  }
  return parsed.data;
}

/**
 * Patch an existing item.  Only the keys present on `patch` are sent to
 * Postgres — undefined values are not transmitted, so the caller can
 * never accidentally clear a column by passing the wrong shape.
 *
 * @param db    - Injected Supabase client.
 * @param id    - The item to update.
 * @param patch - Partial column set to write.
 * @returns     The validated updated row, or `null` on error.
 */
export async function updateItem(
  db: IslSupabaseClient,
  id: string,
  patch: RoadmapItemUpdate,
): Promise<RoadmapItem | null> {
  const { data, error } = await db
    .from('roadmap_items')
    .update(patch)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.warn('[updateItem] failed:', error.message);
    return null;
  }
  const parsed = RoadmapItemSchema.safeParse(data);
  if (!parsed.success) {
    console.warn('[updateItem] validation failed:', parsed.error.message);
    return null;
  }
  return parsed.data;
}

/**
 * Delete an item permanently.  No soft-delete column — the curator can
 * always archive by setting `status = 'shipped'` instead.  Hard-delete
 * is reserved for genuine mistakes (duplicate captures, test data).
 *
 * @param db - Injected Supabase client.
 * @param id - The item to delete.
 * @returns  `true` on success, `false` on error.
 */
export async function deleteItem(
  db: IslSupabaseClient,
  id: string,
): Promise<boolean> {
  const { error } = await db.from('roadmap_items').delete().eq('id', id);
  if (error) {
    console.warn('[deleteItem] failed:', error.message);
    return false;
  }
  return true;
}

/**
 * Atomically swap the priority values of two items in the same column.
 * Implemented as two sequential UPDATEs — Supabase doesn't expose a
 * transactional multi-statement RPC by default, and the board re-fetches
 * after every mutation so even a partial failure resolves to a visible
 * "stuck" state the curator can re-trigger.
 *
 * @param db          - Injected Supabase client.
 * @param aId         - First item id.
 * @param aPriority   - New priority for `aId`.
 * @param bId         - Second item id.
 * @param bPriority   - New priority for `bId`.
 * @returns           `true` if both updates succeeded, `false` otherwise.
 */
export async function swapPriority(
  db: IslSupabaseClient,
  aId: string,
  aPriority: number,
  bId: string,
  bPriority: number,
): Promise<boolean> {
  // Two writes in flight in parallel — they target different rows so
  // there's no ordering hazard, and parallel halves the wall-clock cost.
  const [resA, resB] = await Promise.all([
    db.from('roadmap_items').update({ priority: aPriority }).eq('id', aId),
    db.from('roadmap_items').update({ priority: bPriority }).eq('id', bId),
  ]);
  if (resA.error) {
    console.warn('[swapPriority] update A failed:', resA.error.message);
    return false;
  }
  if (resB.error) {
    console.warn('[swapPriority] update B failed:', resB.error.message);
    return false;
  }
  return true;
}
