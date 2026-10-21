// ── scripts/db-maintenance.ts ────────────────────────────────────────────────
// Disk-size reporting and position-frame pruning for the production database.
//
// WHY THIS EXISTS
// ───────────────
// `match_positions` (migration 0061) stores one JSONB frame every 2 seconds of
// match time — 2 731 rows and ~4.8 MB per match.  That migration's own header
// says the data "can be pruned after the season ends", but no pruning was ever
// built.  Season 1's completed fixtures therefore accumulated past the 500 MB
// Free-plan disk quota, Supabase restricted the project, and every API call —
// including auth — began returning HTTP 402.  The game went dark.
//
// This script is the missing half of that design: it measures where the disk
// actually went, and prunes replay frames the game no longer needs.
//
// WHY THE MANAGEMENT API AND NOT THE NORMAL CLIENT
// ────────────────────────────────────────────────
// A size-quota restriction blocks the project's own API gateway (PostgREST,
// Auth, Realtime all 402), so `@supabase/supabase-js` with the service-role key
// cannot reach the database precisely when we most need to shrink it.  The
// Management API (api.supabase.com) is a separate control plane and keeps
// working while the project is restricted, so it is the only route that can
// actually dig the project out.  This is also why the recovery path must be a
// script rather than a migration: migrations are applied through the same
// restricted project.
//
// SAFETY
// ──────
// Every statement below is a fixed, reviewed string.  Nothing from the CLI or
// from workflow inputs is ever interpolated into SQL except `retentionDays`,
// which is parsed with Number.parseInt and range-checked before use.  There is
// deliberately no "run arbitrary SQL" mode — this file is invoked by a GitHub
// workflow holding a management token, and that token must never become a
// general-purpose SQL console.
//
// USAGE
// ─────
//   npx tsx scripts/db-maintenance.ts report
//   npx tsx scripts/db-maintenance.ts prune --retention-days 14 --dry-run
//   npx tsx scripts/db-maintenance.ts prune --retention-days 14
//
// REQUIRED ENV
//   SUPABASE_ACCESS_TOKEN   Management API personal access token.
//   SUPABASE_PROJECT_REF    Project ref (defaults to the production ref).

const PROJECT_REF = process.env['SUPABASE_PROJECT_REF'] ?? 'ddtpbipkqamuxnvupddc';
const ACCESS_TOKEN = process.env['SUPABASE_ACCESS_TOKEN'];

/** Free-plan disk quota. Staying under this is what lifts the restriction. */
const FREE_PLAN_QUOTA_BYTES = 500 * 1024 * 1024;

/** Guard rails for the one caller-supplied number that reaches SQL. */
const MIN_RETENTION_DAYS = 1;
const MAX_RETENTION_DAYS = 365;

// ── Management API ───────────────────────────────────────────────────────────

/**
 * Run one fixed SQL statement through the Supabase Management API.
 *
 * @param sql    A literal, reviewed statement from this file.
 * @param label  Human label used in error messages.
 * @returns      Result rows (empty array for statements that return none).
 */
async function runSql<T = Record<string, unknown>>(sql: string, label: string): Promise<T[]> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN ?? ''}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`[${label}] Management API ${res.status}: ${body.slice(0, 400)}`);
  }

  const json: unknown = await res.json();
  return Array.isArray(json) ? (json as T[]) : [];
}

/** Format a byte count the way a human reads a disk report. */
function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ── report ───────────────────────────────────────────────────────────────────

/**
 * Print total database size and the largest tables, so the next action is
 * driven by measurement rather than by guesswork.
 *
 * @returns Total database size in bytes.
 */
async function report(): Promise<number> {
  const totals = await runSql<{ bytes: number }>(
    `select pg_database_size(current_database()) as bytes`,
    'total-size',
  );
  const total = Number(totals[0]?.bytes ?? 0);

  // `pg_total_relation_size` includes indexes and TOAST — the JSONB payloads in
  // match_positions live in TOAST, so a table-only measure would hide them.
  const tables = await runSql<{ table_name: string; bytes: number }>(
    `select
       quote_ident(schemaname) || '.' || quote_ident(relname) as table_name,
       pg_total_relation_size(relid)                          as bytes
     from pg_catalog.pg_statio_user_tables
     order by pg_total_relation_size(relid) desc
     limit 15`,
    'table-sizes',
  );

  console.log(`\nDatabase total : ${mb(total)}`);
  console.log(`Free-plan quota: ${mb(FREE_PLAN_QUOTA_BYTES)}`);
  console.log(
    total > FREE_PLAN_QUOTA_BYTES
      ? `OVER QUOTA by ${mb(total - FREE_PLAN_QUOTA_BYTES)} — project is restricted.\n`
      : `Under quota with ${mb(FREE_PLAN_QUOTA_BYTES - total)} to spare.\n`,
  );

  console.log('Largest tables:');
  for (const t of tables) {
    const share = total > 0 ? ((Number(t.bytes) / total) * 100).toFixed(1) : '0.0';
    console.log(
      `  ${String(t.table_name).padEnd(34)} ${mb(Number(t.bytes)).padStart(10)}  ${share.padStart(5)}%`,
    );
  }
  console.log('');
  return total;
}

