// ── Leagues.jsx ───────────────────────────────────────────────────────────────
// The Intergalactic Leagues listing page.  Implements the mockup layout:
//
//   H1: INTERGALACTIC LEAGUES
//   ─────────────────────────────
//   Tagline subtitle
//
//   ┌───────────────────┐  ┌───────────────────┐
//   │ ROCKY INNER LEAGUE│  │ GAS/ICE GIANTS    │
//   │ Description...    │  │ Description...    │
//   │ [VIEW LEAGUE]     │  │ [VIEW LEAGUE]     │
//   └───────────────────┘  └───────────────────┘
//   ┌───────────────────┐  ┌───────────────────┐
//   │ OUTER REACHES     │  │ KUIPER BELT       │
//   │ Description...    │  │ Description...    │
//   │ [VIEW LEAGUE]     │  │ [VIEW LEAGUE]     │
//   └───────────────────┘  └───────────────────┘
//
// The 2-column desktop grid collapses to 1 column on mobile.
// Each card links to /leagues/:leagueId for the League Detail page.
//
// DATA SOURCE
// ───────────
// League records are fetched from Supabase on mount.  The DB is the single
// source of truth for league names and descriptions.  A loading state is
// shown while the fetch is in flight; the grid renders once data arrives.

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Button from '../components/ui/Button';
import { getLeagues } from '../lib/supabase';

/**
 * Intergalactic Leagues listing page.
 *
 * Fetches all four ISL leagues from Supabase and renders them as equal-height
 * cards in a 2-column desktop grid.  Each card displays the league name,
 * description prose, and a "VIEW LEAGUE" primary button that navigates to
 * the league detail page.
 *
 * Shows a brief loading message while the fetch is in flight; on error falls
 * back to an inline message rather than crashing the page.
 *
 * @returns {JSX.Element}
 */
export default function Leagues() {
  // ── Data fetch ────────────────────────────────────────────────────────────
  // Leagues are stable reference data — fetch once on mount, no polling needed.
  const [leagues, setLeagues]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error,   setError]     = useState(false);

  useEffect(() => {
    getLeagues()
      .then(data => {
        setLeagues(data);
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, []); // empty deps: run once on mount

  return (
    <div className="container" style={{ paddingTop: '40px', paddingBottom: '40px' }}>

      {/* ── Page hero ───────────────────────────────────────────────────────── */}
      <div className="page-hero" style={{ textAlign: 'center', marginBottom: '40px' }}>
        <h1>Intergalactic Leagues</h1>
        <hr className="divider" style={{ maxWidth: '600px', margin: '16px auto 16px' }} />
        <p className="subtitle">The most exciting soccer simulation game in the solar system!</p>
      </div>

      {/* ── Loading / error states ──────────────────────────────────────────── */}
      {loading && (
        <p style={{ textAlign: 'center', opacity: 0.5, fontSize: '14px' }}>
          Loading leagues…
        </p>
      )}
      {error && (
        <p style={{ textAlign: 'center', opacity: 0.5, fontSize: '14px' }}>
          Could not load leagues. Please try again later.
        </p>
      )}

      {/* ── League cards grid ───────────────────────────────────────────────── */}
      {/* 2-column desktop grid; each card stretches to the same height via
          `align-items: stretch` on the grid container so that pairs of cards
          always share the same bottom edge — matching the mockup. */}
      {!loading && !error && (
        <div
          className="leagues-grid"
          style={{
            display: 'grid',
            // Two equal columns on desktop; single column on narrow viewports
            // via the .leagues-grid responsive rule in index.css.
            gridTemplateColumns: '1fr 1fr',
            gap: '24px',
          }}
        >
          {leagues.map(league => (
            // ── Individual league card ───────────────────────────────────────
            // flex column layout pushes the button to the bottom of the card
            // regardless of description length, keeping all rows visually aligned.
            <div
              key={league.id}
              className="card"
              style={{ display: 'flex', flexDirection: 'column' }}
            >
              {/* League name — .card-title gives the standardised in-card
                  heading size (18px uppercase) shared across all listing cards. */}
              <h3 className="card-title">{league.name}</h3>

              {/* Description prose — grows to fill available card space so the
                  button stays at the bottom even on cards with short text. */}
              <p style={{ fontSize: '14px', lineHeight: 1.7, opacity: 0.85, flex: 1, marginBottom: '24px' }}>
                {league.description}
              </p>

              {/* VIEW LEAGUE button — primary variant per the design spec.
                  Wrapped in Link rather than using a button onClick so the
                  navigation is accessible and crawlable. */}
              <div>
                <Link to={`/leagues/${league.id}`}>
                  <Button variant="primary">View League</Button>
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

    </div>
  );
}
