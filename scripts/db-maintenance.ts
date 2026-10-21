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
 * Retries transient failures. A restricted, over-quota project is a stressed
 * project: the control plane intermittently answers 5xx or "Connection
 * terminated due to connection timeout" even for trivial catalog reads. Those
 * are worth retrying. A 4xx is a real error in our SQL and is raised at once,
 * because retrying a syntax error just wastes the operator's time.
 *
 * `vacuum` and `truncate` are not idempotent in the strict sense but are safe
 * to repeat: re-running either converges on the same end state.
 *
 * @param sql    A literal, reviewed statement from this file.
 * @param label  Human label used in error messages.
 * @returns      Result rows (empty array for statements that return none).
 */
async function runSql<T = Record<string, unknown>>(sql: string, label: string): Promise<T[]> {
  const MAX_ATTEMPTS = 7;
  let lastError = '';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN ?? ''}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: sql }),
      });
    } catch (err) {
      // Network-level failure: always transient.
      lastError = err instanceof Error ? err.message : String(err);
      await sleep(attempt);
      continue;
    }

    if (res.ok) {
      const json: unknown = await res.json();
      return Array.isArray(json) ? (json as T[]) : [];
    }

    const body = (await res.text()).slice(0, 400);

    // A 4xx means our statement is wrong; fail loudly rather than hammering.
    if (res.status < 500) {
      throw new Error(`[${label}] Management API ${res.status}: ${body}`);
    }

    lastError = `${res.status}: ${body}`;
    if (attempt < MAX_ATTEMPTS) {
      console.log(
        `  [${label}] transient ${lastError.slice(0, 90)} — retry ${attempt}/${MAX_ATTEMPTS - 1}`,
      );
      await sleep(attempt);
    }
  }

  throw new Error(`[${label}] Management API failed after ${MAX_ATTEMPTS} attempts: ${lastError}`);
}

/**
 * Back off between retries: 3s, 6s, 12s, 24s, then 30s thereafter.
 *
 * @param attempt  1-based attempt number just completed.
 */
