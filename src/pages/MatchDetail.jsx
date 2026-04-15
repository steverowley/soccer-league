// ── MatchDetail.jsx ─────────────────────────────────────────────────────────
// Individual match page at /matches/:matchId.
//
// SECTIONS:
//   1. MATCH HEADER — home vs away, competition/round, status badge, score
//      if completed, weather/stadium flavour text.
//   2. WAGER WIDGET — shown for 'scheduled' matches; disabled after kickoff.
//      If no odds row exists yet we compute them on-the-fly from team stats
//      so the first visitor to the page bootstraps the odds for everyone.
//   3. BET HISTORY — filtered to this match (user's own wagers only, via RLS).
//
// DATA STRATEGY:
//   - `getMatch(matchId)` from the legacy supabase.js returns a rich row:
//     home_team + away_team with nested players/managers, competition name,
//     match_player_stats. This is the same helper the Matches page uses.
//   - `getMatchOdds(db, matchId)` from the betting feature. On cache-miss
//     for a scheduled match we compute odds from the nested team data via
//     `computeAvgRating` + `computeForm` + `computeMatchOdds`, then persist
//     via `saveMatchOdds` so subsequent visitors pay no extra DB round-trip.
//   - Form is derived from the teams' players' average stats only (no
//     historical match query) until a proper "recent results" API is built.
//     This is a conscious simplification — odds will be updated by the
//     backend odds-generation job in a later phase.
//
// KICKOFF TIMING:
//   The matches table stores `played_at` (when a match was saved as
//   completed) but NOT an explicit scheduled kickoff timestamp. We map
//   the three status values to a synthetic kickoffAt:
//     'scheduled'   → far-future sentinel (bets remain open)
//     'in_progress' → 1 ms in the past   (bets close immediately)
//     'completed'   → played_at          (bets closed at completion time)
//   This is a known limitation; a `scheduled_at` column is the right fix.

import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../features/auth';
import { useSupabase } from '../shared/supabase/SupabaseProvider';
import { WagerWidget, BetHistory, getMatchOdds, saveMatchOdds } from '../features/betting';
import { computeAvgRating, computeMatchOdds } from '../features/betting';
import { getMatch } from '../lib/supabase';
import Button from '../components/ui/Button';

// ── Sentinel kickoff timestamp for 'scheduled' matches ─────────────────────
// A far-future date so WagerWidget treats the match as "not yet kicked off"
// and keeps the betting form enabled. Replace with a real `scheduled_at`
// column once it's added to the schema.
const FAR_FUTURE = '2099-01-01T00:00:00.000Z';

/**
 * Derive a synthetic kickoffAt timestamp from a match row. WagerWidget
 * uses this to decide whether to show the stake form or the "bets closed"
 * banner.
 *
 * @param {object} match  Match row with `status` and optional `played_at`.
 * @returns {string}       ISO timestamp the widget should treat as kickoff.
 */
function deriveKickoffAt(match) {
  switch (match.status) {
    case 'completed':
      // played_at is set when a match result is saved. Use it so the widget
      // correctly shows "bets closed" without relying on any current time.
      return match.played_at ?? new Date(Date.now() - 1).toISOString();
    case 'in_progress':
      // Match has started — close bets by returning a time just in the past.
      return new Date(Date.now() - 1_000).toISOString();
    case 'scheduled':
    default:
      return FAR_FUTURE;
  }
}

/**
 * Compute and save odds from the match's nested team data. Called once
 * when a scheduled match page is viewed and no odds row exists yet. This
 * bootstraps odds for all subsequent visitors without requiring a
 * server-side cron.
 *
 * Uses starter players only (starter=true) to match the engine's
 * createAgent() contract which computes stats from starters.
 *
 * @param {object}          db       Injected Supabase client.
 * @param {object}          match    Match row with nested home_team + away_team.
 * @returns {Promise<object|null>}   The saved MatchOdds row, or null on failure.
 */
