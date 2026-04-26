// ── architect/logic/loreStore.ts ─────────────────────────────────────────────
// WHY: The Cosmic Architect's lore lives in the DB (`architect_lore` table)
// so every browser session shares the same cross-match narrative.  LoreStore
// is the bridge between that table and the in-memory ArchitectLore object
// used by CosmicArchitect — it keeps the in-match read path synchronous
// while moving all DB I/O to match boundaries.
//
// LIFECYCLE:
//   1. Pre-match:  `await loreStore.hydrate()` loads all DB rows into an
//      in-memory ArchitectLore object.  See prepareArchitect.ts for the
//      canonical wiring of this step into the match-start flow.
//   2. During match: `getContext()` reads `this.lore` synchronously — no DB.
//   3. Post-match:  `loreStore.persistAll(lore)` converts the lore object to
//      DB rows and batch-upserts them.  Fire-and-forget individual writes are
//      available via `enqueueWrite()` for future in-match narrative events.
//   4. Match end:   `await loreStore.flush()` awaits all pending promises.

import type { IslSupabaseClient } from '@shared/supabase/client';
import type {
  ArchitectLore,
  ArchitectLoreRow,
  MatchLedgerEntry,
  ManagerFate,
  PlayerArc,
  PlayerRelationship,
  RivalryThread,
  SeasonArc,
} from '../types';
import { loadAllLore, batchUpsertLore, upsertLoreRow } from '../api/lore';

// ── Constants ───────────────────────────────────────────────────────────────

/**
 * Current lore schema version. Mirrors the version field on every emptyLore()
 * scaffold returned by this module.  Bump only when the in-memory shape
 * changes in a backwards-incompatible way; callers may then need a migration
 * pass at hydrate() time.
 */
const LORE_VERSION = 2;

/**
 * Maximum match ledger entries.  Oldest are dropped when exceeded.
 * Matches CosmicArchitect.MAX_LEDGER so prompt context stays bounded as the
 * ledger grows over a season.
 */
export const MAX_LEDGER = 50;

// ── Empty lore scaffold ────────────────────────────────────────────────────

/**
 * Returns a fresh empty lore object with all fields initialised. Mirrors
 * CosmicArchitect._emptyLore() exactly so downstream code can safely
 * access any field without null-checks.
 */
export function emptyLore(): ArchitectLore {
  return {
    version: LORE_VERSION,
    playerArcs: {},
    managerFates: {},
    rivalryThreads: {},
    seasonArcs: {},
    matchLedger: [],
    currentSeason: null,
    playerRelationships: {},
  };
}

// ── Conversion: DB rows → in-memory lore ────────────────────────────────────

/**
 * Reconstruct a full ArchitectLore object from an array of DB rows.
 * Each row's (scope, key) pair maps to a specific field in the lore object.
 *
 * Unknown scope prefixes are silently ignored — this makes the system
 * forward-compatible with future lore categories without breaking existing
 * code.
 *
 * @param rows  Array of ArchitectLoreRow from the architect_lore table.
 * @returns     Fully populated ArchitectLore object.
 */
export function rowsToLore(rows: ArchitectLoreRow[]): ArchitectLore {
  const lore = emptyLore();

  for (const row of rows) {
    const { scope, key, payload } = row;

    // ── Global scope: match_ledger, current_season ────────────────────────
    if (scope === 'global') {
      if (key === 'match_ledger') {
        lore.matchLedger = (payload as { entries: MatchLedgerEntry[] }).entries ?? [];
      } else if (key === 'current_season') {
        lore.currentSeason = (payload as { value: string | null }).value ?? null;
      }
      continue;
    }

    // ── Scoped entries: extract prefix and suffix ─────────────────────────
    const colonIdx = scope.indexOf(':');
    if (colonIdx === -1) continue; // Unknown format, skip.

    const prefix = scope.slice(0, colonIdx);
    const suffix = scope.slice(colonIdx + 1);

    switch (prefix) {
      case 'player':
        if (key === 'arc') {
          lore.playerArcs[suffix] = payload as unknown as PlayerArc;
        }
        break;

      case 'manager':
        if (key === 'fate') {
          lore.managerFates[suffix] = payload as unknown as ManagerFate;
        }
        break;

      case 'rivalry':
        if (key === 'thread') {
          lore.rivalryThreads[suffix] = payload as unknown as RivalryThread;
        }
        break;

      case 'season':
        if (key === 'arc') {
          lore.seasonArcs[suffix] = payload as unknown as SeasonArc;
        }
        break;

      case 'relationship':
        if (key === 'details') {
          lore.playerRelationships[suffix] = payload as unknown as PlayerRelationship;
        }
        break;

      // Unknown prefix — silently skip for forward compatibility.
    }
  }

  return lore;
}

// ── Conversion: in-memory lore → DB rows ────────────────────────────────────

/**
 * Convert an ArchitectLore object into an array of DB row payloads suitable
 * for batch upserting into architect_lore. Each lore field becomes one or
 * more rows keyed by (scope, key).
 *
 * @param lore  The in-memory ArchitectLore object.
 * @returns     Array of { scope, key, payload } objects.
 */
