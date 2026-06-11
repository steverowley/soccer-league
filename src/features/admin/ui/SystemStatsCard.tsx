// ── features/admin/ui/SystemStatsCard.tsx ────────────────────────────────────
// "At a glance" landing surface for the admin dashboard.
//
// COMPOSITION
//   - SystemStatsCard: full-bleed 4-cell strip of cross-table aggregates
//     (users, credits in circulation, open wagers, completed matches).
//   - OverviewPanel:   the default landing tab — renders the stats strip plus
//     a short navigational kicker pointing at the other tabs.
//
// WHY ONE FILE
//   The stats strip is only used by the overview panel today; if a future
//   panel reuses it we can promote the component without restructuring.

import { useEffect, useState } from 'react';
import type { IslSupabaseClient } from '@shared/supabase/client';
import { getSystemStats, type SystemStats } from '../api/admin';
import {
  DUST, DUST_50, HAIRLINE, PHOBOS,
  LABEL_STYLE, VALUE_STYLE, PanelHeader,
} from './primitives';

// ── SystemStatsCard ──────────────────────────────────────────────────────────

/**
 * Full-bleed stats bar showing four aggregate metrics.
 *
 * All four counts are fetched in parallel inside `getSystemStats` so the
 * cells appear together (no staggered pop-in).  No polling — the row
 * refreshes when the admin reloads the page, which keeps DB load near zero
 * on a surface that is rarely open.
 *
 * Each cell shows `…` until the fetch resolves; an error surfaces as the
 * placeholder remaining indefinitely, which is acceptable for a dev surface.
 *
 * @param db  Supabase client supplied by the parent (uses the active session;
 *            anon clients see zeros where RLS denies the underlying tables).
 */
function SystemStatsCard({ db }: { db: IslSupabaseClient }) {
  const [stats, setStats] = useState<SystemStats | null>(null);

  // Single fetch on mount.  No interval — see file header for rationale.
  useEffect(() => {
    getSystemStats(db).then(setStats);
  }, [db]);

  // ── Cell descriptors ──────────────────────────────────────────────────────
  // Built every render because the placeholder string flips from "…" to the
  // formatted number as soon as `stats` resolves.  Cheap, four entries.
  const cells = [
    { label: 'Users',                  value: stats ? String(stats.totalUsers)                      : '…' },
    { label: 'Credits in circulation', value: stats ? `${stats.totalCredits.toLocaleString()} IC`   : '…' },
    { label: 'Open wagers',            value: stats ? String(stats.openWagers)                      : '…' },
    { label: 'Matches completed',      value: stats ? String(stats.completedMatches)                : '…' },
  ];

  return (
    <div
      style={{
        display: 'grid',
        // Four equal columns on desktop; responsive CSS below collapses to
        // 2-up on mobile so the numbers remain legible without horizontal
        // scrolling.
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 1,                           // 1-px gap renders as hairline rules between cells
        background: HAIRLINE,
        borderBottom: `1px solid ${HAIRLINE}`,
        marginBottom: 40,
      }}
      className="isl-stats-grid"
    >
      {cells.map(({ label, value }) => (
        <div key={label} style={{ background: PHOBOS, padding: '16px 20px' }}>
          <p style={{ ...LABEL_STYLE, marginBottom: 6 }}>{label}</p>
          <p style={{ ...VALUE_STYLE, fontSize: 18, fontWeight: 700 }}>{value}</p>
        </div>
      ))}
      <style>{`
        @media (max-width: 767px) { .isl-stats-grid { grid-template-columns: 1fr 1fr !important; } }
      `}</style>
    </div>
  );
}

// ── OverviewPanel ────────────────────────────────────────────────────────────

/**
 * Default landing panel for `/admin`.  Renders the stats strip plus a short
 * navigational kicker explaining how to move between the rest of the tabs.
 *
 * Intentionally light — the goal is "you know where you are" rather than
 * "everything on one screen."  Heavier surfaces (season controls, fixtures,
 * architect log) each get a dedicated tab.
 *
 * @param db  Supabase client forwarded to the embedded SystemStatsCard.
 */
export function OverviewPanel({ db }: { db: IslSupabaseClient }) {
  return (
    <section aria-labelledby="overview-heading">
      <PanelHeader id="overview-heading" title="At a Glance" />

      <SystemStatsCard db={db} />

      <p style={{ ...VALUE_STYLE, color: DUST_50, marginTop: 32, maxWidth: 560 }}>
        Use the tabs above to drive the league: <strong style={{ color: DUST }}>Season</strong> for
        status + voting controls, <strong style={{ color: DUST }}>Fixtures</strong> for the match
        table, <strong style={{ color: DUST }}>Roadmap</strong> for the planning board,
        <strong style={{ color: DUST }}> Testing</strong> for destructive ops, and
        <strong style={{ color: DUST }}> Architect</strong> for the intervention log.
      </p>
    </section>
  );
}
