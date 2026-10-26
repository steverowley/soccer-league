// ── scripts/lib/freeTierGuards.ts ────────────────────────────────────────────
// Pure decisions behind two db-maintenance modes (docs/mvp-free-tier.md):
//
//   replay-retention  keep the `replays` Storage bucket under its budget by
//                     deleting the OLDEST replay files first (decision 1).
//   size              fail the daily check when the database or Storage is
//                     near the free plan's limits (decision 7).
//
// Kept free of I/O so vitest can pin the rules; scripts/db-maintenance.ts does
// the fetching and deleting.

const MB = 1024 * 1024;

/** Storage budget for replay files: retention trims the bucket to this. */
export const REPLAY_BUDGET_BYTES = 800 * MB;

/** The daily size check fails above these (free plan: 500 MB DB, 1 GB Storage). */
export const DB_SIZE_LIMIT_BYTES = 350 * MB;
export const STORAGE_SIZE_LIMIT_BYTES = 800 * MB;

/** One stored object, as listed from `storage.objects`. */
export interface StoredReplay {
  name: string;
  bytes: number;
  /** ISO timestamp; oldest is deleted first. */
  createdAt: string;
  /**
   * False when no match row exists for this file any more (a deleted test
   * match, a wiped season).  Orphans are always deleted, whatever the budget.
   * Omitted means the match exists.
   */
  matchExists?: boolean;
}

/** What retention decided. */
export interface RetentionPlan {
  /** Names to delete: orphans first, then the oldest replays. */
  remove: string[];
  /** How many of `remove` are orphans (their match no longer exists). */
  orphans: number;
  totalBytes: number;
  /** Bytes left once `remove` is gone. */
  keptBytes: number;
}

/**
 * Pick the replays to delete: every orphan (its match no longer exists, so
 * nothing can ever show it), then the oldest so the rest fit in `budgetBytes`.
 *
 * Oldest by `createdAt` (ties broken by name, so the plan is deterministic).
 * Apart from orphans, nothing is deleted while the bucket is within budget.
 * viewing convenience, not the record: results, events and stats stay in the
 * database, and the viewer shows a static formation for a match with no file.
 *
 * @param objects      Every object in the bucket.
 * @param budgetBytes  Target total (default {@link REPLAY_BUDGET_BYTES}).
 */
export function planReplayRetention(
  objects: readonly StoredReplay[],
  budgetBytes = REPLAY_BUDGET_BYTES,
): RetentionPlan {
  const totalBytes = objects.reduce((sum, o) => sum + Math.max(0, o.bytes), 0);
  const oldestFirst = [...objects].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.name.localeCompare(b.name),
  );
  const remove: string[] = [];
  let kept = totalBytes;
  for (const o of oldestFirst) {
    if (o.matchExists !== false) continue;
    remove.push(o.name);
    kept -= Math.max(0, o.bytes);
  }
  const orphans = remove.length;
  for (const o of oldestFirst) {
    if (kept <= budgetBytes) break;
    if (o.matchExists === false) continue;
    remove.push(o.name);
    kept -= Math.max(0, o.bytes);
  }
  return { remove, orphans, totalBytes, keptBytes: kept };
}

/** Result of the daily size check. */
export interface SizeVerdict {
  ok: boolean;
  /** One line per breached limit (empty when ok). */
  problems: string[];
}

/** Format bytes as MB with one decimal. */
export function mb(bytes: number): string {
  return `${(bytes / MB).toFixed(1)} MB`;
}

/**
 * Compare measured sizes with the free-tier guard limits.
 *
 * @param dbBytes       `pg_database_size(current_database())`.
 * @param storageBytes  Sum of every Storage object's size (all buckets: the
 *                      free plan's 1 GB is per project, not per bucket).
 */
export function evaluateSizeGuard(
  dbBytes: number,
  storageBytes: number,
  limits = { db: DB_SIZE_LIMIT_BYTES, storage: STORAGE_SIZE_LIMIT_BYTES },
): SizeVerdict {
  const problems: string[] = [];
  if (dbBytes > limits.db) {
    problems.push(`database ${mb(dbBytes)} is over the ${mb(limits.db)} guard (free plan quota 500 MB)`);
  }
  if (storageBytes > limits.storage) {
    problems.push(`storage ${mb(storageBytes)} is over the ${mb(limits.storage)} guard (free plan 1 GB)`);
  }
  return { ok: problems.length === 0, problems };
}