async function computeAndSaveOdds(db, match) {
  const homePlayers = (match.home_team?.players ?? []).filter((p) => p.starter);
  const awayPlayers = (match.away_team?.players ?? []).filter((p) => p.starter);

  // Average rating across the five core stat columns. Falls back to 70
  // (functional default) when a team has no starter rows in the DB yet.
  const homeInput = {
    avgRating: computeAvgRating(homePlayers),
    form: { wins: 2, draws: 1, losses: 2 }, // Neutral 5-match form until history API exists.
  };
  const awayInput = {
    avgRating: computeAvgRating(awayPlayers),
    form: { wins: 2, draws: 1, losses: 2 },
  };

  const { homeOdds, drawOdds, awayOdds } = computeMatchOdds(homeInput, awayInput);

  return saveMatchOdds(db, match.id, homeOdds, drawOdds, awayOdds);
}

// ── Status badge labels + colour mapping ───────────────────────────────────
// Three possible statuses in the schema; each gets a distinct visual cue.

/** Human-readable labels for each match status value. */
const STATUS_LABEL = {
  scheduled:   'Upcoming',
  in_progress: 'Live',
  completed:   'Final',
};

/** CSS colour variable for each match status badge. */
const STATUS_COLOR = {
  scheduled:   'var(--color-dust)',
  in_progress: 'var(--color-purple)',
  completed:   'rgba(227,224,213,0.4)',
};

/**
 * /matches/:matchId route page.
 *
 * Fetches the match, derives/bootstraps odds, then renders the match
 * header, WagerWidget, and filtered BetHistory in one container.
 *
 * @returns {JSX.Element}
 */
