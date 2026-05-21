// ── features/admin/ui/ArchitectInterventionLog.tsx ───────────────────────────
// Read-only viewer for the `architect_interventions` audit table.
//
// WHAT IT SHOWS
//   Every mutation the Cosmic Architect makes (stat bumps, referee
//   strictness changes, narrative injections) writes one row to
//   `architect_interventions`.  This panel renders the most-recent rows as a
//   table so admins can audit the chaos director's activity — "why did this
//   player suddenly score a hat-trick?" usually has its answer here.
//
// WHY READ-ONLY
//   Interventions are immutable audit records.  Reversing one must be done
//   via the DB directly (service-role only) — intentional friction so no
//   admin accidentally wipes the Architect's lore.

import { useEffect, useState } from 'react';
import type { IslSupabaseClient } from '@shared/supabase/client';
import {
  getArchitectInterventions,
  type ArchitectIntervention,
} from '../api/admin';
import {
  DUST_50, DUST_FAINT, HAIRLINE, QUANTUM,
  LABEL_STYLE, VALUE_STYLE,
  PanelHeader, Skeleton, fmtDatetime,
} from './primitives';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Format an `old → new` value pair as a compact, single-line string for the
 * Change column.  Objects are JSON-stringified; primitives are coerced with
 * `String`.  `null` / `undefined` render as an em-dash so the column always
 * shows two arrowed segments even when one side is missing.
 *
 * Kept narrow on purpose — the full payloads remain in the DB, and the table
 * column is intentionally tight so the more-narrative Reason column reads
 * cleanly next to it.
 *
 * @param a  The "before" value (`old_value` column).
 * @param b  The "after"  value (`new_value` column).
 */
function diffStr(a: unknown, b: unknown): string {
  const fmt = (v: unknown) =>
    typeof v === 'object' ? JSON.stringify(v) : String(v ?? '—');
  return `${fmt(a)} → ${fmt(b)}`;
}

// ── Component ────────────────────────────────────────────────────────────────

/**
 * Architect intervention log panel.  Renders up to the most recent 50 rows
 * (cap enforced by `getArchitectInterventions`) in a hairline-bordered table,
 * newest-first.
 *
 * Empty state copy ("The Architect sleeps.") is intentional flavour for the
 * fresh-season case — no interventions yet recorded.
 *
 * @param db  Supabase client supplied by the parent.
 */
export function ArchitectInterventionLog({ db }: { db: IslSupabaseClient }) {
  const [rows, setRows]       = useState<ArchitectIntervention[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getArchitectInterventions(db)
      .then(setRows)
      .finally(() => setLoading(false));
  }, [db]);

  return (
    <section aria-labelledby="architect-heading">
      <PanelHeader id="architect-heading" title="Architect Intervention Log" />

      {loading ? (
        <Skeleton height={160} />
      ) : rows.length === 0 ? (
        <p style={{ ...VALUE_STYLE, color: DUST_50 }}>
          No interventions recorded yet.  The Architect sleeps.
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
                {['Table', 'Field', 'Change', 'Reason', 'When'].map((h) => (
                  <th key={h} style={{ ...LABEL_STYLE, padding: '8px 12px', textAlign: 'left' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} style={{ borderBottom: `1px solid ${DUST_FAINT}` }}>
                  <td style={{ ...VALUE_STYLE, padding: '10px 12px', fontSize: 12 }}>
                    {row.target_table}
                  </td>
                  <td style={{ ...VALUE_STYLE, padding: '10px 12px', fontSize: 12, color: QUANTUM }}>
                    {row.field ?? '—'}
                  </td>
                  <td style={{
                    ...VALUE_STYLE, padding: '10px 12px', fontSize: 11,
                    fontVariantNumeric: 'tabular-nums', maxWidth: 220, wordBreak: 'break-all',
                  }}>
                    {diffStr(row.old_value, row.new_value)}
                  </td>
                  <td style={{
                    ...VALUE_STYLE, padding: '10px 12px', fontSize: 12,
                    color: DUST_50, maxWidth: 320,
                  }}>
                    {row.reason}
                  </td>
                  <td style={{
                    ...VALUE_STYLE, padding: '10px 12px', fontSize: 11,
                    color: DUST_50, whiteSpace: 'nowrap',
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {fmtDatetime(row.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