export function loreToRows(
  lore: ArchitectLore,
): Array<{ scope: string; key: string; payload: Record<string, unknown> }> {
  const rows: Array<{ scope: string; key: string; payload: Record<string, unknown> }> = [];

  // ── Global: match ledger ───────────────────────────────────────────────
  rows.push({
    scope: 'global',
    key: 'match_ledger',
    payload: { entries: lore.matchLedger },
  });

  // ── Global: current season ─────────────────────────────────────────────
  rows.push({
    scope: 'global',
    key: 'current_season',
    payload: { value: lore.currentSeason },
  });

  // ── Player arcs ────────────────────────────────────────────────────────
  for (const [name, arc] of Object.entries(lore.playerArcs)) {
    rows.push({
      scope: `player:${name}`,
      key: 'arc',
      payload: arc as unknown as Record<string, unknown>,
    });
  }

  // ── Manager fates ──────────────────────────────────────────────────────
  for (const [name, fate] of Object.entries(lore.managerFates)) {
    rows.push({
      scope: `manager:${name}`,
      key: 'fate',
      payload: fate as unknown as Record<string, unknown>,
    });
  }

  // ── Rivalry threads ────────────────────────────────────────────────────
  for (const [rkey, rivalry] of Object.entries(lore.rivalryThreads)) {
    rows.push({
      scope: `rivalry:${rkey}`,
      key: 'thread',
      payload: rivalry as unknown as Record<string, unknown>,
    });
  }

  // ── Season arcs ────────────────────────────────────────────────────────
  for (const [sid, arc] of Object.entries(lore.seasonArcs)) {
    rows.push({
      scope: `season:${sid}`,
      key: 'arc',
      payload: arc as unknown as Record<string, unknown>,
    });
  }

  // ── Player relationships ───────────────────────────────────────────────
  for (const [relKey, rel] of Object.entries(lore.playerRelationships)) {
    rows.push({
      scope: `relationship:${relKey}`,
      key: 'details',
      payload: rel as unknown as Record<string, unknown>,
    });
  }

  return rows;
}

// ── LoreStore class ─────────────────────────────────────────────────────────

/**
 * Manages the Architect's persistent lore lifecycle: hydration from DB,
 * synchronous in-memory reads, and fire-and-forget writes.
 *
 * Usage:
 * ```ts
 * const store = new LoreStore(supabaseClient);
 * const lore = await store.hydrate();           // pre-match
 * // ... match runs, getContext() reads lore synchronously ...
 * store.persistAll(mutatedLore);                 // post-match (async, no await needed)
 * await store.flush();                           // match end — ensure all writes complete
 * ```
 *
 * The class also supports granular `enqueueWrite()` calls for future
 * in-match narrative events that need to persist immediately.
 */
export class LoreStore {
  private db: IslSupabaseClient;

  /**
   * Pending write promises from fire-and-forget upserts. `flush()` awaits
   * all of them and clears the array.
   */
  private pendingWrites: Promise<unknown>[] = [];

  constructor(db: IslSupabaseClient) {
    this.db = db;
  }

  /**
   * Load all lore from the DB and reconstruct the in-memory ArchitectLore
   * object. Call this once before the match simulation starts.
   *
   * If the table is empty or the query fails, returns a fresh empty lore
   * scaffold (same as CosmicArchitect._emptyLore()).
   *
   * @returns  Fully populated ArchitectLore object.
   */
  async hydrate(): Promise<ArchitectLore> {
    const rows = await loadAllLore(this.db);
    if (rows.length === 0) return emptyLore();
    return rowsToLore(rows);
  }

  /**
   * Enqueue a single fire-and-forget lore write. The write is added to the
   * pending queue and will be awaited on `flush()`.
   *
   * Use this for in-match narrative events that should persist immediately
   * without blocking the engine.
   *
   * @param scope   Lore scope (e.g. 'player:Kael Vorn').
   * @param key     Lore key within the scope (e.g. 'arc').
   * @param payload JSONB payload.
   */
  enqueueWrite(scope: string, key: string, payload: Record<string, unknown>): void {
    const promise = upsertLoreRow(this.db, scope, key, payload);
    this.pendingWrites.push(promise);
  }

  /**
   * Convert a full lore object to DB rows and batch-upsert them. This is
   * the primary write path for post-match lore persistence.
   *
   * The write is enqueued as a single batch operation. Call `flush()` after
   * if you need to ensure it completes before proceeding.
   *
   * @param lore  The mutated ArchitectLore object after match end.
   */
  persistAll(lore: ArchitectLore): void {
    const rows = loreToRows(lore);
    const promise = batchUpsertLore(this.db, rows);
    this.pendingWrites.push(promise);
  }

  /**
   * Await all pending fire-and-forget writes. Call this at match end to
   * ensure all lore mutations have been flushed to the DB before the
   * session ends.
   *
   * Errors in individual writes are logged by the API layer (warn-level)
   * but do not throw here — lore persistence is best-effort.  A failed
   * write means the next match will re-derive most state from existing
   * rivalryThreads + playerArcs rows, so a transient outage degrades
   * gracefully rather than corrupting the shared narrative.
   */
  async flush(): Promise<void> {
    await Promise.allSettled(this.pendingWrites);
    this.pendingWrites = [];
  }

  /**
   * Returns the number of pending (un-flushed) write operations. Useful
   * for debugging and tests.
   */
  get pendingCount(): number {
    return this.pendingWrites.length;
  }
}
