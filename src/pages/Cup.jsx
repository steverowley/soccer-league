// ── Cup.jsx ────────────────────────────────────────────────────────────────
// Route wrapper for the cup tournament pages at:
//   /cup/celestial      → Celestial Cup (top 3 per league)
//   /cup/solar-shield   → Solar Shield  (4th–6th per league)
//
// WHY a single shared wrapper: both cup competitions are structurally
// identical (single-elimination, 12 qualifiers, identical bracket schema).
// The only difference is which competition row to load and what title to
// show. A `cupKey` prop selects the variant, keeping the routing layer
// simple while letting the typed UI component (`CupBracket`) stay generic.
//
// FETCH FLOW (one effect, runs once per cupKey):
//   1. Read the competitions row by well-known UUID — fetches `bracket`,
//      `name`, `status`.
//   2. Read all teams in the competition_teams table for that competition,
//      joined to `teams` for display name + colour.
//   3. Read every match in the competition (already inserted by the seeder
//      and incrementally by advanceCupRound) so completed scorelines can
//      light up.
//
// EMPTY STATE: when `bracket` is null (cup has not yet been seeded — the
// league phase is still running), CupBracket renders its own friendly
// "draw pending" placeholder, so we don't need a separate branch here.

import { useEffect, useState } from 'react';
import { useSupabase } from '../shared/supabase/SupabaseProvider';
import {
  CupBracket,
  CELESTIAL_CUP_COMPETITION_ID,
  SOLAR_SHIELD_COMPETITION_ID,
} from '../features/match';

// ── Cup metadata ─────────────────────────────────────────────────────────────
// Maps the route-friendly slug to the competition UUID, the page title shown
// in the hero, and the qualifier description rendered as the bracket subtitle.
// Add new cups here; route registration in main.jsx must be updated to match.
const CUP_META = {
  celestial: {
    competitionId: CELESTIAL_CUP_COMPETITION_ID,
    title:         'Celestial Cup',
    subtitle:      'Top 3 from each league. Single-elimination knockout.',
  },
  'solar-shield': {
    competitionId: SOLAR_SHIELD_COMPETITION_ID,
    title:         'Solar Shield',
    subtitle:      'Mid-table qualifiers (4th–6th per league). Knockout.',
  },
};

/**
 * Page-level wrapper for a cup tournament.
 *
 * @param {Object} props
 * @param {'celestial' | 'solar-shield'} props.cupKey
 *   Which cup to display. Looks up the competition UUID, title, and
 *   subtitle from `CUP_META`.
 */
export default function Cup({ cupKey }) {
  const db   = useSupabase();
  const meta = CUP_META[cupKey];

  // bracket = StoredBracket | null  (null = not yet seeded)
  // teams   = Map<team_id, { team_id, name, color }>
  // scores  = Map<match_db_id, { match_db_id, home_score, away_score, completed }>
  const [bracket, setBracket] = useState(null);
  const [teams,   setTeams]   = useState(new Map());
  const [scores,  setScores]  = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    if (!meta) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);

      try {
        // ── 1. competitions row (bracket JSON + status) ────────────────
        const { data: comp, error: compErr } = await db
          .from('competitions')
          .select('id, name, status, bracket')
          .eq('id', meta.competitionId)
          .single();
        if (compErr) throw new Error(compErr.message);

        // ── 2. competition_teams joined to teams for display ───────────
        const { data: ct, error: ctErr } = await db
          .from('competition_teams')
          .select('team_id, seeding, team:teams (id, name, color)')
          .eq('competition_id', meta.competitionId);
        if (ctErr) throw new Error(ctErr.message);

        // ── 3. matches for scorelines ──────────────────────────────────
        const { data: matches, error: mErr } = await db
          .from('matches')
          .select('id, home_score, away_score, status')
          .eq('competition_id', meta.competitionId);
        if (mErr) throw new Error(mErr.message);

        if (cancelled) return;

        // Build display lookups.
        const teamsMap = new Map();
        for (const row of ct ?? []) {
          const t = row.team;
          if (!t) continue;
          teamsMap.set(t.id, { team_id: t.id, name: t.name, color: t.color ?? null });
        }

        const scoresMap = new Map();
        for (const m of matches ?? []) {
          scoresMap.set(m.id, {
            match_db_id: m.id,
            home_score:  m.home_score ?? 0,
            away_score:  m.away_score ?? 0,
            completed:   m.status === 'completed',
          });
        }

        setBracket(comp?.bracket ?? null);
        setTeams(teamsMap);
        setScores(scoresMap);
      } catch (e) {
        if (!cancelled) setError(e?.message ?? 'Failed to load cup');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [db, meta]);

  // ── Render ───────────────────────────────────────────────────────────────

  if (!meta) {
    // Unknown cupKey — defensive guard; the router should never pass this.
    return (
      <div className="container page-content">
        <p className="form-error">Unknown cup: {cupKey}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="page-hero">
        <div className="container">
          <h1>{meta.title}</h1>
          <hr className="divider" />
          <p className="subtitle">{meta.subtitle}</p>
        </div>
      </div>

      <div className="container page-content">
        {error && <p className="form-error">Error: {error}</p>}

        {loading && !error && (
          <p className="status-text">Reading the bracket…</p>
        )}

        {!loading && !error && (
          <CupBracket
            bracket={bracket}
            teams={teams}
            scores={scores}
            title={meta.title}
            subtitle={meta.subtitle}
          />
        )}
      </div>
    </div>
  );
}
