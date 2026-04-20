// ── NewsFeed.jsx ─────────────────────────────────────────────────────────────
// Route wrapper for the public Galaxy Dispatch news feed at /news.
//
// WHY a separate wrapper: pages under src/pages/ are thin route wrappers —
// they own the container div, padding, and any scroll/layout concerns for
// a specific URL. The real content lives in the feature component so it can
// be composed elsewhere (e.g. a sidebar preview widget) without reimporting
// the page shell.
//
// Unlike ArchitectLog.jsx, this page is NOT dev-only — the Galaxy Dispatch
// is a player-facing feature. All users (anonymous and authenticated) should
// be able to read the Architect's transmissions; mystery and lore are for
// everyone.
//
// LAYOUT NOTES
// ────────────
// The NewsFeedPage component owns its own `.container` wrapper and padding
// so this file is intentionally minimal — just enough to satisfy React
// Router's element prop requirement without adding redundant structure.

import { NewsFeedPage } from '../features/architect';

/**
 * /news route wrapper.
 *
 * Renders {@link NewsFeedPage} — the public Galaxy Dispatch narrative feed —
 * inside the site shell (Layout → Header + Outlet + Footer). No auth gate;
 * all visitors can read cosmic transmissions.
 *
 * @returns {JSX.Element}
 */
export default function NewsFeed() {
  return <NewsFeedPage />;
}
