// ── Voting.jsx ─────────────────────────────────────────────────────────────
// Route wrapper for the end-of-season voting page at /voting.
//
// WHY a separate wrapper: the route layer stays a thin .jsx shell that reads
// the current season from Supabase and passes `seasonId` down to the typed
// VotingPage component. This separates "which season are we on?" (a routing
// concern) from "render the voting UI for this season" (a feature concern),
// so the VotingPage component stays fully testable in isolation.
//

import { useEffect, useState } from 'react';
import { getActiveSeason } from '../lib/supabase';
import { useSupabase } from '../shared/supabase/SupabaseProvider';
import { VotingPage } from '../features/voting';

export default function Voting() {
  const db = useSupabase();

  const [seasonId, setSeasonId] = useState(null);
  const [error, setError]       = useState(null);

  useEffect(() => {
    getActiveSeason(db)
      .then((season) => setSeasonId(season?.id ?? null))
      .catch((e)     => setError(e?.message ?? 'Could not load active season'));
  }, [db]); // db is a stable context ref — safe to add without causing re-fetches

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
        <div className="container page-content">
          <p className="form-error">Error: {error}</p>
        </div>
      </div>
    );
  }

  if (!seasonId) {
    return (
      <div>
        {hero}
        <div className="container page-content">
          <p className="status-text">Loading season…</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {hero}
      <div className="container page-content">
        <VotingPage seasonId={seasonId} />
      </div>
    </div>
  );
}