function sleep(attempt: number): Promise<void> {
  const ms = Math.min(3000 * 2 ** (attempt - 1), 30_000);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Format a byte count the way a human reads a disk report. */
function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ── status ───────────────────────────────────────────────────────────────────

/**
 * Report the project's infrastructure state without touching the database.
 *
 * Added because every SQL statement, including trivial reads against a 0.6 MB
 * table, began failing with "Connection terminated due to connection timeout"
 * after earlier statements had succeeded. That symptom has two very different
 * causes and they need very different responses:
 *
 *   - a flaky-but-live database, which retrying eventually beats, or
 *   - a project Supabase has restricted or paused at the infrastructure level,
 *     where no amount of SQL will ever connect and only the owner can act.
 *
 * These endpoints are control-plane only, so they answer even when the database
 * is unreachable. That is exactly what makes them the right first question.
 */
async function status(): Promise<void> {
  const projectRes = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}`, {
    headers: { Authorization: `Bearer ${ACCESS_TOKEN ?? ''}` },
  });
  if (!projectRes.ok) {
    console.log(
      `project lookup: HTTP ${projectRes.status} ${(await projectRes.text()).slice(0, 200)}`,
    );
  } else {
    const p = (await projectRes.json()) as Record<string, unknown>;
    console.log(`project   : ${String(p['name'] ?? '?')} (${PROJECT_REF})`);
    console.log(`status    : ${String(p['status'] ?? '?')}`);
    console.log(`region    : ${String(p['region'] ?? '?')}`);
    console.log(`created   : ${String(p['created_at'] ?? '?')}`);
  }

  // Per-service health distinguishes "database down" from "whole project down".
  const healthRes = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/health?services=db&services=rest&services=auth`,
    { headers: { Authorization: `Bearer ${ACCESS_TOKEN ?? ''}` } },
  );
  if (healthRes.ok) {
    const services = (await healthRes.json()) as Array<Record<string, unknown>>;
    console.log('\nservices:');
    for (const s of services) {
      const err = s['error'] ? ` (${String(s['error']).slice(0, 120)})` : '';
      console.log(`  ${String(s['name'] ?? '?').padEnd(8)} ${String(s['status'] ?? '?')}${err}`);
    }
  } else {
    console.log(
      `\nhealth lookup: HTTP ${healthRes.status} ${(await healthRes.text()).slice(0, 200)}`,
    );
  }
  console.log('');
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
 * Delete position frames for matches older than the retention window.
 *
 * Replay frames are a *viewing* convenience, not the historical record: results,
 * scorers and `match_events` are untouched, the Chronicle keeps the narrative,
 * and `MatchPitchPanel` already degrades to a static formation when a match has
 * no frames.  Recent matches — the ones fans actually replay — are kept.
 *
 * IMPLEMENTATION: NEVER SCAN match_positions
 * ──────────────────────────────────────────
 * The Management API enforces a statement timeout (~2 min). An earlier version
 * asked `count(*) ... where match_id not in (...)`, which sequentially scans a
 * 2.1 GB table and was cancelled every time — so the tool could not even
 * measure, let alone prune.
 *
 * Every decision here is therefore made against `matches` (0.6 MB) or the
 * catalog, and the only statements that touch `match_positions` are keyed by
 * `match_id`, which is the leading column of its primary key. That turns each
 * delete into an index range scan over one match's ~2 731 rows.
 *
 * @param retentionDays  Keep frames for matches dated within this many days.
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

  // Expressed as "keep what is recent" rather than "prune what looks finished".
  // A disk-recovery tool must not leave rows behind because a match carries an
  // unexpected status or a null timestamp, and `created_at` is NOT NULL so the
  // coalesce always yields a real date.
  //
  // `retentionDays` is a validated integer, so this interpolation is safe.
  const matchAge = `coalesce(m.played_at, m.simulated_at, m.scheduled_at, m.created_at)`;

  // Cheap: both counts come from `matches`, and the size from the catalog.
  // `reltuples` is an estimate, which is all a progress report needs.
  const survey = await runSql<{
    recent: number;
    stale: number;
    est_rows: number;
    bytes: number;
  }>(
    `select
       (select count(*) from matches m
          where ${matchAge} >= now() - interval '${retentionDays} days') as recent,
       (select count(*) from matches m
          where ${matchAge} <  now() - interval '${retentionDays} days') as stale,
       (select coalesce(reltuples, 0)::bigint from pg_class
          where oid = 'match_positions'::regclass)                      as est_rows,
       pg_total_relation_size('match_positions')                        as bytes`,
    'prune-survey',
  );
  const recentMatches = Number(survey[0]?.recent ?? 0);
  const staleMatches = Number(survey[0]?.stale ?? 0);

  console.log(
    `match_positions : ~${Number(survey[0]?.est_rows ?? 0)} rows, ${mb(Number(survey[0]?.bytes ?? 0))}`,
  );
  console.log(`matches within ${retentionDays}d : ${recentMatches} (frames kept)`);
  console.log(`matches older      : ${staleMatches} (frames pruned)`);

  if (dryRun) {
    console.log('\n[dry-run] no changes made.\n');
    return;
  }
  if (staleMatches === 0) {
    console.log('\nNothing to prune.\n');
    return;
  }

  // Fast path: nothing is being kept, so drop the table's files outright.
  // The alternative, DELETE + VACUUM FULL, needs free disk roughly equal to
  // the data it rewrites, which is a poor assumption in a routine that exists
  // precisely because the disk is full. TRUNCATE needs no headroom and returns
  // the space immediately.
  if (recentMatches === 0) {
    console.log('\nNo match falls inside the retention window; truncating match_positions…');
    await runSql(`truncate table match_positions`, 'truncate');
    console.log('Done.\n');
    return;
  }

  // Otherwise: before grinding through matches one at a time, check whether the
  // retained matches hold any frames at all. On this league they usually do not
  // — "recent" matches are overwhelmingly *future* fixtures that have not been
  // played, so they have no replay data. When that holds, the retention window
  // protects nothing and TRUNCATE finishes the whole job in one statement
  // instead of hundreds.
  const recentIds = await runSql<{ id: string }>(
    `select m.id from matches m
     where ${matchAge} >= now() - interval '${retentionDays} days'`,
    'prune-recent-ids',
  );
  const safeRecent = toUuids(recentIds, 'recent');

  if (safeRecent.length > 0) {
    const probe = await runSql<{ n: number }>(
      `select count(*)::int as n from (
         select 1 from match_positions
         where match_id in (${safeRecent.map((id) => `'${id}'::uuid`).join(',')})
         limit 1
       ) t`,
      'prune-probe-recent',
    );
    if (Number(probe[0]?.n ?? 0) === 0) {
      console.log(
        `\nNone of the ${safeRecent.length} retained matches has replay frames ` +
          `(they are unplayed fixtures); truncating match_positions…`,
      );
      await runSql(`truncate table match_positions`, 'truncate');
      console.log('Done.\n');
      return;
    }
  }

  // Some retained matches really do hold frames, so delete the stale ones per
  // match. Each statement is an index range scan keyed on match_id.
  const ids = await runSql<{ id: string }>(
    `select m.id from matches m
     where ${matchAge} < now() - interval '${retentionDays} days'`,
    'prune-stale-ids',
  );
  const safeIds = toUuids(ids, 'stale');

  // Small chunks: 25 matches is ~68 000 rows per statement, which repeatedly
  // tripped the API timeout. A handful of matches per statement completes well
  // inside it, and a failure costs one chunk rather than the run.
  const CHUNK = 3;
  let done = 0;
  let failed = 0;
  for (let i = 0; i < safeIds.length; i += CHUNK) {
    const list = safeIds
      .slice(i, i + CHUNK)
      .map((id) => `'${id}'::uuid`)
      .join(',');
    try {
      await runSql(`delete from match_positions where match_id in (${list})`, 'prune-delete');
      done += CHUNK;
    } catch {
      // Keep going. Deletes commit per chunk, so progress survives, and the
      // next scheduled run picks up whatever this one could not finish.
      failed += CHUNK;
    }
    if ((i / CHUNK) % 10 === 0 || i + CHUNK >= safeIds.length) {
      console.log(`  pruned ~${Math.min(done, safeIds.length)}/${safeIds.length} matches`);
    }
  }
  if (failed > 0) {
    console.log(`  ${failed} match(es) could not be pruned this run; they retry next run.`);
  }

  // A plain DELETE only marks rows dead — Postgres keeps the pages, so the disk
  // quota (and therefore the restriction) would not budge. VACUUM FULL rewrites
  // only the surviving rows, so the headroom it needs is the size of what we
  // chose to keep, not the size of what we deleted.
  console.log('\nReclaiming disk (vacuum full match_positions)…');
  await runSql(`vacuum full match_positions`, 'vacuum');
  console.log('Done.\n');
}