export default function MatchDetail() {
  const { matchId } = useParams();
  const { user }    = useAuth();
  const db          = useSupabase();

  const [match,      setMatch]      = useState(null);
  const [odds,       setOdds]       = useState(null);      // null = loading; false = none available
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState(null);
  // Bumped after a successful wager so BetHistory re-fetches.
  const [wageredKey, setWageredKey] = useState(0);

  // ── Data fetch ─────────────────────────────────────────────────────────
  // WHY: We parallelise the two reads (match row + odds row) to minimise
  // total latency. If no odds row exists for a scheduled match we compute
  // and save them as a side-effect, then update local state from the result.
  const loadData = useCallback(async () => {
    if (!matchId) return;
    setLoading(true);
    setError(null);
    try {
      const [matchRow, oddsRow] = await Promise.all([
        getMatch(matchId),
        getMatchOdds(db, matchId),
      ]);

      setMatch(matchRow);

      if (oddsRow) {
        setOdds(oddsRow);
      } else if (matchRow?.status === 'scheduled') {
        // No odds stored yet — compute from team stats and persist so the
        // next visitor doesn't have to pay for the computation again.
        const computed = await computeAndSaveOdds(db, matchRow);
        setOdds(computed ?? false); // false = computation failed, show placeholder
      } else {
        // Completed/in-progress match with no odds row — betting was either
        // never available or already settled. Show nothing.
        setOdds(false);
      }
    } catch (e) {
      setError(e?.message ?? 'Failed to load match');
    } finally {
      setLoading(false);
    }
  }, [db, matchId]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Render branches ────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="container" style={{ paddingTop: '40px' }}>
        <p style={{ opacity: 0.6 }}>Loading match…</p>
      </div>
    );
  }

  if (error || !match) {
    return (
      <div className="container" style={{ paddingTop: '40px' }}>
        <p style={{ color: 'var(--color-red)' }}>{error ?? 'Match not found.'}</p>
        <Link to="/matches">
          <Button variant="secondary" style={{ marginTop: '16px' }}>← Back to Matches</Button>
        </Link>
      </div>
    );
  }

  // ── Derived display values ─────────────────────────────────────────────
  const homeTeam   = match.home_team;
  const awayTeam   = match.away_team;
  const isComplete = match.status === 'completed';
  const kickoffAt  = deriveKickoffAt(match);

  // Shape for WagerWidget — only the three fields it needs.
  const wagerMatch = {
    id:           match.id,
    homeTeamName: homeTeam?.name ?? 'Home',
    awayTeamName: awayTeam?.name ?? 'Away',
    kickoffAt,
  };

  return (
    <div className="container" style={{ paddingTop: '40px', paddingBottom: '80px' }}>

      {/* ── Breadcrumb ─────────────────────────────────────────────────────── */}
      <nav style={{ marginBottom: '24px', fontSize: '12px', opacity: 0.5 }}>
        <Link to="/matches" style={{ color: 'inherit' }}>Matches</Link>
        {' / '}
        <span>{homeTeam?.name} vs {awayTeam?.name}</span>
      </nav>

      {/* ── Match header card ─────────────────────────────────────────────── */}
      {/* The score is the centrepiece for completed matches; the status badge
          is the centrepiece for upcoming ones. The same card hosts both so
          the layout doesn't shift between states. */}
      <section className="section">
        <div className="card" style={{ maxWidth: '640px' }}>

          {/* Competition + round context */}
          <p style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em', opacity: 0.5, marginBottom: '12px' }}>
            {match.competitions?.name}
            {match.round ? ` — ${match.round}` : ''}
          </p>

          {/* Status badge */}
          <span style={{
            display: 'inline-block',
            fontSize: '11px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: STATUS_COLOR[match.status] ?? 'var(--color-dust)',
            border: `1px solid ${STATUS_COLOR[match.status] ?? 'var(--color-dust)'}`,
            padding: '2px 8px',
            marginBottom: '20px',
          }}>
            {STATUS_LABEL[match.status] ?? match.status}
          </span>

          {/* Teams + score row */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px',
            marginBottom: '16px',
          }}>
            {/* Home team */}
            <div style={{ flex: 1, textAlign: 'left' }}>
              <Link
                to={`/teams/${homeTeam?.id}`}
                style={{ color: 'var(--color-dust)', textDecoration: 'none' }}
              >
                <h2 style={{ fontSize: '20px', fontWeight: 700 }}>{homeTeam?.name}</h2>
              </Link>
            </div>

            {/* Score — shown for completed matches; vs separator otherwise */}
            <div style={{ textAlign: 'center', minWidth: '80px' }}>
              {isComplete ? (
                <span style={{ fontSize: '36px', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                  {match.home_score} – {match.away_score}
                </span>
              ) : (
                <span style={{ fontSize: '20px', opacity: 0.4 }}>vs</span>
              )}
            </div>

            {/* Away team */}
            <div style={{ flex: 1, textAlign: 'right' }}>
              <Link
                to={`/teams/${awayTeam?.id}`}
                style={{ color: 'var(--color-dust)', textDecoration: 'none' }}
              >
                <h2 style={{ fontSize: '20px', fontWeight: 700 }}>{awayTeam?.name}</h2>
              </Link>
            </div>
          </div>

          {/* Stadium / weather flavour line */}
          {(match.stadium || match.weather) && (
            <p style={{ fontSize: '11px', opacity: 0.4, textAlign: 'center' }}>
              {[match.stadium, match.weather].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
      </section>

      {/* ── Wager widget ─────────────────────────────────────────────────────── */}
      {/* Only show the widget when odds are available (or loading). If the match
          is completed and odds were never stored we skip it entirely — there's
          nothing to bet on and no meaningful odds to show. */}
      {odds !== false && (
        <section className="section">
          <WagerWidget
            match={wagerMatch}
            odds={odds || null}
            onWagerPlaced={() => setWageredKey((k) => k + 1)}
          />
        </section>
      )}

      {/* ── Bet history filtered to this match ───────────────────────────────── */}
      {/* Only shown to logged-in users — anonymous users have no wager history.
          The matchId filter is applied client-side inside BetHistory. */}
      {user && (
        <section className="section">
          <BetHistory
            userId={user.id}
            matchId={match.id}
            limit={20}
            refreshKey={wageredKey}
          />
        </section>
      )}

    </div>
  );
}
