// ── features/admin/ui/SystemStatsCard.tsx ────────────────────────────────────
// "At a glance" landing surface for the admin dashboard.
//
// COMPOSITION
//   - SystemStatsCard: a hairline card of four cross-table aggregates
//     (users, credits in circulation, open wagers, completed matches), each
//     a shared StatBlock.
//   - OverviewPanel:   the default landing tab: renders the stats card plus
//     a short line pointing at the other tabs.
//
// WHY ONE FILE
//   The stats card is only used by the overview panel today; if a future
//   panel reuses it we can promote the component without restructuring.
//
// On the design language (docs/design-language.md) since its last group:
// shared SectionHeader, Card and StatBlock, no raw style values.

import { useEffect, useState } from 'react';
import type { IslSupabaseClient } from '@shared/supabase/client';
import { space, tone, type } from '../../../shared/design';
import { Card, SectionHeader, StatBlock } from '../../../shared/ui';
import { getSystemStats, type SystemStats } from '../api/admin';

// ── SystemStatsCard ──────────────────────────────────────────────────────────

/**
 * Hairline card showing four aggregate metrics.
 *
 * All four counts are fetched in parallel inside `getSystemStats` so the
 * cells appear together (no staggered pop-in).  No polling: the card
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

  // Single fetch on mount.  No interval: see file header for rationale.
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
    <Card>
      <div
        style={{
          display: 'grid',
          // Four across on a desktop, two on a phone: each column needs
          // about 140 px for the longest label to wrap onto two lines.
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: space[24],
        }}
      >
        {cells.map(({ label, value }) => (
          <StatBlock key={label} label={label} value={value} />
        ))}
      </div>
    </Card>
  );
}

// ── OverviewPanel ────────────────────────────────────────────────────────────

/**
 * Default landing panel for `/admin`.  Renders the stats card plus a short
 * line explaining what the other tabs hold.
 *
 * Intentionally light: the goal is "you know where you are" rather than
 * "everything on one screen."  Heavier surfaces (season controls, fixtures,
 * architect log) each get a dedicated tab.
 *
 * @param db  Supabase client forwarded to the embedded SystemStatsCard.
 */
export function OverviewPanel({ db }: { db: IslSupabaseClient }) {
  const strong = { ...tone.primary, fontWeight: 700 } as const;
  return (
    <section aria-labelledby="overview-heading">
      <SectionHeader index="I" label="Overview" title={<span id="overview-heading">At a glance</span>} />

      <SystemStatsCard db={db} />

      <p style={{ ...type.small, ...tone.secondary, marginTop: space[24], marginBottom: 0, maxWidth: '60ch' }}>
        Use the tabs above to drive the league: <strong style={strong}>Season</strong> for
        status and voting controls, <strong style={strong}>Fixtures</strong> for the match
        table, <strong style={strong}>Testing</strong> for destructive operations,
        <strong style={strong}> Architect</strong> for the intervention log, and
        <strong style={strong}> Viewer</strong> for the match viewer.
      </p>
    </section>
  );
}