/**
 * Validate database-supplied ids as UUIDs before they are interpolated into SQL.
 *
 * They come from our own tables, but they do reach a statement, so they get
 * checked rather than trusted.
 *
 * @param rows  Rows carrying an `id`.
 * @param tag   Label for the error message.
 * @returns     The ids, guaranteed to match the UUID pattern.
 */
function toUuids(rows: Array<{ id: string }>, tag: string): string[] {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const safe = rows.map((r) => r.id).filter((id) => typeof id === 'string' && UUID.test(id));
  if (safe.length !== rows.length) {
    throw new Error(`refusing to prune: ${rows.length - safe.length} ${tag} id(s) are not UUIDs`);
  }
  return safe;
}

// ── operational logs ─────────────────────────────────────────────────────────

/**
 * Trim the two extension-owned log tables that grow without bound.
 *
 * Neither holds game state:
 *   - `cron.job_run_details` is pg_cron's execution history. The match worker
 *     runs every minute, so this table gains ~1 440 rows a day forever. Recent
 *     history is genuinely useful for debugging a stuck worker; a year of it is
 *     not. It reached 279 MB (10.9% of the database).
 *   - `net._http_response` is pg_net's response buffer. It is a transient queue
 *     that callers read once; Supabase is meant to reap it and frequently does
 *     not. It reached 75.9 MB.
 *
 * Both are truncated or trimmed rather than vacuumed where possible, for the
 * same disk-headroom reason as the position fast path above.
 *
 * @param cronDays  Days of pg_cron execution history to retain.
 * @param dryRun    Measure only; make no changes.
 */
