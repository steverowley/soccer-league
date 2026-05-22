// ── Admin.tsx ─────────────────────────────────────────────────────────────────
// Admin dashboard — `/admin` route.  Thin orchestrator that composes the
// per-panel subcomponents under `src/features/admin/ui/`.  Each panel owns
// its own data fetching, mutation handlers, and toast state — this file is
// responsible only for:
//   - the auth gate (delegated to `AdminAccessGate`)
//   - the static page hero (delegated to `AdminPageHero`)
//   - the URL-synced tab strip (presentational chips in `AdminTabStrip`)
//   - routing the active tab to its panel
//
// ACCESS CONTROL
//   See `AdminAccessGate` and migration 0032 for the full story.  The
//   client-side flag is a dev convenience; the real security boundary is
//   the server-side `admin_reset_season()` RPC, which rejects non-admins
//   with HTTP 403.

import { useSearchParams } from 'react-router-dom';
import Header from '../components/Header';
import { Container, Footer } from '../components/Layout';
import { useSupabase } from '../shared/supabase/SupabaseProvider';
import {
  AdminAccessGate,
  AdminPageHero,
  AdminTabStrip,
  DEFAULT_ADMIN_TAB,
  parseAdminTab,
  OverviewPanel,
  SeasonControlsPanel,
  FixtureBrowser,
  ArchitectInterventionLog,
  TestingPanel,
  type AdminTab,
} from '../features/admin/ui';

// ── Root page ─────────────────────────────────────────────────────────────────

/**
 * Admin dashboard root component.  Wraps every panel in `AdminAccessGate`
 * so non-admin visitors never see the inner panels regardless of the
 * current `?tab=…` value.  Adding a new tab is a one-line change in
 * `ADMIN_TABS` plus a new branch in the panel switch below.
 */
export default function Admin() {
  const db = useSupabase();

  // ── Tab state (URL-synced) ────────────────────────────────────────────────
  // `?tab=…` drives which panel renders.  Keeping state in the URL (rather
  // than a local `useState`) makes the active tab bookmarkable and lets
  // browser back/forward step between tabs naturally.  Unknown / missing
  // values fall back to DEFAULT_ADMIN_TAB without touching the URL.
  const [params, setParams] = useSearchParams();
  const activeTab: AdminTab = parseAdminTab(params.get('tab')) ?? DEFAULT_ADMIN_TAB;

  /**
   * Update the active tab and reflect the change in the URL.  Selecting
   * the default tab deletes the `?tab=…` param so `/admin` stays the
   * canonical form for the landing view.  `replace: true` so a burst of
   * clicks during exploration doesn't flood the browser history.
   *
   * @param next  The newly-selected tab id.
   */
  const onTabSelect = (next: AdminTab): void => {
    const params2 = new URLSearchParams(params);
    if (next === DEFAULT_ADMIN_TAB) params2.delete('tab');
    else                            params2.set('tab', next);
    setParams(params2, { replace: true });
  };

  return (
    <AdminAccessGate>
      <Header />
      <main>
        <AdminPageHero />
        <AdminTabStrip active={activeTab} onSelect={onTabSelect} />

        {/* ── Body panel (switched on tab) ───────────────────────────────
            Only the active panel renders — unmounted tabs lose state on
            switch, which is intentional: a stale fixture filter or
            in-flight toast shouldn't survive context switches between
            unrelated panels.  Each panel re-fetches on mount, so first
            paint of a tab is always a fresh view. */}
        <Container>
          <div style={{ padding: '32px 16px 80px' }}>
            {activeTab === 'overview'  && <OverviewPanel              db={db} />}
            {activeTab === 'season'    && <SeasonControlsPanel        db={db} />}
            {activeTab === 'fixtures'  && <FixtureBrowser             db={db} />}
            {activeTab === 'testing'   && <TestingPanel               db={db} />}
            {activeTab === 'architect' && <ArchitectInterventionLog   db={db} />}
          </div>
        </Container>
      </main>
      <Footer />
    </AdminAccessGate>
  );
}
