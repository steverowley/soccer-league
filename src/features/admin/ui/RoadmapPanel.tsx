// ── features/admin/ui/RoadmapPanel.tsx ───────────────────────────────────────
// Thin wrapper that embeds the bd-mirrored kanban board inside the admin
// tab strip.  Same component the (formerly public, now admin-gated)
// `/roadmap` page renders; surfacing it here gives admins a one-click path
// from operational state (Season, Fixtures, Architect) to planning state
// without leaving the admin context.
//
// No `db` prop — the board pulls its own Supabase client via `useSupabase()`
// inside its own component tree.

import { RoadmapBoard } from '../../roadmap';
import { PanelHeader } from './primitives';

/**
 * Roadmap admin tab.  Wraps `RoadmapBoard` with an accessible section header
 * so it sits inside the tab strip alongside the other admin panels with
 * consistent typography and ARIA labelling.
 */
export function RoadmapPanel() {
  return (
    <section aria-labelledby="roadmap-heading">
      <PanelHeader id="roadmap-heading" title="Roadmap" />
      <RoadmapBoard />
    </section>
  );
}