// ── prune ────────────────────────────────────────────────────────────────────

/**
 * Delete position frames for matches that finished longer ago than the
 * retention window.
 *
 * Replay frames are a *viewing* convenience, not the historical record: results,
 * scorers and `match_events` are untouched, the Chronicle keeps the narrative,
 * and `MatchPitchPanel` already degrades to a static formation when a match has
 * no frames.  Recent matches — the ones fans actually replay — are kept.
 *
 * Implementation note: the delete runs in bounded batches because one unbounded
 * `delete` over ~600 k rows can exceed the Management API statement timeout and
 * roll back entirely, making progress impossible.  Batching lets each statement
 * commit, so a timeout costs one batch instead of the whole run.
 *
 * @param retentionDays  Keep frames for matches finished within this many days.
 * @param dryRun         Measure only; make no changes.
 */
async function prune(retentionDays: number, dryRun: boolean): Promise<void> {
  if (
    !Number.isInteger(retentionDays) ||
    retentionDays < MIN_RETENTION_DAYS ||
    retentionDays > MAX_RETENTION_DAYS
  ) {
    throw new Error(
      `retention-days must be an integer in [${MIN_RETENTION_DAYS}, ${MAX_RETENTION_DAYS}], got ${retentionDays}`,
    );
  }

  // `retentionDays` is a validated integer, so this interpolation is safe.
  const stalePredicate = `
    match_id in (
      select m.id from matches m
      where m.status = 'completed'
        and coalesce(m.completed_at, m.scheduled_at) < now() - interval '${retentionDays} days'
    )`;

  const before = await runSql<{ rows: number; bytes: number }>(
    `select
       (select count(*) from match_positions)                  as total_rows,
       (select count(*) from match_positions where ${stalePredicate}) as rows,
       pg_total_relation_size('match_positions')               as bytes`,
    'prune-measure',
  );
  const stale = Number(before[0]?.rows ?? 0);
  const totalRows = Number((before[0] as unknown as { total_rows?: number })?.total_rows ?? 0);

  console.log(`match_positions : ${totalRows} rows, ${mb(Number(before[0]?.bytes ?? 0))}`);
  console.log(`older than ${retentionDays}d: ${stale} rows`);

  if (dryRun) {
    console.log('\n[dry-run] no changes made.\n');
    return;
  }
  if (stale === 0) {
    console.log('\nNothing to prune.\n');
    return;
  }

  // Batched delete. ctid-based selection avoids re-running the subquery scan
  // for every batch.
  const BATCH = 50_000;
  let removed = 0;
  for (;;) {
    const res = await runSql<{ deleted: number }>(
      `with doomed as (
         select ctid from match_positions
         where ${stalePredicate}
         limit ${BATCH}
       )
       delete from match_positions mp
       using doomed
       where mp.ctid = doomed.ctid
       returning 1`,
      'prune-delete',
    );
    const n = res.length;
    removed += n;
    console.log(`  deleted ${removed}/${stale}`);
    if (n === 0) break;
  }

  // A plain DELETE only marks rows dead — Postgres keeps the pages, so the disk
  // quota (and therefore the restriction) would not budge. VACUUM FULL rewrites
  // the table and returns the space to the filesystem, which is the whole point
  // of this exercise.
  console.log('\nReclaiming disk (vacuum full match_positions)…');
  await runSql(`vacuum full match_positions`, 'vacuum');
  console.log('Done.\n');
}

// ── entrypoint ───────────────────────────────────────────────────────────────

/** Parse argv, dispatch, and exit non-zero on failure so CI goes red. */
async function main(): Promise<void> {
  if (!ACCESS_TOKEN) {
    console.error('SUPABASE_ACCESS_TOKEN is not set.');
    process.exit(2);
  }

  const argv = process.argv.slice(2);
  const command = argv[0] ?? 'report';
  const dryRun = argv.includes('--dry-run');

  const dIdx = argv.indexOf('--retention-days');
  const retentionDays = dIdx >= 0 ? Number.parseInt(argv[dIdx + 1] ?? '', 10) : 14;

  switch (command) {
    case 'report':
      await report();
      break;
    case 'prune':
      await report();
      await prune(retentionDays, dryRun);
      if (!dryRun) await report();
      break;
    default:
      console.error(`Unknown command '${command}'. Use: report | prune`);
      process.exit(2);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
