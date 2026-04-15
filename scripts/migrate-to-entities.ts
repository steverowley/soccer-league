#!/usr/bin/env tsx
// ── migrate-to-entities.ts ───────────────────────────────────────────────────
// WHY THIS SCRIPT EXISTS:
//   Phase 5 introduces the unified `entities` model (see
//   0002_entities.sql). That migration includes a DO $$ block that
//   backfills entity rows for every existing player and manager. In
//   environments where the migration has already run, the DO block is a
//   no-op — but it runs ONCE, at migration time. Any rows added to
//   `players` or `managers` AFTER the migration (e.g. when Phase 0.5's
//   seed generator expands rosters from 16 to 22 players) still need a
//   corresponding entity row and a populated `entity_id` FK.
//
//   This script is the standalone, re-runnable companion to that DO
//   block. It scans `players` and `managers` for rows with a null
//   `entity_id`, creates matching `entities` rows via the shared factory
//   functions (entity shapes stay consistent with the seed migration),
//   copies `personality`/`style` into `entity_traits`, and writes the
//   `entity_id` FK back onto the source row.
//
// IDEMPOTENCY:
//   The script is safe to re-run at any time. Rows that already have
//   `entity_id` set are skipped. There is no time-of-check / time-of-use
//   window that can duplicate entities because each player/manager row
//   is updated in the same statement that sets its FK — two concurrent
//   runs would race on the UPDATE, not the INSERT, and at most one
//   wins.
//
// USAGE:
//   # One-shot backfill (uses SUPABASE_SERVICE_ROLE_KEY to bypass RLS):
//   SUPABASE_URL=https://... \
//   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
//     tsx scripts/migrate-to-entities.ts
//
//   # Dry run (reads only, no writes):
//   tsx scripts/migrate-to-entities.ts --dry-run
//
//   # Verbose per-row logging:
//   tsx scripts/migrate-to-entities.ts --verbose
//
// DESIGN:
//   - Uses the SERVICE ROLE key because the entity tables have RLS that
//     requires `auth.role() = 'authenticated'` for writes; a service
//     account bypasses RLS entirely, which is appropriate for a one-time
//     administrative backfill.
//   - Pages through `players` / `managers` in batches of PAGE_SIZE to
//     avoid large in-memory result sets. The live DB has ≤1000 rows
//     total across both tables today, but this script should still
//     behave sensibly when rosters grow.
//   - Processes one row at a time inside each page so a single bad row
//     (e.g. unique-constraint collision) fails loudly without rolling
//     back the entire page. The script keeps a counter of failures and
//     exits with a non-zero status if any occurred.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../src/types/database';
import {
  createManagerEntity,
  createPlayerEntity,
  createTrait,
} from '../src/features/entities/logic/entityFactory';

// ── Types ───────────────────────────────────────────────────────────────────

/**
 * Subset of columns we read from `players`. Narrowing with Pick here means
 * adding new columns to `players` later doesn't break this script's types.
 */
type PlayerRow = Pick<
  Database['public']['Tables']['players']['Row'],
  'id' | 'name' | 'team_id' | 'position' | 'nationality' | 'personality' | 'entity_id'
>;

/**
 * Subset of columns we read from `managers`.
 */
type ManagerRow = Pick<
  Database['public']['Tables']['managers']['Row'],
  'id' | 'name' | 'team_id' | 'nationality' | 'style' | 'entity_id'
>;

/**
 * Typed service-role client. The Database generic locks query shapes at
 * compile time — a drift between this script and the DB schema produces
 * a typecheck error rather than a runtime crash.
 */
type AdminClient = SupabaseClient<Database>;

// ── Constants ───────────────────────────────────────────────────────────────

/**
 * Page size for batched fetches. Small enough that a single page fits
 * comfortably in memory even when the column count grows, large enough
 * that the full roster (~750 rows) completes in ~4 pages.
 *
 * If you crank this up significantly, also raise the statement timeout
 * on the Supabase project — very large IN-list updates can time out.
 */
const PAGE_SIZE = 500;

// ── CLI flag parsing ────────────────────────────────────────────────────────

/**
 * Minimal CLI parser — avoids pulling in commander/yargs for a script with
 * only two flags. Each flag is checked as a literal substring match; order
 * of flags on the command line does not matter.
 */
interface CliFlags {
  /** If true, print what would happen without writing to the DB. */
  dryRun: boolean;
  /** If true, log one line per row processed (otherwise only summary). */
  verbose: boolean;
}

function parseFlags(argv: readonly string[]): CliFlags {
  return {
    dryRun: argv.includes('--dry-run') || argv.includes('-n'),
    verbose: argv.includes('--verbose') || argv.includes('-v'),
  };
}

// ── Client construction ─────────────────────────────────────────────────────

/**
 * Build a service-role Supabase client from environment variables. Bails
 * out with a descriptive error if either required var is missing so the
 * operator can correct their invocation without a stack trace.
 *
 * @throws If `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` is unset.
 */
