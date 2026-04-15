// ── ArchitectLogPage.tsx ────────────────────────────────────────────────────
// WHY: Dev-only page for sanity-checking the Cosmic Architect's historic
// rewrites. Whenever the Architect mutates a past row (match score, player
// stat, narrative summary, etc.) it writes an audit row to
// `architect_interventions` BEFORE touching the target table. This page
// renders that audit table so we can verify:
//   1. Every rewrite has a clear reason string.
//   2. The old/new value snapshots round-trip cleanly.
//   3. No rewrites are landing without an audit row (would be invisible).
//   4. Compensating "ROLLBACK NOTICE" rows show up when a mutation fails
//      after the audit.
//
// DESIGN PRINCIPLES:
//   - Truthful, not pretty: this is a dev tool. Functionality > polish.
//     We render JSON snapshots verbatim so nothing is hidden.
//   - Self-fetching: the page pulls its own data on mount and on a manual
//     refresh button. No global state, no event-bus subscriptions.
//   - Read-only by design: there is NO mutation control on this page. The
//     audit table is append-only and we treat it the same way the rest of
//     the app does — observable, not editable.
//
// CONSUMERS:
//   - src/app/architect-log.tsx — the dev-only route at /architect-log.
//     The route should be gated behind import.meta.env.DEV (or a feature
//     flag) so the page doesn't ship to production.

import { useCallback, useEffect, useState } from 'react';
import { useSupabase } from '@shared/supabase/SupabaseProvider';
import { getRecentInterventions } from '../api/interventions';
import type { ArchitectInterventionRow } from '../types';

// ── Tuning constants ───────────────────────────────────────────────────────

/**
 * Default page size for the audit fetch. 100 is enough for a couple of
 * weeks of cron-driven activity at typical Architect intervention rates
 * (~1–5 rewrites per day) without bloating the JSON parse cost.
 */
const DEFAULT_LIMIT = 100;

// ── Component ──────────────────────────────────────────────────────────────

/**
 * The dev-only Architect intervention audit log. Renders a table of recent
 * `architect_interventions` rows with a manual refresh control. No props.
 *
 * Lifecycle:
 *   1. On mount, fetch up to DEFAULT_LIMIT recent rows via the api layer.
 *   2. Render a table with timestamp, table, target id, field, snapshots,
 *      and reason. JSON snapshots are pretty-printed for readability.
 *   3. A "Refresh" button re-runs the fetch on demand — useful while
 *      iterating on the Edge Function or running manual rewrite tests.
 *
 * Edge cases handled:
 *   - Loading: shows a "loading…" message instead of an empty table.
 *   - Empty: explicit "no interventions yet" message rather than a stub
 *     table with no rows (so it's obvious nothing has been written).
 *   - Error: shows the failure inline with a retry hint.
 *   - Failed (compensating) rows: highlighted via a CSS modifier so the
 *     reviewer can spot them at a glance.
 */
export function ArchitectLogPage() {
  const db = useSupabase();
  const [rows, setRows] = useState<ArchitectInterventionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState<number>(0);

  // ── Fetch lifecycle ──────────────────────────────────────────────────────
  // WHY: Re-fetch on mount and whenever the manual refresh button bumps
  // `refreshTick`. Strict-mode-safe via the cancellation flag.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Reset state inside the async tick to satisfy the
      // react-hooks/set-state-in-effect rule.
      setRows(null);
      setError(null);
      try {
        const fetched = await getRecentInterventions(db, DEFAULT_LIMIT);
        if (cancelled) return;
        setRows(fetched);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load audit log');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db, refreshTick]);

  /** Bump the tick counter to force a re-fetch from the api layer. */
  const handleRefresh = useCallback(() => {
    setRefreshTick((t) => t + 1);
  }, []);

  // ── Render branches ──────────────────────────────────────────────────────

  return (
    <section className="architect-log" aria-labelledby="architect-log-title">
      <header className="architect-log__header">
        <h2 id="architect-log-title">Architect Intervention Log</h2>
        <p className="architect-log__intro">
          Every historic rewrite the Cosmic Architect performs writes an
          audit row before touching the target table. This page renders the
          most recent {DEFAULT_LIMIT} entries newest-first. Failed rewrites
          appear as compensating <code>ROLLBACK NOTICE</code> rows.
        </p>
        <button
          type="button"
          className="architect-log__refresh"
          onClick={handleRefresh}
          disabled={rows === null && error === null}
        >
          Refresh
        </button>
      </header>

      {error && (
        <p role="alert" className="architect-log__error">
          Could not load audit log — {error}
        </p>
      )}

      {!error && rows === null && (
        <p className="architect-log__loading">Loading audit log…</p>
      )}

      {!error && rows !== null && rows.length === 0 && (
        <p className="architect-log__empty">
          No interventions have been recorded yet. The Architect has been
          unusually quiet.
        </p>
      )}

      {!error && rows !== null && rows.length > 0 && (
        <table className="architect-log__table">
          <caption className="visually-hidden">
            Audit log of Architect interventions, newest first.
          </caption>
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Table</th>
              <th scope="col">Target</th>
              <th scope="col">Field</th>
              <th scope="col">Old</th>
              <th scope="col">New</th>
              <th scope="col">Reason</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <InterventionRow key={row.id} row={row} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ── Internal subcomponent ───────────────────────────────────────────────────

interface InterventionRowProps {
  row: ArchitectInterventionRow;
}

/**
 * A single audit row in the table. Extracted so the per-row CSS modifier
 * (failed/normal) and the JSON formatting helpers stay co-located. The
 * row applies a `is-failed` class when `meta.failed === true` so the
 * reviewer can spot compensating rollback rows at a glance.
 */
function InterventionRow({ row }: InterventionRowProps) {
  const isFailed = (row.meta as { failed?: unknown })?.failed === true;
  return (
    <tr
      className={`architect-log__row${isFailed ? ' is-failed' : ''}`}
      data-table={row.target_table}
    >
      <td className="architect-log__cell architect-log__cell--time">
        <time dateTime={row.created_at}>{formatDate(row.created_at)}</time>
      </td>
      <td className="architect-log__cell">{row.target_table}</td>
      <td className="architect-log__cell architect-log__cell--id">
        <code>{row.target_id ?? '—'}</code>
      </td>
      <td className="architect-log__cell">{row.field ?? <em>multi-column</em>}</td>
      <td className="architect-log__cell architect-log__cell--snapshot">
        <pre>{formatJson(row.old_value)}</pre>
      </td>
      <td className="architect-log__cell architect-log__cell--snapshot">
        <pre>{formatJson(row.new_value)}</pre>
      </td>
      <td className="architect-log__cell architect-log__cell--reason">
        {row.reason}
      </td>
    </tr>
  );
}

// ── Internal helpers ────────────────────────────────────────────────────────

/**
 * Pretty-print a JSON snapshot for the audit cell. Returns the literal
 * string `null` for null/undefined and falls back to `String(value)` for
 * anything that JSON.stringify can't handle (cyclic refs, BigInt, etc.).
 *
 * @param value  The snapshot value (any JSON-able shape).
 * @returns      A multi-line string ready for a `<pre>` tag.
 */
function formatJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * Format an ISO timestamp for the audit log. Uses the user's locale via
 * `toLocaleString` so the cell feels native. Falls back to the raw ISO
 * string if Date.parse fails — better than throwing inside a render.
 */
function formatDate(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  return new Date(ms).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
