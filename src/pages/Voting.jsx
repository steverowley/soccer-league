// ── Voting.jsx ─────────────────────────────────────────────────────────────
// Route wrapper for the end-of-season voting page at /voting.
//
// WHY a separate wrapper: the route layer stays a thin .jsx shell that reads
// the current season from Supabase and passes `seasonId` down to the typed
// VotingPage component. This separates "which season are we on?" (a routing
// concern) from "render the voting UI for this season" (a feature concern),
// so the VotingPage component stays fully testable in isolation.
//
// SEASON RESOLUTION:
//   We re-use the legacy `getActiveSeason()` helper from src/lib/supabase.js
//   because the season-management feature hasn't been migrated to TypeScript
//   yet. Once it is, swap this for the typed equivalent.

import { useEffect, useState } from 'react';
import { getActiveSeason } from '../lib/supabase';
import { useSupabase } from '../shared/supabase/SupabaseProvider';
import { VotingPage } from '../features/voting';

/**
 * /voting route wrapper. Resolves the active season then hands off to
 * {@link VotingPage}. Shows a loading state while the season is fetching
 * and an error card if the fetch fails.
 *
 * @returns {JSX.Element}
 */
export default function Voting() {
  const db = useSupabase();

  const [seasonId, setSeasonId] = useState(null);
  const [error, setError]       = useState(null);

  useEffect(() => {
    getActiveSeason(db)
      .then((season) => setSeasonId(season?.id ?? null))
      .catch((e)     => setError(e?.message ?? 'Could not load active season'));
  }, [db]); // db is a stable context ref — safe to add without causing re-fetches

  // ── Loading / error shells ────────────────────────────────────────────────
  // Both states include the page hero so the layout doesn't jump when the
  // season resolves. Using a shared hero + inline message keeps the page
  // structurally identical across all three branches (loading / error / ready).

  const hero = (
    <div className="page-hero">
      <div className="container">
        <h1>Season Vote</h1>
        <hr className="divider" />
        <p className="subtitle">Pool your credits. Shape your club's future.</p>
      </div>
    </div>
  );

  if (error) {
    return (
      <div>
        {hero}
        <div className="container" style={{ paddingBottom: '80px' }}>
          <p style={{ color: 'var(--color-red)', fontSize: '13px' }}>Error: {error}</p>
        </div>
      </div>
    );
  }

  if (!seasonId) {
    return (
      <div>
        {hero}
        <div className="container" style={{ paddingBottom: '80px' }}>
          <p style={{ opacity: 0.6, fontSize: '13px' }}>Loading season…</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {hero}
      <div className="container" style={{ paddingBottom: '80px' }}>
        <VotingPage seasonId={seasonId} />
      </div>
    </div>
  );
}