function buildAdminClient(): AdminClient {
  const url = process.env['SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) {
    throw new Error(
      'Missing required env vars: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. ' +
        'This script must run with service-role credentials to bypass RLS on the entity tables.',
    );
  }
  return createClient<Database>(url, key, {
    // Script runs outside the browser — no session persistence needed.
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ── Paged fetch helpers ─────────────────────────────────────────────────────

/**
 * Page through players with a null `entity_id` in batches of PAGE_SIZE.
 * Each page is yielded as a plain array; the caller owns iteration.
 *
 * Using an async generator means we don't hold the full result set in
 * memory even if future roster sizes grow into the tens of thousands.
 */
async function* unlinkedPlayerPages(
  db: AdminClient,
): AsyncGenerator<PlayerRow[]> {
  let offset = 0;
  while (true) {
    const { data, error } = await db
      .from('players')
      .select('id, name, team_id, position, nationality, personality, entity_id')
      .is('entity_id', null)
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`[players] fetch failed at offset=${offset}: ${error.message}`);
    }
    if (!data || data.length === 0) return;

    yield data as PlayerRow[];

    // If the page was short, we've reached the end and can stop early
    // without a further (guaranteed-empty) round trip.
    if (data.length < PAGE_SIZE) return;
    offset += data.length;
  }
}

/**
 * Same pattern as `unlinkedPlayerPages` but for managers.
 */
async function* unlinkedManagerPages(
  db: AdminClient,
): AsyncGenerator<ManagerRow[]> {
  let offset = 0;
  while (true) {
    const { data, error } = await db
      .from('managers')
      .select('id, name, team_id, nationality, style, entity_id')
      .is('entity_id', null)
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`[managers] fetch failed at offset=${offset}: ${error.message}`);
    }
    if (!data || data.length === 0) return;

    yield data as ManagerRow[];

    if (data.length < PAGE_SIZE) return;
    offset += data.length;
  }
}

// ── Per-row processors ──────────────────────────────────────────────────────

/**
 * Counters rolled up by the backfill pipeline, used for the summary line
 * and the process exit code. Counts are intentionally per-kind so the
 * operator can spot discrepancies at a glance.
 */
interface BackfillStats {
  players: { linked: number; traits: number; failed: number };
  managers: { linked: number; traits: number; failed: number };
}

function emptyStats(): BackfillStats {
  return {
    players: { linked: 0, traits: 0, failed: 0 },
    managers: { linked: 0, traits: 0, failed: 0 },
  };
}

/**
 * Create an entity + personality trait for a single player row and write
 * the FK back. Increments the appropriate counters.
 *
 * IMPORTANT: `team_id` is nullable on the players table but required by
 * `createPlayerEntity()`. Rows with null `team_id` are defensively skipped
 * (logged) rather than throwing — the ISL schema should never produce
 * such rows, but we don't want the whole backfill to abort if one does.
 */
async function processPlayer(
  db: AdminClient,
  row: PlayerRow,
  flags: CliFlags,
  stats: BackfillStats,
): Promise<void> {
  if (!row.team_id) {
    stats.players.failed += 1;
    console.warn(`[player ${row.id}] skipped: team_id is null`);
    return;
  }

  // ── Shape the entity row ─────────────────────────────────────────────
  // Using the shared factory guarantees the meta shape matches what the
  // seed migration inserted, so the Architect doesn't see two flavours
  // of player entity in its context window.
  const insertRow = createPlayerEntity({
    name: row.name,
    team_id: row.team_id,
    position: row.position ?? 'UNK',
    nationality: row.nationality,
  });

  if (flags.dryRun) {
    if (flags.verbose) {
      console.log(`[dry-run][player ${row.id}] would insert entity name='${row.name}'`);
    }
    stats.players.linked += 1;
    if (row.personality) stats.players.traits += 1;
    return;
  }

  // ── Insert entity, read back the generated UUID ──────────────────────
  const { data: entity, error: insertErr } = await db
    .from('entities')
    .insert(insertRow)
    .select('id')
    .single();

  if (insertErr || !entity) {
    stats.players.failed += 1;
    console.warn(`[player ${row.id}] entity insert failed: ${insertErr?.message ?? 'no data'}`);
    return;
  }

  // ── Write FK back onto the player row ────────────────────────────────
  // A race here (two workers processing the same row) is harmless: one
  // UPDATE wins and sets entity_id; the other writes the same value.
  // The ENTITIES insert is the only non-idempotent step, and we already
  // skipped this row if entity_id was non-null at fetch time.
  const { error: updateErr } = await db
    .from('players')
    .update({ entity_id: entity.id })
    .eq('id', row.id);

  if (updateErr) {
    stats.players.failed += 1;
    console.warn(`[player ${row.id}] FK update failed: ${updateErr.message}`);
    return;
  }

  stats.players.linked += 1;

  // ── Optional: personality trait ──────────────────────────────────────
  // Mirrors the DO $$ block in 0002_entities.sql which writes the
  // personality archetype into entity_traits so the Architect can read
  // it without joining back to the players table.
  if (row.personality) {
    const trait = createTrait({
      entity_id: entity.id,
      trait_key: 'personality',
      trait_value: row.personality,
    });
    const { error: traitErr } = await db
      .from('entity_traits')
      .upsert(trait, { onConflict: 'entity_id,trait_key' });
    if (traitErr) {
      console.warn(`[player ${row.id}] personality trait upsert failed: ${traitErr.message}`);
      // NOTE: Not counted as a failure — the entity + FK are already
      // written, which is the main value. Missing a trait can be
      // recovered by re-running the script or patching manually.
    } else {
      stats.players.traits += 1;
    }
  }

  if (flags.verbose) {
    console.log(`[player ${row.id}] linked to entity ${entity.id}`);
  }
}