async function pruneOperationalLogs(cronDays: number, dryRun: boolean): Promise<void> {
  if (!Number.isInteger(cronDays) || cronDays < 1 || cronDays > 90) {
    throw new Error(`cron-retention-days must be an integer in [1, 90], got ${cronDays}`);
  }

  // Catalog estimates again, not count(*): these tables are hundreds of MB and
  // an exact count risks the same statement timeout that defeated the first
  // attempt at pruning. A groundskeeping report does not need exactness.
  const sizes = await runSql<{ cron_rows: number; http_rows: number }>(
    `select
       (select coalesce(reltuples, 0)::bigint from pg_class
          where oid = 'cron.job_run_details'::regclass)                  as cron_rows,
       (select coalesce(reltuples, 0)::bigint from pg_class
          where oid = 'net._http_response'::regclass)                    as http_rows`,
    'oplog-measure',
  );
  const cronRows = Number(sizes[0]?.cron_rows ?? 0);
  const httpRows = Number(sizes[0]?.http_rows ?? 0);

  console.log(`cron.job_run_details : ~${cronRows} rows (retaining ${cronDays}d)`);
  console.log(`net._http_response   : ~${httpRows} rows (clearing)`);

  if (dryRun) {
    console.log('\n[dry-run] no changes made to operational logs.\n');
    return;
  }

  if (cronRows > 0) {
    // Delete, then vacuum: VACUUM FULL rewrites only the surviving week of
    // history, so the headroom it needs is small regardless of how much is
    // being discarded.
    await runSql(
      `delete from cron.job_run_details where end_time < now() - interval '${cronDays} days'`,
      'cron-delete',
    );
    await runSql(`vacuum full cron.job_run_details`, 'cron-vacuum');
    console.log(`  trimmed cron.job_run_details to ${cronDays}d`);
  }

  if (httpRows > 0) {
    // Safe to drop wholesale: pg_net callers consume responses synchronously,
    // so anything still sitting here is already-read residue.
    await runSql(`truncate table net._http_response`, 'http-truncate');
    console.log(`  truncated net._http_response`);
  }
  console.log('');
}

// ── entrypoint ───────────────────────────────────────────────────────────────

/**
 * Run `report()` without letting its failure stop the caller.
 *
 * The size report is diagnostic; pruning is the actual job. A restricted
 * project drops connections unpredictably, and an earlier version aborted the
 * whole run because `pg_database_size` happened to time out. Never let the
 * nice-to-have gate the necessary.
 *
 * @param when  Label distinguishing the before/after report in the log.
 */
async function tryReport(when: string): Promise<void> {
  try {
    await report();
  } catch (err) {
    console.log(
      `\n[${when}] size report unavailable (${err instanceof Error ? err.message : String(err)}).`,
    );
    console.log('Continuing: the report is diagnostic, the prune is the job.\n');
  }
}

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

  const cIdx = argv.indexOf('--cron-retention-days');
  const cronDays = cIdx >= 0 ? Number.parseInt(argv[cIdx + 1] ?? '', 10) : 7;

  switch (command) {
    case 'status':
      await status();
      break;
    case 'report':
      await status();
      await report();
      break;
    case 'prune':
      // Always lead with the control-plane status. If the project is paused or
      // restricted at the infrastructure level, that single line explains every
      // subsequent connection failure and tells the operator what to do.
      await status();
      await tryReport('before');
      await prune(retentionDays, dryRun);
      await pruneOperationalLogs(cronDays, dryRun);
      if (!dryRun) await tryReport('after');
      break;
    default:
      console.error(`Unknown command '${command}'. Use: status | report | prune`);
      process.exit(2);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
