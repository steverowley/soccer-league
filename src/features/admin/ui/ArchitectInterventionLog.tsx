// ── features/admin/ui/ArchitectInterventionLog.tsx ───────────────────────────
// Read-only viewer for the `architect_interventions` audit table.
//
// WHAT IT SHOWS
//   Every mutation the Cosmic Architect makes (stat bumps, referee
//   strictness changes, narrative injections) writes one row to
//   `architect_interventions`.  This panel renders the most-recent rows as a
//   table so admins can audit the chaos director's activity: "why did this
//   player suddenly score a hat-trick?" usually has its answer here.
//
// WHY READ-ONLY
//   Interventions are immutable audit records.  Reversing one must be done
//   via the DB directly (service-role only): intentional friction so no
//   admin accidentally wipes the Architect's lore.
//
// LOOK (docs/design-language.md)
//   This is Architect content, so the table sits in an `architect` Card
//   (purple hairline) and the changed field is named in the Architect's
//   colour: the one place on the admin console purple carries meaning.
//   The table itself is the shared DataTable.

import { useEffect, useState } from 'react';
import type { IslSupabaseClient } from '@shared/supabase/client';
import { color, tone } from '../../../shared/design';
import { Card, DataTable, EmptyState, SectionHeader, Skeleton, dataCell, dataHead } from '../../../shared/ui';
import {
  getArchitectInterventions,
  type ArchitectIntervention,
} from '../api/admin';
import { fmtDatetime } from './format';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Format an `old → new` value pair as a compact, single-line string for the
 * Change column.  Objects are JSON-stringified; primitives are coerced with
 * `String`.  `null` / `undefined` render as a dash so the column always
 * shows two arrowed segments even when one side is missing.
 *
 * Kept narrow on purpose: the full payloads remain in the DB, and the table
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

/** Column headings, in order. */
const HEADINGS = ['Table', 'Field', 'Change', 'Reason', 'When'] as const;

// ── Component ────────────────────────────────────────────────────────────────

/**
 * Architect intervention log panel.  Renders up to the most recent 50 rows
 * (cap enforced by `getArchitectInterventions`) newest-first.
 *
 * Empty state copy ("The Architect sleeps.") is intentional flavour for the
 * fresh-season case: no interventions yet recorded.
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
      <SectionHeader index="I" label="Architect" title={<span id="architect-heading">Intervention log</span>} />

      {loading ? (
        <Skeleton height={160} />
      ) : rows.length === 0 ? (
        <EmptyState centred={false}>No interventions recorded yet.  The Architect sleeps.</EmptyState>
      ) : (
        <Card tone="architect" padding={0}>
          <DataTable caption="Architect interventions, newest first" minWidth={720}>
            <thead>
              <tr>
                {HEADINGS.map((h) => (
                  <th key={h} scope="col" style={dataHead()}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td style={dataCell()}>{row.target_table}</td>
                  <td style={{ ...dataCell(), color: color.architect }}>{row.field ?? '—'}</td>
                  <td style={{ ...dataCell(), maxWidth: 220, wordBreak: 'break-all' }}>
                    {diffStr(row.old_value, row.new_value)}
                  </td>
                  <td style={{ ...dataCell(), ...tone.secondary, maxWidth: 320 }}>{row.reason}</td>
                  <td style={{ ...dataCell(), ...tone.secondary, whiteSpace: 'nowrap' }}>
                    {fmtDatetime(row.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </Card>
      )}
    </section>
  );
}