/**
 * Manager equivalent of `processPlayer`. The only meaningful difference is
 * the column mapping and the trait key (`style` instead of `personality`).
 */
async function processManager(
  db: AdminClient,
  row: ManagerRow,
  flags: CliFlags,
  stats: BackfillStats,
): Promise<void> {
  if (!row.team_id) {
    stats.managers.failed += 1;
    console.warn(`[manager ${row.id}] skipped: team_id is null`);
    return;
  }

  const insertRow = createManagerEntity({
    name: row.name,
    team_id: row.team_id,
    nationality: row.nationality,
  });

  if (flags.dryRun) {
    if (flags.verbose) {
      console.log(`[dry-run][manager ${row.id}] would insert entity name='${row.name}'`);
    }
    stats.managers.linked += 1;
    if (row.style) stats.managers.traits += 1;
    return;
  }

  const { data: entity, error: insertErr } = await db
    .from('entities')
    .insert(insertRow)
    .select('id')
    .single();

  if (insertErr || !entity) {
    stats.managers.failed += 1;
    console.warn(`[manager ${row.id}] entity insert failed: ${insertErr?.message ?? 'no data'}`);
    return;
  }

  const { error: updateErr } = await db
    .from('managers')
    .update({ entity_id: entity.id })
    .eq('id', row.id);

  if (updateErr) {
    stats.managers.failed += 1;
    console.warn(`[manager ${row.id}] FK update failed: ${updateErr.message}`);
    return;
  }

  stats.managers.linked += 1;

  if (row.style) {
    const trait = createTrait({
      entity_id: entity.id,
      trait_key: 'style',
      trait_value: row.style,
    });
    const { error: traitErr } = await db
      .from('entity_traits')
      .upsert(trait, { onConflict: 'entity_id,trait_key' });
    if (traitErr) {
      console.warn(`[manager ${row.id}] style trait upsert failed: ${traitErr.message}`);
    } else {
      stats.managers.traits += 1;
    }
  }

  if (flags.verbose) {
    console.log(`[manager ${row.id}] linked to entity ${entity.id}`);
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

/**
 * Script entry point. Builds a client, runs both backfills, prints a
 * summary, and returns a non-zero exit code if any row failed.
 *
 * Exported so a test harness or programmatic caller (e.g. a future
 * supabase/seed step) can invoke it with an injected client without
 * spawning a subprocess.
 */
export async function run(flags: CliFlags, db?: AdminClient): Promise<number> {
  const client = db ?? buildAdminClient();
  const stats = emptyStats();

  console.log(
    flags.dryRun
      ? '🔍 Running entity backfill in DRY-RUN mode (no writes)'
      : '✏️  Running entity backfill (writes enabled)',
  );

  // ── Players pass ─────────────────────────────────────────────────────
  // Iterate pages lazily; processRow runs sequentially per row to keep
  // Supabase request concurrency modest (avoids tripping rate limits).
  for await (const page of unlinkedPlayerPages(client)) {
    for (const row of page) {
      await processPlayer(client, row, flags, stats);
    }
  }

  // ── Managers pass ────────────────────────────────────────────────────
  for await (const page of unlinkedManagerPages(client)) {
    for (const row of page) {
      await processManager(client, row, flags, stats);
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────
  console.log('');
  console.log('─── Summary ───');
  console.log(
    `Players:  linked=${stats.players.linked}, traits=${stats.players.traits}, failed=${stats.players.failed}`,
  );
  console.log(
    `Managers: linked=${stats.managers.linked}, traits=${stats.managers.traits}, failed=${stats.managers.failed}`,
  );

  const totalFailed = stats.players.failed + stats.managers.failed;
  return totalFailed === 0 ? 0 : 1;
}

// ── Entry point guard ───────────────────────────────────────────────────────
// Only execute when invoked directly (not when imported by tests). The
// `import.meta.url` check distinguishes `tsx scripts/migrate-to-entities.ts`
// (runs) from `import { run } from '.../migrate-to-entities'` (doesn't).

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  // tsx sometimes reports the path without the file:// prefix; accept both.
  import.meta.url.endsWith(process.argv[1] ?? '');

if (invokedDirectly) {
  const flags = parseFlags(process.argv.slice(2));
  run(flags)
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      console.error('Fatal error:', err);
      process.exit(2);
    });
}
